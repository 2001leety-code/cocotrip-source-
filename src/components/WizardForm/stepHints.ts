// #wizard-step-hints (2026-06-05, 운영자 #3): 각 위저드 스텝의 친절한 설명.
// 기존 AIIntroModal 은 전체 흐름 3단계를 "한 번에" 보여줬는데, 운영자 요청 = 각 스텝마다
// 그 자리에서 필요한 안내. 타사 참고(Mailchimp/Airbnb/NN-g): 1~2문장, 행동 중심, 부담 없게,
// 작업 기억 부담 최소화(스텝 옆에 바로). WizardStepHint 가 스텝 첫 도달 시 1회 + "?" 재보기.
//
// 카피는 여기 한 곳에 모음 → 운영자가 손쉽게 다듬기 가능. 4언어 동시(ko/en/ja/zh).
export type WizardHintLang = 'ko' | 'en' | 'ja' | 'zh';

export interface WizardStepHintCopy {
  title: Record<WizardHintLang, string>;
  body: Record<WizardHintLang, string>;
}

// step 인덱스(0~4) = STEPS: 0 예약 / 1 도시 / 2 음식 / 3 상세 / 4 생성
export const WIZARD_STEP_HINTS: Record<number, WizardStepHintCopy> = {
  0: {
    title: { ko: '예약 정보', en: 'Your bookings', ja: '予約情報', zh: '预订信息' },
    body: {
      ko: '이미 예약한 항공편이나 호텔이 있나요? 알려주시면 일정을 거기에 맞춰 짜드려요.',
      en: 'Already booked a flight or hotel? Tell us and we’ll build your plan around it.',
      ja: '予約済みの航空券やホテルはありますか？教えていただければ、それに合わせて旅程を作ります。',
      zh: '已经订好机票或酒店了吗？告诉我们，行程就按它来安排。',
    },
  },
  1: {
    title: { ko: '가고 싶은 곳', en: 'Where to go', ja: '行きたい場所', zh: '想去的地方' },
    body: {
      ko: '가고 싶은 도시와 즐기고 싶은 활동을 골라주세요. 여러 도시도 괜찮아요.',
      en: 'Pick the cities you want to visit and the activities you’d enjoy — multiple cities are fine.',
      ja: '行きたい都市と楽しみたいアクティビティを選んでください。複数の都市もOKです。',
      zh: '选择想去的城市和想体验的活动，多个城市也没问题。',
    },
  },
  2: {
    title: { ko: '음식 취향', en: 'Food & diet', ja: '食の好み', zh: '饮食偏好' },
    body: {
      ko: '좋아하는 음식과 식이 제한(할랄·비건·알레르기)을 알려주시면 딱 맞는 맛집만 추천해요.',
      en: 'Share your tastes and any dietary needs (halal, vegan, allergies) — we’ll match the right restaurants.',
      ja: '好きな食べ物と食事制限（ハラル・ビーガン・アレルギー）を教えてください。ぴったりのお店だけご提案します。',
      zh: '告诉我们你的口味和饮食限制（清真、纯素、过敏），我们只推荐合适的餐厅。',
    },
  },
  3: {
    title: { ko: '여행 상세', en: 'Trip details', ja: '旅行の詳細', zh: '行程细节' },
    body: {
      ko: '여행 날짜·인원·공항·숙소를 입력하면 이동 동선을 최적화해 드려요.',
      en: 'Enter your dates, group size, airport, and hotel — we’ll optimize your route.',
      ja: '旅行日程・人数・空港・宿泊先を入力すると、移動ルートを最適化します。',
      zh: '填写日期、人数、机场和住宿，我们会帮你优化路线。',
    },
  },
  4: {
    title: { ko: '거의 다 됐어요', en: 'Almost there', ja: 'あと少し', zh: '就快好了' },
    body: {
      ko: '입력한 내용을 확인하고 ‘생성’을 누르면 30초 만에 맞춤 일정이 나와요!',
      en: 'Review your details and hit Generate — your custom itinerary is ready in 30 seconds!',
      ja: '入力内容を確認して「生成」を押すと、30秒であなた専用の旅程が完成します！',
      zh: '确认填写的内容后点击“生成”，30秒内就能拿到专属行程！',
    },
  },
};

/** 안전한 언어 정규화 — 미지원 언어는 영어 폴백. */
export function normalizeHintLang(lang: string | undefined): WizardHintLang {
  return lang === 'ko' || lang === 'ja' || lang === 'zh' ? lang : 'en';
}
