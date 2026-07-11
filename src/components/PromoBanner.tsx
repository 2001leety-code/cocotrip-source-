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
import { BRAND } from '@/lib/design-tokens';

const DISMISS_KEY = 'coco_promo_banner_dismissed_v1';

// ─── 코드 상수 폴백 (Firestore 미설정/오류 시 사용) ───────────────────────────

// 🚨 운영자: 오픈 프로모 마감일 표시 문자열 (예: '6/30', 'Jun 30').
//    비우면('') → "선착순"만 표시(현행). 넣으면 자동으로 "~6/30 마감" 등 4언어 표시(긴급성).
//    🚨 마감일이 지나면 반드시 비우거나 새 날짜로 교체 — 가짜 긴급성 금지(신뢰·규제, Booking €413M 벌금 사례).
// 2026-07-07: 지난 날짜('6/28') 비움 — 가짜 긴급성 제거(코드에 강제 마감일 없음). '선착순'만 표시.
const PROMO_END_DATE = '';

// CTA 클릭 이동 — 할인 적용 상품(차터/투어) 목록
const CTA_HREF = '/tours';

// 문구 — 운영자가 여기만 바꾸면 됨. (긴급성 꼬리말은 urgency() 가 자동 부착)
// 🚨 2026-07-07: 거짓 '50% OFF'·'첫 예약 10%' 제거 — 실제 최대 할인은 총 10%(가입 5%+5% 쿠폰).
// 🚨 2026-07-10 P0: 서버 DEFAULT(api/_shared/promo-config.js)와 반드시 동일하게 유지 —
//    7/7에 여기만 고치고 서버를 빼먹어 prod API 가 낡은 50% 문구를 계속 반환했음.
//    실발급(onboarding-coupons.js) = AI플랜 무료(1~3일) + 차터5% + 투어5% → 문구 일치.
const COPY: Record<string, string> = {
  en: '🎉 Grand Opening — free 1–3 day AI plan + 5% charter and tour coupons when you sign up',
  ko: '🎉 오픈 기념 — 가입하면 1~3일 AI 일정 무료 + 차터·투어 5% 쿠폰',
  ja: '🎉 オープン記念 — 登録で1〜3日AIプラン無料 + チャーター・ツアー5%クーポン',
  zh: '🎉 开业纪念 — 注册即享1–3天AI行程免费 + 包车·行程5%优惠券',
};

// 클릭 가능 CTA — 끝에 밑줄로 노출 (리서치: 'your'→'my'/명확한 CTA 가 클릭률↑)
const CTA: Record<string, string> = {
  en: 'See deals →',
  ko: '딜 보기 →',
  ja: 'お得を見る →',
  zh: '查看优惠 →',
};

// ─── 어드민 설정 타입 ──────────────────────────────────────────────────────────
interface PromoConfig {
  enabled: boolean;
  copy: Record<string, string>;
  ctaText: Record<string, string>;
  ctaHref: string;
  endDate: string;
}

// 긴급성 꼬리말 — endDate 있으면 "마감일", 없으면 "선착순".
function urgency(lang: string, endDate: string): string {
  if (endDate) {
    if (lang === 'ko') return ` · ~${endDate} 마감`;
    if (lang === 'ja') return ` · ${endDate}まで`;
    if (lang === 'zh') return ` · ${endDate}截止`;
    return ` · ends ${endDate}`;
  }
  if (lang === 'ko') return ' · 선착순';
  if (lang === 'ja') return ' · 先着順';
  if (lang === 'zh') return ' · 限量';
  return ' · limited';
}

export function PromoBanner() {
  const { language } = useLanguage();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(DISMISS_KEY) === 'true'; } catch { return false; }
  });
  // 어드민 설정 — null=로딩중/미설정(코드상수 사용), PromoConfig=원격 설정 사용
  const [remoteConfig, setRemoteConfig] = useState<PromoConfig | null>(null);

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
    try { localStorage.setItem(DISMISS_KEY, 'true'); } catch { /* noop */ }
    setDismissed(true);
  };

  return (
    // 닫기(X)는 Link 밖 형제 — 중첩 인터랙티브 회피 + X 클릭 시 네비게이션 안 됨.
    <div className="relative w-full" style={{ background: BRAND.gradient.primary }} role="region" aria-label="Promotion">
      <Link
        to={activeCtaHref}
        className="block w-full text-center text-white text-[12px] sm:text-sm font-semibold py-2 px-9 leading-snug hover:brightness-110 transition"
      >
        <span>{text} </span>
        <span className="underline underline-offset-2 whitespace-nowrap">{cta}</span>
      </Link>
      <button
        type="button"
        onClick={close}
        aria-label="Close promotion"
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-white hover:bg-white/15 transition-colors"
      >
        <X size={15} />
      </button>
    </div>
  );
}
