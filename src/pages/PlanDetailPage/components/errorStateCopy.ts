// P312 2차 (2026-06-12): ErrorState 풀페이지 카피 resolver — 순수 함수 (React/firebase 무의존).
// ErrorState.tsx 는 Header(firebase 의존) 를 import 하므로, 4-lang/폴백 로직을 별도 모듈로
// 분리해 단위 테스트가 firebase init 없이 돌도록 함.
//
// autherror 브랜치와 동일한 인라인 4-lang 패턴. ui dict(planDetail.ui) 키가 있으면 우선,
// 없으면 인라인 폴백 (legacy 번역 캐시 / 키 누락 시에도 깨진 화면 대신 정상 문구 보장).

export interface ErrorStateCopy {
  title: string;
  desc: string;
  retry: string;
  contact: string;
}

const INLINE_COPY: Record<'ko' | 'en' | 'ja' | 'zh', ErrorStateCopy> = {
  ko: {
    title: '일정 생성에 실패했습니다',
    desc: '결제는 정상적으로 확인되었으니 걱정하지 마세요. 아래 버튼으로 새 일정을 만들거나, 1:1 문의로 도움을 받으실 수 있습니다.',
    retry: '다시 시도',
    contact: '1:1 문의',
  },
  en: {
    title: 'Itinerary Generation Failed',
    desc: "Your payment was confirmed, so no worries. Create a new itinerary with the button below, or reach out via 1:1 chat and we'll help you out.",
    retry: 'Try Again',
    contact: '1:1 Inquiry',
  },
  ja: {
    title: '旅程の作成に失敗しました',
    desc: 'お支払いは正常に確認されていますのでご安心ください。下のボタンで新しい旅程を作成するか、1:1お問い合わせでサポートを受けられます。',
    retry: '再試行',
    contact: '1:1お問い合わせ',
  },
  zh: {
    title: '行程创建失败',
    desc: '您的付款已正常确认，请放心。请用下方按钮创建新行程，或通过1:1咨询获得帮助。',
    retry: '重试',
    contact: '1:1咨询',
  },
};

// 2026-10-26 (첫날 도착 PR2 r2): 실패 사유별 안내(plan._streaming_error_code) — 일반 안내 앞에 붙인다(4개 언어 인라인, 같은 패턴).
const REASON_COPY: Record<'ko' | 'en' | 'ja' | 'zh', Record<string, string>> = {
  ko: {
    ROUTE_DAY_INFEASIBLE: '이 시각으로는 여행 중 하루가 자정 전에 끝나지 않았어요. 도착 시각이나 일정 길이를 바꿔 다시 만들어 주세요.',
    DIETARY_MEAL_COVERAGE_FAILED: '여행 중 하루에 꼭 필요한 식사를 넣지 못했어요. 도착 시각이나 일정 길이를 바꿔 다시 만들어 주세요.',
  },
  en: {
    ROUTE_DAY_INFEASIBLE: "One day of this trip couldn't finish before midnight with these times. Please change the arrival time or the trip length and create the plan again.",
    DIETARY_MEAL_COVERAGE_FAILED: "We couldn't fit a required meal into one of the days. Please change the arrival time or the trip length and create the plan again.",
  },
  ja: {
    ROUTE_DAY_INFEASIBLE: 'この時刻では旅程のある日が深夜0時までに終わりませんでした。到着時刻か旅行日数を変更して、もう一度作成してください。',
    DIETARY_MEAL_COVERAGE_FAILED: '旅程のある日に必要な食事を入れられませんでした。到着時刻か旅行日数を変更して、もう一度作成してください。',
  },
  zh: {
    ROUTE_DAY_INFEASIBLE: '按这些时间，行程中有一天无法在午夜前结束。请修改到达时间或行程天数后重新生成。',
    DIETARY_MEAL_COVERAGE_FAILED: '行程中有一天无法安排必需的用餐。请修改到达时间或行程天数后重新生成。',
  },
};

export function resolveErrorStateCopy(language: string, ui: Record<string, string>, reasonCode?: string | null): ErrorStateCopy {
  const lng = (['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as 'ko' | 'en' | 'ja' | 'zh';
  const base = INLINE_COPY[lng];
  const reason = reasonCode ? REASON_COPY[lng][reasonCode] : undefined;
  // ui dict 값이 비어 있으면(키 누락 / "") || 로 인라인 폴백.
  return {
    title: ui.planErrorTitle || base.title,
    desc: reason ? `${reason} ${ui.planErrorDesc || base.desc}` : (ui.planErrorDesc || base.desc),
    retry: ui.planErrorRetry || base.retry,
    contact: ui.planErrorContact || base.contact,
  };
}
