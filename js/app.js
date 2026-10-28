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
  updateNoteLocation,
  fetchPlaces
} from './notes.js';
import { validateImage, uploadImage, compressImage } from './storage.js';
import { createMap, clusterNotes } from './map.js';
import { openLocationPicker } from './location-picker.js';

const PAGE_SIZE = 10;

const client = getSupabaseClient();

const themeToggle = document.getElementById('theme-toggle');
const THEME_KEY = 'bonvoyage-theme';

function applyTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.dataset.theme = 'dark';
  } else {
    delete document.documentElement.dataset.theme;
  }

  themeToggle?.setAttribute('aria-pressed', String(theme === 'dark'));
}

if (themeToggle) {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

  themeToggle.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';

    applyTheme(next);

    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (error) {
      /* 忽略 */
    }
  });
}

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
const loadMoreStatus = document.getElementById('load-more-status');
const loadMoreSentinel = document.getElementById('notes-sentinel');
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
let extraNotes = new Map();
let gapElement = null;
let tailNotes = [];
let tailCursor = null;
let hasMoreTail = true;
let tailMode = false;
let autoLoadPaused = false;
let cardObserver = null;
const visibleCards = new Set();
let hasMore = true;
let loadingNotes = false;
let toastTimer = 0;
let composerLocation = null;
let mapNotes = [];


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

/**
 * 友好的时间显示：刚刚 / N 分钟前 / 今天 / 10月29日
 */
function formatTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff >= 0 && diff < minute) {
    return '刚刚';
  }

  if (diff >= 0 && diff < hour) {
    return `${Math.floor(diff / minute)} 分钟前`;
  }

  if (diff >= 0 && diff < day) {
    return `${Math.floor(diff / hour)} 小时前`;
  }

  if (diff >= 0 && diff < day * 7) {
    return `${Math.floor(diff / day)} 天前`;
  }

  const sameYear = date.getFullYear() === now.getFullYear();
  const monthDay = `${date.getMonth() + 1}月${date.getDate()}日`;

  return sameYear ? monthDay : `${date.getFullYear()}年${monthDay}`;
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

async function refreshMap() {
  try {
    mapNotes = await fetchPlaces(client);
  } catch (error) {
    console.error('加载地图坐标失败:', error);
    return;
  }

  mapApi.setPins(clusterNotes(mapNotes));
  mapEmpty.hidden = mapNotes.length > 0;
}

function updateLoadMore() {
  loadMoreStatus.hidden = !loadingNotes;
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
  extraNotes = new Map();
  tailNotes = [];
  tailCursor = null;
  hasMoreTail = true;
  tailMode = false;
  commentsByNote = new Map();
  hasMore = true;

  if (gapElement && gapElement.parentNode) {
    gapElement.remove();
  }

  gapElement = null;

  setNotesStatus('');
  showSkeletons(3);

  await loadNextPage();
}

