/**
 * CharterIntroModal — 전세차량 이용 방법 안내. **사용자가 눌러야만 열린다.**
 *
 * 트리거: 히어로 영역의 "이용 방법" 버튼(이 파일이 함께 렌더). 자동 노출 없음.
 * 위치:   CharterNewPage / CharterPage 히어로
 * 닫기:   "확인했어요" 버튼, 배경 클릭, X 버튼
 *
 * 안내 항목:
 *   - 차터 예약 6단계 흐름 요약
 *   - 마감 시간 이내 출발은 채팅창 사용 (오른쪽 하단 ChatWidget)
 *   - 예약 마감 정책
 *
 * 🔴 2026-07-30: 이 모달은 "12시간 전 마감" 이라고 안내하고 있었다. 실제 정책은 전세차량
 *   1시간(투어 8시간)이라, 실은 예약할 수 있는 손님에게 "이미 마감" 이라고 말하는 과소약속이었다.
 *   → 번역 문구를 `{h}` 자리표시자로 바꾸고 숫자는 `lib/bookingCutoff` 상수에서 넣는다.
 *
 * 🔴 2026-08-01: **첫 진입 자동 노출을 없앴다.**
 *   실측 — 신규 방문자는 쿠키 동의 배너(z-10001)와 이 모달(z-9999)을 동시에 받았고, 배너가
 *   모달의 기본 버튼을 덮어 자동화가 180초 동안 견적 입력칸을 누르지 못했다. 겹침을 피하려고
 *   "동의 후 노출" 로 미루면 마찰이 쿠키 → 모달 → 위저드로 그대로 남는다.
 *   (⚠️ 2026-08-02 정정: 근거로 들었던 "견적 시작 14명" 은 주간 자동 테스트 오염분이었다.
 *    팝업 겹침 자체는 실측된 실제 결함이다.) 견적을 보러 온 사람 앞에
 *   설명창을 세우지 않는다 — 필요한 사람만 버튼으로 연다.
 *   (모바일 자동 노출은 "강제 모달이 전환 방해" 라는 이유로 이미 꺼져 있었다. 같은 판단을
 *    데스크탑에도 적용한 것.)
 *   자동 노출이 없으므로 "1회만 보여주기" 저장키(`COCO_CHARTER_INTRO_SEEN_v1`)도 제거했다.
 *
 * 디자인은 OnboardingCouponModal / AIIntroModal 과 일관 유지.
 */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Car, MapPin, Clock, MessageCircle, AlertTriangle, X, HelpCircle } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { CHARTER_VEHICLE_CUTOFF_HOURS } from '@/lib/bookingCutoff';

/** 번역 문구의 `{h}` 를 실제 마감 시간으로 채운다. 키가 없으면 영어 기본문에도 같은 규칙 적용. */
function withCutoffHours(text: string): string {
  return text.replace(/\{h\}/g, String(CHARTER_VEHICLE_CUTOFF_HOURS));
}

