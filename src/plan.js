import OpenAI from 'openai';
import { runAgent } from './agent.js';
import { parseConfirmedHours } from './validation.js';
import { openPlan, sealPlan } from './plan-session.js';

const interests = ['맛집', '관광', '자연', '휴식', '쇼핑'];
const transports = ['자동차', '대중교통', '도보'];

const stopSchema = {
  type: 'object',
  properties: {
    time: { type: 'string' },
    endTime: { type: ['string', 'null'], description: '예정 방문 종료 시각 HH:MM. 미정이면 null.' },
    name: { type: 'string' },
    description: { type: 'string' },
    placeId: { type: ['string', 'null'] },
  },
  required: ['time', 'endTime', 'name', 'description', 'placeId'],
  additionalProperties: false,
};

const itineraryFormat = (days, maxStopsPerDay) => ({
  type: 'json_schema',
  name: 'travel_itinerary',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      itinerary: {
        type: 'array',
        minItems: days,
        maxItems: days,
        items: {
          type: 'object',
          properties: { stops: { type: 'array', minItems: 1, maxItems: maxStopsPerDay, items: stopSchema } },
          required: ['stops'],
          additionalProperties: false,
        },
      },
    },
    required: ['itinerary'],
    additionalProperties: false,
  },
});

const editFormat = (days, maxStopsPerDay) => ({
  type: 'json_schema', name: 'travel_itinerary_edit', strict: true,
  schema: {
    type: 'object',
    properties: {
      reply: { type: 'string' },
      changes: {
        type: 'array', maxItems: days,
        items: {
          type: 'object',
          properties: {
            day: { type: 'integer', description: '1부터 시작하는 여행 일차' },
            reason: { type: 'string' },
            stops: { type: 'array', minItems: 1, maxItems: maxStopsPerDay, items: stopSchema },
          },
          required: ['day', 'reason', 'stops'], additionalProperties: false,
        },
      },
    },
    required: ['reply', 'changes'], additionalProperties: false,
  },
});

const sessionSecret = () => process.env.PLAN_SESSION_SECRET?.trim() || process.env.OPENAI_API_KEY?.trim();

function validInteger(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() > 0 &&
    date.toISOString().slice(0, 10) === value;
}

function validTrip(trip) {
  return trip && typeof trip.region === 'string' && trip.region.length <= 80 &&
    /^[가-힣a-zA-Z0-9·. -]+$/.test(trip.region.trim()) && validDate(trip.departure) &&
    validInteger(trip.days, 1, 14) && validInteger(trip.people, 1, 50) &&
    validInteger(trip.budget, 1, 100000000) && transports.includes(trip.transport) &&
    Array.isArray(trip.interests) && trip.interests.length <= interests.length &&
    trip.interests.every(interest => interests.includes(interest)) &&
    typeof trip.notes === 'string' && trip.notes.length <= 500 &&
    (trip.maxStopsPerDay === undefined || validInteger(trip.maxStopsPerDay, 1, 3)) &&
    (trip.maxTransferMinutes == null || validInteger(trip.maxTransferMinutes, 1, 600));
}

export async function revisePlan(request, response) {
  response.set('Cache-Control', 'no-store');
  const { planId, message } = request.body ?? {};
  if (typeof planId !== 'string' || typeof message !== 'string' || !message.trim() || message.length > 1000) {
    return response.status(400).json({ error: '현재 일정과 수정 요청을 확인해 주세요.' });
  }
  const secret = sessionSecret();
  const saved = secret && openPlan(planId, secret);
  if (!saved) {
    return response.status(410).json({ error: '수정 세션이 만료되었습니다. 여행 계획을 다시 생성해 주세요.' });
  }
  return sendPlan(saved.trip, response, { previous: saved.context, message: message.trim() });
}

export async function generatePlan(request, response) {
  response.set('Cache-Control', 'no-store');
  const trip = request.body;
  if (!validTrip(trip)) {
    return response.status(400).json({ error: '여행 조건을 확인하고 다시 입력해 주세요.' });
  }

  const { region, departure, days, people, budget, transport, interests: preferences, notes } = trip;
  const { maxStopsPerDay = 3, maxTransferMinutes = null } = trip;
  const confirmedHours = parseConfirmedHours(trip.confirmedHours ?? '', days);
  if (!confirmedHours) return response.status(400).json({
    error: '확인한 영업시간은 일차 | 장소명 | HH:MM-HH:MM 형식으로 입력해 주세요.',
  });
  return sendPlan({
    region: region.trim().replace(/\s+/g, ' '), departure, days, people, budget, transport, interests: preferences, notes, maxStopsPerDay, maxTransferMinutes,
    confirmedHours,
  }, response);
}

async function sendPlan(trip, response, edit = null) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim();
  if (!apiKey || !model) {
    return response.status(503).json({ error: '서버의 OpenAI 설정이 필요합니다.' });
  }
  const { days, maxStopsPerDay } = trip;
  const format = edit ? editFormat(days, maxStopsPerDay) : itineraryFormat(days, maxStopsPerDay);
  const trace = [];
  try {
    const client = new OpenAI({ apiKey, timeout: 45000, maxRetries: 0 });
    const result = await runAgent(client, model, trip, format, trace, edit);
    if (result) {
      const { context, ...view } = result;
      return response.json({ ...view, trace, planId: sealPlan(trip, context, sessionSecret()) });
    }
    return response.status(502).json({
      error: '완성된 일정을 받지 못했습니다. 다시 시도해 주세요.', trace,
    });
  } catch (error) {
    if (error instanceof OpenAI.APIConnectionTimeoutError || error instanceof OpenAI.APIUserAbortError) {
      return response.status(504).json({ error: '일정 생성 시간이 초과되었습니다. 다시 시도해 주세요.', trace });
    }
    if (error instanceof OpenAI.RateLimitError) {
      return response.status(429).json({ error: 'OpenAI 사용량 한도에 도달했습니다. 잠시 후 다시 시도하거나 계정의 한도를 확인해 주세요.', trace });
    }
    if (error instanceof OpenAI.APIError && [401, 403, 404].includes(error.status)) {
      return response.status(502).json({ error: '서버의 OpenAI 인증 또는 모델 설정을 확인해 주세요.', trace });
    }
    return response.status(502).json({ error: '일정을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.', trace });
  }
}
