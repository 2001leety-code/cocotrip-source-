// P294 (2026-05-29): 사용자 UI quality_warnings 노출 panel.
//
// 배경 (5/29 핸드오프 큐 #3): QualityWarningsPanel 은 운영자 (isAdminEmail) 전용
//   amber 디버그 panel. 사용자 영향 있는 warnings (arrival_guide 자동 합성, 호텔
//   anchor 자동 추가, 공항 터미널 교정, 식이제한 안내 부족 등) 는 사용자에게 안내해야
//   "왜 plan 이 이렇게 나왔는지" 이해 + 신뢰 가능.
//
// 화이트리스트 설계 (운영자 박제):
//   - positive notices (자동 보완 — 사용자 안내 OK) 만 노출
//   - severity 'critical' 회피 (Gemini retry 후 silent fail = 운영자 escalation 영역)
//   - 디자인 SSOT: purple/pink gradient (admin amber 와 구분)
//   - i18n 4lang (ko/en/ja/zh) — CLAUDE.md J 박제
//
// 운영자 박제 lesson 적용:
//   - 한국어 라벨 우선 (외국인 VIP 사용자 = 영어 default, ko/ja/zh 도 동시 지원)
//   - 디자인 SSOT 색상 토큰 (purple-500 / pink-500 gradient)
import { useState } from 'react';
import { Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';

/**
 * 사용자에게 노출할 quality_warning kind 화이트리스트.
 *
 * 안전 기준:
 *   - 사용자가 "왜 plan 이 이렇게 나왔는지" 이해 도움
 *   - silent fail (운영자 영역) 또는 internal validator (debug) 는 제외
 *   - severity 'critical' (Gemini retry trigger) 는 제외 (admin escalation 영역)
 *
 * 회귀 시: USER_VISIBLE_KINDS 에 신규 kind 추가 시 → i18n 4lang text 동시 추가 의무.
 */
export const USER_VISIBLE_KINDS: Record<string, string> = {
  arrival_guide_self_healed: 'arrivalGuideSelfHealed',
  lodging_bookend_self_healed: 'lodgingBookendSelfHealed',
  cross_city_lodging_corrected: 'crossCityLodgingCorrected',
  arrival_airport_overridden: 'arrivalAirportOverridden',
  departure_airport_overridden: 'departureAirportOverridden',
  dietary_coverage_low: 'dietaryCoverageLow',
  daily_budget_self_healed: 'dailyBudgetSelfHealed',
};

interface QualityWarningLike {
  type?: string;
  kind?: string;
  message?: string;
  severity?: string;
  // P-launch (2026-05-31): block_mode 정상 lodging bookend 추가 표시 (손님 패널 suppress 용).
  expected_block_mode?: boolean;
  [key: string]: unknown;
}

interface Props {
  qualityWarnings: QualityWarningLike[] | undefined | null;
}

export function UserPlanNoticesPanel({ qualityWarnings }: Props) {
  const [open, setOpen] = useState(false);
  const { t } = useLanguage();

  const warnings = Array.isArray(qualityWarnings) ? qualityWarnings : [];
  // 화이트리스트 필터 — type 또는 kind 매칭. severity='critical' 제외.
  const visible = warnings.filter((w) => {
    const k = String(w?.type || w?.kind || '');
    if (!USER_VISIBLE_KINDS[k]) return false;
    if (w?.severity === 'critical') return false;
    // P-launch (2026-05-31): block_mode 는 zone_courses 블록에 lodging 이 없어 호텔 bookend
    //   추가가 정상 동작 → 손님에게 노이즈(plan a8b96f91 5일 10건). 손님 패널에서만 숨김.
    //   관리자 패널(QualityWarningsPanel)엔 유지 + legacy plan 진짜 누락(flag 없음)은 노출.
    if (k === 'lodging_bookend_self_healed' && w?.expected_block_mode === true) return false;
    return true;
  });
  if (visible.length === 0) return null;

  // i18n fallback chain — translations 미로드 시 한국어 default.
  const noticesT = (t as { planDetail?: { notices?: Record<string, string> } })?.planDetail?.notices;
  const title = noticesT?.title || '플랜 자동 보정 안내';
  const subtitle = noticesT?.subtitle || 'AI 가 입력 정보를 바탕으로 자동 보완한 항목입니다.';
  const countSuffix = noticesT?.countSuffix || '건';

  return (
    <div
      className="max-w-4xl mx-auto px-4 mt-8"
      data-testid="user-plan-notices-panel"
    >
      <div className="rounded-2xl border border-purple-400/20 bg-gradient-to-br from-purple-500/[0.06] to-pink-500/[0.04] p-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-2 text-left"
          aria-expanded={open}
        >
          <span className="flex items-center gap-2 text-purple-200">
            <Sparkles className="w-4 h-4 shrink-0" />
            <span className="text-sm font-bold">{title}</span>
            <span className="text-xs text-purple-200/70">
              · {visible.length} {countSuffix}
            </span>
          </span>
          {open ? (
            <ChevronUp className="w-4 h-4 text-purple-200 shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-purple-200 shrink-0" />
          )}
        </button>

        {open && (
          <div className="mt-3 space-y-2">
            <div className="text-xs text-white/55 mb-2">{subtitle}</div>
            {visible.map((w, i) => {
              const k = String(w?.type || w?.kind || '');
              const labelKey = USER_VISIBLE_KINDS[k];
              const label = (noticesT?.[labelKey] as string | undefined) || k;
              return (
                <div
                  key={i}
                  className="rounded-lg bg-white/[0.04] border border-white/8 p-2.5 text-xs text-white/80 flex items-start gap-2"
                >
                  <span className="text-purple-300 shrink-0">•</span>
                  <span>{label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
