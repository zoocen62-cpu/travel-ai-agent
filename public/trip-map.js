const container = document.querySelector('#live-map');
const status = document.querySelector('#map-status');
let sdk;
let instance;
let overlays = [];
let revision = 0;
let authenticationFailed = false;

async function loadMaps() {
  const response = await fetch('/api/maps/config', { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Map configuration unavailable');
  const { clientId } = await response.json();
  if (!clientId) throw new Error('Map client ID missing');
  return new Promise((resolve, reject) => {
    authenticationFailed = false;
    const script = document.createElement('script');
    const timer = setTimeout(() => {
      script.remove();
      reject(new Error('Map SDK timed out'));
    }, 12000);
    const url = new URL('https://oapi.map.naver.com/openapi/v3/maps.js');
    url.search = new URLSearchParams({ ncpKeyId: clientId, callback: 'travelPlannerMapsReady' });
    window.travelPlannerMapsReady = () => {
      clearTimeout(timer);
      if (window.naver?.maps?.Map) resolve(window.naver.maps);
      else reject(new Error('Map SDK unavailable'));
    };
    window.navermap_authFailure = () => {
      authenticationFailed = true;
      clearTimeout(timer);
      container.hidden = true;
      status.textContent = '네이버 지도 인증 실패 · Web Dynamic Map과 등록된 웹 서비스 주소를 확인해 주세요.';
      reject(new Error('Map authentication failed'));
    };
    script.onerror = () => {
      clearTimeout(timer);
      script.remove();
      reject(new Error('Map SDK request failed'));
    };
    script.src = url.href;
    script.async = true;
    document.head.append(script);
  });
}

new ResizeObserver(() => {
  if (instance && !container.hidden) instance.setSize([container.clientWidth, container.clientHeight]);
}).observe(container);

export async function showTripMap(stops) {
  const request = ++revision;
  container.hidden = true;
  overlays.forEach(overlay => overlay.setMap(null));
  overlays = [];
  const pins = (stops ?? []).flatMap((stop, index) => stop.coordinates ? [{ stop, index }] : []);
  if (!pins.length) {
    status.textContent = stops ? '이 날짜에는 확인된 장소 좌표가 없습니다.' : '샘플 동선도 · 실제 위치와 거리 미반영';
    return;
  }
  status.textContent = '네이버 지도를 불러오는 중…';
  try {
    sdk ??= loadMaps().catch(error => {
      sdk = undefined;
      throw error;
    });
    const maps = await sdk;
    if (request !== revision || authenticationFailed) return;
    const points = pins.map(({ stop }) => new maps.LatLng(stop.coordinates.latitude, stop.coordinates.longitude));
    container.hidden = false;
    instance ??= new maps.Map(container, { center: points[0], zoom: 14, zoomControl: true });
    instance.setSize([container.clientWidth, container.clientHeight]);
    for (const [pinIndex, { stop, index }] of pins.entries()) {
      overlays.push(new maps.Marker({
        map: instance, position: points[pinIndex], title: stop.name,
        icon: { content: '<span class="live-pin">' + (index + 1) + '</span>', anchor: new maps.Point(13, 13) },
      }));
    }
    const extent = [...points];
    let routeCount = 0;
    for (const stop of stops) {
      if (!(stop.routeFromPrevious?.path?.length >= 2)) continue;
      const path = stop.routeFromPrevious.path.map(([lng, lat]) => new maps.LatLng(lat, lng));
      overlays.push(new maps.Polyline({
        map: instance, path, strokeColor: '#235747', strokeOpacity: 0.9, strokeWeight: 4,
      }));
      for (const position of path) extent.push(position);
      routeCount++;
    }
    if (extent.length > 1) {
      const bounds = new maps.LatLngBounds(extent[0], extent[0]);
      for (const position of extent.slice(1)) bounds.extend(position);
      instance.fitBounds(bounds, { top: 24, right: 24, bottom: 24, left: 24 });
    } else {
      instance.setCenter(points[0]);
      instance.setZoom(14);
    }
    if (!authenticationFailed) {
      status.textContent = '확인된 장소 ' + pins.length + '곳 · ' +
        (routeCount ? 'Directions 5 자동차 경로 ' + routeCount + '구간' : '표시할 자동차 경로 없음');
    }
  } catch {
    if (request !== revision || authenticationFailed) return;
    container.hidden = true;
    status.textContent = '네이버 지도를 불러오지 못했습니다. 일정에서 장소와 출처를 확인할 수 있습니다.';
  }
}
