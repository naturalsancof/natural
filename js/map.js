import { MAP_WIDTH, MAP_HEIGHT, WORLD_PATH } from './world-map.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const MIN_SCALE = 1;
const MAX_SCALE = 9;
const DRAG_THRESHOLD = 5;

export function projectPoint(lat, lng) {
  return {
    x: ((lng + 180) / 360) * MAP_WIDTH,
    y: ((90 - lat) / 180) * MAP_HEIGHT
  };
}

export function unprojectPoint(x, y) {
  return {
    lng: (x / MAP_WIDTH) * 360 - 180,
    lat: 90 - (y / MAP_HEIGHT) * 180
  };
}

/**
 * 把坐标相近的留言合并成一个图钉（默认 1 位小数 ≈ 11km）
 */
export function clusterNotes(notes, precision = 1) {
  const factor = 10 ** precision;
  const groups = new Map();

  notes.forEach(note => {
    if (!Number.isFinite(note.lat) || !Number.isFinite(note.lng)) {
      return;
    }

    const key = `${Math.round(note.lat * factor)}:${Math.round(note.lng * factor)}`;
    const existed = groups.get(key);

    if (existed) {
      existed.notes.push(note);
      return;
    }

    groups.set(key, {
      key,
      lat: note.lat,
      lng: note.lng,
      notes: [note]
    });
  });

  return [...groups.values()];
}

function shortText(value, length = 48) {
  const text = (value || '').replace(/\s+/g, ' ').trim();

  if (text.length <= length) {
    return text;
  }

  return `${text.slice(0, length)}…`;
}

