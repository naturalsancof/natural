import {MAP_HEIGHT, MAP_WIDTH} from './world-map.js';

export function projectPoint(lat, lng) {
  return {
    x: ((lng + 180) / 360) * MAP_WIDTH,
    y: ((90 - lat) / 180) * MAP_HEIGHT,
  };
}

export function unprojectPoint(x, y) {
  return {
    lng: (x / MAP_WIDTH) * 360 - 180,
    lat: 90 - (y / MAP_HEIGHT) * 180,
  };
}

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
      notes: [note],
    });
  });

  return [...groups.values()];
}

export function shortText(value, length = 48) {
  const text = (value || '').replace(/\s+/g, ' ').trim();

  if (text.length <= length) {
    return text;
  }

  return `${text.slice(0, length)}…`;
}
