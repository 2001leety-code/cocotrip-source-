// 어드민 이메일 매칭 헬퍼 — 클라이언트 측 단일 source of truth.
//
// batch 9 fix (B9-3, 2026-05-09): paymentGate.js 의 ADMIN_BYPASS_EMAILS 와
// 동기화된 클라이언트 매칭. 어드민 본인 계정에서 쿠폰 무제한 사용,
// Test Mode 노출 등 분기에 사용.
//
// 운영자 1명 기준 hardcoded fallback. VITE_ADMIN_EMAILS env 우선 (쉼표 구분).
//
// 보안: 클라이언트 판정은 UI 분기용일 뿐, 실제 권한은 백엔드 (verifyUserToken
// + ADMIN_BYPASS_EMAILS) 에서 재검증. 클라이언트만 우회해도 백엔드가 거절.

const HARDCODED_ADMIN_EMAILS = ['2001leety@gmail.com'];

function getAdminEmails(): string[] {
  const raw = (import.meta.env.VITE_ADMIN_EMAILS as string | undefined)?.trim();
  if (raw) {
    return raw.split(',').map(e => e.toLowerCase().trim()).filter(Boolean);
  }
  return HARDCODED_ADMIN_EMAILS;
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return getAdminEmails().includes(email.toLowerCase().trim());
}
