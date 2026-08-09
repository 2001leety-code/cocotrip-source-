/**
 * PromoBanner — 오픈기념 할인 다국어 배너 (페이지 최상단, 클릭 가능, 닫기 가능).
 *
 * 운영자 2026-06-07: 마케팅 리서치 반영 — ① 클릭 가능 CTA(전환↑) ② 마감일(긴급성) ③ 4언어.
 *   - 배너 클릭 → /tours (할인 적용 차터/투어). 끝에 밑줄 CTA 로 클릭 가능 표시.
 *   - ⚠️ 문구는 COPY/CTA 만 바꾸면 됨. 실제 할인은 가입 WELCOME 쿠폰(차터5%+투어5%)이 적용
 *     (2026-07-07 v2: EARLY50 비활성·총 할인 상한 10%).
 *
 * 어드민 설정 (2026-06-07):
 *   - 마운트 시 /api/promo-config fetch → 성공 + enabled 면 Firestore 값 사용.
 *   - 실패/로딩/미설정 시 코드 상수 폴백 (기존 동작 유지, 깜빡임 방지).
 *   - enabled:false 면 배너 미표시.
 */
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { trackPromoView, trackPromoClick, trackPromoDismiss } from '@/lib/analytics';

const DISMISS_KEY = 'coco_promo_banner_dismissed_v1';

// ─── 코드 상수 폴백 (Firestore 미설정/오류 시 사용) ───────────────────────────

// 🚨 운영자: 오픈 프로모 마감일 표시 문자열 (예: '6/30', 'Jun 30').
//    비우면('') → 긴급성 문구를 아예 붙이지 않음(현행). 넣으면 자동으로 "~6/30 마감" 등 4언어 표시.
//    🚨 마감일이 지나면 반드시 비우거나 새 날짜로 교체 — 가짜 긴급성 금지(신뢰·규제, Booking €413M 벌금 사례).
// 2026-08-10 P2 (#1272): 비웠을 때 '선착순'/'limited' 를 자동으로 붙이던 것 자체가
//    근거 없는 긴급성이었다 — urgency() 를 비워 아무것도 안 붙게 고쳤다.
const PROMO_END_DATE = '';

// 🔴 2026-07-30: CTA 목적지를 문구와 맞춘다.
//   문구가 앞세우는 것은 **가입하면 받는 무료 한국 여행 일정**인데 CTA 는 /tours(투어 목록)로
//   보내고 있었다. 무료 일정을 기대하고 누른 사람이 투어 목록에 떨어지면 약속이 깨진다.
//   플래너로 보내고, 5% 쿠폰은 결제 단계에서 자동 적용된다(문구에 그대로 남긴다).
const CTA_HREF = '/planner';

// 문구 — 운영자가 여기만 바꾸면 됨. (긴급성 꼬리말은 urgency() 가 자동 부착)
// 🚨 2026-07-07: 거짓 '50% OFF'·'첫 예약 10%' 제거 — 실제 최대 할인은 총 10%(가입 5%+5% 쿠폰).
// 🚨 2026-07-10 P0: 서버 DEFAULT(api/_shared/promo-config.js)와 반드시 동일하게 유지 —
//    7/7에 여기만 고치고 서버를 빼먹어 prod API 가 낡은 50% 문구를 계속 반환했음.
//    실발급(onboarding-coupons.js) = 한국 여행 일정 무료(1~3일) + 차터5% + 투어5% → 문구 일치.
// 🚨 2026-08-10 P2 (#1272): 제품을 "AI 플랜"으로 전면에 내세우지 않는다 — 구현(AI)이 아니라
//    능력("실행 가능한 한국 일정")으로 부른다는 docs/DESIGN-EDITORIAL-CONCIERGE.md §5 규칙을
//    이 배너만 예외로 어기고 있었다. 할인율·기간·CTA 목적지는 그대로.
const COPY: Record<string, string> = {
  en: '🎉 Grand Opening — free 1–3 day Korea itinerary + 5% charter and tour coupons when you sign up',
  ko: '🎉 오픈 기념 — 가입하면 1~3일 한국 여행 일정 무료 + 차터·투어 5% 쿠폰',
  ja: '🎉 オープン記念 — 登録で1〜3日韓国旅程無料 + チャーター・ツアー5%クーポン',
  zh: '🎉 开业纪念 — 注册即享1–3天韩国行程免费 + 包车·行程5%优惠券',
};

// 클릭 가능 CTA — 끝에 밑줄로 노출 (리서치: 'your'→'my'/명확한 CTA 가 클릭률↑)
const CTA: Record<string, string> = {
  en: 'Start free plan →',
  ko: '무료 일정 만들기 →',
  ja: '無料プランを作る →',
  zh: '免费生成行程 →',
};

