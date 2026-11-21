const destinations = {
  제주: ['동문시장 먹거리', '성산일출봉', '비자림', '월정리 해변 카페', '제주 소품점'],
  부산: ['자갈치시장 먹거리', '감천문화마을', '태종대', '광안리 해변 카페', '국제시장'],
  강릉: ['중앙시장 먹거리', '오죽헌', '경포호', '안목 커피거리', '월화거리 소품점'],
  경주: ['황리단길 식당', '대릉원', '보문호', '보문호 주변 카페', '경주 중앙시장'],
  전주: ['남부시장 먹거리', '전주한옥마을', '덕진공원', '한옥마을 찻집', '전주공예품전시관'],
};

import { calculate_budget } from './budget.js';
import { showTripMap } from './trip-map.js';

const categories = ['맛집', '관광', '자연', '휴식', '쇼핑'];
const descriptions = {
  맛집: '지역 먹거리를 골라 즐겨요.',
  관광: '대표 명소를 천천히 둘러봐요.',
  자연: '풍경을 감상하며 가볍게 걸어요.',
  휴식: '잠시 쉬어 가는 시간을 가져요.',
  쇼핑: '기념품과 지역 특산품을 둘러봐요.',
};
const times = ['10:00', '13:00', '16:00'];
const positions = [[17, 71], [50, 34], [83, 55]];
const money = new Intl.NumberFormat('ko-KR');
const shortDate = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', timeZone: 'UTC' });
const fullDate = new Intl.DateTimeFormat('ko-KR', {
  month: 'long', day: 'numeric', weekday: 'long', timeZone: 'UTC',
});
const form = document.querySelector('#trip-form');
const title = document.querySelector('#result-title');
const days = document.querySelector('#days');
const detail = document.querySelector('#day-detail');
const map = document.querySelector('#map');
const departure = form.elements.namedItem('departure');

function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content) node.textContent = content;
  if (className) node.className = className;
  return node;
}

function won(amount) {
  return money.format(amount) + '원';
}

function createPlan(values) {
  const region = values.get('region').trim().replace(/\s+/g, ' ');
  const preferences = values.getAll('interests');
  const preferred = preferences.length ? preferences : categories;
  const firstDate = new Date(values.get('departure') + 'T00:00:00Z');
  const duration = Number(values.get('days'));
  const maxStopsPerDay = Number(values.get('maxStopsPerDay'));
  const itinerary = Array.from({ length: duration }, (_, index) => {
    const date = new Date(firstDate);
    date.setUTCDate(firstDate.getUTCDate() + index);

    // Start each day with a preferred category, then add variety from the sample catalog.
    const offset = index % preferred.length;
    const rotated = [...preferred.slice(offset), ...preferred.slice(0, offset)];
    const main = rotated[0];
    const other = categories.filter(category => category !== main);
    const fallback = [other[index % other.length], other[(index + 1) % other.length]];
    const selected = [...new Set([...rotated, ...fallback])].slice(0, 3);
    const foodIndex = selected.indexOf('맛집');
    if (foodIndex >= 0) {
      [selected[foodIndex], selected[1]] = [selected[1], selected[foodIndex]];
    }
    return { date, stops: selected.slice(0, maxStopsPerDay).map(makeStop) };
  });

  function makeStop(category, index) {
    return { category, name: destinations[region]?.[categories.indexOf(category)] ?? region + ' ' + category, time: times[index] };
  }

  return {
    region, itinerary, preferences,
    people: Number(values.get('people')),
    budget: Number(values.get('budget')),
    transport: values.get('transport'),
    notes: values.get('notes').trim(),
    maxStopsPerDay,
    maxTransferMinutes: Number(values.get('maxTransferMinutes')) || null,
    confirmedHours: values.get('confirmedHours').trim(),
  };
}

function renderMap(stops) {
  const width = map.clientWidth;
  const height = map.clientHeight;
  const points = positions.slice(0, stops.length).map(([x, y]) => [width * x / 100, height * y / 100]);
  const lines = points.slice(1).map(([x, y], index) => {
    const [startX, startY] = points[index];
    const line = element('span', '', 'map-segment');
    line.style.left = startX + 'px';
    line.style.top = startY + 'px';
    line.style.width = Math.hypot(x - startX, y - startY) + 'px';
    line.style.transform = 'translateY(-50%) rotate(' + Math.atan2(y - startY, x - startX) + 'rad)';
    return line;
  });
  const markers = stops.map((_, index) => {
    const marker = element('span', String(index + 1), 'map-marker');
    marker.style.left = positions[index][0] + '%';
    marker.style.top = positions[index][1] + '%';
    return marker;
  });
  map.replaceChildren(...lines, ...markers);
}

