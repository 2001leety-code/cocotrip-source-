// 취소·환불 정책 표 SSOT (api/_refund-policy.js 24시간 바이너리와 동기화).
// 2026-07-14 운영자 확정: 24시간 바이너리(24h 이상=100% / 24h 미만=0%), 등급 차등 폐지.
// RefundPolicyModal(하단 CTA 바 링크)과 TourCancellationSection(페이지 섹션, MRT P1
// 2026-08-19)이 이 값을 같이 쓴다 — 두 파일이 각자 리터럴을 들고 있으면 한쪽만 고치는
// 사고가 난다. 컴포넌트 파일에 두면 상수 export 가 react-refresh/only-export-components 에
// 걸려 별도 데이터 파일로 뺐다.
import type { Language } from '@/i18n';

export const COL_HEADERS: Record<Language, { period: string; refund: string }> = {
  ko: { period: '취소 시점',      refund: '환불' },
  en: { period: 'When you cancel', refund: 'Refund' },
  ja: { period: 'キャンセル時点',  refund: '返金' },
  zh: { period: '取消时间',       refund: '退款' },
};

// 바이너리 2행: [기간 라벨, 환불율].
export const ROWS: Record<Language, [string, string][]> = {
  ko: [['투어 24시간 이상 전', '100%'], ['투어 24시간 미만 · 노쇼', '0%']],
  en: [['24+ hours before tour', '100%'], ['Within 24 hours · no-show', '0%']],
  ja: [['ツアー24時間以上前', '100%'], ['24時間未満・ノーショー', '0%']],
  zh: [['旅游24小时以上前', '100%'], ['24小时内 · 未出席', '0%']],
};

export const HEADING: Record<Language, string> = {
  ko: '취소·환불 정책',
  en: 'Cancellation & Refund Policy',
  ja: 'キャンセル・返金ポリシー',
  zh: '取消和退款政策',
};

export const NOTES: Record<Language, string[]> = {
  ko: [
    '투어 시작 시각(KST 기준) 대비 잔여 시간으로 산정합니다.',
    '전 고객 동일 정책입니다 (회원 등급별 차등 없음).',
    '환불은 PayPal 원결제 수단으로 7~10영업일 내 처리됩니다.',
  ],
  en: [
    'Hours are counted from the tour start time (KST).',
    'Same policy for all customers (no loyalty-tier difference).',
    'Refunds are processed to the original PayPal account within 7-10 business days.',
  ],
  ja: [
    'ツアー開始時刻（KST）からの残り時間で計算されます。',
    '全てのお客様に同一のポリシーです（会員ランクによる差はありません）。',
    'PayPal原決済手段に7~10営業日以内に返金されます。',
  ],
  zh: [
    '按照旅游开始时间（韩国时间）计算剩余时间。',
    '所有客户政策相同（无会员等级差异）。',
    '退款将在7-10个工作日内退至原PayPal账户。',
  ],
};