async function loadNextPage() {
  if (loadingNotes || !hasMore) {
    return;
  }

  loadingNotes = true;
  loadMoreStatus.hidden = false;

  if (gapElement) {
    const gapButton = gapElement.querySelector('.notes-gap-button');

    if (gapButton) {
      gapButton.disabled = true;
      gapButton.textContent = '加载中…';
    }
  }

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

    // 记录插入点位置，用于插入后补偿滚动（别把当前看的内容顶走）
    const gapMounted = gapElement && gapElement.parentNode === notesList;
    const anchorTop = gapMounted ? gapElement.getBoundingClientRect().top : null;
    const heightBefore = document.documentElement.scrollHeight;

    if (gapMounted) {
      notesList.insertBefore(fragment, gapElement);
    } else {
      notesList.appendChild(fragment);
    }

    if (anchorTop !== null && anchorTop < 0) {
      const grown = document.documentElement.scrollHeight - heightBefore;

      if (grown > 0) {
        window.scrollBy(0, grown);
      }
    }

    setNotesStatus('');

    hasMore = page.length === PAGE_SIZE;
    placeGap();

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

    if (gapElement) {
      const gapButton = gapElement.querySelector('.notes-gap-button');

      if (gapButton) {
        gapButton.disabled = false;
        gapButton.textContent = '加载中间被跳过的帖子';
      }
    }

    updateLoadMore();
    maybeAutoLoad();
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
  extraNotes.delete(noteId);
  visibleCards.delete(String(noteId));

  if (tailNotes.some(item => item.id === noteId)) {
    tailNotes = tailNotes.filter(item => item.id !== noteId);

    if (tailCursor && tailCursor.id === noteId) {
      tailCursor = tailNotes[tailNotes.length - 1] || null;
    }
  }

  placeGap();

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

  time.textContent = formatTime(note.created_at);
  time.dateTime = note.created_at;

  const content = card.querySelector('.note-content');
  content.textContent = note.content || '';
  content.hidden = !note.content;

  const locationEl = card.querySelector('.note-location');
  const hasPoint = Number.isFinite(note.lat) && Number.isFinite(note.lng);

  if (note.location && hasPoint) {
    locationEl.textContent = note.location;
    locationEl.hidden = false;
  } else {
    locationEl.hidden = true;
  }

  const imageWrap = card.querySelector('.note-image-wrap');
  const image = card.querySelector('.note-image');

  if (cardObserver) {
    cardObserver.observe(card);
  }

  if (note.img_url) {
    image.src = note.img_url;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.hidden = false;
    imageWrap.hidden = false;

    image.classList.add('is-loading');

    const reveal = () => image.classList.add('is-ready');

    if (image.complete) {
      reveal();
    } else {
      image.addEventListener('load', reveal, { once: true });
      image.addEventListener('error', reveal, { once: true });
    }

    image.addEventListener('click', () => {
      openLightbox(note.img_url);
    });
  } else {
    imageWrap.hidden = true;
    image.hidden = true;

    card.classList.add('is-text-only');
  }

  const editLocationButton = card.querySelector('.edit-location-button');

  editLocationButton.hidden = false;
  editLocationButton.addEventListener('click', () => {
    handleEditLocation(note);
  });

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

    time.textContent = formatTime(comment.created_at);
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

function mergedNotes() {
  return [...loadedNotes, ...extraNotes.values()].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );
}

function oldestLoadedTime() {
  const last = loadedNotes[loadedNotes.length - 1];

  return last ? new Date(last.created_at).getTime() : null;
}

/**
 * 维护「中间还有帖子没加载」的占位条
 */
