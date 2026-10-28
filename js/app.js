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
  subscribeToComments,
  fetchNoteById,
  updateNoteLocation
} from './notes.js';
import { validateImage, uploadImage, compressImage } from './storage.js';
import { createMap, clusterNotes } from './map.js';
import { openLocationPicker } from './location-picker.js';

const PAGE_SIZE = 10;

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
const composerToggle = document.getElementById('composer-toggle');
const composerToggleLabel = document.querySelector('.composer-toggle-label');
const composerPanel = composerToggle.closest('.composer');

const notesList = document.getElementById('notes-list');
const notesStatus = document.getElementById('notes-status');
const retryButton = document.getElementById('retry-button');
const loadMoreButton = document.getElementById('load-more');
const noteTemplate = document.getElementById('note-template');
const commentTemplate = document.getElementById('comment-template');
const skeletonTemplate = document.getElementById('skeleton-template');
const toast = document.getElementById('toast');
const mapCanvas = document.getElementById('map-canvas');
const mapEmpty = document.getElementById('map-empty');
const composerLocationButton = document.getElementById('composer-location');
const composerLocationName = document.getElementById('composer-location-name');
const composerLocationClear = document.getElementById('composer-location-clear');

const adminToggle = document.getElementById('admin-toggle');
const adminPanel = document.getElementById('admin-panel');
const adminHeading = document.getElementById('admin-heading');
const adminLoginForm = document.getElementById('admin-login-form');
const adminEmail = document.getElementById('admin-email');
const adminPassword = document.getElementById('admin-password');
const adminLoginButton = document.getElementById('admin-login-button');
const adminLogoutButton = document.getElementById('admin-logout-button');
const adminSession = document.getElementById('admin-session');
const adminStatus = document.getElementById('admin-status');
const adminMessage = document.getElementById('admin-message');

const lightbox = document.getElementById('lightbox');
const lightboxImage = document.getElementById('lightbox-image');
const lightboxClose = document.getElementById('lightbox-close');

const mapApi = createMap(mapCanvas, {
  onSelectNote: noteId => focusNote(noteId)
});

let currentUser = null;
let commentsByNote = new Map();
let loadedNotes = [];
let hasMore = true;
let loadingNotes = false;
let toastTimer = 0;
let composerLocation = null;


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

function showToast(message) {
  if (!message) {
    return;
  }

  toast.textContent = message;
  toast.hidden = false;

  window.clearTimeout(toastTimer);

  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 2600);
}

function refreshMap() {
  const pinned = loadedNotes.filter(
    note => Number.isFinite(note.lat) && Number.isFinite(note.lng)
  );

  mapApi.setPins(clusterNotes(pinned));
  mapEmpty.hidden = pinned.length > 0;
}

function updateLoadMore() {
  loadMoreButton.hidden = !hasMore || loadedNotes.length === 0;
  loadMoreButton.disabled = false;
  loadMoreButton.textContent = '加载更多';
}


/* =========================
   管理员登录面板
========================= */

