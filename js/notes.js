export async function fetchNotes(client) {
  const { data, error } = await client
    .from('notes')
    .select('id, author, content, img_url, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createNote(client, note) {
  const { error } = await client.from('notes').insert([note]);
  if (error) throw error;
}

export function subscribeToNotes(client, onChange) {
  return client
    .channel('bon-voyage-notes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notes' }, onChange)
    .subscribe((status) => console.info('Realtime status:', status));
}
