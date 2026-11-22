/**
 * 만 14세 미만 동반 — 보호자 동의 기록(처리방침 2026-11-21). 2026-11-22.
 * 새 개인정보는 담지 않는다: 아이와 함께 가는지, 동의했는지, 언제, 어떤 문구 판(version)에 동의했는지뿐이다.
 * 예약 기록에는 서버가 이미 그대로 보관하는 칸으로만 간다(투어 = 예약 memo, 차터 = 위저드 상태·장바구니 memo).
 */

/** 보호자 동의 문구 판. 문구(BookingInfoForm 의 agreeGuardian)를 바꾸면 이 값도 바꾼다. */
export const GUARDIAN_CONSENT_VERSION = '2026-11-21';

export interface GuardianConsent {
  /** 만 14세 미만 아이와 함께 가는가(차터 = 아이 수 > 0, 투어 = 손님이 스스로 밝힘). */
  minor: boolean;
  /** 보호자 동의를 했는가. minor 가 false 면 늘 false. */
  agreed: boolean;
  /** 동의한 시각(ISO). 동의 전·해당 없음 = null. */
  at: string | null;
  version: string;
}

/** 예약 memo 한 줄. 아이 동반이 아니면 '' (memo 를 늘리지 않음). */
export function guardianMemoLine(g: GuardianConsent | null | undefined): string {
  if (!g || !g.minor) return '';
  if (g.agreed && g.at) return `Child under 14: yes | Guardian consent: yes @ ${g.at} (v${g.version})`;
  return 'Child under 14: yes | Guardian consent: no';
}
