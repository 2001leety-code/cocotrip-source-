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

export function resolveErrorStateCopy(language: string, ui: Record<string, string>): ErrorStateCopy {
  const lng = (['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as 'ko' | 'en' | 'ja' | 'zh';
  const base = INLINE_COPY[lng];
  // ui dict 값이 비어 있으면(키 누락 / "") || 로 인라인 폴백.
  return {
    title: ui.planErrorTitle || base.title,
    desc: ui.planErrorDesc || base.desc,
    retry: ui.planErrorRetry || base.retry,
    contact: ui.planErrorContact || base.contact,
  };
}
