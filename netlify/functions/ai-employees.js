/**
 * CocoTripKR AI 직원 모듈
 * Gemini API를 사용해 4명의 AI 직원을 구현
 *
 * 1호: 운영 매니저  — 예약 알림 텔레그램 메시지 생성, 일일 리포트
 * 2호: 고객 경험   — 바우처 텍스트, 확인 이메일, 후기 요청 이메일
 * 3호: 마케팅      — SNS 콘텐츠, Reddit 답변 초안
 * 4호: 품질 관리   — 날씨 대체 코스, 장소 검증 리포트
 *
 * CONTEXT: CocoTripKR, cocotripkr.com
 * OWNER: 태연 (태오/Tae-o)
 * STACK: Netlify Functions (ESM), @google/generative-ai
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

// ── 공통 사업 정보 컨텍스트 ─────────────────────────────────────────────
const BUSINESS_CONTEXT = `
사업자: 태연 (태오 / Tae-o)
사업명: CocoTripKR (cocotripkr.com)
사업 내용: 한국 인바운드 관광 — 전세차량, 공항 픽업, K-pop 셔틀, AI 여행 플래너

상품 및 가격:
- 스타리아(최대 8인): ₩291,200~₩572,000
- 스프린터(15인): 스타리아×2배 + 가이드 ₩300,000/일
- 인천공항→서울 도심: ₩124,800
- 인천공항→강남/잠실: ₩145,600
- 인천공항→가평/남이섬: ₩208,000
- 인천공항→평창/강릉: ₩332,800~₩364,000
- 김포공항→서울 도심: ₩83,200
- 부산공항→부산 시내: ₩83,200
- 제주공항→제주 시내: ₩72,800
- K-pop 셔틀 1인: ₩26,000 / 차량 전체(최대 8인): ₩208,000

시간대: 항상 KST (UTC+9) 기준
연락처: 카카오톡, WhatsApp, 이메일
`;

// ── Gemini 클라이언트 초기화 ───────────────────────────────────────────
function getGeminiModel(systemInstruction) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 🟢 1호: 운영 매니저 (Operations Manager)
// ═══════════════════════════════════════════════════════════════════════
const OPS_MANAGER_PROMPT = `
너는 CocoTripKR의 운영 매니저 AI다.
${BUSINESS_CONTEXT}

역할:
- PayPal 결제 알림 텔레그램 메시지 생성
- 일일 매출 리포트 생성
- 고객 문의 답변 초안 작성

규칙:
- 항상 KST 기준 시간 표시
- 금액은 USD + KRW 동시 표시
- 불확실한 정보는 "태연님 확인 필요" 표시
- 고객에게 직접 발송하지 말 것 — 초안을 태연님에게 먼저
- 마크다운 없이 텍스트만 출력 (텔레그램 HTML 파싱 활용 가능)
`;

/**
 * 1호: 새 예약 텔레그램 알림 메시지 생성
 * @param {object} booking - 예약 정보
 * @returns {string} 텔레그램 메시지 텍스트
 */
export async function generateBookingAlert(booking) {
  const model = getGeminiModel(OPS_MANAGER_PROMPT);
  const prompt = `
다음 예약 정보로 텔레그램 알림 메시지를 생성해라.
매뉴얼의 형식을 정확히 따를 것.

예약 정보:
${JSON.stringify(booking, null, 2)}

출력: 텔레그램 메시지 텍스트만 (설명 없이)
`;
  const result = await model.generateContent(prompt);
  return result.response.text();
}

/**
 * 1호: 일일 매출 리포트 생성
 * @param {object} reportData - 어제 매출 + 오늘 일정 + 환율 데이터
 * @returns {string} 텔레그램 리포트 메시지
 */
export async function generateDailyReport(reportData) {
  const model = getGeminiModel(OPS_MANAGER_PROMPT);
  const prompt = `
다음 데이터로 일일 리포트 텔레그램 메시지를 생성해라.
매뉴얼의 리포트 형식을 정확히 따를 것.

데이터:
${JSON.stringify(reportData, null, 2)}

출력: 텔레그램 메시지 텍스트만 (설명 없이)
`;
  const result = await model.generateContent(prompt);
  return result.response.text();
}

/**
 * 1호: 고객 문의 답변 초안
 * @param {string} inquiry - 고객 문의 내용
 * @param {string} language - 'en'|'ko'|'ja'|'zh'
 * @returns {string} 답변 초안
 */
export async function generateInquiryReply(inquiry, language = 'en') {
  const model = getGeminiModel(OPS_MANAGER_PROMPT);
  const prompt = `
고객 문의에 대한 답변 초안을 작성해라.
언어: ${language}
문의 내용: "${inquiry}"

규칙:
- 친절하고 전문적인 톤
- 가격은 정확히 KRW + USD(현재 환율 약 1,380원/달러 기준)
- 자연스럽게 추가 옵션 제안
- 끝에 "카카오톡으로 편하게 문의주세요!" 추가 (영어면 "Feel free to reach us on KakaoTalk!")
- 답변 텍스트만 출력
`;
  const result = await model.generateContent(prompt);
  return result.response.text();
}

