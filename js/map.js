import { MAP_WIDTH, MAP_HEIGHT, WORLD_PATH } from './world-map.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

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

function shortText(value, length = 42) {
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

/**
 * 世界地图组件
 * @param {HTMLElement} host 容器
 * @param {object} options { onSelectNote, interactive, onPick }
 */
export function createMap(host, options = {}) {
  const { onSelectNote = null, interactive = false, onPick = null } = options;

  host.innerHTML = '';

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`);
  svg.setAttribute('class', 'world-map');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

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

  function closePopup() {
    popup.hidden = true;
    popup.innerHTML = '';
  }

  function openPopup(pin) {
    const point = projectPoint(pin.lat, pin.lng);

    popup.innerHTML = '';

    const title = document.createElement('p');
    title.className = 'map-popup-title';
    title.textContent = pin.notes.length > 1
      ? `${pin.notes.length} 条留言在这附近`
      : '这条留言在这里';
    popup.appendChild(title);

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

      item.addEventListener('click', () => {
        closePopup();

        if (typeof onSelectNote === 'function') {
          onSelectNote(note.id);
        }
      });

      popup.appendChild(item);
    });

    const leftPercent = Math.min(88, Math.max(12, (point.x / MAP_WIDTH) * 100));
    const topPercent = (point.y / MAP_HEIGHT) * 100;

    popup.classList.toggle('is-below', topPercent < 34);
    popup.style.left = `${leftPercent}%`;
    popup.style.top = `${topPercent}%`;
    popup.hidden = false;
  }

  function renderPins() {
    pinLayer.innerHTML = '';

    pins.forEach(pin => {
      const point = projectPoint(pin.lat, pin.lng);

      const group = document.createElementNS(SVG_NS, 'g');
      group.setAttribute('class', 'map-pin');
      group.setAttribute('transform', `translate(${point.x} ${point.y})`);

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

    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', 'map-marker');
    group.setAttribute('transform', `translate(${point.x} ${point.y})`);

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

  if (interactive) {
    svg.classList.add('is-interactive');

    svg.addEventListener('click', event => {
      const matrix = svg.getScreenCTM();

      if (!matrix) {
        return;
      }

      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;

      const local = point.matrixTransform(matrix.inverse());

      if (local.x < 0 || local.y < 0 || local.x > MAP_WIDTH || local.y > MAP_HEIGHT) {
        return;
      }

      const { lat, lng } = unprojectPoint(local.x, local.y);

      setMarker({ lat, lng });

      if (typeof onPick === 'function') {
        onPick({
          lat: Math.max(-85, Math.min(85, lat)),
          lng
        });
      }
    });
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

  return {
    element: svg,
    setPins,
    setMarker,
    closePopup
  };
}
