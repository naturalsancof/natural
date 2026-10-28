const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const REVERSE_URL = 'https://api.bigdatacloud.net/data/reverse-geocode-client';

/**
 * 按地名搜索坐标（Open-Meteo，免费、无需 key）
 * 返回 [{ name, detail, label, lat, lng }]
 */
export async function searchPlaces(query) {
  const keyword = (query || '').trim();

  if (!keyword) {
    return [];
  }

  const url = `${GEOCODE_URL}?name=${encodeURIComponent(keyword)}&count=8&language=zh&format=json`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error('搜索失败');
  }

  const data = await response.json();

  return (data.results || []).map(item => {
    const detail = [item.admin1, item.country]
      .filter(part => part && part !== item.name)
      .join(' · ');

    return {
      name: item.name,
      detail,
      label: detail ? `${item.name} · ${detail}` : item.name,
      lat: item.latitude,
      lng: item.longitude
    };
  });
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