let activeStops = [];
new ResizeObserver(() => {
  if (activeStops.length) renderMap(activeStops);
}).observe(map);

function sourceLink(source) {
  const link = element('a', source.name, 'source-link');
  link.href = source.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function showDay(day, selectedButton, generated, plan) {
  for (const button of days.children) {
    button.setAttribute('aria-selected', String(button === selectedButton));
    button.tabIndex = button === selectedButton ? 0 : -1;
  }
  detail.setAttribute('aria-labelledby', selectedButton.id);
  const stops = element('ol', '', 'stops');
  for (const [index, stop] of day.stops.entries()) {
    const row = element('li');
    const time = element('time', stop.time);
    time.dateTime = stop.time;
    const description = element('div');
    description.append(element('strong', stop.name), element('p', stop.description ?? descriptions[stop.category], 'stop-description'));
    if (generated) {
      if (stop.address) description.append(element('p', stop.address, 'stop-description'));
      description.append(stop.source ? sourceLink(stop.source) : element('p', '장소 출처 미확인', 'stop-description'));
      if (index > 0) {
        const route = stop.routeFromPrevious;
        const movement = route
          ? '이전 장소에서 자동차 약 ' + Math.ceil(route.durationMs / 60000) + '분 · ' +
            (route.distanceMeters / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 2 }) + ' km · Directions 5'
          : '이전 장소에서 ' + plan.transport + ' 이동시간 확인 불가';
        description.append(element('p', movement, 'stop-description'));
        if (plan.transport === '자동차' && plan.maxTransferMinutes &&
            (!route || route.durationMs > plan.maxTransferMinutes * 60000)) {
          description.append(element('p', route ? '요청한 이동시간 한도 초과' : '요청한 이동시간 한도 충족 여부 미확인', 'stop-description'));
        }
      }
    }
    const visitTime = element('div', '', 'visit-time');
    visitTime.append(time);
    if (generated && stop.endTime) {
      const end = element('span', '– ' + stop.endTime, 'stop-description');
      visitTime.append(end);
    }
    row.append(visitTime, description);
    stops.append(row);
  }
  detail.replaceChildren(element('h4', fullDate.format(day.date)), stops);
  if (generated && day.weather) {
    const forecast = day.weather;
    const reasons = {
      outside_window: '기상청 단기예보 범위 밖', not_requested: '이번 일정에서 예보 조회 생략',
      missing_key: '기상청 서비스 키 미설정', api_error: '기상청 예보 조회 실패', no_data: '해당 시간대 예보 없음',
      unknown_region: '예보 격자에 연결할 지역 좌표 미확인',
    };
    const summary = forecast.status === 'forecast'
      ? (forecast.rainExpected ? '비 가능성 있음' : '주간 비 신호 없음') +
        (forecast.maxRainProbability === null ? '' : ' · 최대 강수확률 ' + forecast.maxRainProbability + '%') +
        (forecast.rainTimes.length ? ' · 비 예보 ' + forecast.rainTimes.join(', ') : '')
      : '날씨 미확인 · ' + (reasons[forecast.reason] ?? '예보 없음');
    const weather = element('p', summary, 'stop-description trip-weather');
    if (forecast.source) weather.append(' · ', sourceLink(forecast.source));
    stops.before(weather);
  }
  map.hidden = generated;
  activeStops = generated ? [] : day.stops;
  if (activeStops.length) renderMap(activeStops);
  void showTripMap(generated ? day.stops : null);
  document.querySelector('#map-key').replaceChildren(
    ...day.stops.map((stop, index) => element('li', (index + 1) + '. ' + stop.name +
      (generated && !stop.coordinates ? ' · 좌표 미확인' : ''))),
  );
}

function renderTrace(trace, failed = false) {
  const statuses = { success: '완료', unavailable: '확인 불가', error: '실패' };
  const records = trace.map(({ name, status, summary }) => name + ' · ' + statuses[status] + ' · ' + summary);
  if (failed) records.unshift('최근 일정 생성 요청이 완료되지 않았습니다.');
  if (!records.length) records.push('이번 일정에서 호출된 도구가 없습니다.');
  document.querySelector('#agent-log').replaceChildren(...records.map(record => element('li', record)));
}

