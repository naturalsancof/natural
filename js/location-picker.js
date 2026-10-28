import { createMap } from './map.js';
import { searchPlaces, reverseGeocode, locateMe } from './geo.js';

const $ = id => document.getElementById(id);

let bound = false;
let miniMap = null;
let resolver = null;
let draft = null;
let cleared = false;
let searchToken = 0;
let searchTimer = 0;

function setMessage(message, type = '') {
  const node = $('location-message');
  node.textContent = message;
  node.className = `form-message ${type}`.trim();
}

function updateButtons() {
  $('location-confirm').disabled = !draft && !cleared;
  $('location-clear').hidden = !draft;
}

function setLabel(text) {
  $('location-label').textContent = text;
}

function closeModal() {
  $('location-modal').hidden = true;
  $('location-modal').setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
}

function finish(value) {
  closeModal();

  if (typeof resolver === 'function') {
    resolver(value);
  }

  resolver = null;
}

function pickPoint(lat, lng, location) {
  draft = { lat, lng, location: location || '' };
  cleared = false;

  miniMap.setMarker({ lat, lng });
  miniMap.closePopup();

  updateButtons();
}

async function describePoint(lat, lng) {
  setLabel('正在解析地名…');

  const label = await reverseGeocode(lat, lng);

  // 期间用户又点了别处就丢弃旧结果
  if (!draft || draft.lat !== lat || draft.lng !== lng) {
    return;
  }

  draft.location = label;
  setLabel(label);
}

function renderResults(results) {
  const list = $('location-results');
  list.innerHTML = '';

  results.forEach(item => {
    const li = document.createElement('li');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'location-result';

    const name = document.createElement('strong');
    name.textContent = item.name;

    const detail = document.createElement('span');
    detail.textContent = item.detail || '';

    button.appendChild(name);

    if (item.detail) {
      button.appendChild(detail);
    }

    button.addEventListener('click', () => {
      pickPoint(item.lat, item.lng, item.label);
      setLabel(item.label);
      list.innerHTML = '';
      setMessage('');
    });

    li.appendChild(button);
    list.appendChild(li);
  });
}

async function runSearch() {
  const query = $('location-query').value.trim();

  if (query.length < 2) {
    $('location-results').innerHTML = '';
    setMessage(query ? '再多输一个字试试' : '');
    return;
  }

  const token = ++searchToken;

  setMessage('搜索中…');

  try {
    const results = await searchPlaces(query);

    // 期间用户又改了输入，丢弃这次结果
    if (token !== searchToken) {
      return;
    }

    if (!results.length) {
      $('location-results').innerHTML = '';
      setMessage('没找到，试试更短的词（如「大理」），或直接在地图上点选', 'error');
      return;
    }

    renderResults(results);
    setMessage('');
  } catch (error) {
    if (token !== searchToken) {
      return;
    }

    console.error('地名搜索失败:', error);
    setMessage('搜索失败，可以直接在地图上点选', 'error');
  }
}

async function useCurrentPosition() {
  setMessage('正在定位…');

  try {
    const { lat, lng } = await locateMe();

    pickPoint(lat, lng);
    await describePoint(lat, lng);
    setMessage('');
  } catch (error) {
    setMessage(error.message, 'error');
  }
}

function ensureBound() {
  if (bound) {
    return;
  }

  bound = true;

  miniMap = createMap($('location-map'), {
    interactive: true,
    onPick: ({ lat, lng }) => {
      pickPoint(lat, lng);
      describePoint(lat, lng);
    }
  });

  $('location-search-button').addEventListener('click', runSearch);

  $('location-query').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      window.clearTimeout(searchTimer);
      runSearch();
    }
  });

  // 边打边搜，350ms 防抖
  $('location-query').addEventListener('input', () => {
    window.clearTimeout(searchTimer);

    const value = $('location-query').value.trim();

    if (value.length < 2) {
      searchToken += 1;
      $('location-results').innerHTML = '';
      setMessage('');
      return;
    }

    searchTimer = window.setTimeout(runSearch, 350);
  });

  $('location-locate').addEventListener('click', useCurrentPosition);

  $('location-clear').addEventListener('click', () => {
    draft = null;
    cleared = true;
    miniMap.setMarker(null);
    setLabel('未选择地点');
    updateButtons();
  });

  $('location-confirm').addEventListener('click', () => {
    if (draft) {
      const label = draft.location || `${draft.lat.toFixed(2)}, ${draft.lng.toFixed(2)}`;
      finish({ location: label, lat: draft.lat, lng: draft.lng });
      return;
    }

    if (cleared) {
      finish({ clear: true });
      return;
    }

    finish(null);
  });

  $('location-cancel').addEventListener('click', () => finish(null));
  $('location-close').addEventListener('click', () => finish(null));

  $('location-modal').addEventListener('click', event => {
    if (event.target === $('location-modal')) {
      finish(null);
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('location-modal').hidden) {
      finish(null);
    }
  });
}

export function openLocationPicker(initial = {}) {
  ensureBound();

  return new Promise(resolve => {
    resolver = resolve;

    const hasPoint = Number.isFinite(initial.lat) && Number.isFinite(initial.lng);

    draft = hasPoint
      ? { lat: initial.lat, lng: initial.lng, location: initial.location || '' }
      : null;

    cleared = false;

    $('location-query').value = '';
    $('location-results').innerHTML = '';
    setMessage('');

    if (draft) {
      miniMap.setMarker({ lat: draft.lat, lng: draft.lng });
      setLabel(draft.location || `${draft.lat.toFixed(2)}, ${draft.lng.toFixed(2)}`);
    } else {
      miniMap.setMarker(null);
      setLabel('未选择地点');
    }

    updateButtons();

    $('location-modal').hidden = false;
    $('location-modal').setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');

    window.setTimeout(() => $('location-query').focus(), 60);
  });
}
