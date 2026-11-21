const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const closingClock = /^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/;
const minute = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const normalize = name => name.trim().replace(/\s+/g, '').toLowerCase();

export function parseConfirmedHours(value, days) {
  if (typeof value !== 'string' || value.length > 1500) return null;
  const entries = [];
  for (const line of value.split(/\r?\n/).filter(line => line.trim())) {
    const [day, place, time, extra] = line.split('|').map(part => part.trim());
    const [opens, closes, more] = (time ?? '').split('-').map(part => part.trim());
    if (!/^\d{1,2}$/.test(day) || Number(day) < 1 || Number(day) > days || !place || extra !== undefined ||
        more !== undefined || !clock.test(opens) || !closingClock.test(closes) || opens >= closes) return null;
    entries.push({ day: Number(day), place: normalize(place), opens, closes });
  }
  return entries;
}

export function validDraft(itinerary, days) {
  return Array.isArray(itinerary) && itinerary.length === days && itinerary.every(day =>
    Array.isArray(day?.stops) && day.stops.length >= 1 && day.stops.length <= 12 &&
    day.stops.every(stop => stop && typeof stop.time === 'string' && clock.test(stop.time) &&
      (stop.endTime == null || (typeof stop.endTime === 'string' && closingClock.test(stop.endTime))) &&
      typeof stop.name === 'string' && stop.name.trim() && typeof stop.description === 'string' && stop.description.trim()),
  );
}

export function validateItinerary(itinerary, budget, trip) {
  const issues = [];
  const add = (type, severity, message, day = null, stop = null) => issues.push({ type, severity, message, day, stop });
  const maxMinutes = trip.maxTransferMinutes ?? 90;
  if (budget?.totalCost > trip.budget) {
    add('budget', 'conflict', '금액이 있는 비용만 합산해도 총예산을 ' +
      (budget.totalCost - trip.budget).toLocaleString('ko-KR') + '원 초과합니다.');
  } else if (!budget || budget.unknownCount || budget.isProvisional) {
    add('budget', 'check', '미확인 비용 또는 추정치가 있어 실제 총예산 충족 여부를 확인해야 합니다.');
  }

  for (const [index, day] of itinerary.entries()) {
    const dayNumber = index + 1;
    const weather = day.weather;
    if (day.stops.length > trip.maxStopsPerDay) {
      add('stop_limit', 'conflict', '방문지 ' + day.stops.length + '곳이 일일 한도 ' + trip.maxStopsPerDay + '곳을 초과합니다.', dayNumber);
    }
    if (weather?.status !== 'forecast') {
      add('weather', 'check', '날씨와 장소 유형의 적합성을 확인할 예보가 없습니다.', dayNumber);
    }
    const earlierStops = [];
    for (const [position, stop] of day.stops.entries()) {
      const report = (type, severity, message) => add(type, severity, stop.name + ' · ' + message, dayNumber, stop.name);
      const start = minute(stop.time);
      const end = stop.endTime ? minute(stop.endTime) : start;
      if (end < start || (stop.endTime && end === start)) report('time_overlap', 'conflict', '방문 종료 시각이 시작 시각보다 늦어야 합니다.');
      if (earlierStops.at(-1)?.start > start) report('time_order', 'conflict', '방문 시작 시각이 앞 순서의 방문보다 이릅니다.');
      if (earlierStops.some(other => other.start === start || (
        other.start < Math.max(start + 1, end) && start < Math.max(other.start + 1, other.end)
      ))) report('time_overlap', 'conflict', '다른 방문 일정과 시간이 겹칩니다.');
      earlierStops.push({ start, end });

      if (position && trip.transport === '자동차') {
        const route = stop.routeFromPrevious;
        if (!route) report('drive_time', 'check', '이전 장소에서의 자동차 이동시간 확인 필요');
        else if (route.durationMs > maxMinutes * 60000) {
          report('drive_time', 'conflict', '자동차 이동 약 ' + Math.ceil(route.durationMs / 60000) + '분이 기준 ' + maxMinutes + '분을 초과합니다.');
        }
      }

      const windows = trip.confirmedHours.filter(entry => entry.day === dayNumber && entry.place === normalize(stop.name));
      if (!windows.length) report('opening_hours', 'check', '확인된 영업시간 없음');
      else if (!windows.some(({ opens, closes }) => start >= minute(opens) && start < minute(closes) && end <= minute(closes))) {
        report('opening_hours', 'conflict', '사용자가 확인한 영업시간과 방문시간이 겹치지 않거나 방문 종료가 영업시간을 넘습니다.');
      }

      if (weather?.status === 'forecast' && weather.rainExpected) {
        const type = stop.category ?? '';
        if (/해수욕장|등산로|해변|둘레길|자연명소|수목원/.test(type)) {
          report('weather', 'conflict', '비 가능성이 있는 날의 야외 장소입니다.');
        } else if (!/박물관|미술관|전시관|과학관|공연장|영화관/.test(type)) {
          report('weather', 'check', '비 가능성이 있어 실내 이용 가능 여부를 확인해야 합니다.');
        }
      }
    }
  }
  return issues;
}