export function CharterIntroModal() {
  const [open, setOpen] = useState(false);
  const { t } = useLanguage();

  // i18n — charterPage 네임스페이스 (4개 언어 모두 키 존재)
  const c = ((t as unknown) as { charterPage?: Record<string, string> }).charterPage ?? {};
  // 버튼 라벨은 모달 제목을 그대로 쓴다 — 4개 언어가 이미 있어 새 번역 키를 만들지 않는다.
  // `??` 가 아니라 `||` — 레포 규칙(AGENTS.md). 빈 문자열 번역이면 `??` 는 빈 라벨을 그대로 써서
  // 이름 없는 아이콘 버튼이 된다.
  const openLabel = c.charterIntroTitle || 'How charter booking works';

  function handleClose() {
    setOpen(false);
  }

  // 트리거 — 화면을 막지 않는 인라인 버튼. 위저드는 뒤에서 그대로 조작 가능하다.
  const trigger = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      data-testid="charter-how-it-works"
      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs text-white/70 transition-colors hover:border-[#B668FC]/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B668FC]/70"
    >
      <HelpCircle size={14} className="shrink-0" />
      {openLabel}
    </button>
  );

  if (!open) return trigger;

  // 열려 있는 동안에도 트리거는 DOM 에 남긴다 — 닫은 뒤 버튼이 사라지면 다시 열 수 없다.
  //
  // 🔴 다이얼로그는 **document.body 로 포털**한다 (2026-08-02 리뷰 지적).
  //   모바일 차터 화면은 밝은 셸(`.cocotrip-mobile-charter`)이고, index.css 가 그 안의
  //   `[class*="text-white"]` 을 전부 짙은 남색으로 `!important` 덮어쓴다. 이 다이얼로그는
  //   배경이 짙은 남색이라 셸 안에 있으면 제목·본문·닫기 버튼이 배경과 같은 색이 되어
  //   사실상 보이지 않는다. 예전엔 자동 노출이 데스크탑 전용이라 드러나지 않던 문제인데,
  //   버튼으로 모바일에서도 열 수 있게 되면서 실제로 닿는 경로가 생겼다.
  //   포털로 셸 밖에 두면 색상 덮어쓰기 대상에서 벗어난다(레포의 MoodGuideModal 과 같은 방식).
  //   트리거 버튼은 셸 안에 그대로 둔다 — 밝은 배경에서 어두운 글자가 맞다.
  return (
    <>
      {trigger}
      {createPortal(
      <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="charter-intro-title"
    >
      <div
        className="relative w-full max-w-md rounded-2xl overflow-hidden shadow-2xl max-h-[90vh] overflow-y-auto"
        style={{ background: 'linear-gradient(135deg, #1a1b2e 0%, #16213e 60%, #0f3460 100%)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-3 right-3 text-white/60 hover:text-white transition-colors z-10"
          aria-label="Close"
          type="button"
        >
          <X size={20} />
        </button>

        {/* Header */}
        <div className="pt-8 pb-4 px-6 text-center">
          <div className="flex justify-center mb-3">
            <div className="rounded-full p-3" style={{ background: 'rgba(124,92,252,0.25)' }}>
              <Car className="text-[#a78bfa]" size={32} />
            </div>
          </div>
          <h2 id="charter-intro-title" className="text-white font-bold text-xl leading-tight">
            {c.charterIntroTitle ?? 'How charter booking works'}
          </h2>
          <p className="text-white/60 text-sm mt-1.5">
            {c.charterIntroSubtitle ?? 'Airport transfers, day tours, and multi-day charters in 6 quick steps.'}
          </p>
        </div>

        {/* Steps */}
        <div className="px-6 pb-2 space-y-3">
          {/* Step 1 */}
          <div
            className="flex items-start gap-3 rounded-xl px-4 py-3"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(124,92,252,0.3)' }}
          >
            <MapPin className="text-[#7c5cfc] shrink-0 mt-0.5" size={20} />
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-sm leading-snug">
                {c.charterIntroStep1Title ?? '1. Choose origin & service'}
              </p>
              <p className="text-white/55 text-xs mt-1 leading-relaxed">
                {c.charterIntroStep1Body ?? 'Pick your departure airport or city, then select the service you need.'}
              </p>
            </div>
          </div>

          {/* Step 2 */}
          <div
            className="flex items-start gap-3 rounded-xl px-4 py-3"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(124,92,252,0.3)' }}
          >
            <Car className="text-[#7c5cfc] shrink-0 mt-0.5" size={20} />
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-sm leading-snug">
                {c.charterIntroStep2Title ?? '2. Enter dates, passengers & vehicle'}
              </p>
              <p className="text-white/55 text-xs mt-1 leading-relaxed">
                {c.charterIntroStep2Body ?? 'Share your travel dates, party size, luggage count, and preferred vehicle.'}
              </p>
            </div>
          </div>

          {/* Step 3 */}
          <div
            className="flex items-start gap-3 rounded-xl px-4 py-3"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(124,92,252,0.3)' }}
          >
            <Clock className="text-[#7c5cfc] shrink-0 mt-0.5" size={20} />
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-sm leading-snug">
                {c.charterIntroStep3Title ?? '3. Review the quote and book'}
              </p>
              <p className="text-white/55 text-xs mt-1 leading-relaxed">
                {c.charterIntroStep3Body ?? 'An instant quote appears on screen. Pay via PayPal or request a tailored quote on WhatsApp.'}
              </p>
            </div>
          </div>
        </div>

        {/* Urgent / chat callout — emphasized */}
        <div
          className="mx-6 mt-4 rounded-xl px-4 py-3"
          style={{
            background: 'linear-gradient(135deg, rgba(255,107,157,0.18), rgba(182,104,252,0.18))',
            border: '1px solid rgba(255,107,157,0.45)',
          }}
        >
          <div className="flex items-start gap-2.5">
            <MessageCircle className="text-[#FF6B9D] shrink-0 mt-0.5" size={20} />
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-sm leading-snug">
                {c.charterIntroChatTitle ?? 'Need it urgently? Chat with us instead'}
              </p>
              <p className="text-white/70 text-xs mt-1 leading-relaxed">
                {withCutoffHours(c.charterIntroChatBody || "If you're departing within {h} hours, please skip the wizard and message us via the chat window in the bottom-right corner.")}
              </p>
            </div>
          </div>
        </div>

        {/* Booking deadline note */}
        <div className="mx-6 mt-3 flex items-center gap-2 text-[11px] text-amber-300/85">
          <AlertTriangle className="shrink-0" size={14} />
          <span className="leading-snug">
            {withCutoffHours(c.charterIntroDeadline || 'Booking cutoff: {h} hours before departure.')}
          </span>
        </div>

        {/* CTA */}
        <div className="p-6 pt-3">
          <button
            onClick={handleClose}
            type="button"
            className="w-full rounded-xl py-3 font-semibold text-white text-sm transition-opacity hover:opacity-90 active:opacity-75"
            style={{ background: 'linear-gradient(135deg, #7c5cfc, #6d28d9)' }}
          >
            {c.charterIntroClose ?? 'Got it'}
          </button>
        </div>
        </div>
      </div>,
      document.body,
      )}
    </>
  );
}
