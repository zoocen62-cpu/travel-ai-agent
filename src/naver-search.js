const endpoint = 'https://naverapihub.apigw.ntruss.com/search/v1/local';

function searchError(status, message) {
  return Object.assign(new Error(message), { status });
}

function textField(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function coordinate(value, limit) {
  const raw = textField(value);
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return null;
  const number = Number(raw);
  // The live API returns WGS84 coordinates as integer strings scaled by 10^7.
  const degrees = /^-?\d{8,10}$/.test(raw) ? number / 1e7 : number;
  return degrees !== 0 && Math.abs(degrees) <= limit ? degrees : null;
}

export async function search_places(region, keyword) {
  region = textField(region);
  keyword = textField(keyword);
  if (!region || region.length > 80 || !keyword || keyword.length > 100) {
    throw searchError(400, '여행 지역과 검색어를 확인해 주세요.');
  }

  const clientId = process.env.NAVER_API_HUB_CLIENT_ID?.trim();
  const clientSecret = process.env.NAVER_API_HUB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw searchError(503, '서버의 NAVER API HUB 설정이 필요합니다.');
  }

  const url = new URL(endpoint);
  url.search = new URLSearchParams({ query: region + ' ' + keyword, display: '5', format: 'json' });
  let response;
  try {
    response = await fetch(url, {
      headers: {
        'X-NCP-APIGW-API-KEY-ID': clientId,
        'X-NCP-APIGW-API-KEY': clientSecret,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    if (error.name === 'TimeoutError') throw searchError(504, '장소 검색 시간이 초과되었습니다.');
    throw searchError(502, 'NAVER API HUB에 연결하지 못했습니다.');
  }

  if ([401, 403].includes(response.status)) {
    throw searchError(502, 'NAVER API HUB 인증 정보와 지역 검색 권한을 확인해 주세요.');
  }
  if (response.status === 429) throw searchError(429, '장소 검색 사용량 한도에 도달했습니다.');
  if (!response.ok) throw searchError(502, '장소 검색에 실패했습니다.');

  const data = await response.json().catch(() => null);
  if (!Array.isArray(data?.items)) throw searchError(502, '장소 검색 응답을 읽지 못했습니다.');

  return data.items.map(item => {
    const name = textField(item?.title).replace(/<\/?b>/gi, '').trim();
    const address = textField(item?.roadAddress) || textField(item?.address);
    const longitude = coordinate(item?.mapx, 180);
    const latitude = coordinate(item?.mapy, 90);
    return {
      name,
      address,
      category: textField(item?.category),
      source: {
        name: 'NAVER API HUB 지역 검색',
        url: 'https://map.naver.com/p/search/' + encodeURIComponent([name, address].filter(Boolean).join(' ')),
      },
      coordinates: longitude === null || latitude === null ? null : { longitude, latitude },
    };
  }).filter(place => place.name);
}
