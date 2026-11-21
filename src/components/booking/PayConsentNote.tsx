import { useLanguage } from '@/hooks/useLanguage';

// 결제 버튼 옆 한 줄: "결제하면 이용약관과 개인정보 처리방침에 동의합니다." (2026-11-22)
// 체크칸이 없는 결제 버튼(K-pop 셔틀·콘서트 팝업·플랜 안 예약 카드)용. 새 탭으로 열어 결제 화면을 지킨다.
// 라우터 밖에서도 그려지게 <a> (쿠키 안내와 같은 방식).
export function PayConsentNote({ className = 'text-[11px] text-gray-500' }: { className?: string }) {
  const { t } = useLanguage();
  const c = t.payConsent;
  const link = 'underline underline-offset-2 hover:opacity-80';
  return (
    <p className={className} data-testid="pay-consent-note">
      {c.before}
      <a href="/terms" target="_blank" rel="noopener noreferrer" className={link}>{c.terms}</a>
      {c.middle}
      <a href="/privacy" target="_blank" rel="noopener noreferrer" className={link}>{c.privacy}</a>
      {c.after}
    </p>
  );
}
