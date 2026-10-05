import { getSupabaseClient } from './supabase.js';
import { createNote, fetchNotes, subscribeToNotes } from './notes.js';
import { uploadImage, validateImage } from './storage.js';

const elements = {
  form: document.querySelector('#note-form'), author: document.querySelector('#author'), content: document.querySelector('#content'),
  image: document.querySelector('#img-file'), preview: document.querySelector('#preview'), previewWrap: document.querySelector('#preview-wrap'),
  removeImage: document.querySelector('#remove-image'), submit: document.querySelector('#submit-button'), message: document.querySelector('#form-message'),
  status: document.querySelector('#notes-status'), list: document.querySelector('#notes-list'), retry: document.querySelector('#retry-button'), template: document.querySelector('#note-template'),
};
let client;
let previewUrl = '';

function setMessage(message = '', type = '') { elements.message.textContent = message; elements.message.dataset.type = type; }
function setPublishing(publishing) { elements.submit.disabled = publishing; elements.submit.textContent = publishing ? '正在发布…' : '发布留言'; }
function cleanupPreview() { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = ''; elements.preview.removeAttribute('src'); elements.previewWrap.hidden = true; }

function showStatus(message, kind = '') {
  elements.status.textContent = message; elements.status.dataset.kind = kind; elements.status.hidden = false;
  elements.retry.hidden = kind !== 'error';
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '' : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function renderNotes(notes) {
  elements.list.replaceChildren();
  if (!notes.length) { showStatus('还没有留言。成为第一个记录旅程的人吧。', 'empty'); return; }
  elements.status.hidden = true;
  for (const note of notes) {
    const fragment = elements.template.content.cloneNode(true);
    fragment.querySelector('.note-author').textContent = note.author || '匿名旅人';
    fragment.querySelector('.note-content').textContent = note.content || '';
    const time = fragment.querySelector('.note-time'); time.dateTime = note.created_at || ''; time.textContent = formatDate(note.created_at);
    if (note.img_url) { const image = fragment.querySelector('.note-image'); image.src = note.img_url; image.hidden = false; }
    elements.list.append(fragment);
  }
}

async function loadNotes() {
  showStatus('正在加载留言…', 'loading');
  try { renderNotes(await fetchNotes(client)); }
  catch (error) { console.error(error); elements.list.replaceChildren(); showStatus('无法加载留言，请检查网络或 Supabase 的读取权限。', 'error'); }
}

elements.image.addEventListener('change', () => {
  cleanupPreview(); const file = elements.image.files[0]; if (!file) return;
  const error = validateImage(file); if (error) { setMessage(error, 'error'); elements.image.value = ''; return; }
  previewUrl = URL.createObjectURL(file); elements.preview.src = previewUrl; elements.previewWrap.hidden = false; setMessage();
});
elements.removeImage.addEventListener('click', () => { elements.image.value = ''; cleanupPreview(); });
elements.retry.addEventListener('click', loadNotes);

elements.form.addEventListener('submit', async (event) => {
  event.preventDefault(); const author = elements.author.value.trim(); const content = elements.content.value.trim(); const file = elements.image.files[0];
  if (!author) return setMessage('请填写昵称。', 'error');
  if (!content && !file) return setMessage('请输入文字或选择一张照片。', 'error');
  setPublishing(true); setMessage();
  try {
    const img_url = file ? await uploadImage(client, file) : '';
    await createNote(client, { author, content, img_url });
    elements.content.value = ''; elements.image.value = ''; cleanupPreview(); setMessage('留言已发布。', 'success');
    // Realtime normally updates the list; load once here so publishing still feels immediate when Realtime is disabled.
    await loadNotes();
  } catch (error) { console.error(error); setMessage(`发布失败：${error.message || '请稍后重试。'}`, 'error'); }
  finally { setPublishing(false); }
});

try { client = getSupabaseClient(); await loadNotes(); subscribeToNotes(client, loadNotes); }
catch (error) { console.error(error); showStatus(error.message || '应用初始化失败。', 'error'); }
