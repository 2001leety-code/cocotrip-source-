// Revision / Regenerate card.
// Extracted from PlanDetailPage/index.tsx L424-456 (zero behavior change).
// 2026-05-04 (Tier 1-B): 클릭 시 RevisionReasonModal 을 띄워 사유 수집 후 redirect.
// 2026-05-08 (W4): revisionCredits=0 안내 카드 + 7개 사유 + plan_complaints 저장 + avoidList.
// 2026-05-09 (B9-18): UX 안정화. 사용자 신고 ("안 눌림", "잘 안 뜸", "늦게 뜸").
//   - RevisionReasonModal eager + createPortal 적용 (Modal 자체 PR 동시 적용)
//   - 진단 console.log: onClick 진입 / modalOpen 상태 변화 시
//   - 모바일 touch target ≥48px (min-h-[48px])
//   - haptic feedback (navigator.vibrate)
//   - type="button" 명시 (form submit 회피)
//   - e.preventDefault + e.stopPropagation (ancestor click 가로채기 방지)
//   - 첫 클릭 즉시 setModalOpen(true) — Firestore 같은 무거운 작업 없음
import { useState, useEffect } from 'react';
import { RefreshCw, Sparkles, Lock } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { authFetch } from '@/lib/authFetch';
import type { PlannerFormValues } from '@/components/PlannerForm';
import type { PlanDocument } from '../types';
import { RevisionReasonModal, type RevisionReasonPayload } from './RevisionReasonModal';
import { writePlannerRevisionSnapshot } from '@/pages/PlannerPage/lib/plannerRevisionSnapshot';

// 2026-08-24 (planner-intent-v1 §3): the FULL safe brief for "다시 만들기",
// keyed to this specific plan (writePlannerRevisionSnapshot binds it to
// `planId`) — PlannerPage/Wizard reads it once and prefers it over the
// legacy URL query params below, which stay only as a fallback for an old
// shared link. Extracted defensively: `plan.input` shape varies across plan
// generations (legacy vs enriched), so every read is a typeof-guarded
// fallback chain, never a direct cast.
function extractPlannerValuesFromPlan(plan: PlanDocument): Partial<PlannerFormValues> {
  const inp = (plan.input || {}) as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
  const arr = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : undefined;
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const map = (v: unknown): Record<string, string> | undefined =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : undefined;

  const days = plan.itinerary?.days;
  const lastDay = Array.isArray(days) && days.length ? days[days.length - 1] : null;

  const values: Partial<PlannerFormValues> = {
    regions: arr(inp.regions),
    cityKey: str(inp.cityKey),
    cityKeys: arr(inp.cityKeys),
    startDate: str(inp.startDate),
    endDate: str(inp.endDate) || (lastDay ? str(lastDay.date) : undefined),
    // Bug fix (planner-intent-v1 §3): the request body forwards `styles`,
    // never `categories` — reading `inp.categories` here always missed.
    categories: arr(inp.styles) || arr(inp.categories),
    pax: num(inp.pax) || num(inp.adults),
    arrival_airport: str(inp.arrival_airport),
    departure_airport: str(inp.departure_airport),
    arrival_time: str(inp.arrivalTime) || str(inp.arrival_time),
    departure_time: str(inp.departureTime) || str(inp.departure_time),
    tour_start_time: str(inp.tourStartTime) || str(inp.tour_start_time),
    tour_end_time: str(inp.tourEndTime) || str(inp.tour_end_time),
    hotel_address: str(inp.hotel_address),
    hotelByCity: map(inp.hotelByCity),
    recommended_zone: str(inp.recommended_zone),
    recommended_zones: map(inp.recommended_zones),
    arrival_city: str(inp.arrival_city),
    departure_city: str(inp.departure_city),
    entry_city: str(inp.entry_city),
    reservation_status: str(inp.reservation_status) as PlannerFormValues['reservation_status'],
    tourPace: str(inp.tourPace),
    dietPrefs: arr(inp.dietPrefs),
    priceRange: str(inp.priceRange),
    spiceLevel: str(inp.spiceLevel),
    bucketDishes: arr(inp.bucketDishes),
    companions: str(inp.companions),
    wantAccom: typeof inp.wantAccom === 'boolean' ? inp.wantAccom : undefined,
    accomBudget: str(inp.accomBudget),
    // Bug fix (planner-intent-v1 §3): Firestore persists this as
    // `specialRequest` (camelCase — see PlanDocument.input) — `inp.freeText`
    // was never the actual field, so the free-text brief was always dropped.
    freeText: str(inp.specialRequest) || str(inp.freeText) || str(inp.special_request),
  };
  if (inp.luggage && typeof inp.luggage === 'object') {
    const l = inp.luggage as { small?: unknown; medium?: unknown; large?: unknown };
    values.luggage = { small: Number(l.small) || 0, medium: Number(l.medium) || 0, large: Number(l.large) || 0 };
  }
  // dietaryRestrictions: canonical field wins; legacy `allergies` is
  // migrated elsewhere in this file already (Halal/Vegan/Vegetarian only) —
  // writePlannerRevisionSnapshot's own sanitizer re-filters regardless.
  const dietaryRestrictionsRaw = arr(inp.dietaryRestrictions);
  if (dietaryRestrictionsRaw) values.dietaryRestrictions = dietaryRestrictionsRaw;
  return values;
}

