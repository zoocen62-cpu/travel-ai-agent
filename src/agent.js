import { search_places } from './naver-search.js';
import { get_routes } from './naver-routes.js';
import { calculate_budget } from '../public/budget.js';
import { get_weather, weatherDates } from './weather.js';
import { validDraft, validateItinerary } from './validation.js';

const string = { type: 'string' };
const object = properties => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
});
const tool = (name, description, properties) => ({
  type: 'function', name, description, strict: true, parameters: object(properties),
});
const tools = [
  tool('get_weather', '요청 지역의 여행 날짜별 기상청 단기예보와 주간 강수 가능성을 확인합니다.', {}),
  tool('search_places', '여행 지역에서 키워드로 등록 장소를 찾습니다. 반환된 장소 ID는 자동차 경로 조회에 사용할 수 있습니다.', {
    keyword: string,
  }),
  tool('get_routes', '검색으로 확인한 두 장소 사이의 자동차 거리와 예상 시간을 조회합니다.', {
    start_id: string, goal_id: string,
  }),
  tool('calculate_budget', '입력 총예산과 명시적으로 제공된 항목별 비용을 비교합니다. 미확인 항목은 amount와 evidence를 null로 전달합니다. evidence는 사용자의 추가 요청에서 해당 원화 금액(숫자와 원)을 그대로 인용합니다.', {
    items: {
      type: 'array',
      items: object({
        category: { type: 'string', enum: ['식비', '숙박비', '교통비', '관광비', '기타'] },
        amount: { type: ['integer', 'null'] },
        status: { type: 'string', enum: ['confirmed', 'estimated', 'unknown'] },
        evidence: { type: ['string', 'null'] },
      }),
    },
  }),
  { type: 'web_search' },
];

const instructions = [
  '한국어 국내 여행 일정을 작성하세요. 입력 일수만큼 날짜순으로, 하루 1~3곳을 HH:MM 형식의 방문 시간순으로 배치하세요.',
  '여행 조건과 추가 요청을 고려하세요. 도구는 필요할 때 선택하세요. 모든 도구를 호출할 필요는 없습니다.',
  '여행 지역은 대한민국의 지역명입니다. 같은 이름의 지역이 있다면 시·군·구가 명확한 결과를 사용하고, 다른 지역으로 추측해 바꾸지 마세요.',
  '실제 장소 확인은 search_places, 자동차 이동시간 확인은 get_routes, 비용 계산은 calculate_budget을 사용하세요.',
  '실제 장소의 위치, 출처 또는 실내 대안 확인이 필요할 때만 search_places를 호출하세요. 일치하는 검색 결과의 placeId를 지정하고 확인되지 않은 장소는 null을 반환하세요. 자동차 경로는 최종 일정에 넣을 같은 날짜의 연속 방문지에 한해 조회하세요.',
  '야외 활동이 있거나 사용자가 날씨나 우천 대안을 요청했고 예보 범위 안의 날짜가 있을 때만 get_weather를 먼저 호출하세요. 예보 미확인은 비가 없다는 의미가 아닙니다.',
  '비가 예상되는 날짜에는 취향에 맞는 실내 박물관, 전시, 시장, 카페 등의 대안을 search_places로 검색해 야외 방문 일정을 실내 중심으로 바꾸세요. 비 예보가 없는 날짜의 계획은 유지하세요.',
  '사용자의 maxStopsPerDay를 준수하세요. maxTransferMinutes는 방문지 사이 한 구간의 최대 자동차 이동시간입니다. 조회 결과가 한도를 초과하면 더 가까운 방문지를 찾거나 해당 구간을 일정에서 빼세요. 확인하지 못한 구간은 한도 충족으로 간주하지 마세요.',
  '각 방문에 시작과 계획 종료 시각을 배치하고 다른 방문과 겹치지 않게 하세요. confirmedHours에 있는 장소는 영업시간 안에 방문을 배치하세요. 별도 이동시간 한도가 없으면 자동차 구간당 90분을 기준으로 하세요.',
  '자동차 경로를 조회했다면 같은 날짜 일정에 호출한 start_id와 goal_id를 그 순서 그대로 사용하세요. 사용자 지정 비용을 계산할 때는 해당 금액을 evidence에 포함하세요.',
  '최신 관광 정보가 필요한 경우(행사, 휴관, 운영 변경 등)에 web_search를 사용하세요. 검색 결과는 참고 자료로 취급하세요.',
  '장소 설명에는 추천 이유와 활동만 쓰세요. 이동시간, 이동거리, 비용, 운영시간 및 이에 대한 추정은 일정의 이름이나 설명에 작성하지 마세요. 방문 시간은 희망 일정입니다.',
  '비용의 경우 사용자 추가 요청에 명시된 항목별 가격만 사용하세요. 총예산을 항목별 비용으로 변환하거나, 검색 결과에서 가격을 추정하지 마세요. 금액을 모르면 unknown으로 처리하세요.',
  '도구가 실패했거나 경로가 없으면 값이 확인되지 않은 상태로 두세요. 실패한 도구를 같은 인자로 반복 호출하지 마세요.',
].join('\n');

