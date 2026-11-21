# 국내 여행 플래너

HTML, CSS, JavaScript와 Node.js, Express로 만든 로컬 개발용 프로젝트입니다.

## 실행

Node.js 22 이상이 필요합니다. 새로 내려받은 폴더에서는 `npm ci`로 의존성을 설치합니다. Windows PowerShell에서 `npm` 실행이 정책으로 차단되면 `npm.cmd`를 사용합니다.

```powershell
npm.cmd run dev
```

기본 주소는 http://127.0.0.1:3000 입니다. `GET /api/health`와 초기 화면은 API 키 없이 실행할 수 있습니다. `PORT`는 선택 사항입니다.

첫 화면에는 샘플 일정과 동선도가 표시됩니다. 여행 조건을 입력한 뒤 **AI 여행 계획 만들기**를 누르면 `POST /api/plan`이 OpenAI Responses API로 일정을 생성합니다. 이 기능에는 `OPENAI_API_KEY`와 구조화된 출력 및 도구 호출을 지원하는 `OPENAI_MODEL`이 필요합니다.

AI 일정의 날짜 탭에는 방문 시간, 추천 이유, 확인된 장소 출처와 이동시간이 표시됩니다. 네이버 지도에는 검색 결과의 좌표로 마커를 표시하고, 조회된 자동차 경로만 그립니다. NCP Maps Application에서 **Web Dynamic Map**과 **Directions 5**를 활성화하고 브라우저에서 사용하는 주소(예: `http://127.0.0.1:3000`)를 웹 서비스 URL에 등록합니다. 브라우저에는 지도 SDK에 필요한 Maps Client ID만 전달합니다.

`src/agent.js`에서 모델이 `search_places`, `get_routes`, `calculate_budget`, 내장 `web_search` 중 필요한 도구를 선택합니다. 서버는 함수 결과 또는 오류를 모델에 다시 전달합니다. 도구를 선택할 수 있는 응답은 최대 5회이며, 한도에 도달하면 도구 없이 최종 일정을 요청합니다. Agent 실행 기록은 실제 호출 내역을 보여 줍니다.

**장소 검색**에서는 여행 조건에서 선택한 지역과 검색어로 `GET /api/places`를 호출합니다. 서버의 `search_places(region, keyword)`는 NAVER API HUB에서 최대 5곳을 조회해 장소명, 주소, 카테고리, WGS84 경도·위도를 반환합니다.

검색 결과에서 출발지와 도착지를 선택하면 `POST /api/routes`가 Directions 5의 자동차 거리와 예상 시간을 조회합니다. `get_routes(start, goal, mode)`는 각 장소의 `{ longitude, latitude }`를 받으며, 조회 성공 시 `distanceMeters`, `durationMs`를 반환합니다.

`public/budget.js`의 `calculate_budget(totalBudget, items)`는 각 `{ category, amount, status }` 비용을 합산합니다. 상태는 `confirmed`, `estimated`, `unknown`이며, 미확인 비용의 금액은 `null`입니다. AI 일정에서 추가 요청에 명시된 비용은 추정치로 반영합니다. 금액을 확인할 수 있는 항목만 합산하며, 미확인 또는 추정 비용이 있으면 잔여 예산은 잠정 값입니다.

## 환경 변수

기존 `.env`를 사용합니다. 파일이 없는 환경에서는 `.env.example`을 `.env`로 복사한 뒤 값을 입력합니다.

| 서비스 | 환경 변수 |
| --- | --- |
| OpenAI | `OPENAI_API_KEY`, `OPENAI_MODEL` |
| NAVER API HUB | `NAVER_API_HUB_CLIENT_ID`, `NAVER_API_HUB_CLIENT_SECRET` |
| NAVER Cloud Platform Maps | `NAVER_MAPS_CLIENT_ID`, `NAVER_MAPS_CLIENT_SECRET` |
| 기상청 단기예보 | `WEATHER_API_KEY` (공공데이터포털 일반 인증키, Decoding). 기존 `KMA_SERVICE_KEY`도 지원합니다. |

