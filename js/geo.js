const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const REVERSE_URL = 'https://api.bigdatacloud.net/data/reverse-geocode-client';

// 行政区划类型的加权，避免把同名的公交站/小店排在前面
const TYPE_BONUS = {
  city: 12,
  town: 10,
  village: 8,
  administrative: 8,
  county: 8,
  state: 6,
  country: 4,
  municipality: 8,
  suburb: 6
};

function normalize(value) {
  return (value || '')
    .toLowerCase()
    .replace(/[\s·,，.。()（）\-]/g, '')
    .replace(/(特别行政区|自治区|自治州|地区|省|市|县|区|镇|乡|村)+$/, '');
}

/**
 * 生成几个查询变体：原文 / 去掉省市区后缀 / 去掉「中国」前缀
 */
function buildVariants(query) {
  const cleaned = query.replace(/\s+/g, '').replace(/^中国/, '');
  const stripped = cleaned.replace(/(特别行政区|自治区|自治州|地区|省|市|县|区|镇|乡|村)+$/, '');

  return [...new Set([cleaned, stripped].filter(item => item.length >= 2))];
}

async function fetchJson(url, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

async function fromOpenMeteo(query) {
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(query)}&count=8&language=zh&format=json`;
  const data = await fetchJson(url);

  if (!data || !Array.isArray(data.results)) {
    return [];
  }

  return data.results.map(item => {
    const detail = [item.admin1, item.country]
      .filter(part => part && part !== item.name)
      .join(' · ');

    return {
      name: item.name,
      detail,
      label: detail ? `${item.name} · ${detail}` : item.name,
      lat: item.latitude,
      lng: item.longitude,
      type: 'city',
      source: 'open-meteo'
    };
  });
}

async function fromNominatim(query) {
  const url = `${NOMINATIM_URL}?format=jsonv2&addressdetails=1&limit=8&accept-language=zh-CN&q=${encodeURIComponent(query)}`;
  const data = await fetchJson(url);

  if (!Array.isArray(data)) {
    return [];
  }

  return data.map(item => {
    const address = item.address || {};
    const name = item.name
      || address.city
      || address.town
      || address.village
      || address.county
      || address.state
      || '';

    if (!name) {
      return null;
    }

    const parts = [];

    ['city', 'town', 'county', 'state', 'country'].forEach(key => {
      const value = address[key];

      if (value && value !== name && !parts.includes(value)) {
        parts.push(value);
      }
    });

    const detail = parts.slice(0, 2).join(' · ');

    return {
      name,
      detail,
      label: detail ? `${name} · ${detail}` : name,
      lat: Number(item.lat),
      lng: Number(item.lon),
      type: item.type || '',
      source: 'nominatim'
    };
  }).filter(item => item && Number.isFinite(item.lat) && Number.isFinite(item.lng));
}

function dedupe(list) {
  const seen = new Set();
  const result = [];

  list.forEach(item => {
    const key = `${item.lat.toFixed(2)},${item.lng.toFixed(2)},${normalize(item.name)}`;

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    result.push(item);
  });

  return result;
}

function fuzzyScore(query, item) {
  const q = normalize(query);
  const name = normalize(item.name);
  const label = normalize(item.label);

  if (!q) {
    return 0;
  }

  let score = 10;

  if (name === q) {
    score = 100;
  } else if (name.startsWith(q)) {
    score = 92;
  } else if (name.includes(q)) {
    score = 84;
  } else if (label.includes(q)) {
    score = 70;
  } else {
    // 打散匹配：允许「云南大理」这种词序
    let index = 0;
    let hit = true;

    for (const char of q) {
      const found = name.indexOf(char, index);

      if (found === -1) {
        hit = false;
        break;
      }

      index = found + 1;
    }

    if (hit) {
      score = 45;
    }
  }

  // OSM 的行政区层级更可靠，同分时优先
  const sourceBonus = item.source === 'nominatim' ? 6 : 0;

  return score + (TYPE_BONUS[item.type] || 0) + sourceBonus;
}

/**
 * 模糊搜索地名：同时查 Open-Meteo 和 Nominatim，按相似度排序
 */
export async function searchPlaces(query) {
  const keyword = (query || '').trim();

  if (keyword.length < 2) {
    return [];
  }

  for (const variant of buildVariants(keyword)) {
    const [openMeteo, nominatim] = await Promise.all([
      fromOpenMeteo(variant),
      fromNominatim(variant)
    ]);

    const merged = dedupe([...nominatim, ...openMeteo]);

    if (!merged.length) {
      continue;
    }

    return merged
      .map(item => ({ ...item, score: fuzzyScore(keyword, item) }))
      .sort((a, b) => b.score - a.score || a.name.length - b.name.length)
      .slice(0, 10);
  }

  return [];
}

/**
 * 由坐标反查地名（BigDataCloud，免费、无需 key）
 */
export async function reverseGeocode(lat, lng) {
  const url = `${REVERSE_URL}?latitude=${lat}&longitude=${lng}&localityLanguage=zh`;
  const fallback = `${lat.toFixed(2)}, ${lng.toFixed(2)}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      return fallback;
    }

    const data = await response.json();

    const locality = data.city
      || data.locality
      || data.principalSubdivision
      || '';

    const country = data.countryName || '';

    const unique = [...new Set([locality, country].filter(Boolean))];

    return unique.length ? unique.join(' · ') : fallback;
  } catch {
    return fallback;
  }
}

/**
 * 浏览器定位
 */
export function locateMe() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('这台设备不支持定位'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      position => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
      },
      error => {
        const message = error.code === 1
          ? '定位权限被拒绝'
          : '定位失败，请稍后再试';
        reject(new Error(message));
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 }
    );
  });
}