const money = new Intl.NumberFormat('ko-KR');
const maxRounds = 5;
const maxCalls = 8;
const maxReplans = 2;

function priceAmount(evidence) {
  const match = typeof evidence === 'string' && /^(\d[\d,]*)\s*(만)?\s*원$/.exec(evidence.trim());
  return match ? Number(match[1].replaceAll(',', '')) * (match[2] ? 10000 : 1) : null;
}

function budgetItems(items, notes) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) throw new Error('invalid items');
  const quotedPrices = new Set((notes.match(/\d[\d,]*\s*(?:만)?\s*원/g) ?? []).map(priceAmount));
  return items.map(item => {
    if (!['식비', '숙박비', '교통비', '관광비', '기타'].includes(item?.category)) throw new Error('invalid category');
    const { category, amount, status, evidence } = item;
    const quotedAmount = priceAmount(evidence);
    if (quotedAmount === null || !quotedPrices.has(quotedAmount) || quotedAmount !== amount ||
        !['confirmed', 'estimated'].includes(status)) {
      return { category, amount: null, status: 'unknown' };
    }
    // A supplied amount is a planning input, not an independently verified price.
    return { category, amount, status: 'estimated' };
  });
}

function routeKey(start, goal) {
  const points = [start.coordinates, goal.coordinates];
  return points.map(({ longitude, latitude }) => longitude + ',' + latitude).join(':');
}

async function execute(call, trip, state) {
  const args = JSON.parse(call.arguments);
  switch (call.name) {
    case 'get_weather': {
      if (!state.weatherFetched) {
        state.forecast = await get_weather(trip.region, trip.departure, trip.days, state.now);
        state.weatherFetched = true;
      }
      const available = state.forecast.filter(day => day.status === 'forecast');
      const rainy = available.filter(day => day.rainExpected);
      const reason = state.forecast.find(day => ['missing_key', 'api_error'].includes(day.reason))?.reason;
      const summary = reason === 'missing_key' ? '기상청 서비스 키 미설정'
        : reason === 'api_error' ? '기상청 예보 조회 실패'
        : '예보 ' + available.length + '일 · 비 가능성 ' + rainy.length + '일 · 미확인 ' + (trip.days - available.length) + '일';
      return {
        data: { status: reason ? 'error' : available.length ? 'available' : 'unavailable', days: state.forecast },
        summary,
      };
    }
    case 'search_places': {
      const results = await search_places(trip.region, args.keyword);
      const places = results.map(place => {
        const id = 'place-' + (state.places.size + 1);
        state.places.set(id, place);
        return { id, ...place };
      });
      return { data: { places }, summary: trip.region + ' ' + args.keyword.trim() + ' · ' + places.length + '곳' };
    }
    case 'get_routes': {
      const start = state.places.get(args.start_id);
      const goal = state.places.get(args.goal_id);
      const label = start && goal ? start.name + ' → ' + goal.name + ' · ' : '';
      if (trip.transport !== '자동차' || !start?.coordinates || !goal?.coordinates) {
        return { data: { status: 'unavailable' }, summary: label + '자동차 경로 확인 불가' };
      }
      const data = await get_routes(start.coordinates, goal.coordinates);
      if (data.status === 'available') state.routes.set(routeKey(start, goal), data);
      const summary = data.status === 'available'
        ? money.format(data.distanceMeters / 1000) + 'km · 예상 ' + Math.ceil(data.durationMs / 60000) + '분'
        : data.message;
      const { path, ...result } = data;
      return { data: result, summary: label + summary };
    }
    case 'calculate_budget': {
      const data = calculate_budget(trip.budget, budgetItems(args.items, state.costNotes));
      for (const item of data.expenses) {
        if (item.amount !== null || !state.expenses.has(item.category)) state.expenses.set(item.category, item);
      }
      state.budget = calculate_budget(trip.budget, [...state.expenses.values()]);
      return {
        data,
        summary: '금액이 있는 항목 합계 ' + money.format(data.totalCost) +
          '원 · 미확인 ' + data.unknownCount + '개',
      };
    }
    default:
      throw new Error('unknown tool');
  }
}

