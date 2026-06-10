/**
 * 서비스/자격증명 수명 레지스트리 — 수정팀이 만료·갱신·rotation 전에 미리 알림(조용히 터지는 것 방지).
 *
 * 2026-06-10 운영자 받적: "교통처럼 미리 작업해놔야 할 것" → 외부 의존성 수명 자동 감시.
 * 날짜를 운영자가 기록하면(lastRotated/expiryDate) 수정팀이 갱신/만료 N일 전 자동 알림.
 * 미기록(null) 항목은 "날짜 기록 필요"로 1회 안내 → 운영자가 채우면 그때부터 자동 감시.
 *
 * 🔴 여기엔 실제 키/시크릿 값을 절대 넣지 않는다 (날짜·정책만). 값은 Vercel Dashboard.
 * SSOT = 이 파일. 새 서비스/갱신 시 날짜만 고치면 됨.
 * (교통 ODsay 만료 2026-10-14·한도는 transitServiceConfig.js + checkTransitService 가 별도 감시.)
 */
export const SERVICE_REGISTRY = [
  // 🔐 자격증명 rotation (보안). lastRotated = 마지막 갱신일('YYYY-MM-DD') 또는 null(미기록).
  {
    key: 'paypal_secret', label: 'PayPal 시크릿', kind: 'rotation', rotationDays: 90, lastRotated: null,
    note: 'PAYPAL_CLIENT_SECRET 90일 rotation 권장. 마지막 갱신일 기록 시 자동 알림.',
  },
  {
    key: 'firebase_key', label: 'Firebase 비밀키', kind: 'rotation', rotationDays: 365, lastRotated: null,
    note: 'FIREBASE_PRIVATE_KEY 1년 rotation. Vercel Dashboard 직접 입력만(CLI 금지).',
  },
  // 🌐 외부 서비스 만료. expiryDate = 만료일('YYYY-MM-DD') 또는 null(미기록).
  {
    key: 'domain', label: 'cocotripkr.com 도메인', kind: 'expiry', expiryDate: null,
    note: '도메인 갱신일. 만료 시 사이트 다운 — 갱신일 기록 권장.',
  },
];

export const SERVICE_WARN_DAYS = 30;
export const SERVICE_CRIT_DAYS = 7;
