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


export async function deleteNote(client, id) {
  if (!id) {
    throw new Error('缺少留言 ID。');
  }

  const { error } = await client
    .from('notes')
    .delete()
    .eq('id', id);

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