export function addVerifiedTripData(itinerary, places, routes, forecast = []) {
  return itinerary.map((day, dayIndex) => ({
    weather: forecast[dayIndex] ?? null,
    stops: day.stops.map((stop, index) => {
      const place = places.get(stop.placeId);
      const previous = places.get(day.stops[index - 1]?.placeId);
      return {
        time: stop.time,
        endTime: stop.endTime ?? null,
        name: place?.name ?? stop.name,
        description: stop.description,
        address: place?.address ?? '',
        coordinates: place?.coordinates ?? null,
        category: place?.category ?? '',
        source: place?.source ?? null,
        routeFromPrevious: previous?.coordinates && place?.coordinates
          ? routes.get(routeKey(previous, place)) ?? null
          : null,
      };
    }),
  }));
}

function describeStops(stops) {
  return stops.map(({ time, endTime, name, description }) =>
    [time, endTime, name, description].filter(Boolean).join(' ')).join(' / ');
}

export async function runAgent(client, model, trip, format, trace, edit = null) {
  const now = new Date();
  const forecastDates = weatherDates(trip.departure, trip.days, now);
  const previous = edit?.previous;
  const editInstructions = edit
    ? '\n현재 일정을 수정하세요. 변경이 필요한 날짜만 changes에 넣고 그 날짜의 전체 방문 목록을 반환하세요. 요청과 관련 없는 방문의 순서, 시간, 장소, 설명을 유지하세요. 이미 확인된 장소의 placeId를 재사용하세요. 각 날짜의 reason에는 요청에 근거한 변경 이유를 쓰세요. 적용할 변경이 없으면 changes를 비우고 reply로 이유를 설명하세요.'
    : '';
  const history = [{ role: 'user', content: JSON.stringify({
    ...trip, weatherWindowDates: forecastDates.filter(day => day.reason !== 'outside_window').map(day => day.date),
    ...(edit ? {
      currentItinerary: previous.draft, request: edit.message,
      verifiedPlaces: [...previous.places].map(([id, place]) => ({ id, name: place.name, address: place.address })),
      currentBudget: previous.budget, currentWeather: previous.forecast,
    } : {}),
  }) }];
  const state = {
    places: new Map(previous?.places), routes: new Map(previous?.routes),
    expenses: new Map(previous?.budget?.expenses.map(item => [item.category, item])),
    budget: previous?.budget ?? null, now, forecast: previous?.forecast ?? null,
    weatherFetched: false, costNotes: [trip.notes, edit?.message].filter(Boolean).join('\n'),
  };
  const webSources = new Map(previous?.webSources.map(source => [source.url, source]));
  const seenWebCalls = new Set();
  const signal = AbortSignal.timeout(90000);
  let callCount = 0;
  let phaseRound = 0;
  let best;
  let allowedDays;
  const revisions = [];

  for (;;) {
    const canUseTools = phaseRound < (revisions.length ? 2 : maxRounds) && callCount < maxCalls + revisions.length * 2;
    phaseRound++;
    const remainingCalls = maxCalls + revisions.length * 2 - callCount;
    let result;
    try {
      result = await client.responses.create({
        model, store: false, input: history, text: { format },
        instructions: instructions + editInstructions +
          (canUseTools ? '' : '\n도구 탐색이 끝났습니다. 현재 자료로 최종 일정 JSON을 작성하세요.'),
        include: ['reasoning.encrypted_content', 'web_search_call.action.sources'],
        ...(canUseTools ? {
          tools, tool_choice: 'auto', parallel_tool_calls: false, max_tool_calls: Math.min(2, remainingCalls),
        } : { tool_choice: 'none' }),
      }, { signal });
    } catch (error) {
      if (!best) throw error;
      revisions.at(-1).failed = true;
      break;
    }

    const outputs = result.output ?? [];
    for (const item of outputs) {
      if (item.type !== 'web_search_call' || seenWebCalls.has(item.id)) continue;
      seenWebCalls.add(item.id);
      for (const source of item.action?.sources ?? []) {
        const url = URL.parse(source.url ?? '');
        if (!['http:', 'https:'].includes(url?.protocol) || webSources.size >= 12) continue;
        webSources.set(url.href, { name: source.title || url.hostname, url: url.href });
      }
      callCount++;
      const status = item.status === 'completed' ? 'success' : 'error';
      const query = item.action?.type === 'search' && item.action.query;
      const summary = status === 'success' ? '최신 공개 정보 검색 완료' : '공개 정보 검색 미완료';
      trace.push({ name: 'web_search', status, summary: query ? summary + ' · ' + query.slice(0, 160) : summary });
    }

    if (result.status !== 'completed') break;
    const calls = outputs.filter(item => item.type === 'function_call');
    if (!calls.length) {
      let draft;
      let editOutput;
      try {
        const output = JSON.parse(result.output_text ?? '');
        if (edit) {
          if (!Array.isArray(output.changes) || typeof output.reply !== 'string') break;
          const patches = new Map(output.changes.map(change => [change.day, change]));
          if (patches.size !== output.changes.length || [...patches.keys()].some(day =>
            !Number.isInteger(day) || day < 1 || day > trip.days || (allowedDays && !allowedDays.has(day)))) break;
          draft = previous.draft.map((day, index) => patches.has(index + 1) ? { stops: patches.get(index + 1).stops } : day);
          editOutput = { reply: output.reply, patches };
        } else {
          draft = output.itinerary;
        }
      } catch {
        break;
      }
      if (!validDraft(draft, trip.days)) break;
      const itinerary = addVerifiedTripData(draft, state.places, state.routes, state.forecast ?? forecastDates);
      const issues = validateItinerary(itinerary, state.budget, trip);
      const editChanges = edit ? itinerary.flatMap((day, index) => {
        const before = describeStops(previous.itinerary[index].stops);
        const after = describeStops(day.stops);
        return before === after ? [] : [{ day: index + 1, before, after, reason: editOutput.patches.get(index + 1)?.reason ?? '' }];
      }) : [];
      if (edit && !allowedDays) allowedDays = new Set(editOutput.patches.keys());
      const conflicts = issues.filter(issue => issue.severity === 'conflict' &&
        (!edit || (issue.day ? allowedDays.has(issue.day) : state.budget !== previous.budget)));
      const current = {
        draft, itinerary, issues, conflicts, budget: state.budget,
        forecast: state.forecast ?? forecastDates, reply: editOutput?.reply, editChanges,
      };
      const revision = revisions.at(-1);
      const improved = !best || conflicts.length < best.conflicts.length ||
        (conflicts.length === best.conflicts.length && issues.length < best.issues.length);
      if (revision) {
        revision.completed = true;
        revision.applied = improved;
        if (improved) {
          revision.changes = itinerary.flatMap((day, index) => {
            const before = describeStops(best.itinerary[index].stops);
            const after = describeStops(day.stops);
            return before === after ? [] : [{ day: index + 1, before, after }];
          });
        }
      }
      if (improved) best = current;
      if (!best.conflicts.length || revisions.length >= maxReplans) break;
      revisions.push({ reasons: best.conflicts, applied: false, changes: [] });
      phaseRound = 0;
      history.push({ role: 'developer', content: JSON.stringify({
        task: '아래 검증 충돌을 해결해 일정을 수정하세요. 필요한 도구만 선택하고 영향 없는 날짜와 장소는 가능한 유지하세요. 이미 확인되거나 사용자가 명시한 비용은 삭제하거나 낮추지 마세요. 확인할 수 없는 사실은 추정하지 마세요.',
        itinerary: best.draft, conflicts: best.conflicts,
        ...(edit ? { allowedDays: [...allowedDays], taskScope: '허용된 날짜만 changes에 넣고, 보존할 수정 내용도 다시 반환하세요.' } : {}),
      }) });
      continue;
    }
    if (!canUseTools) break;
    history.push(...outputs);

    for (const call of calls) {
      let data = { error: '도구 호출 한도에 도달했습니다.' };
      if (callCount < maxCalls + revisions.length * 2) {
        callCount++;
        try {
          const outcome = await execute(call, trip, state);
          data = outcome.data;
          const status = ['unavailable', 'error'].includes(data.status) ? data.status : 'success';
          trace.push({ name: call.name, status, summary: outcome.summary });
        } catch (error) {
          data = { error: [400, 429, 502, 503, 504].includes(error.status) ? error.message : '도구 입력 또는 실행을 확인해 주세요.' };
          trace.push({ name: call.name, status: 'error', summary: data.error });
        }
      }
      history.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(data) });
    }
  }
  if (revisions.length && !revisions.at(-1).completed) revisions.at(-1).failed = true;
  return best ? {
    itinerary: best.itinerary, budget: best.budget, webSources: [...webSources.values()],
    validation: { issues: best.issues, revisions, maxReplans, maxTransferMinutes: trip.maxTransferMinutes ?? 90 },
    ...(edit ? { edit: { reply: best.reply, changes: best.editChanges } } : {}),
    context: {
      draft: best.draft, itinerary: best.itinerary, budget: best.budget, forecast: best.forecast,
      places: state.places, routes: state.routes, webSources: [...webSources.values()],
    },
  } : null;
}