adminToggle.addEventListener('click', () => {
  const isHidden = adminPanel.hidden;

  adminPanel.hidden = !isHidden;
  adminToggle.setAttribute('aria-expanded', String(isHidden));

  if (isHidden && !currentUser) {
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
  showAdminMessage('');
  updateAdminUI();

  // 登录成功就把面板收起来，别一直占着屏幕
  adminPanel.hidden = true;
  adminToggle.setAttribute('aria-expanded', 'false');
  showToast('已登录管理员');
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
  showToast('已退出登录');
});


/* =========================
   管理员 UI
========================= */

function updateAdminUI() {
  const loggedIn = !!currentUser;

  adminLoginForm.hidden = loggedIn;
  adminSession.hidden = !loggedIn;

  adminHeading.textContent = loggedIn ? '管理员' : '管理员登录';
  adminToggle.classList.toggle('is-admin', loggedIn);

  if (loggedIn) {
    adminStatus.textContent = `已登录：${currentUser.email}`;
  } else {
    adminStatus.textContent = '登录后可以管理留言。';
    adminEmail.value = '';
    adminPassword.value = '';
  }

  refreshAdminButtons();
}

function refreshAdminButtons() {
  loadedNotes.forEach(note => {
    const card = commentCard(note.id);

    if (!card) {
      return;
    }

    card.querySelector('.delete-note-button').hidden = !currentUser;

    const editLocation = card.querySelector('.edit-location-button');

    if (editLocation) {
      editLocation.hidden = !currentUser;
    }
  });

  commentsByNote.forEach((_list, noteId) => renderComments(noteId));
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
   发布框折叠
========================= */

function setComposerOpen(open) {
  form.hidden = !open;
  composerToggleLabel.textContent = open ? '收起' : '写一则旅途留言';
  composerToggle.setAttribute('aria-expanded', String(open));
  composerPanel.classList.toggle('is-open', open);
}

composerToggle.addEventListener('click', () => {
  const willOpen = form.hidden;

  setComposerOpen(willOpen);

  if (willOpen) {
    authorInput.focus();
  }
});


/* =========================
   发布框里的地点
========================= */

function renderComposerLocation() {
  const hasPoint = !!composerLocation;

  composerLocationButton.hidden = hasPoint;
  composerLocationClear.hidden = !hasPoint;
  composerLocationName.hidden = !hasPoint;
  composerLocationName.textContent = hasPoint ? `📍 ${composerLocation.location}` : '';
}

composerLocationButton.addEventListener('click', async () => {
  const result = await openLocationPicker(composerLocation || {});

  if (!result || result.clear) {
    return;
  }

  composerLocation = {
    location: result.location,
    lat: result.lat,
    lng: result.lng
  };

  renderComposerLocation();
});

composerLocationClear.addEventListener('click', () => {
  composerLocation = null;
  renderComposerLocation();
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
  showFormMessage(file ? '正在压缩图片…' : '正在发布…');

  try {
    let uploadFile = file;

    if (file) {
      uploadFile = await compressImage(file);
      showFormMessage('正在上传图片…');
    }

    let imageUrl = '';

    if (uploadFile) {
      imageUrl = await uploadImage(client, uploadFile);
    }

    const created = await createNote(client, {
      author,
      content,
      img_url: imageUrl,
      location: composerLocation?.location || null,
      lat: composerLocation?.lat ?? null,
      lng: composerLocation?.lng ?? null
    });

    form.reset();
    clearImagePreview();
    composerLocation = null;
    renderComposerLocation();
    showFormMessage('');
    setComposerOpen(false);
    showToast('发布成功');

    if (created) {
      prependNote(created);
    }
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

function showSkeletons(count = 3) {
  notesList.innerHTML = '';

  if (!skeletonTemplate) {
    return;
  }

  const fragment = document.createDocumentFragment();

  for (let i = 0; i < count; i += 1) {
    fragment.appendChild(skeletonTemplate.content.cloneNode(true));
  }

  notesList.appendChild(fragment);
}

async function renderNotes() {
  loadedNotes = [];
  commentsByNote = new Map();
  hasMore = true;

  setNotesStatus('');
  showSkeletons(3);

  await loadNextPage();
}

async function loadNextPage() {
  if (loadingNotes) {
    return;
  }

  loadingNotes = true;
  loadMoreButton.disabled = true;
  loadMoreButton.textContent = '加载中…';

  try {
    const before = loadedNotes.length
      ? loadedNotes[loadedNotes.length - 1]
      : null;

    const page = await fetchNotes(client, { limit: PAGE_SIZE, before });

    if (!loadedNotes.length) {
      notesList.innerHTML = '';
    }

    if (!page.length) {
      hasMore = false;

      if (!loadedNotes.length) {
        setNotesStatus('还没有留言，成为第一个留下足迹的人吧。');
      }

      return;
    }

    const pageComments = await loadCommentsForNotes(page);
    pageComments.forEach((list, noteId) => {
      commentsByNote.set(noteId, list);
    });

    const fragment = document.createDocumentFragment();

    page.forEach(note => {
      loadedNotes.push(note);
      fragment.appendChild(createNoteCard(note));
    });

    notesList.appendChild(fragment);
    setNotesStatus('');

    hasMore = page.length === PAGE_SIZE;

    refreshMap();
  } catch (error) {
    console.error('加载留言失败:', error);

    if (!loadedNotes.length) {
      notesList.innerHTML = '';
      setNotesStatus('无法加载留言，请检查网络连接。', true);
    } else {
      showToast('加载失败，请稍后再试');
    }
  } finally {
    loadingNotes = false;
    updateLoadMore();
  }
}

function prependNote(note) {
  if (!note || note.id === undefined || note.id === null) {
    return;
  }

  if (loadedNotes.some(item => item.id === note.id)) {
    return;
  }

  loadedNotes.unshift(note);

  const card = createNoteCard(note);

  if (notesList.firstChild) {
    notesList.insertBefore(card, notesList.firstChild);
  } else {
    notesList.appendChild(card);
  }

  setNotesStatus('');
  refreshMap();
  updateLoadMore();
}

function removeNoteCard(noteId) {
  const before = loadedNotes.length;

  loadedNotes = loadedNotes.filter(item => item.id !== noteId);

  if (loadedNotes.length === before) {
    return;
  }

  const card = commentCard(noteId);

  if (card) {
    card.remove();
  }

  commentsByNote.delete(noteId);

  if (!loadedNotes.length) {
    if (hasMore) {
      loadNextPage();
    } else {
      setNotesStatus('还没有留言，成为第一个留下足迹的人吧。');
    }
  }

  refreshMap();
  updateLoadMore();
}

function createNoteCard(note) {
  const fragment = noteTemplate.content.cloneNode(true);
  const card = fragment.querySelector('.note-card');

  card.dataset.noteId = note.id;

  card.querySelector('.note-author').textContent = note.author || '匿名';

  const time = card.querySelector('.note-time');
  const date = new Date(note.created_at);

  time.textContent = Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString('zh-CN');
  time.dateTime = note.created_at;

  const content = card.querySelector('.note-content');
  content.textContent = note.content || '';
  content.hidden = !note.content;

  const locationEl = card.querySelector('.note-location');
  const hasPoint = Number.isFinite(note.lat) && Number.isFinite(note.lng);

  if (note.location && hasPoint) {
    locationEl.textContent = `📍 ${note.location}`;
    locationEl.hidden = false;
  } else {
    locationEl.hidden = true;
  }

  const imageWrap = card.querySelector('.note-image-wrap');
  const image = card.querySelector('.note-image');

  if (note.img_url) {
    image.src = note.img_url;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.hidden = false;
    imageWrap.hidden = false;

    image.addEventListener('click', () => {
      openLightbox(note.img_url);
    });
  } else {
    imageWrap.hidden = true;
    image.hidden = true;
  }

  const editLocationButton = card.querySelector('.edit-location-button');

  if (currentUser) {
    editLocationButton.hidden = false;
    editLocationButton.addEventListener('click', () => {
      handleEditLocation(note);
    });
  } else {
    editLocationButton.hidden = true;
  }

  const deleteButton = card.querySelector('.delete-note-button');

  if (currentUser) {
    deleteButton.hidden = false;
    deleteButton.addEventListener('click', async () => {
      await handleDeleteNote(note);
    });
  } else {
    deleteButton.hidden = true;
  }

  initCommentBlock(card, note.id);

  return card;
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


function initCommentBlock(card, noteId) {
  const form = card.querySelector('.comment-form');
  const toggle = card.querySelector('.comment-toggle');

  form.addEventListener('submit', event => {
    handleCommentSubmit(event, noteId);
  });

  toggle.addEventListener('click', () => {
    const willOpen = form.hidden;

    form.hidden = !willOpen;
    toggle.textContent = willOpen ? '取消' : '写评论';
    toggle.setAttribute('aria-expanded', String(willOpen));

    if (willOpen) {
      form.querySelector('.comment-author').focus();
    }
  });

  renderComments(noteId, card);
}


function renderComments(noteId, card) {
  const node = card || commentCard(noteId);

  if (!node) {
    return;
  }

  const list = node.querySelector('.comment-list');
  const items = commentsByNote.get(noteId) || [];

  list.innerHTML = '';

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
  if (!commentCard(noteId)) {
    return;
  }

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
    showToast('评论已删除');
  } catch (error) {
    console.error('删除评论失败:', error);
    alert(
      error.message ||
      '删除失败，请确认你拥有管理员权限。'
    );
  }
}


/* =========================
   地图 → 定位到留言
========================= */

function insertNoteInOrder(note) {
  const index = loadedNotes.findIndex(
    item => new Date(item.created_at) < new Date(note.created_at)
  );

  if (index === -1) {
    loadedNotes.push(note);
    notesList.appendChild(createNoteCard(note));
    return;
  }

  loadedNotes.splice(index, 0, note);

  const target = notesList.children[index];

  const card = createNoteCard(note);

  if (target) {
    notesList.insertBefore(card, target);
  } else {
    notesList.appendChild(card);
  }
}

async function focusNote(noteId) {
  let note = loadedNotes.find(item => item.id === noteId);

  if (!note) {
    try {
      note = await fetchNoteById(client, noteId);
    } catch (error) {
      console.error('定位留言失败:', error);
      showToast('这条留言暂时打不开');
      return;
    }

    if (!note) {
      return;
    }

    insertNoteInOrder(note);
  }

  const card = commentCard(noteId);

  if (!card) {
    return;
  }

  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.add('is-flash');

  window.setTimeout(() => {
    card.classList.remove('is-flash');
  }, 1800);
}


/* =========================
   编辑地点
========================= */

async function handleEditLocation(note) {
  if (!currentUser) {
    alert('请先登录管理员账号。');
    return;
  }

  let result = null;

  try {
    result = await openLocationPicker({
      location: note.location || '',
      lat: note.lat,
      lng: note.lng
    });
  } catch (error) {
    console.error('打开地点选择器失败:', error);
    return;
  }

  if (!result) {
    return;
  }

  const patch = result.clear
    ? { location: null, lat: null, lng: null }
    : { location: result.location, lat: result.lat, lng: result.lng };

  try {
    const updated = await updateNoteLocation(client, note.id, patch);

    Object.assign(note, patch);

    const oldCard = commentCard(note.id);

    if (oldCard && updated) {
      oldCard.replaceWith(createNoteCard(note));
    }

    refreshMap();
    showToast(result.clear ? '地点已移除' : '地点已更新');
  } catch (error) {
    console.error('更新地点失败:', error);
    alert(error.message || '更新地点失败，请稍后再试。');
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
    removeNoteCard(note.id);
    showToast('留言已删除');
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
   重试 / 加载更多
========================= */

retryButton.addEventListener('click', renderNotes);

loadMoreButton.addEventListener('click', () => {
  loadNextPage();
});


/* =========================
   Realtime
========================= */

subscribeToNotes(client, payload => {
  const eventType = payload?.eventType;

  if (eventType === 'INSERT') {
    prependNote(payload.new);
    return;
  }

  if (eventType === 'DELETE') {
    const noteId = payload?.old?.id;

    if (noteId !== undefined && noteId !== null) {
      removeNoteCard(noteId);
    }
  }
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