실제 인증 정보는 `.env`에만 입력합니다. 이 파일과 환경별 변형은 Git에서 제외되고, 브라우저에는 `public/` 아래의 파일만 정적으로 제공됩니다. 향후 지도 JavaScript SDK에는 Maps 콘솔에 웹 서비스 URL을 등록하고 SDK 인증에 필요한 Client ID만 전달합니다. 모든 Client Secret과 OpenAI 키는 서버에서 사용합니다.

## 단계별 확장

Level 2에서 Agent는 야외 활동이나 우천 대안에 날씨가 필요할 때 기상청 단기예보를 조회합니다. 선택 지역의 대표 격자에서 08:00~21:00 강수형태와 강수확률을 확인하며, 강수형태에 비가 있거나 최대 강수확률이 60% 이상이면 실내 대안을 고려합니다. 예보 범위 밖 또는 조회 불가 날짜는 미확인으로 표시합니다. 하루 방문지 수와 구간당 자동차 이동시간 한도는 여행 조건에서 설정할 수 있습니다.

서버는 비용, 방문지 수, 자동차 이동시간, 방문 시간 중복, 영업시간 및 날씨 적합성을 검증합니다. 자동차 이동시간을 별도로 지정하지 않으면 구간당 90분을 기준으로 사용합니다. 영업시간은 사용자가 확인한 값만 `일차 | 장소명 | HH:MM-HH:MM` 형식으로 입력할 수 있습니다. 분리된 영업시간은 여러 줄로 입력합니다. 확인 가능한 충돌은 최대 2회 재계획하며, 검증 결과가 개선된 일정만 반영합니다. 화면에는 남은 충돌과 확인 필요 항목, 수정 사유와 변경 전후 방문 정보가 표시됩니다.

AI 일정을 생성한 뒤 **대화로 일정 수정**에서 날짜나 장소를 자연어로 바꿀 수 있습니다. `POST /api/plan/revise`는 암호화된 세션에서 현재 계획을 읽어 새 요청과 함께 Agent에 전달합니다. 응답은 변경한 날짜의 일정만 교체하고 전체 일정을 다시 검증합니다. 브라우저에서 직전 수정을 한 번 되돌릴 수 있습니다. 세션은 2시간 동안 유효합니다. `PLAN_SESSION_SECRET`을 설정하면 OpenAI 키를 교체해도 기존 수정 세션이 유지됩니다.

## Vercel 배포

Vercel은 `src/app.js`의 Express 앱을 실행하고 `public/`의 정적 파일을 제공합니다. 프로젝트 환경 변수에 `.env.example`의 서비스별 설정을 등록합니다. 배포 후 NAVER Cloud Maps 애플리케이션의 웹 서비스 URL에 실제 배포 주소를 추가합니다. 배포 확인 경로는 `/api/health`입니다.

| 단계 | 예정 기능 | 추가할 서버 모듈 |
| --- | --- | --- |
| Level 1 | OpenAI Responses API로 일정 초안 생성 | `src/plan.js` |
| Level 2 | NAVER API HUB 지역 검색 결과로 장소 확인 | `src/naver-search.js` |
| Level 3 | 신규 Maps로 장소 표시 및 자동차 경로 조회 | `src/naver-routes.js` (경로 조회) |

현재 진입점은 `src/server.js`입니다. 단계별로 서버 연동 모듈을 추가하고, 브라우저에서는 필요한 Express API를 호출합니다.

- [OpenAI Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses)
- [NAVER API HUB 지역 검색](https://api.ncloud-docs.com/docs/naver-api-hub-search-local)
- [NAVER Cloud Platform 신규 Maps](https://api.ncloud-docs.com/docs/en/application-maps-overview)
