const endpoint = 'https://maps.apigw.ntruss.com/map-direction/v1/driving';
const noRoute = () => ({ status: 'unavailable', message: '자동차 경로 확인 불가' });

function routeError(status, message) {
  return Object.assign(new Error(message), { status });
}

function coordinatePair(point) {
  const { longitude, latitude } = point ?? {};
  if (!Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
      !Number.isFinite(latitude) || Math.abs(latitude) > 90) {
    throw routeError(400, '출발지와 도착지의 경도·위도를 확인해 주세요.');
  }
  return longitude + ',' + latitude;
}

export async function get_routes(start, goal, mode = 'car') {
  if (mode !== 'car') return noRoute();
  const startPair = coordinatePair(start);
  const goalPair = coordinatePair(goal);
  if (startPair === goalPair) return noRoute();

  const clientId = process.env.NAVER_MAPS_CLIENT_ID?.trim();
  const clientSecret = process.env.NAVER_MAPS_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw routeError(503, '서버의 NAVER Maps 설정이 필요합니다.');
  }

  const url = new URL(endpoint);
  url.search = new URLSearchParams({ start: startPair, goal: goalPair, option: 'traoptimal' });
  let response;
  let data;
  try {
    response = await fetch(url, {
      headers: {
        'X-NCP-APIGW-API-KEY-ID': clientId,
        'X-NCP-APIGW-API-KEY': clientSecret,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    data = await response.json();
  } catch (error) {
    if (error.name === 'TimeoutError') throw routeError(504, '자동차 경로 조회 시간이 초과되었습니다.');
    throw routeError(502, 'NAVER Maps 응답을 받지 못했습니다.');
  }

  if ((response.ok || response.status === 400) && [1, 2, 3, 4, 5].includes(data?.code)) return noRoute();
  if ([401, 403].includes(response.status)) {
    throw routeError(502, 'NAVER Maps 인증 정보와 Directions 5 권한을 확인해 주세요.');
  }
  if (response.status === 429) throw routeError(429, 'Directions 5 활성화 여부와 사용량 한도를 확인해 주세요.');
  if (!response.ok || data?.code !== 0) throw routeError(502, '자동차 경로 조회에 실패했습니다.');

  const route = data.route?.traoptimal?.[0];
  const summary = route?.summary;
  if (!summary) return noRoute();
  const { distance, duration } = summary;
  if (!Number.isSafeInteger(distance) || distance < 0 || !Number.isSafeInteger(duration) || duration < 0) {
    throw routeError(502, '자동차 경로의 거리와 시간을 읽지 못했습니다.');
  }
  const validPath = Array.isArray(route.path) && route.path.length >= 2 && route.path.every(point =>
    Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) &&
    Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90,
  );
  return { status: 'available', distanceMeters: distance, durationMs: duration, path: validPath ? route.path : [] };
}
