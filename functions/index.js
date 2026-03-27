const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');

admin.initializeApp();

// Cloud Functions 배포 리전 설정 (네이버 지도 API 레이턴시 고려: 아시아 동북부)
setGlobalOptions({ region: 'asia-northeast3' });

/**
 * generateTravelPlan
 *
 * 사용자로부터 여행 카테고리, 방문 지역, 여행 날짜를 전달받아
 * 구조화된 여행 일정 JSON을 반환하는 Callable Function.
 *
 * 요청(request.data) 스키마:
 * {
 *   categories: string[]   // ['K-pop', 'K-food', 'K-culture', 'K-beauty'] 중 다중 선택
 *   regions:    string[]   // ['서울', '부산', '제주', ...] 중 다중 선택
 *   startDate:  string     // ISO 8601 형식 (예: '2025-09-01')
 *   endDate:    string     // ISO 8601 형식 (예: '2025-09-05')
 * }
 */
exports.generateTravelPlan = onCall(async (request) => {
  // ── 1. 인증 확인 ─────────────────────────────────────────────────
  if (!request.auth) {
    throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  }

  // ── 2. 입력값 파싱 및 유효성 검사 ────────────────────────────────
  const { categories, regions, startDate, endDate } = request.data;

  const VALID_CATEGORIES = ['K-pop', 'K-food', 'K-culture', 'K-beauty'];

  if (!Array.isArray(categories) || categories.length === 0) {
    throw new HttpsError('invalid-argument', 'categories는 1개 이상 선택해야 합니다.');
  }
  const invalidCat = categories.find((c) => !VALID_CATEGORIES.includes(c));
  if (invalidCat) {
    throw new HttpsError('invalid-argument', `유효하지 않은 카테고리: ${invalidCat}`);
  }
  if (!Array.isArray(regions) || regions.length === 0) {
    throw new HttpsError('invalid-argument', 'regions는 1개 이상 선택해야 합니다.');
  }
  if (!startDate || !endDate || isNaN(Date.parse(startDate)) || isNaN(Date.parse(endDate))) {
    throw new HttpsError('invalid-argument', 'startDate, endDate는 유효한 ISO 8601 날짜여야 합니다.');
  }
  if (new Date(startDate) > new Date(endDate)) {
    throw new HttpsError('invalid-argument', 'startDate는 endDate보다 이전이어야 합니다.');
  }

  // ── 3. AI API 호출 자리 (TODO) ────────────────────────────────────
  // 향후 이 위치에서 AI API(예: OpenAI GPT, Google Gemini 등)를 호출합니다.
  // 호출 시 categories, regions, startDate, endDate를 프롬프트에 포함하여
  // 각 날짜별 장소 추천 목록을 생성합니다.
  //
  // 예시:
  // const openai = require('openai');
  // const aiResponse = await openai.chat.completions.create({ ... });
  // const rawPlan = parseAiResponse(aiResponse);

  // ── 4. 네이버 지도 API 연동 자리 (TODO) ──────────────────────────
  // 향후 이 위치에서 네이버 지도 Directions API를 호출합니다.
  // 각 장소 간 이동 경로(차량 이동 시간, 거리)를 조회하여
  // itinerary의 각 place에 travelTimeFromPrev 필드를 채웁니다.
  //
  // 예시:
  // const naverResponse = await axios.get('https://naveropenapi.apigw.ntruss.com/map-direction/v1/driving', {
  //   params: { start: '127.0276,37.4979', goal: '129.0756,35.1796' },
  //   headers: { 'X-NCP-APIGW-API-KEY-ID': process.env.NAVER_CLIENT_ID, ... }
  // });

  // ── 5. 응답 데이터 구성 (현재는 목업 데이터) ─────────────────────
  // 실제 AI + 네이버 지도 연동 전, 응답 포맷을 고정합니다.
  // 프론트엔드는 이 구조를 기준으로 렌더링 로직을 미리 구현할 수 있습니다.
  const plan = buildMockPlan({ categories, regions, startDate, endDate });

  return plan;
});

/**
 * 목업 여행 일정 생성기.
 * AI + 네이버 지도 연동 완료 후 이 함수를 대체합니다.
 *
 * 반환 스키마:
 * {
 *   meta: { categories, regions, startDate, endDate, generatedAt }
 *   itinerary: [
 *     {
 *       day: number          // 1부터 시작
 *       date: string         // 'YYYY-MM-DD'
 *       places: [
 *         {
 *           order:              number   // 당일 방문 순서
 *           name:               string   // 장소명 (한국어)
 *           nameEn:             string   // 장소명 (영어)
 *           category:           string   // 해당 장소의 K-* 카테고리
 *           address:            string   // 도로명 주소
 *           coordinates: {
 *             lat:              number
 *             lng:              number
 *           }
 *           travelTimeFromPrev: number|null  // 이전 장소에서 차량 이동 시간(분). 첫 장소는 null
 *           tips:               string   // 방문 팁 (1-2문장)
 *         }
 *       ]
 *     }
 *   ]
 * }
 */
function buildMockPlan({ categories, regions, startDate, endDate }) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const totalDays = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;

  const itinerary = Array.from({ length: totalDays }, (_, i) => {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];

    return {
      day: i + 1,
      date: dateStr,
      places: [
        {
          order: 1,
          name: '경복궁',
          nameEn: 'Gyeongbokgung Palace',
          category: 'K-culture',
          address: '서울특별시 종로구 사직로 161',
          coordinates: { lat: 37.5796, lng: 126.9770 },
          travelTimeFromPrev: null,
          tips: '한복 대여 시 무료 입장 가능. 수요일은 야간 개장 운영.',
        },
        {
          order: 2,
          name: '광장시장',
          nameEn: 'Gwangjang Market',
          category: 'K-food',
          address: '서울특별시 종로구 창경궁로 88',
          coordinates: { lat: 37.5700, lng: 126.9994 },
          travelTimeFromPrev: 15,
          tips: '빈대떡과 마약김밥이 대표 메뉴. 점심 시간 혼잡 주의.',
        },
        {
          order: 3,
          name: 'SM 아티움',
          nameEn: 'SM Artium',
          category: 'K-pop',
          address: '서울특별시 강남구 영동대로 511',
          coordinates: { lat: 37.5085, lng: 127.0614 },
          travelTimeFromPrev: 30,
          tips: '공식 굿즈 구매 및 포토부스 체험 가능. 사전 예약 권장.',
        },
      ],
    };
  });

  return {
    meta: {
      categories,
      regions,
      startDate,
      endDate,
      generatedAt: new Date().toISOString(),
    },
    itinerary,
  };
}