function formatDate(value) {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('zh-CN');
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * 世界地图组件（支持滚轮 / 双指缩放、拖动平移）
 */
export function createMap(host, options = {}) {
  const { onSelectNote = null, interactive = false, onPick = null } = options;

  host.innerHTML = '';

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`);
  svg.setAttribute('class', 'world-map');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');

  const land = document.createElementNS(SVG_NS, 'path');
  land.setAttribute('d', WORLD_PATH);
  land.setAttribute('class', 'world-land');
  land.setAttribute('fill-rule', 'evenodd');

  const pinLayer = document.createElementNS(SVG_NS, 'g');
  pinLayer.setAttribute('class', 'world-pins');

  const markerLayer = document.createElementNS(SVG_NS, 'g');
  markerLayer.setAttribute('class', 'world-marker-layer');

  svg.appendChild(land);
  svg.appendChild(pinLayer);
  svg.appendChild(markerLayer);
  host.appendChild(svg);

  const popup = document.createElement('div');
  popup.className = 'map-popup';
  popup.hidden = true;
  host.appendChild(popup);

  let pins = [];
  let marker = null;
  let scale = 1;
  let center = { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 };

  let dragging = false;
  let dragMoved = false;
  let lastPoint = null;
  let suppressClick = false;
  const pointers = new Map();
  let pinchStart = null;

  /* ---------- 视图 ---------- */

  function applyView() {
    const width = MAP_WIDTH / scale;
    const height = MAP_HEIGHT / scale;

    const x = clamp(center.x - width / 2, 0, MAP_WIDTH - width);
    const y = clamp(center.y - height / 2, 0, MAP_HEIGHT - height);

    center = { x: x + width / 2, y: y + height / 2 };

    svg.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
    syncPinScale();
    closePopup();
  }

  function syncPinScale() {
    const k = 1 / scale;

    pinLayer.querySelectorAll('.map-pin').forEach(node => {
      node.setAttribute(
        'transform',
        `translate(${node.dataset.x} ${node.dataset.y}) scale(${k})`
      );
    });

    const markerNode = markerLayer.querySelector('.map-marker');

    if (markerNode) {
      markerNode.setAttribute(
        'transform',
        `translate(${markerNode.dataset.x} ${markerNode.dataset.y}) scale(${k})`
      );
    }
  }

  function clientToMap(clientX, clientY) {
    const matrix = svg.getScreenCTM();

    if (!matrix) {
      return { x: 0, y: 0 };
    }

    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;

    const local = point.matrixTransform(matrix.inverse());

    return { x: local.x, y: local.y };
  }

  function zoomAt(clientX, clientY, factor) {
    const anchor = clientToMap(clientX, clientY);
    const nextScale = clamp(scale * factor, MIN_SCALE, MAX_SCALE);

    if (nextScale === scale) {
      return;
    }

    const ratio = scale / nextScale;

    center = {
      x: anchor.x + (center.x - anchor.x) * ratio,
      y: anchor.y + (center.y - anchor.y) * ratio
    };

    scale = nextScale;
    applyView();
  }

  /* ---------- 弹窗 ---------- */

  function closePopup() {
    popup.hidden = true;
    popup.innerHTML = '';
  }

  function openPopup(pin) {
    const point = projectPoint(pin.lat, pin.lng);
    const matrix = svg.getScreenCTM();

    if (!matrix) {
      return;
    }

    const screen = svg.createSVGPoint();
    screen.x = point.x;
    screen.y = point.y;

    const placed = screen.matrixTransform(matrix);
    const box = host.getBoundingClientRect();

    popup.innerHTML = '';

    const title = document.createElement('p');
    title.className = 'map-popup-title';
    title.textContent = pin.notes.length > 1
      ? `${pin.notes.length} 条留言在这附近`
      : '这条留言在这里';
    popup.appendChild(title);

    const list = document.createElement('div');
    list.className = 'map-popup-list';

    pin.notes.forEach(note => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'map-popup-item';

      const head = document.createElement('span');
      head.className = 'map-popup-item-head';

      const author = document.createElement('strong');
      author.textContent = note.author || '匿名';

      const time = document.createElement('span');
      time.className = 'map-popup-item-time';
      time.textContent = formatDate(note.created_at);

      head.appendChild(author);
      head.appendChild(time);

      const text = document.createElement('span');
      text.className = 'map-popup-item-text';
      text.textContent = shortText(note.content) || note.location || '（图片）';

      item.appendChild(head);
      item.appendChild(text);

      item.addEventListener('click', event => {
        event.stopPropagation();
        closePopup();

        if (typeof onSelectNote === 'function') {
          onSelectNote(note.id);
        }
      });

      list.appendChild(item);
    });

    popup.appendChild(list);

    const topInBox = placed.y - box.top;

    popup.classList.toggle('is-below', topInBox < 130);
    popup.style.left = `${clamp(placed.x - box.left, 80, Math.max(80, box.width - 80))}px`;
    popup.style.top = `${topInBox}px`;
    popup.hidden = false;
  }

  /* ---------- 绘制 ---------- */

  function renderPins() {
    pinLayer.innerHTML = '';
    const k = 1 / scale;

    pins.forEach(pin => {
      const point = projectPoint(pin.lat, pin.lng);

      const group = document.createElementNS(SVG_NS, 'g');
      group.setAttribute('class', 'map-pin');
      group.dataset.x = String(point.x);
      group.dataset.y = String(point.y);
      group.setAttribute('transform', `translate(${point.x} ${point.y}) scale(${k})`);

      const hit = document.createElementNS(SVG_NS, 'circle');
      hit.setAttribute('r', 12);
      hit.setAttribute('class', 'map-pin-hit');

      const halo = document.createElementNS(SVG_NS, 'circle');
      halo.setAttribute('r', 9);
      halo.setAttribute('class', 'map-pin-halo');

      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('r', 4.2);
      dot.setAttribute('class', 'map-pin-dot');

      group.appendChild(hit);
      group.appendChild(halo);
      group.appendChild(dot);

      if (pin.notes.length > 1) {
        const count = document.createElementNS(SVG_NS, 'text');
        count.setAttribute('class', 'map-pin-count');
        count.setAttribute('y', 2.6);
        count.textContent = String(pin.notes.length);
        group.appendChild(count);
      }

      group.addEventListener('click', event => {
        event.stopPropagation();

        if (suppressClick) {
          return;
        }

        openPopup(pin);
      });

      pinLayer.appendChild(group);
    });
  }

  function renderMarker() {
    markerLayer.innerHTML = '';

    if (!marker) {
      return;
    }

    const point = projectPoint(marker.lat, marker.lng);
    const k = 1 / scale;

    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', 'map-marker');
    group.dataset.x = String(point.x);
    group.dataset.y = String(point.y);
    group.setAttribute('transform', `translate(${point.x} ${point.y}) scale(${k})`);

    const ring = document.createElementNS(SVG_NS, 'circle');
    ring.setAttribute('r', 7);
    ring.setAttribute('class', 'map-marker-ring');

    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('r', 3);
    dot.setAttribute('class', 'map-marker-dot');

    group.appendChild(ring);
    group.appendChild(dot);
    markerLayer.appendChild(group);
  }

  /* ---------- 交互 ---------- */

  svg.addEventListener('pointerdown', event => {
    if (event.button !== undefined && event.button !== 0) {
      return;
    }

    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 1) {
      dragging = true;
      dragMoved = false;
      suppressClick = false;
      lastPoint = { x: event.clientX, y: event.clientY };
      svg.setPointerCapture(event.pointerId);
      return;
    }

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        scale
      };
    }
  });

  svg.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) {
      return;
    }

    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 2 && pinchStart) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);

      if (pinchStart.distance > 0) {
        const factor = distance / pinchStart.distance;

        zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, factor);
        pinchStart.distance = distance;
      }

      dragMoved = true;
      suppressClick = true;
      return;
    }

    if (!dragging || !lastPoint) {
      return;
    }

    const dx = event.clientX - lastPoint.x;
    const dy = event.clientY - lastPoint.y;

    if (!dragMoved && Math.hypot(dx, dy) < DRAG_THRESHOLD) {
      return;
    }

    dragMoved = true;
    suppressClick = true;

    const before = clientToMap(lastPoint.x, lastPoint.y);
    const after = clientToMap(event.clientX, event.clientY);

    center = {
      x: center.x - (after.x - before.x),
      y: center.y - (after.y - before.y)
    };

    lastPoint = { x: event.clientX, y: event.clientY };
    applyView();
  });

  function endPointer(event) {
    pointers.delete(event.pointerId);

    if (pointers.size < 2) {
      pinchStart = null;
    }

    if (pointers.size === 0) {
      dragging = false;
      lastPoint = null;
    }
  }

  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);

  svg.addEventListener('wheel', event => {
    event.preventDefault();

    zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });

  svg.addEventListener('dblclick', event => {
    event.preventDefault();
    zoomAt(event.clientX, event.clientY, 1.8);
  });

  svg.addEventListener('click', event => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }

    // 点空白处：收起弹窗
    closePopup();

    if (!interactive) {
      return;
    }

    const point = clientToMap(event.clientX, event.clientY);

    if (point.x < 0 || point.y < 0 || point.x > MAP_WIDTH || point.y > MAP_HEIGHT) {
      return;
    }

    const { lat, lng } = unprojectPoint(point.x, point.y);

    setMarker({ lat, lng });

    if (typeof onPick === 'function') {
      onPick({
        lat: Math.max(-85, Math.min(85, lat)),
        lng
      });
    }
  });

  if (interactive) {
    svg.classList.add('is-interactive');
  }

  function setPins(next) {
    pins = Array.isArray(next) ? next : [];
    closePopup();
    renderPins();
  }

  function setMarker(next) {
    marker = next && Number.isFinite(next.lat) && Number.isFinite(next.lng)
      ? next
      : null;
    renderMarker();
  }

  function resetView() {
    scale = 1;
    center = { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 };
    applyView();
  }

  applyView();

  return {
    element: svg,
    setPins,
    setMarker,
    closePopup,
    resetView
  };
}
