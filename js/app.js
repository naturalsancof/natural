import { getSupabaseClient } from './supabase.js';
import {
  fetchNotes,
  createNote,
  subscribeToNotes,
  deleteNote,
  fetchComments,
  fetchCommentsForNote,
  createComment,
  deleteComment,
  subscribeToComments
} from './notes.js';
import { validateImage, uploadImage } from './storage.js';

const client = getSupabaseClient();

const form = document.getElementById('note-form');
const authorInput = document.getElementById('author');
const contentInput = document.getElementById('content');
const imageInput = document.getElementById('img-file');
const previewWrap = document.getElementById('preview-wrap');
const preview = document.getElementById('preview');
const removeImageButton = document.getElementById('remove-image');
const submitButton = document.getElementById('submit-button');
const formMessage = document.getElementById('form-message');

const notesList = document.getElementById('notes-list');
const notesStatus = document.getElementById('notes-status');
const retryButton = document.getElementById('retry-button');
const noteTemplate = document.getElementById('note-template');
const commentTemplate = document.getElementById('comment-template');

const adminToggle = document.getElementById('admin-toggle');
const adminPanel = document.getElementById('admin-panel');
const adminLoginForm = document.getElementById('admin-login-form');
const adminEmail = document.getElementById('admin-email');
const adminPassword = document.getElementById('admin-password');
const adminLoginButton = document.getElementById('admin-login-button');
const adminLogoutButton = document.getElementById('admin-logout-button');
const adminStatus = document.getElementById('admin-status');
const adminMessage = document.getElementById('admin-message');

const lightbox = document.getElementById('lightbox');
const lightboxImage = document.getElementById('lightbox-image');
const lightboxClose = document.getElementById('lightbox-close');

let currentUser = null;
let commentsByNote = new Map();


/* =========================
   工具函数
========================= */

function showFormMessage(message, type = '') {
  formMessage.textContent = message;
  formMessage.className = `form-message ${type}`.trim();
}

function showAdminMessage(message, type = '') {
  adminMessage.textContent = message;
  adminMessage.className = `form-message ${type}`.trim();
}

function setNotesStatus(message, showRetry = false) {
  notesStatus.textContent = message;
  notesStatus.hidden = !message;
  retryButton.hidden = !showRetry;
}


/* =========================
   管理员登录面板
========================= */

adminToggle.addEventListener('click', () => {
  const isHidden = adminPanel.hidden;

  adminPanel.hidden = !isHidden;
  adminToggle.setAttribute('aria-expanded', String(isHidden));

  if (isHidden) {
    adminEmail.focus();
  }
});


/* =========================
   管理员登录
========================= */

adminLoginForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const email = adminEmail.value.trim();
  const password = adminPassword.value;

  if (!email || !password) {
    showAdminMessage('请输入邮箱和密码。', 'error');
    return;
  }

  adminLoginButton.disabled = true;
  showAdminMessage('正在登录…');

  const { data, error } = await client.auth.signInWithPassword({
    email,
    password
  });

  adminLoginButton.disabled = false;

  if (error) {
    console.error('管理员登录失败:', error);
    showAdminMessage('登录失败，请检查邮箱和密码。', 'error');
    return;
  }

  currentUser = data.user;
  adminPassword.value = '';
  updateAdminUI();
  showAdminMessage('登录成功。', 'success');
});


/* =========================
   管理员退出
========================= */

adminLogoutButton.addEventListener('click', async () => {
  const { error } = await client.auth.signOut();

  if (error) {
    console.error('退出登录失败:', error);
    showAdminMessage('退出失败，请稍后再试。', 'error');
    return;
  }

  currentUser = null;
  updateAdminUI();
});


/* =========================
   管理员 UI
========================= */

function updateAdminUI() {
  const loggedIn = !!currentUser;

  adminLoginButton.hidden = loggedIn;
  adminLogoutButton.hidden = !loggedIn;
  adminEmail.hidden = loggedIn;
  adminPassword.hidden = loggedIn;

  const labels = adminLoginForm.querySelectorAll('label');
  labels.forEach(label => {
    label.hidden = loggedIn;
  });

  if (loggedIn) {
    adminStatus.textContent = `已登录：${currentUser.email}`;
  } else {
    adminStatus.textContent = '登录后可以管理留言。';
    adminEmail.value = '';
    adminPassword.value = '';
  }

  renderNotes();
}


/* =========================
   初始化管理员状态
========================= */

async function loadAuthState() {
  const {
    data: { user }
  } = await client.auth.getUser();

  currentUser = user || null;
  updateAdminUI();

  client.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    updateAdminUI();
  });
}


/* =========================
   图片预览
========================= */

imageInput.addEventListener('change', () => {
  const file = imageInput.files?.[0];

  if (!file) {
    clearImagePreview();
    return;
  }

  const validation = validateImage(file);

  if (!validation.valid) {
    showFormMessage(validation.message, 'error');
    imageInput.value = '';
    clearImagePreview();
    return;
  }

  preview.src = URL.createObjectURL(file);
  previewWrap.hidden = false;
  showFormMessage('');
});


