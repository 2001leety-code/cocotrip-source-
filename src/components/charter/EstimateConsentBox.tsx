/**
 * 추정가(charter_custom_estimate) 결제 전 정산조건 고지 + 필수 동의 (2026-07-30).
 *
 * 🔴 고친 문제: `/charter` 공개 본문 4개 언어가 "결제 후 추가 청구는 하지 않습니다" 라고
 *   단정했는데, 추정가 결제는 실제 거리·시간이 ±10% 넘게 다르면 추가 청구 또는 부분 환불을
 *   한다. 고지는 **결제 후** 메일·바우처·월렛패스에만 있었다. 번역 키
 *   (`estimatePayDisclaimer` · `estimatePayAgreeLabel`)는 이미 4개 언어로 있었는데
 *   **화면 호출처가 0건**이었다 — 번역만 만들어 두고 배선하지 않은 것이다.
 *
 * 계약
 *   - 이 상자는 추정가 결제 경로에서만 렌더한다(확정가 상품에는 붙이지 않는다 — 그쪽은
 *     실제로 추가 청구가 없고, 없는 조건에 동의를 받으면 그것도 거짓 고지다).
 *   - 체크 전에는 결제 버튼이 비활성이고, 주문 생성 요청도 만들지 않는다
 *     (`PayPalBookingButton` 의 `disabled`). 서버도 같은 조건을 fail-closed 로 다시 본다.
 */
import { getWizardI18n } from './wizard-i18n';

interface Props {
  language: 'ko' | 'en' | 'ja' | 'zh';
  agreed: boolean;
  onChange: (agreed: boolean) => void;
}

export function EstimateConsentBox({ language, agreed, onChange }: Props) {
  const i18n = getWizardI18n(language);
  return (
    <div
      data-testid="estimate-consent-box"
      className="rounded-xl border border-amber-500/35 bg-amber-500/[0.07] p-3 space-y-2.5"
    >
      <p className="text-[11px] leading-relaxed text-amber-100/90 sm:text-xs">
        {i18n.estimatePayDisclaimer}
      </p>
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          data-testid="estimate-consent-checkbox"
          checked={agreed}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[#B668FC]"
        />
        <span className="text-[11px] font-semibold leading-relaxed text-white/85 sm:text-xs">
          {i18n.estimatePayAgreeLabel}
        </span>
      </label>
    </div>
  );
}