// ═══════════════════════════════════════════════════════════════════════
// 🟠 2호: 고객 경험 담당 (Customer Experience Manager)
// ═══════════════════════════════════════════════════════════════════════
const CX_MANAGER_PROMPT = `
너는 CocoTripKR의 고객 경험 담당 AI다.
${BUSINESS_CONTEXT}

역할:
- PDF 바우처 내용 생성 (텍스트)
- 예약 확인 이메일 작성
- 투어 완료 후 후기 요청 이메일
- 불만/저평점 긴급 알림

규칙:
- 고객 대면 메시지는 따뜻하고 프로페셔널하게
- 이모지 적절히 사용 (과하지 않게)
- 모든 메시지는 초안 → 태연님 승인 후 발송
- 개인정보(여권번호 등) 절대 포함 금지
`;

/**
 * 2호: 예약 확인 이메일 HTML 생성
 * @param {object} booking - 예약 정보
 * @param {string} language - 'en'|'ko'|'ja'|'zh'
 * @returns {object} { subject, html, text }
 */
export async function generateConfirmationEmail(booking, language = 'en') {
  const model = getGeminiModel(CX_MANAGER_PROMPT);

  const langMap = { en: '영어', ko: '한국어', ja: '일본어', zh: '중국어' };
  const prompt = `
다음 예약 정보로 예약 확인 이메일을 ${langMap[language] || '영어'}로 작성해라.
매뉴얼의 이메일 형식을 따를 것.

예약 정보:
${JSON.stringify(booking, null, 2)}

출력 형식 (JSON만):
{
  "subject": "이메일 제목",
  "text": "일반 텍스트 버전",
  "html": "HTML 버전 (인라인 스타일 사용, 모바일 친화적)"
}
`;
  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();
  // JSON 파싱
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      // 파싱 실패 시 기본 반환
    }
  }
  return {
    subject: `Your CocoTripKR Booking is Confirmed! 🎉 [${booking.bookingRef}]`,
    text,
    html: `<pre>${text}</pre>`,
  };
}

/**
 * 2호: 바우처 텍스트 생성
 * @param {object} booking - 예약 정보
 * @returns {string} 바우처 텍스트 내용
 */
export async function generateVoucherText(booking) {
  const model = getGeminiModel(CX_MANAGER_PROMPT);
  const prompt = `
다음 예약 정보로 바우처 텍스트를 생성해라.
매뉴얼의 바우처 형식을 정확히 따를 것.
영문 기준으로 작성.

예약 정보:
${JSON.stringify(booking, null, 2)}

출력: 바우처 텍스트만
`;
  const result = await model.generateContent(prompt);
  return result.response.text();
}

/**
 * 2호: 후기 요청 이메일 생성
 * @param {object} booking - 완료된 예약 정보
 * @param {string} language - 언어
 * @returns {object} { subject, html, text }
 */
export async function generateReviewRequestEmail(booking, language = 'en') {
  const model = getGeminiModel(CX_MANAGER_PROMPT);
  const prompt = `
투어 완료 24시간 후 보내는 후기 요청 이메일을 작성해라.
언어: ${language}

예약 정보:
${JSON.stringify(booking, null, 2)}

규칙:
- 매뉴얼의 후기 요청 이메일 형식 따르기
- 5% 할인 쿠폰 언급
- Google 리뷰 링크: https://g.page/r/cocotripkr/review (예시)
- cocotripkr.com/planner AI 플래너 링크 포함

출력 형식 (JSON만):
{
  "subject": "이메일 제목",
  "text": "일반 텍스트",
  "html": "HTML 버전"
}
`;
  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch {}
  }
  return { subject: 'How was your CocoTripKR experience? ⭐', text, html: `<pre>${text}</pre>` };
}

// ═══════════════════════════════════════════════════════════════════════
// 🔵 3호: 마케팅 담당 (Marketing Manager)
// ═══════════════════════════════════════════════════════════════════════
const MARKETING_MANAGER_PROMPT = `
너는 CocoTripKR의 마케팅 담당 AI다.
${BUSINESS_CONTEXT}

타깃: 한국 여행 계획 중인 외국인 관광객 (미국, 일본, 중국, 동남아, 유럽)
연령: 25~45세 / 관심사: K-pop, K-food, K-beauty, 문화, 쇼핑, 자연

역할:
- Reddit 잠재 고객 답변 초안
- TikTok/Instagram 콘텐츠 스크립트
- SEO 블로그 포스트

규칙:
- 영어 기본, 일본어/중국어 버전은 요청 시
- Reddit 답변은 스팸처럼 보이면 안 됨 (먼저 진짜 유용한 정보 제공)
- 제휴 링크 자연스럽게 삽입
- 모든 콘텐츠 태연님 승인 후 게시
`;

/**
 * 3호: Reddit 답변 초안 생성
 * @param {object} post - Reddit 포스트 정보 { title, content, subreddit }
 * @returns {string} 답변 초안
 */