function clearImagePreview() {
  if (preview.src.startsWith('blob:')) {
    URL.revokeObjectURL(preview.src);
  }

  preview.src = '';
  previewWrap.hidden = true;
}


removeImageButton.addEventListener('click', () => {
  imageInput.value = '';
  clearImagePreview();
});


/* =========================
   发布留言
========================= */

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const author = authorInput.value.trim();
  const content = contentInput.value.trim();
  const file = imageInput.files?.[0] || null;

  if (!author) {
    showFormMessage('请输入昵称。', 'error');
    authorInput.focus();
    return;
  }

  if (!content && !file) {
    showFormMessage('请输入文字或选择一张图片。', 'error');
    return;
  }

  if (author.length > 60) {
    showFormMessage('昵称不能超过 60 个字符。', 'error');
    return;
  }

  if (content.length > 2000) {
    showFormMessage('留言不能超过 2000 个字符。', 'error');
    return;
  }

  if (file) {
    const validation = validateImage(file);

    if (!validation.valid) {
      showFormMessage(validation.message, 'error');
      return;
    }
  }

  submitButton.disabled = true;
  showFormMessage('正在发布…');

  try {
    let imageUrl = '';

    if (file) {
      imageUrl = await uploadImage(client, file);
    }

    await createNote(client, {
      author,
      content,
      img_url: imageUrl
    });

    form.reset();
    clearImagePreview();
    showFormMessage('发布成功。', 'success');
    await renderNotes();

  } catch (error) {
    console.error('发布留言失败:', error);
    showFormMessage(
      error.message || '发布失败，请稍后再试。',
      'error'
    );
  } finally {
    submitButton.disabled = false;
  }
});


/* =========================
   加载留言
========================= */

async function renderNotes() {
  setNotesStatus('正在加载留言…');

  try {
    const notes = await fetchNotes(client);
    commentsByNote = await loadCommentsForNotes(notes);
    notesList.innerHTML = '';

    if (!notes.length) {
      setNotesStatus('还没有留言，成为第一个留下足迹的人吧。');
      return;
    }

    notes.forEach(note => {
      const fragment = noteTemplate.content.cloneNode(true);

      fragment.querySelector('.note-card').dataset.noteId = note.id;

      const author = fragment.querySelector('.note-author');
      const time = fragment.querySelector('.note-time');
      const content = fragment.querySelector('.note-content');
      const imageWrap = fragment.querySelector('.note-image-wrap');
      const image = fragment.querySelector('.note-image');
      const deleteButton = fragment.querySelector('.delete-note-button');

      author.textContent = note.author || '匿名';

      const date = new Date(note.created_at);
      time.textContent = Number.isNaN(date.getTime())
        ? ''
        : date.toLocaleString('zh-CN');
      time.dateTime = note.created_at;

      content.textContent = note.content || '';
      content.hidden = !note.content;

      if (note.img_url) {
        image.src = note.img_url;
        image.hidden = false;
        imageWrap.hidden = false;

        image.addEventListener('click', () => {
          openLightbox(note.img_url);
        });
      } else {
        imageWrap.hidden = true;
        image.hidden = true;
      }

      if (currentUser) {
        deleteButton.hidden = false;
        deleteButton.addEventListener('click', async () => {
          await handleDeleteNote(note);
        });
      } else {
        deleteButton.hidden = true;
      }

      notesList.appendChild(fragment);
      initCommentBlock(note.id);
    });

    setNotesStatus('');

  } catch (error) {
    console.error('加载留言失败:', error);
    setNotesStatus('无法加载留言，请检查网络连接。', true);
  }
}


/* =========================
   评论
========================= */

async function loadCommentsForNotes(notes) {
  const ids = notes.map(note => note.id);

  let comments = [];

  try {
    comments = await fetchComments(client, ids);
  } catch (error) {
    console.error('加载评论失败:', error);
  }

  const map = new Map();

  comments.forEach(comment => {
    const key = comment.note_id;
    const bucket = map.get(key);

    if (bucket) {
      bucket.push(comment);
    } else {
      map.set(key, [comment]);
    }
  });

  return map;
}


function commentCard(noteId) {
  return notesList.querySelector(
    '.note-card[data-note-id="' + noteId + '"]'
  );
}


function initCommentBlock(noteId) {
  const card = commentCard(noteId);

  if (!card) {
    return;
  }

  card.querySelector('.comment-form').addEventListener('submit', event => {
    handleCommentSubmit(event, noteId);
  });

  renderComments(noteId);
}


function renderComments(noteId) {
  const card = commentCard(noteId);

  if (!card) {
    return;
  }

  const list = card.querySelector('.comment-list');
  const count = card.querySelector('.comment-count');
  const empty = card.querySelector('.comment-empty');
  const items = commentsByNote.get(noteId) || [];

  list.innerHTML = '';
  count.textContent = String(items.length);
  empty.hidden = items.length > 0;

  items.forEach(comment => {
    const fragment = commentTemplate.content.cloneNode(true);

    fragment.querySelector('.comment-author-name').textContent = comment.author || '匿名';

    const time = fragment.querySelector('.comment-time');
    const date = new Date(comment.created_at);

    time.textContent = Number.isNaN(date.getTime())
      ? ''
      : date.toLocaleString('zh-CN');
    time.dateTime = comment.created_at;

    fragment.querySelector('.comment-text').textContent = comment.content || '';

    const deleteButton = fragment.querySelector('.delete-comment-button');

    if (currentUser) {
      deleteButton.hidden = false;
      deleteButton.addEventListener('click', () => {
        handleCommentDelete(noteId, comment);
      });
    }

    list.appendChild(fragment);
  });
}


