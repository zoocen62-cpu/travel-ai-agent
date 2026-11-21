import express from 'express';
import { fileURLToPath } from 'node:url';
import { generatePlan, revisePlan } from './plan.js';
import { search_places } from './naver-search.js';
import { get_routes } from './naver-routes.js';

const app = express();
const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url));

app.disable('x-powered-by');

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' });
});

app.get('/api/maps/config', (_request, response) => {
  response.set('Cache-Control', 'no-store');
  response.json({ clientId: process.env.NAVER_MAPS_CLIENT_ID?.trim() || null });
});

app.post('/api/plan', express.json({ limit: '8kb' }), generatePlan);
app.post('/api/plan/revise', express.json({ limit: '2mb' }), revisePlan);

app.post('/api/routes', express.json({ limit: '2kb' }), async (request, response) => {
  response.set('Cache-Control', 'no-store');
  try {
    const { start, goal, mode } = request.body ?? {};
    response.json(await get_routes(start, goal, mode));
  } catch (error) {
    if ([400, 429, 502, 503, 504].includes(error.status)) {
      return response.status(error.status).json({ error: error.message });
    }
    response.status(500).json({ error: '자동차 경로 조회 중 문제가 발생했습니다.' });
  }
});

app.get('/api/places', async (request, response) => {
  response.set('Cache-Control', 'no-store');
  try {
    const places = await search_places(request.query.region, request.query.keyword);
    response.json({ places });
  } catch (error) {
    if ([400, 429, 502, 503, 504].includes(error.status)) {
      return response.status(error.status).json({ error: error.message });
    }
    response.status(500).json({ error: '장소 검색 중 문제가 발생했습니다.' });
  }
});

app.use(['/api/plan', '/api/routes'], (error, _request, response, next) => {
  if (error.status !== 400 && error.status !== 413) return next(error);
  response.status(error.status).json({ error: '요청 형식이나 크기를 확인해 주세요.' });
});

app.use(express.static(publicDirectory));

export default app;