function renderValidation(validation) {
  document.querySelector('#plan-validation').hidden = !validation;
  if (!validation) return;
  const { issues, revisions, maxReplans, maxTransferMinutes } = validation;
  const conflictCount = issues.filter(issue => issue.severity === 'conflict').length;
  document.querySelector('#validation-summary').textContent =
    '남은 충돌 ' + conflictCount + '건 · 확인 필요 ' + (issues.length - conflictCount) +
    '건 · 재계획 ' + revisions.length + '/' + maxReplans + '회 · 자동차 구간 기준 ' + maxTransferMinutes + '분';
  document.querySelector('#validation-issues').replaceChildren(...issues.map(issue =>
    element('li', (issue.severity === 'conflict' ? '충돌' : '확인 필요') + ' · ' +
      (issue.day ? issue.day + '일차 · ' : '') + issue.message),
  ));
  document.querySelector('#validation-revisions').replaceChildren(...revisions.map((revision, index) => {
    const details = element('details', '', 'validation-revision');
    const status = revision.failed ? '수정 시도 실패' : revision.applied ? '수정 반영' : '이전 일정 유지';
    details.append(element('summary', (index + 1) + '차 재계획 · ' + status));
    const reasons = element('ul', '', 'validation-list');
    for (const reason of revision.reasons) {
      reasons.append(element('li', '수정 이유 · ' + (reason.day ? reason.day + '일차 · ' : '') + reason.message));
    }
    for (const change of revision.changes) {
      reasons.append(element('li', change.day + '일차 · ' + change.before + ' → ' + change.after));
    }
    details.append(reasons);
    return details;
  }));
}

function renderPlan(plan, generated = false, selectedDay = 0) {
  document.querySelector('#result-kind').textContent = generated ? 'AI가 작성한 여행 계획' : '샘플 여행 계획';
  title.textContent = plan.region + ' ' + plan.itinerary.length + '일 여행';
  document.querySelector('#trip-summary').textContent =
    shortDate.format(plan.itinerary[0].date) + ' 출발 · ' + plan.people + '명 · ' + plan.transport;

  const buttons = plan.itinerary.map((day, index) => {
    const button = element('button', (index + 1) + '일차 · ' + shortDate.format(day.date));
    button.type = 'button';
    button.id = 'trip-day-' + (index + 1);
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', 'day-detail');
    button.addEventListener('click', () => showDay(day, button, generated, plan));
    button.addEventListener('keydown', event => {
      const count = plan.itinerary.length;
      const nextIndex = { ArrowRight: (index + 1) % count, ArrowLeft: (index + count - 1) % count, Home: 0, End: count - 1 }[event.key];
      if (!Number.isInteger(nextIndex)) return;
      event.preventDefault();
      days.children[nextIndex].focus();
      days.children[nextIndex].click();
    });
    return button;
  });
  days.replaceChildren(...buttons);
  const activeDay = Math.min(selectedDay, buttons.length - 1);
  showDay(plan.itinerary[activeDay], buttons[activeDay], generated, plan);

  document.querySelector('#budget-total').textContent = won(plan.budget);
  document.querySelector('#per-person').textContent = '1인당 약 ' + won(Math.round(plan.budget / plan.people));
  const transportLabel = { 자동차: '차량·주유', 대중교통: '대중교통', 도보: '이동' }[plan.transport];
  const transportShare = { 자동차: 20, 대중교통: 15, 도보: 0 }[plan.transport];
  const lodgingShare = plan.itinerary.length > 1 ? 35 : 0;
  const allocation = [[transportLabel, transportShare], ['숙박', lodgingShare], ['식비', 30]];
  let remainder = plan.budget;
  const budgetRows = allocation.map(([label, share]) => {
    const amount = Math.floor(plan.budget * share / 100);
    remainder -= amount;
    return [label, amount];
  });
  budgetRows.push(['관광·기타', remainder]);
  const budget = generated ? plan.agentBudget : calculate_budget(plan.budget, budgetRows.map(([category, amount]) => ({
    category, amount, status: 'estimated',
  })));
  document.querySelector('#budget-caption').textContent = generated ? '입력한 총예산' : '입력 예산 기준 예시 배분';
  const costStatus = { confirmed: '확인', estimated: '추정', unknown: '미확인' };
  const expenses = budget?.expenses ?? [];
  const rows = expenses.map(({ category, amount, status }) => {
    const row = element('tr');
    const label = element('th', category);
    label.scope = 'row';
    row.append(label, element('td', amount === null ? '미확인' : won(amount) + ' (' + costStatus[status] + ')'));
    return row;
  });
  if (expenses.some(item => item.amount !== null)) {
    const row = element('tr');
    const label = element('th', '금액이 있는 비용 합계');
    label.scope = 'row';
    row.append(label, element('td', won(budget.totalCost)));
    rows.push(row);
  }
  document.querySelector('#budget-items').replaceChildren(...rows);
  const remaining = document.querySelector('#budget-remaining');
  const remainingLabel = document.querySelector('#budget-remaining-label');
  remainingLabel.textContent = '잔여 예산';
  if (!budget || budget.expenses.every(item => item.amount === null)) {
    remaining.textContent = '미확인';
  } else {
    remainingLabel.textContent = (budget.isProvisional ? '잠정 ' : '') + (budget.remainingBudget < 0 ? '예산 초과' : '잔여 예산');
    remaining.textContent = won(Math.abs(budget.remainingBudget));
  }

  const sources = plan.webSources ?? [];
  document.querySelector('#web-sources').hidden = sources.length === 0;
  document.querySelector('#web-sources-list').replaceChildren(...sources.map(source => {
    const item = element('li');
    item.append(sourceLink(source));
    return item;
  }));
  if (generated) {
    renderValidation(plan.validation);
    renderTrace(plan.trace);
    return;
  }
  const records = [
    '여행 조건 확인 · ' + plan.region + ' / ' + plan.itinerary.length + '일 / ' + plan.people + '명',
    '예시 장소 선택 · ' + (plan.preferences.join(', ') || '전체 취향'),
    '샘플 일정, 동선도, 예산 배분 생성 완료',
  ];
  if (plan.notes) records.splice(1, 0, '추가 요청 기록 (샘플 일정에는 미반영) · ' + plan.notes);
  document.querySelector('#agent-log').replaceChildren(...records.map(record => element('li', record)));
}

const koreaDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
});
const dateParts = Object.fromEntries(koreaDate.formatToParts(new Date()).map(({ type, value }) => [type, value]));
departure.value = [dateParts.year, dateParts.month, dateParts.day].join('-');
const sampleValues = new FormData(form);
sampleValues.set('region', '제주');
renderPlan(createPlan(sampleValues));

const submitButton = form.querySelector('button[type="submit"]');
const requestStatus = document.querySelector('#request-status');
const requestError = document.querySelector('#request-error');
const chat = document.querySelector('#plan-chat');
const chatForm = document.querySelector('#chat-form');
const chatInput = chatForm.elements.namedItem('message');
const chatButton = chatForm.querySelector('button[type="submit"]');
const chatMessages = document.querySelector('#chat-messages');
const chatStatus = document.querySelector('#chat-status');
const chatError = document.querySelector('#chat-error');
const undoButton = document.querySelector('#undo-edit');
let currentPlan;
let undoPlan;
let editing = false;
let generating = false;

function planFromResponse(plan, result) {
  if (!Array.isArray(result?.itinerary) || result.itinerary.length !== plan.itinerary.length ||
      typeof result.planId !== 'string') return null;
  return {
    ...plan,
    planId: result.planId,
    itinerary: plan.itinerary.map((day, index) => ({ ...day, ...result.itinerary[index] })),
    trace: result.trace ?? [],
    agentBudget: result.budget,
    webSources: result.webSources,
    validation: result.validation,
  };
}

function syncChat() {
  chat.hidden = !currentPlan;
  chatInput.disabled = generating || editing;
  chatButton.disabled = generating || editing;
  undoButton.disabled = !undoPlan || generating || editing;
  submitButton.disabled = generating || editing;
}

function chatMessage(speaker, message, changes = []) {
  const item = element('li', '', 'chat-message');
  item.append(element('strong', speaker), element('p', message));
  if (changes.length) {
    const list = element('ul', '', 'validation-list');
    for (const change of changes) {
      const entry = element('li');
      entry.append(
        element('strong', change.day + '일차'),
        element('p', '변경 전 · ' + change.before),
        element('p', '변경 후 · ' + change.after),
        element('p', '이유 · ' + change.reason),
      );
      list.append(entry);
    }
    item.append(list);
  }
  chatMessages.append(item);
}

chatForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!currentPlan || generating || editing) return;
  const message = chatInput.value.trim();
  if (!message) return;
  editing = true;
  syncChat();
  chatError.textContent = '';
  chatStatus.textContent = '일정을 수정하고 다시 검증하는 중…';
  chatMessage('나', message);
  try {
    const response = await fetch('/api/plan/revise', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId: currentPlan.planId, message }),
    });
    const result = await response.json().catch(() => null);
    const revised = response.ok && planFromResponse(currentPlan, result);
    if (!revised || !result.edit || !Array.isArray(result.edit.changes)) {
      chatError.textContent = result?.error || '일정을 수정하지 못했습니다. 다시 시도해 주세요.';
      return;
    }
    const changes = result.edit.changes;
    const selectedDay = changes.length ? changes[0].day - 1 : [...days.children].findIndex(button =>
      button.getAttribute('aria-selected') === 'true');
    if (changes.length || JSON.stringify(revised.itinerary) !== JSON.stringify(currentPlan.itinerary) ||
        JSON.stringify(revised.agentBudget) !== JSON.stringify(currentPlan.agentBudget)) {
      undoPlan = currentPlan;
    }
    currentPlan = revised;
    renderPlan(currentPlan, true, Math.max(0, selectedDay));
    chatMessage('Agent', result.edit.reply || (changes.length ? '수정한 일정을 다시 검증했습니다.' : '방문 일정에 변경 사항이 없습니다.'), changes);
    chatInput.value = '';
    chatStatus.textContent = changes.length ? '수정 완료' : '검증 완료';
  } catch {
    chatError.textContent = '수정 요청을 보내는 중 연결에 문제가 생겼습니다.';
  } finally {
    if (chatError.textContent) chatStatus.textContent = '';
    editing = false;
    syncChat();
    chatInput.focus();
  }
});

undoButton.addEventListener('click', () => {
  if (!undoPlan || editing || generating) return;
  currentPlan = undoPlan;
  undoPlan = null;
  renderPlan(currentPlan, true);
  chatError.textContent = '';
  chatStatus.textContent = '직전 수정 전 일정으로 돌아왔습니다.';
  chatMessage('안내', chatStatus.textContent);
  syncChat();
  chatInput.focus();
});
const placesForm = document.querySelector('#places-form');
const placesButton = placesForm.querySelector('button[type="submit"]');
const placesStatus = document.querySelector('#places-status');
const placesError = document.querySelector('#places-error');
const placesList = document.querySelector('#places-list');
const routePoints = document.querySelector('#route-points');
const routeButton = document.querySelector('#route-button');
const routeStatus = document.querySelector('#route-status');
const routePlaces = { start: null, goal: null };
let routeSelectionVersion = 0;

function selectRoutePlace(type, place) {
  routePlaces[type] = place;
  routeSelectionVersion++;
  routePoints.textContent = '출발 ' + (routePlaces.start?.name ?? '미선택') +
    ' · 도착 ' + (routePlaces.goal?.name ?? '미선택');
  routeButton.disabled = !routePlaces.start || !routePlaces.goal;
  routeStatus.textContent = '';
}

routeButton.addEventListener('click', async () => {
  const version = ++routeSelectionVersion;
  routeButton.disabled = true;
  routeStatus.textContent = '자동차 경로를 확인하고 있습니다…';
  try {
    const response = await fetch('/api/routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start: routePlaces.start.coordinates, goal: routePlaces.goal.coordinates }),
    });
    const route = await response.json();
    if (version !== routeSelectionVersion) return;
    if (!response.ok) {
      routeStatus.textContent = route.error || '자동차 경로 조회에 실패했습니다.';
    } else if (route.status === 'available') {
      const distance = (route.distanceMeters / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
      routeStatus.textContent = distance + ' km · 예상 ' + Math.ceil(route.durationMs / 60000) + '분';
    } else {
      routeStatus.textContent = '자동차 경로 확인 불가';
    }
  } catch {
    if (version === routeSelectionVersion) routeStatus.textContent = '자동차 경로 조회에 연결하지 못했습니다.';
  } finally {
    if (version === routeSelectionVersion) routeButton.disabled = false;
  }
});

placesForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (placesButton.disabled) return;
  const keyword = placesForm.elements.namedItem('keyword').value.trim();
  placesError.textContent = '';
  if (!keyword) {
    placesError.textContent = '검색어를 입력해 주세요.';
    return;
  }

  const region = form.elements.namedItem('region').value.trim().replace(/\s+/g, ' ');
  if (!region) {
    placesError.textContent = '여행 지역을 입력해 주세요.';
    return;
  }
  const query = new URLSearchParams({ region, keyword });
  placesButton.disabled = true;
  placesList.replaceChildren();
  placesStatus.textContent = region + ' · ' + keyword + ' 검색 중…';
  try {
    const response = await fetch('/api/places?' + query);
    const data = await response.json();
    if (!response.ok) {
      placesStatus.textContent = '';
      placesError.textContent = data.error || '장소 검색에 실패했습니다.';
      return;
    }

    placesList.replaceChildren(...data.places.map(place => {
      const row = element('li');
      row.append(
        element('strong', place.name),
        element('p', place.category || '카테고리 정보 없음', 'stop-description'),
        element('p', place.address || '주소 정보 없음', 'stop-description'),
        element('p', place.coordinates
          ? '위도 ' + place.coordinates.latitude + ' · 경도 ' + place.coordinates.longitude
          : '좌표 정보 없음', 'stop-description'),
      );
      if (place.source) row.append(sourceLink(place.source));
      if (place.coordinates) {
        const actions = element('div', '', 'route-actions');
        for (const [type, label] of [['start', '출발지'], ['goal', '도착지']]) {
          const button = element('button', label + '로 선택');
          button.type = 'button';
          button.setAttribute('aria-label', place.name + '을 ' + label + '로 선택');
          button.addEventListener('click', () => selectRoutePlace(type, place));
          actions.append(button);
        }
        row.append(actions);
      }
      return row;
    }));
    placesStatus.textContent = region + ' · ' + keyword + ' — ' +
      (data.places.length ? '검색 결과 ' + data.places.length + '곳' : '검색 결과가 없습니다.');
  } catch {
    placesStatus.textContent = '';
    placesError.textContent = '장소 검색에 연결하지 못했습니다. 다시 시도해 주세요.';
  } finally {
    placesButton.disabled = false;
  }
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (generating || editing) return;
  const values = new FormData(form);
  const plan = createPlan(values);
  const { region, people, budget, transport, preferences, notes } = plan;
  if (!region) {
    requestError.textContent = '여행 지역을 입력해 주세요.';
    form.elements.namedItem('region').focus();
    return;
  }
  generating = true;
  syncChat();
  submitButton.textContent = '일정 만드는 중…';
  requestError.textContent = '';
  requestStatus.textContent = 'AI가 여행 일정을 만들고 있어요.';
  document.querySelector('#result-status').textContent = '';

  try {
    const response = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        region, people, budget, transport, notes,
        maxStopsPerDay: plan.maxStopsPerDay, maxTransferMinutes: plan.maxTransferMinutes,
        confirmedHours: plan.confirmedHours,
        departure: values.get('departure'),
        days: plan.itinerary.length,
        interests: preferences,
      }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      requestError.textContent = result?.error || '여행 일정 요청에 실패했습니다. 다시 시도해 주세요.';
      if (Array.isArray(result?.trace)) renderTrace(result.trace, true);
      return;
    }
    const generated = planFromResponse(plan, result);
    if (!generated) {
      requestError.textContent = '일정 응답을 읽지 못했습니다. 다시 시도해 주세요.';
      return;
    }
    currentPlan = generated;
    undoPlan = null;
    chatMessages.replaceChildren();
    chatInput.value = '';
    chatError.textContent = '';
    chatStatus.textContent = '';
    renderPlan(currentPlan, true);
    title.focus();
    document.querySelector('#result-status').textContent = title.textContent + ' 일정이 생성되었습니다.';
  } catch {
    requestError.textContent = '여행 일정에 연결하는 중 문제가 발생했습니다. 다시 시도해 주세요.';
  } finally {
    requestStatus.textContent = '';
    submitButton.textContent = 'AI 여행 계획 만들기';
    generating = false;
    syncChat();
  }
});
