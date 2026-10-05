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