function placeGap() {
  const oldest = oldestLoadedTime();

  // 已加载区间追上来的，就从额外区里摘掉
  if (oldest !== null) {
    [...extraNotes.entries()].forEach(([id, item]) => {
      if (new Date(item.created_at).getTime() >= oldest) {
        extraNotes.delete(id);
      }
    });
  }

  if (!extraNotes.size) {
    if (gapElement && gapElement.parentNode) {
      gapElement.remove();
    }

    gapElement = null;
    return;
  }

  if (!gapElement) {
    gapElement = document.createElement('div');
    gapElement.className = 'notes-gap';

    const hint = document.createElement('p');
    hint.className = 'notes-gap-hint';
    hint.textContent = '这里和下面的帖子之间，还有没加载出来的内容';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'notes-gap-button';
    button.textContent = '加载中间被跳过的帖子';
    button.addEventListener('click', async () => {
      await loadNextPage();

      // 补完之后把占位条（或新内容）拉回视野，别让人找不着
      if (gapElement) {
        gapElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });

    gapElement.appendChild(hint);
    gapElement.appendChild(button);
  }

  // 永远放在最靠后的那条额外帖子之前
  let anchor = null;
  let anchorTime = Infinity;

  extraNotes.forEach((item, id) => {
    const time = new Date(item.created_at).getTime();

    if (time < anchorTime) {
      anchorTime = time;
      anchor = commentCard(id);
    }
  });

  if (anchor && anchor.parentNode === notesList) {
    notesList.insertBefore(gapElement, anchor);
  } else {
    notesList.appendChild(gapElement);
  }
}

function insertNoteInOrder(note) {
  const oldest = oldestLoadedTime();

  // 比已加载的末端还新：并进链条（不影响分页游标）
  if (oldest === null || new Date(note.created_at).getTime() >= oldest) {
    const index = loadedNotes.findIndex(
      item => new Date(item.created_at) < new Date(note.created_at)
    );

    if (index === -1) {
      loadedNotes.push(note);
    } else {
      loadedNotes.splice(index, 0, note);
    }

    const merged = mergedNotes();
    const next = merged[merged.findIndex(item => item.id === note.id) + 1];
    const target = next ? commentCard(next.id) : null;
    const card = createNoteCard(note);

    if (target) {
      notesList.insertBefore(card, target);
    } else {
      notesList.appendChild(card);
    }

    placeGap();
    return;
  }

  // 比末端还老：链条还没加载到这，不能塞进 loadedNotes（会把分页游标顶飞）
  extraNotes.set(note.id, note);

  const merged = mergedNotes();
  const next = merged[merged.findIndex(item => item.id === note.id) + 1];
  const target = next ? commentCard(next.id) : null;
  const card = createNoteCard(note);

  if (target) {
    notesList.insertBefore(card, target);
  } else {
    notesList.appendChild(card);
  }

  // 从这条帖子往下继续翻更老的（中间缺口留给按钮补）
  tailMode = true;
  tailCursor = note;
  hasMoreTail = true;

  placeGap();
}

async function focusNote(noteId) {
  let note = loadedNotes.find(item => item.id === noteId)
    || extraNotes.get(noteId)
    || tailNotes.find(item => item.id === noteId);

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

  // 跳到远处时先别自动补页，否则会把刚定位到的帖子挤走
  autoLoadPaused = true;

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

// 滚到底部附近自动加载下一页
// 统一入口：暂停中不自动补，但仍然可以在下方继续加载
function maybeAutoLoad() {
  if (autoLoadPaused || loadingNotes || !loadMoreSentinel) {
    return;
  }

  if (tailMode ? !hasMoreTail : !hasMore) {
    return;
  }

  const rect = loadMoreSentinel.getBoundingClientRect();

  // 哨兵进入视口（含 700px 预取余量）就加载下一页
  if (rect.top <= window.innerHeight + 700) {
    if (tailMode) {
      loadTailPage();
    } else {
      loadNextPage();
    }
  }
}

/**
 * 定位之后：接着定位页往下翻更老的帖子
 */
async function loadTailPage() {
  if (loadingNotes || !hasMoreTail || !tailCursor) {
    return;
  }

  loadingNotes = true;
  loadMoreStatus.hidden = false;

  try {
    const page = await fetchNotes(client, { limit: PAGE_SIZE, before: tailCursor });

    if (!page.length) {
      hasMoreTail = false;
      return;
    }

    const pageComments = await loadCommentsForNotes(page);
    pageComments.forEach((list, noteId) => {
      commentsByNote.set(noteId, list);
    });

    const fragment = document.createDocumentFragment();

    page.forEach(note => {
      tailNotes.push(note);
      fragment.appendChild(createNoteCard(note));
    });

    notesList.appendChild(fragment);

    tailCursor = page[page.length - 1];
    hasMoreTail = page.length === PAGE_SIZE;

    setNotesStatus('');
  } catch (error) {
    console.error('加载留言失败:', error);
    showToast('加载失败，请稍后再试');
  } finally {
    loadingNotes = false;
    updateLoadMore();
    maybeAutoLoad();
  }
}

cardObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    const noteId = entry.target.dataset.noteId;

    if (!noteId) {
      return;
    }

    if (entry.isIntersecting) {
      visibleCards.add(noteId);
    } else {
      visibleCards.delete(noteId);
    }
  });

  const first = [...notesList.children].find(node => {
    const noteId = node.dataset.noteId;

    return noteId && visibleCards.has(noteId);
  });

  mapApi.setActiveNote(first ? Number(first.dataset.noteId) : null);
}, { rootMargin: '-15% 0px -55% 0px' });

const noteObserver = new IntersectionObserver(() => {
  maybeAutoLoad();
}, { rootMargin: '700px 0px' });

noteObserver.observe(loadMoreSentinel);

// 用户一动就恢复自动加载，并立刻试一次（哨兵可能早就在视口里，
// 不补这一下的话 IntersectionObserver 不会再触发，下方就断流了）
['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(type => {
  window.addEventListener(type, () => {
    autoLoadPaused = false;
    maybeAutoLoad();
  }, { passive: true });
});

// 滚动时再兜一层（拖动滚动条没有 wheel 事件）
let autoLoadTick = 0;

window.addEventListener('scroll', () => {
  if (autoLoadTick) {
    return;
  }

  autoLoadTick = window.requestAnimationFrame(() => {
    autoLoadTick = 0;
    maybeAutoLoad();
  });
}, { passive: true });


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