interface RevisionCardProps {
  plan: PlanDocument;
  planId: string;
  token: string | null;
}

// 4-lang i18n for exhausted state
const EXHAUSTED_LABELS: Record<'ko' | 'en' | 'ja' | 'zh', { title: string; desc: string; wa: string }> = {
  ko: {
    title: '무료 재생성 모두 사용됨',
    desc: '추가 재생성은 WhatsApp으로 문의해주세요.',
    wa: 'WhatsApp 문의',
  },
  en: {
    title: 'Free Revisions Used Up',
    desc: 'All free regenerations have been used. Contact us via WhatsApp for more.',
    wa: 'Contact via WhatsApp',
  },
  ja: {
    title: '無料再生成回数を使い切りました',
    desc: '追加の再生成はWhatsAppでお問い合わせください。',
    wa: 'WhatsAppで問い合わせ',
  },
  zh: {
    title: '免费重新生成次数已用完',
    desc: '如需额外重新生成，请通过WhatsApp联系我们。',
    wa: 'WhatsApp联系',
  },
};

export function RevisionCard({ plan, planId, token }: RevisionCardProps) {
  // `?? 0` instead of `|| 0`: revisionCredits=0 is falsy, but 0 is a valid exhausted state.
  // Old `|| 0` caused: plan with credits=0 → treated same as credits=undefined → card hidden
  // with no explanation. Now we show the exhausted-state card when credits===0 explicitly.
  const credits = (plan.revisionCredits as number) ?? 0;
  const { language } = useLanguage();
  const [modalOpen, setModalOpen] = useState(false);

  // 진단 로그: modalOpen 변화 추적. 운영자가 사용자 콘솔로그 받을 때 정확한 상태 파악 가능.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line no-console
      console.log('[RevisionCard] modalOpen state:', modalOpen, '| credits:', credits);
    }
  }, [modalOpen, credits]);

  if (!plan) return null;

  // Exhausted state — revisionCredits is exactly 0 (not undefined/null which would also be 0 via ??)
  // Only show exhausted card if plan.revisionCredits was explicitly set (i.e. plan paid & used up)
  const creditsExplicitlySet = typeof plan.revisionCredits === 'number';
  if (credits <= 0) {
    // If revisionCredits was never set (undefined), don't show anything (legacy plans)
    if (!creditsExplicitlySet) return null;
    // Show exhausted-state card
    const lang = (['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as 'ko' | 'en' | 'ja' | 'zh';
    const L = EXHAUSTED_LABELS[lang];
    return (
      <div className="mt-8 rounded-2xl overflow-hidden border border-white/10"
        style={{ background: 'rgba(255,255,255,0.03)' }}>
        <div className="px-5 py-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Lock className="w-4 h-4 text-white/40" />
            <h3 className="text-sm font-semibold text-white/60">{L.title}</h3>
          </div>
          <p className="text-white/40 text-[14px] mb-3">{L.desc}</p>
          <a
            href="https://wa.me/821087140611"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[14px] font-semibold text-white/70 border border-white/10 hover:bg-white/[0.06] transition-all min-h-[44px]"
          >
            {L.wa}
          </a>
        </div>
      </div>
    );
  }

  const handleSubmit = (payload: RevisionReasonPayload | null) => {
    setModalOpen(false);

    const hasContent = payload && (
      (payload.reasons && payload.reasons.length > 0) ||
      (payload.customNote && payload.customNote.length > 0)
    );

    // Best-effort fire-and-forget: 서버 API 경유 로깅(Admin SDK, rules 우회). 재생성 흐름 무차단.
    // 이전엔 클라 SDK 직접 write 2개[plans.revisionReasons updateDoc + plan_complaints addDoc]를
    // 했으나, plans update allowlist(revisionReasons 미포함) + plan_complaints 룰 부재(catch-all
    // deny)로 둘 다 silent 거부되어 분석 데이터가 전부 손실됐다 → log-revision-reason 엔드포인트로 라우팅.
    if (hasContent && planId) {
      const { reasons, customNote } = payload!;
      const reasonStr = (reasons && reasons.length > 0) ? reasons.join(',') : 'other';
      authFetch('/api/log-revision-reason', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, reason: reasonStr, freeText: customNote || '', language }),
      }).catch((err) => {
        console.warn('[RevisionCard] revision reason log failed (non-fatal):', err?.message || err);
      });
    }

    // Build URL params — collect all previous stop names for server-side avoid logic.
    const allStopNames: string[] = [];
    for (const day of (plan.itinerary?.days || [])) {
      for (const stop of (day.stops || [])) {
        if (stop.name) allStopNames.push(stop.name);
      }
    }
    const avoidListStr = allStopNames.slice(0, 30).join(',');

    const reasonParam = payload?.reasons?.join(',') || '';
    const noteParam = payload?.customNote || '';

    // 2026-08-24 (planner-intent-v1 §3): write the FULL safe brief, bound to
    // this planId, before navigating — PlannerPage/Wizard prefers this over
    // the legacy URL params below (which stay only as a fallback).
    if (planId) {
      writePlannerRevisionSnapshot(planId, extractPlannerValuesFromPlan(plan), {
        reasonCodes: payload?.reasons || [],
        note: noteParam,
        avoidStopNames: allStopNames,
      });
    }

    // 2026-05-09 (B9-37): plan.input 핵심 필드를 URL prefill 로 직렬화 — 사용자
    // 신고 "다시 만들기 시 form 데이터 prefill 안 됨 (비행기/시간/날짜 매번 재입력)".
    // PlannerPage 가 useSearchParams 에서 추출 → WizardForm initialValues 로 주입.
    // 미직렬 필드 (luggage 개수 등) 는 사용자가 그대로 두면 기본값 유지.
    const inp = plan.input || {};
    const prefillEntries: Record<string, string> = {};
    const setIfStr = (k: string, v: unknown) => {
      if (typeof v === 'string' && v.trim()) prefillEntries[k] = v;
    };
    const setIfNum = (k: string, v: unknown) => {
      if (typeof v === 'number' && Number.isFinite(v)) prefillEntries[k] = String(v);
    };
    const setIfArr = (k: string, v: unknown) => {
      if (Array.isArray(v) && v.length > 0) {
        const flat = v.filter((x): x is string => typeof x === 'string' && !!x).join(',');
        if (flat) prefillEntries[k] = flat;
      }
    };
    setIfStr('prefillStartDate', inp.startDate);
    setIfStr('prefillEndDate', (inp as { endDate?: unknown }).endDate);
    setIfArr('prefillRegions', (inp as { regions?: unknown }).regions);
    // Bug fix (planner-intent-v1 §3): the request body forwards `styles`,
    // never `categories` — this always read an absent field.
    setIfArr('prefillCategories', (inp as { styles?: unknown }).styles || (inp as { categories?: unknown }).categories);
    setIfNum('prefillPax', inp.pax ?? inp.adults);
    setIfStr('prefillArrival', inp.arrival_airport);
    setIfStr('prefillHotel', inp.hotel_address);
    setIfArr('prefillDiet', (inp as { dietary?: unknown }).dietary ?? (inp as { dietPrefs?: unknown }).dietPrefs);
    // 2026-08-24 (allergy removal): 새 plan 은 input.dietaryRestrictions 에 저장된다.
    // 옛 plan(레거시)은 input.allergies 뿐 — Halal/Vegan/Vegetarian 만 승격해 prefill,
    // 남아 있을 수 있는 의료 알레르겐 값(Nuts/Shellfish/Gluten/Dairy)은 조용히 버린다.
    const dietaryRestrictionsRaw = (inp as { dietaryRestrictions?: unknown }).dietaryRestrictions;
    const legacyAllergiesRaw = (inp as { allergies?: unknown }).allergies;
    const dietaryRestrictionsForPrefill = Array.isArray(dietaryRestrictionsRaw)
      ? dietaryRestrictionsRaw
      : Array.isArray(legacyAllergiesRaw)
        ? legacyAllergiesRaw.filter((v): v is string => typeof v === 'string' && ['Halal', 'Vegan', 'Vegetarian'].includes(v))
        : undefined;
    setIfArr('prefillDietaryRestrictions', dietaryRestrictionsForPrefill);
    // Bug fix (planner-intent-v1 §3): Firestore persists this as
    // `specialRequest` (camelCase — PlanDocument.input) — `inp.freeText`
    // was never the actual field name, so this always read undefined.
    const freeTxtRaw = (inp as { specialRequest?: unknown; freeText?: unknown }).specialRequest
      || (inp as { specialRequest?: unknown; freeText?: unknown }).freeText;
    if (typeof freeTxtRaw === 'string' && freeTxtRaw.trim()) {
      prefillEntries['prefillFreeText'] = freeTxtRaw.slice(0, 200);
    }

    const params = new URLSearchParams({
      revision: 'true',
      planId: planId || '',
      ...(token ? { token } : {}),
      ...(reasonParam ? { revisionReason: reasonParam } : {}),
      ...(noteParam ? { revisionNote: noteParam } : {}),
      ...(avoidListStr ? { avoidList: avoidListStr } : {}),
      ...prefillEntries,
    });
    window.location.href = `/planner?${params.toString()}`;
  };

  const lang = (['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as 'ko' | 'en' | 'ja' | 'zh';

  const CARD_LABELS: Record<typeof lang, { title: string; desc: string; cta: string; remaining: (n: number) => string }> = {
    ko: {
      title: '다른 분위기로 바꿔볼까요?',
      desc: '100% 만족하지 못하셨나요? 이유를 알려주시면 완전히 새로운 일정을 만들어드려요.',
      cta: '다시 만들기',
      remaining: (n) => `무료 재생성 ${n}회 남음`,
    },
    en: {
      title: 'Want a different vibe?',
      desc: "Not 100% satisfied? Tell us why and we'll create a brand new itinerary.",
      cta: 'Edit & Regenerate',
      remaining: (n) => `${n} Free Revision${n > 1 ? 's' : ''} remaining`,
    },
    ja: {
      title: '違うプランを試しますか？',
      desc: '100%満足できませんでしたか？理由を教えていただければ、全く新しいプランを作ります。',
      cta: '再生成する',
      remaining: (n) => `無料再生成 残り${n}回`,
    },
    zh: {
      title: '想要不同风格的行程吗？',
      desc: '不完全满意？告诉我们原因，我们将为您创建全新行程。',
      cta: '重新生成',
      remaining: (n) => `剩余 ${n} 次免费重新生成`,
    },
  };
  const lbl = CARD_LABELS[lang];

  return (
    <>
      <div className="mt-8 rounded-2xl overflow-hidden border border-amber-500/20"
        style={{ background: 'linear-gradient(135deg, rgba(251,191,36,0.06), rgba(182,104,252,0.04))' }}>
        <div className="px-5 py-5 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Sparkles className="w-5 h-5 text-amber-400" />
            <h3 className="text-lg font-bold text-white">{lbl.title}</h3>
          </div>
          <p className="text-white/50 text-sm mb-1">{lbl.desc}</p>
          <p className="text-amber-400/80 text-[14px] font-semibold mb-4">
            {lbl.remaining(credits)}
          </p>
          <button
            type="button"
            onClick={(e) => {
              // ancestor (SwipeContainer / motion.div) 가 click 을 가로채는 경우 차단.
              e.preventDefault();
              e.stopPropagation();
              // eslint-disable-next-line no-console
              console.log('[RevisionCard] click | credits:', credits, '| modalOpen(prev):', modalOpen);
              // haptic feedback (모바일 사용자가 클릭 인지 — "안 눌림" 신고 대응).
              if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                try { navigator.vibrate(10); } catch { /* ignore */ }
              }
              setModalOpen(true);
            }}
            aria-label={lbl.cta}
            className="w-full min-h-[48px] py-3.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-95 relative z-[1]"
            style={{
              background: 'linear-gradient(135deg, #f59e0b, #B668FC)',
              boxShadow: '0 4px 20px rgba(245,158,11,0.25)',
              touchAction: 'manipulation',  // 더블탭 줌 무시 → 첫 탭 즉시 인식
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <RefreshCw className="w-4 h-4" />
            {lbl.cta}
          </button>
        </div>
      </div>

      <RevisionReasonModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
        language={lang}
      />
    </>
  );
}
