export async function fetchNotes(client) {
  const { data, error } = await client
    .from('notes')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return data || [];
}


export async function createNote(client, payload) {
  const { data, error } = await client
    .from('notes')
    .insert([payload])
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}


function storagePathFromPublicUrl(imgUrl) {
  if (!imgUrl) {
    return null;
  }

  try {
    const url = new URL(imgUrl);
    const marker = '/storage/v1/object/public/notes/';
    const markerIndex = url.pathname.indexOf(marker);

    if (markerIndex === -1) {
      return null;
    }

    return decodeURIComponent(
      url.pathname.slice(markerIndex + marker.length)
    );
  } catch {
    return null;
  }
}


export async function deleteNote(client, note) {
  if (!note?.id) {
    throw new Error('缺少留言 ID。');
  }

  // 先删除 Storage 图片。这样如果图片删除没有权限，数据库留言也不会被删掉。
  const imagePath = storagePathFromPublicUrl(note.img_url);

  if (imagePath) {
    const { error: storageError } = await client.storage
      .from('notes')
      .remove([imagePath]);

    if (storageError) {
      throw new Error(`图片删除失败：${storageError.message}`);
    }
  }

  const { error } = await client
    .from('notes')
    .delete()
    .eq('id', note.id);

  if (error) {
    throw error;
  }
}


export function subscribeToNotes(client, onChange) {
  return client
    .channel('notes-realtime')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notes'
      },
      payload => {
        console.log('Realtime event received:', payload);

        if (typeof onChange === 'function') {
          onChange(payload);
        }
      }
    )
    .subscribe(status => {
      console.log('Realtime status:', status);
    });
}


/* =========================
   评论
========================= */

export async function fetchComments(client, noteIds = []) {
  const ids = (noteIds || []).filter(id => id !== null && id !== undefined);

  if (!ids.length) {
    return [];
  }

  const { data, error } = await client
    .from('comments')
    .select('*')
    .in('note_id', ids)
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}


export async function fetchCommentsForNote(client, noteId) {
  const { data, error } = await client
    .from('comments')
    .select('*')
    .eq('note_id', noteId)
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}


export async function createComment(client, payload) {
  const { data, error } = await client
    .from('comments')
    .insert([payload])
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}


export async function deleteComment(client, commentId) {
  if (!commentId) {
    throw new Error('缺少评论 ID。');
  }

  const { error } = await client
    .from('comments')
    .delete()
    .eq('id', commentId);

  if (error) {
    throw error;
  }
}


export function subscribeToComments(client, onChange) {
  return client
    .channel('comments-realtime')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'comments'
      },
      payload => {
        if (typeof onChange === 'function') {
          onChange(payload);
        }
      }
    )
    .subscribe();
}