async function refreshCommentsForNote(noteId) {
  try {
    const list = await fetchCommentsForNote(client, noteId);

    commentsByNote.set(noteId, list);
    renderComments(noteId);
  } catch (error) {
    console.error('刷新评论失败:', error);
  }
}


function setCommentMessage(element, message, type = '') {
  element.textContent = message;
  element.className = ('comment-message ' + type).trim();
}


async function handleCommentSubmit(event, noteId) {
  event.preventDefault();

  const form = event.currentTarget;
  const authorInput = form.querySelector('.comment-author');
  const contentInput = form.querySelector('.comment-content');
  const message = form.querySelector('.comment-message');
  const button = form.querySelector('.comment-submit');

  const author = authorInput.value.trim();
  const content = contentInput.value.trim();

  if (!author) {
    setCommentMessage(message, '请输入昵称。', 'error');
    authorInput.focus();
    return;
  }

  if (author.length > 60) {
    setCommentMessage(message, '昵称不能超过 60 个字符。', 'error');
    return;
  }

  if (!content) {
    setCommentMessage(message, '写点什么再发表吧。', 'error');
    contentInput.focus();
    return;
  }

  if (content.length > 1000) {
    setCommentMessage(message, '评论不能超过 1000 个字符。', 'error');
    return;
  }

  button.disabled = true;
  setCommentMessage(message, '正在发表…');

  try {
    const created = await createComment(client, {
      note_id: noteId,
      author,
      content
    });

    const list = commentsByNote.get(noteId) || [];
    list.push(created);
    commentsByNote.set(noteId, list);

    contentInput.value = '';
    renderComments(noteId);
    setCommentMessage(message, '评论已发表。', 'success');

    window.setTimeout(() => {
      if (message.textContent === '评论已发表。') {
        setCommentMessage(message, '');
      }
    }, 2400);
  } catch (error) {
    console.error('发表评论失败:', error);
    setCommentMessage(
      message,
      error.message || '评论发表失败，请稍后再试。',
      'error'
    );
  } finally {
    button.disabled = false;
  }
}


async function handleCommentDelete(noteId, comment) {
  if (!currentUser) {
    alert('请先登录管理员账号。');
    return;
  }

  const confirmed = window.confirm(
    '确定删除「' + (comment.author || '匿名') + '」的这条评论吗？\n\n删除后无法恢复。'
  );

  if (!confirmed) {
    return;
  }

  try {
    await deleteComment(client, comment.id);

    const list = (commentsByNote.get(noteId) || [])
      .filter(item => item.id !== comment.id);

    commentsByNote.set(noteId, list);
    renderComments(noteId);
  } catch (error) {
    console.error('删除评论失败:', error);
    alert(
      error.message ||
      '删除失败，请确认你拥有管理员权限。'
    );
  }
}

/* =========================
   删除留言
========================= */

async function handleDeleteNote(note) {
  if (!currentUser) {
    alert('请先登录管理员账号。');
    return;
  }

  const confirmed = window.confirm(
    `确定要删除「${note.author || '匿名'}」的这条留言吗？\n\n删除后无法恢复。`
  );

  if (!confirmed) {
    return;
  }

  try {
    await deleteNote(client, note);
    await renderNotes();
  } catch (error) {
    console.error('删除留言失败:', error);
    alert(
      error.message ||
      '删除失败，请确认你拥有管理员权限。'
    );
  }
}


/* =========================
   Lightbox
========================= */

function openLightbox(url) {
  lightboxImage.src = url;
  lightbox.hidden = false;
  lightbox.setAttribute('aria-hidden', 'false');
  document.body.classList.add('lightbox-open');
}

function closeLightbox() {
  lightbox.hidden = true;
  lightbox.setAttribute('aria-hidden', 'true');
  lightboxImage.src = '';
  document.body.classList.remove('lightbox-open');
}

lightboxClose.addEventListener('click', closeLightbox);

lightbox.addEventListener('click', event => {
  if (event.target === lightbox) {
    closeLightbox();
  }
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !lightbox.hidden) {
    closeLightbox();
  }
});


/* =========================
   重试
========================= */

retryButton.addEventListener('click', renderNotes);


/* =========================
   Realtime
========================= */

subscribeToNotes(client, async () => {
  await renderNotes();
});

subscribeToComments(client, payload => {
  const noteId = payload?.new?.note_id ?? payload?.old?.note_id;

  if (noteId === undefined || noteId === null) {
    return;
  }

  refreshCommentsForNote(noteId);
});


/* =========================
   初始化
========================= */

await loadAuthState();
await renderNotes();
