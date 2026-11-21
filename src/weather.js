const endpoint = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst';
const source = { name: '기상청 단기예보', url: 'https://www.data.go.kr/data/15084084/openapi.do' };
const grids = new Map([
  ['부산', [98, 76]], ['제주', [52, 38]], ['강릉', [92, 131]],
  ['경주', [100, 91]], ['전주', [63, 89]],
]);
const dayMs = 86400000;
const hourMs = 3600000;
const koreaOffset = 9 * hourMs;
const issueHours = [23, 20, 17, 14, 11, 8, 5, 2];

function dateString(time) {
  return new Date(time).toISOString().slice(0, 10);
}

function forecastWindow(now) {
  const koreaTime = now.getTime() + koreaOffset;
  const today = Date.parse(dateString(koreaTime));
  const available = koreaTime - 10 * 60000;
  const day = Date.parse(dateString(available));
  const hour = issueHours.find(value => day + value * hourMs <= available);
  const issueDate = hour === undefined ? day - dayMs : day;
  const issueHour = hour ?? 23;
  return { today, issueDate, issueHour, lastDay: issueDate + (issueHour >= 17 ? 4 : 3) * dayMs };
}

export function weatherDates(date, days = 1, now = new Date()) {
  const start = Date.parse(date + 'T00:00:00Z');
  if (!Number.isFinite(start) || dateString(start) !== date || !Number.isInteger(days) || days < 1 || days > 14) {
    throw new TypeError('날씨 조회 날짜를 확인해 주세요.');
  }
  const { today, lastDay } = forecastWindow(now);
  return Array.from({ length: days }, (_, index) => {
    const time = start + index * dayMs;
    const reason = time < today || time > lastDay ? 'outside_window' : 'not_requested';
    return { date: dateString(time), status: 'unknown', reason };
  });
}

export async function get_weather(region, date, days = 1, now = new Date()) {
  const forecasts = weatherDates(date, days, now);
  const grid = grids.get(region);
  if (!grid) throw new TypeError('지원하는 여행 지역을 선택해 주세요.');
  if (forecasts.every(day => day.reason === 'outside_window')) return forecasts;

  const key = process.env.WEATHER_API_KEY?.trim() || process.env.KMA_SERVICE_KEY?.trim();
  if (!key) return forecasts.map(day => day.reason === 'outside_window' ? day : { ...day, reason: 'missing_key' });

  const { issueDate, issueHour } = forecastWindow(now);
  const [nx, ny] = grid;
  const url = new URL(endpoint);
  url.search = new URLSearchParams({
    serviceKey: key, dataType: 'JSON', pageNo: '1', numOfRows: '1500',
    base_date: dateString(issueDate).replaceAll('-', ''), base_time: String(issueHour).padStart(2, '0') + '00',
    nx: String(nx), ny: String(ny),
  });

  let data;
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error();
    data = (await response.json()).response;
    if (!['00', '03'].includes(data?.header?.resultCode)) throw new Error();
  } catch {
    return forecasts.map(day => day.reason === 'outside_window' ? day : { ...day, reason: 'api_error' });
  }

  const rows = Array.isArray(data.body?.items?.item) ? data.body.items.item : [];
  return forecasts.map(day => {
    if (day.reason === 'outside_window') return day;
    const entries = rows.filter(row => row.fcstDate === day.date.replaceAll('-', '') &&
      /^\d{4}$/.test(row.fcstTime) && row.fcstTime >= '0800' && row.fcstTime <= '2100');
    const conditions = entries.filter(row => row.category === 'PTY' && /^[0-4]$/.test(row.fcstValue));
    const probabilities = entries.filter(row => row.category === 'POP' && /^\d{1,3}$/.test(row.fcstValue))
      .map(row => Number(row.fcstValue)).filter(value => value <= 100);
    if (!conditions.length && !probabilities.length) return { ...day, reason: 'no_data' };
    const maxRainProbability = probabilities.length ? Math.max(...probabilities) : null;
    const rainTimes = [...new Set(conditions.filter(row => ['1', '2', '4'].includes(row.fcstValue))
      .map(row => row.fcstTime.slice(0, 2) + ':' + row.fcstTime.slice(2)))].sort();
    return {
      date: day.date, status: 'forecast', source,
      rainExpected: rainTimes.length > 0 || (maxRainProbability !== null && maxRainProbability >= 60),
      maxRainProbability, rainTimes,
    };
  });
}