export async function generateRedditReply(post) {
  const model = getGeminiModel(MARKETING_MANAGER_PROMPT);
  const prompt = `
다음 Reddit 포스트에 대한 답변 초안을 작성해라.

포스트 정보:
${JSON.stringify(post, null, 2)}

규칙:
- 자연스럽고 스팸처럼 보이지 않게
- 진짜 유용한 정보 먼저 제공
- cocotripkr.com은 1번만 자연스럽게 언급
- 가짜 후기 절대 금지
- 텔레그램 알림 형식으로 출력 (포스트 요약 + 답변 초안)
`;
  const result = await model.generateContent(prompt);
  return result.response.text();
}

/**
 * 3호: TikTok 스크립트 생성
 * @param {string} theme - 콘텐츠 테마
 * @returns {string} 스크립트
 */
export async function generateTikTokScript(theme) {
  const model = getGeminiModel(MARKETING_MANAGER_PROMPT);
  const prompt = `
테마 "${theme}"으로 30초짜리 TikTok 스크립트를 생성해라.
매뉴얼의 TikTok 스크립트 형식을 정확히 따를 것.
영어로 작성.
`;
  const result = await model.generateContent(prompt);
  return result.response.text();
}

/**
 * 3호: 미예약 고객 재타겟팅 이메일
 * @param {object} planner - AI 플래너 사용 기록
 * @param {number} hoursSince - 플래너 사용 후 경과 시간 (48 또는 72)
 * @returns {object} { subject, html, text }
 */
export async function generateRetargetingEmail(planner, hoursSince = 48) {
  const model = getGeminiModel(MARKETING_MANAGER_PROMPT);
  const prompt = `
AI 플래너를 사용했지만 ${hoursSince}시간이 지나도 예약하지 않은 고객에게 보낼 재타겟팅 이메일.
매뉴얼의 재타겟팅 이메일 형식 참고.

플래너 데이터:
${JSON.stringify(planner, null, 2)}

출력 형식 (JSON만):
{
  "subject": "제목",
  "text": "텍스트",
  "html": "HTML"
}
`;
  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch {}
  }
  return { subject: 'Your Korea itinerary is waiting! 🗺️', text, html: `<pre>${text}</pre>` };
}

// ═══════════════════════════════════════════════════════════════════════
// 🟣 4호: 품질 관리 담당 (Quality Assurance Manager)
// ═══════════════════════════════════════════════════════════════════════
const QA_MANAGER_PROMPT = `
너는 CocoTripKR의 품질 관리 담당 AI다.
${BUSINESS_CONTEXT}

역할:
- 날씨 악화 시 대체 코스 생성
- AI 플래너 추천 장소 검증 결과 리포트
- 경쟁사 가격 비교 리포트
- 주간 품질 개선 제안

지역별 실내 대안:
서울: 국립중앙박물관(무료), 코엑스몰, 롯데월드타워 전망대, DDP, 광장시장
부산: 부산현대미술관, 신세계센텀시티, 부산영화체험박물관, 해운대 스파
경주: 경주국립박물관, 황리단길 카페
제주: 제주유리의성, 아쿠아플라넷 제주, 오설록 티뮤지엄

규칙:
- 장소 정보는 실제 데이터 기반 (추측 금지)
- 대체 코스는 동선/시간 고려하여 현실적으로
- 모든 변경 사항은 태연님 승인 후 실행
`;

/**
 * 4호: 날씨 기반 대체 코스 생성
 * @param {object} tourInfo - 투어 정보 { tourName, region, date, originalItinerary }
 * @param {object} weatherData - 날씨 데이터 { forecast, temperature, precipitation }
 * @returns {string} 텔레그램 알림 + 대체 코스 텍스트
 */
export async function generateWeatherAlert(tourInfo, weatherData) {
  const model = getGeminiModel(QA_MANAGER_PROMPT);
  const prompt = `
다음 투어의 내일 날씨가 악화되었다. 대체 코스를 제안해라.
매뉴얼의 날씨 경보 형식을 따를 것.

투어 정보:
${JSON.stringify(tourInfo, null, 2)}

날씨 데이터:
${JSON.stringify(weatherData, null, 2)}

출력: 텔레그램 메시지 텍스트만
`;
  const result = await model.generateContent(prompt);
  return result.response.text();
}

/**
 * 4호: 주간 품질 리포트 생성
 * @param {object} weekData - 주간 데이터 { tours, ratings, feedback }
 * @returns {string} 주간 품질 리포트 텍스트
 */
export async function generateWeeklyQAReport(weekData) {
  const model = getGeminiModel(QA_MANAGER_PROMPT);
  const prompt = `
다음 데이터로 주간 품질 리포트를 생성해라.
매뉴얼의 주간 품질 리포트 형식을 따를 것.

주간 데이터:
${JSON.stringify(weekData, null, 2)}

출력: 리포트 텍스트만
`;
  const result = await model.generateContent(prompt);
  return result.response.text();
}

export default {
  generateBookingAlert,
  generateDailyReport,
  generateInquiryReply,
  generateConfirmationEmail,
  generateVoucherText,
  generateReviewRequestEmail,
  generateRedditReply,
  generateTikTokScript,
  generateRetargetingEmail,
  generateWeatherAlert,
  generateWeeklyQAReport,
};