// ─── 어드민 설정 타입 ──────────────────────────────────────────────────────────
interface PromoConfig {
  enabled: boolean;
  copy: Record<string, string>;
  ctaText: Record<string, string>;
  ctaHref: string;
  endDate: string;
}

// 긴급성 꼬리말 — 실제 endDate 가 있을 때만 표시. 없으면 아무것도 붙이지 않는다
// (2026-08-10 P2: endDate='' 인데 '선착순'/'limited' 를 붙이던 가짜 긴급성 제거 — Booking €413M 벌금 사례).
function urgency(lang: string, endDate: string): string {
  if (!endDate) return '';
  if (lang === 'ko') return ` · ~${endDate} 마감`;
  if (lang === 'ja') return ` · ${endDate}まで`;
  if (lang === 'zh') return ` · ${endDate}截止`;
  return ` · ends ${endDate}`;
}

export function PromoBanner() {
  const { language } = useLanguage();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(DISMISS_KEY) === 'true'; } catch { return false; }
  });
  // 어드민 설정 — null=로딩중/미설정(코드상수 사용), PromoConfig=원격 설정 사용
  const [remoteConfig, setRemoteConfig] = useState<PromoConfig | null>(null);

  // P1 (2026-07-11): 배너 노출 이벤트 — 표시 조건 확정 후 1회 (GA4 퍼널: 노출→클릭→가입).
  useEffect(() => {
    if (dismissed) return;
    if (remoteConfig && !remoteConfig.enabled) return;
    trackPromoView('top_banner');
    // remoteConfig 로딩 전후 각 1회가 아니라 최초 표시 시 1회만 — deps 는 dismissed 만.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dismissed]);

  useEffect(() => {
    // 이미 닫혔으면 fetch 불필요
    if (dismissed) return;
    let cancelled = false;
    fetch('/api/promo-config')
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled && json && json.ok) {
          // 신 구조: { banner, popup } / 구 구조: { config } — 하위 호환
          const cfg = json.banner || json.config;
          if (cfg) setRemoteConfig(cfg as PromoConfig);
        }
      })
      .catch(() => { /* fail-safe: 코드상수 폴백 */ });
    return () => { cancelled = true; };
  }, [dismissed]);

  // enabled:false 면 미표시 (원격 설정이 있을 때만 판단)
  if (remoteConfig && !remoteConfig.enabled) return null;
  if (dismissed) return null;

  // 원격 설정 있으면 사용, 없으면 코드 상수 폴백
  const activeCopy = remoteConfig ? remoteConfig.copy : COPY;
  const activeCta = remoteConfig ? remoteConfig.ctaText : CTA;
  const activeCtaHref = remoteConfig ? remoteConfig.ctaHref : CTA_HREF;
  const activeEndDate = remoteConfig ? remoteConfig.endDate : PROMO_END_DATE;

  const text = (activeCopy[language] || activeCopy.en) + urgency(language, activeEndDate);
  const cta = activeCta[language] || activeCta.en;
  const close = () => {
    trackPromoDismiss('top_banner');
    try { localStorage.setItem(DISMISS_KEY, 'true'); } catch { /* noop */ }
    setDismissed(true);
  };

  return (
    // 닫기(X)는 Link 밖 형제 — 중첩 인터랙티브 회피 + X 클릭 시 네비게이션 안 됨.
    // 2026-08-10 Editorial Concierge: 배경을 브랜드 그라데이션에서 잉크 서피스로 교체.
    //   페이지 맨 위 그라데이션 띠가 새 시각 체계와 정면으로 충돌했다(그라데이션 배경 금지).
    //   문구·CTA·추적·로직은 무변경 — COPY 는 서버(api/_shared/promo-config.js)와
    //   동일성 테스트로 묶여 있어 여기서 손대면 그 테스트가 깨진다.
    <div
      className="ec-root ec-no-print relative w-full"
      style={{ background: 'var(--ec-surface-inverse)', color: 'var(--ec-text-on-inverse)' }}
      role="region"
      aria-label="Promotion"
    >
      <Link
        to={activeCtaHref}
        onClick={() => trackPromoClick('top_banner', activeCtaHref)}
        className="block w-full text-center text-[12px] sm:text-[13px] font-medium py-2.5 px-9 leading-snug"
      >
        <span>{text} </span>
        <span className="font-semibold underline underline-offset-2 whitespace-nowrap">{cta}</span>
      </Link>
      <button
        type="button"
        onClick={close}
        aria-label="Close promotion"
        className="absolute right-1 top-1/2 flex min-h-[44px] min-w-[44px] -translate-y-1/2 items-center justify-center rounded-ec-sm transition-colors duration-ec-base ease-ec-standard hover:bg-white/10"
      >
        <X size={15} />
      </button>
    </div>
  );
}
