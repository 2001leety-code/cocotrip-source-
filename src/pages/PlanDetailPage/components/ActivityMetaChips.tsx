// PR-E SAFETY (2026-06-02): 트레킹/러닝 day 의 난이도·위험·부적합 화면 표시 (외국인 사고 예방).
// backend buildActivityMeta(blockMode.js)가 채운 day.activity_meta 를 사용자에게 노출. 그동안
// admin 패널(TrekkingMetaTab)에만 있고 사용자 plan 화면엔 미렌더였음 (plan.ts 타입도 없었음).
// flag OFF / city_day day = activity_meta undefined → 부모가 falsy guard (미렌더, byte-identical).
import { AlertTriangle, Mountain, Footprints, Clock, TrendingUp, Ruler } from 'lucide-react';
import type { Language } from '@/i18n';
import type { ActivityMeta } from '@/types/plan';

// 난이도 색상 (AllTrails/한산 패턴: 초록→노랑→주황→빨강). 위험 강조 (SAFETY).
const DIFF_STYLE: Record<string, { color: string; bg: string }> = {
  easy: { color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  beginner: { color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  moderate: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  intermediate: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  hard: { color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
  advanced: { color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
  expert: { color: '#dc2626', bg: 'rgba(220,38,38,0.14)' },
};

// 헤더/공통 라벨 4-lang (SAFETY 핵심은 4lang 의무).
const T: Record<Language, Record<string, string>> = {
  ko: { difficulty: '난이도', notFor: '부적합', hazards: '주의', gear: '준비물', trekking: '트레킹/등산', running_route: '러닝 코스', booking: '사전 예약 필요' },
  en: { difficulty: 'Difficulty', notFor: 'Not suitable for', hazards: 'Caution', gear: 'Bring', trekking: 'Hiking', running_route: 'Running', booking: 'Advance booking required' },
  ja: { difficulty: '難易度', notFor: '不適合', hazards: '注意', gear: '持ち物', trekking: 'トレッキング', running_route: 'ランニング', booking: '事前予約必要' },
  zh: { difficulty: '难度', notFor: '不适合', hazards: '注意', gear: '装备', trekking: '徒步', running_route: '跑步', booking: '需提前预订' },
};

// 난이도 값 4-lang (SAFETY).
const DIFF_LABEL: Record<Language, Record<string, string>> = {
  ko: { easy: '쉬움', beginner: '초보', moderate: '보통', intermediate: '중급', hard: '어려움', advanced: '상급', expert: '전문가' },
  en: { easy: 'Easy', beginner: 'Beginner', moderate: 'Moderate', intermediate: 'Intermediate', hard: 'Hard', advanced: 'Advanced', expert: 'Expert' },
  ja: { easy: '初級', beginner: '初心者', moderate: '中級', intermediate: '中級', hard: '上級', advanced: '上級', expert: '専門' },
  zh: { easy: '简单', beginner: '初级', moderate: '中等', intermediate: '中级', hard: '困难', advanced: '高级', expert: '专业' },
};

// hazards/gear/unsuitable 값(snake_case, zone_courses 동적)은 humanize 폴백 (주요 값 i18n 은 후속).
const humanize = (s: string) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const metric = 'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] text-white/60 bg-white/[0.05] border border-white/[0.08]';

export function ActivityMetaChips({ meta, language }: { meta: ActivityMeta; language: Language }) {
  if (!meta || (meta.activity_type !== 'trekking' && meta.activity_type !== 'running_route')) return null;
  const t = T[language] || T.en;
  const dl = DIFF_LABEL[language] || DIFF_LABEL.en;
  const diff = meta.difficulty ? String(meta.difficulty).toLowerCase() : '';
  const ds = DIFF_STYLE[diff] || { color: '#9ca3af', bg: 'rgba(156,163,175,0.12)' };
  const Icon = meta.activity_type === 'trekking' ? Mountain : Footprints;
  const hours = typeof meta.estimated_duration_min === 'number' ? Math.round((meta.estimated_duration_min / 60) * 10) / 10 : null;

  return (
    <div className="mt-2 space-y-2" data-testid="activity-meta">
      {/* 활동 + 난이도 + 메트릭 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
          style={{ color: ds.color, background: ds.bg, border: `1px solid ${ds.color}33` }}>
          <Icon className="w-3 h-3" />
          {t[meta.activity_type]}{meta.difficulty ? ` · ${t.difficulty} ${dl[diff] || humanize(meta.difficulty)}` : ''}
        </span>
        {typeof meta.distance_km === 'number' && (
          <span className={metric}><Ruler className="w-2.5 h-2.5" />{meta.distance_km}km</span>
        )}
        {typeof meta.elevation_gain_m === 'number' && (
          <span className={metric}><TrendingUp className="w-2.5 h-2.5" />{meta.elevation_gain_m}m</span>
        )}
        {hours != null && (
          <span className={metric}><Clock className="w-2.5 h-2.5" />{hours}h</span>
        )}
      </div>

      {/* 부적합 경고 배너 (SAFETY — 가장 눈에 띄게) */}
      {Array.isArray(meta.unsuitable_for) && meta.unsuitable_for.length > 0 && (
        <div className="flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px]"
          style={{ background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.3)' }}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: '#f87171' }} />
          <span className="text-red-300"><b>{t.notFor}:</b> {meta.unsuitable_for.map((u) => humanize(u)).join(', ')}</span>
        </div>
      )}

      {/* 위험 요소 칩 */}
      {Array.isArray(meta.hazards) && meta.hazards.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] text-red-400/80 font-medium">{t.hazards}:</span>
          {meta.hazards.map((h) => (
            <span key={h} className="rounded px-1.5 py-0.5 text-[10px] text-red-300 bg-red-500/10 border border-red-500/20">{humanize(h)}</span>
          ))}
        </div>
      )}

      {/* 준비물 칩 */}
      {Array.isArray(meta.recommended_gear) && meta.recommended_gear.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] text-white/50 font-medium">{t.gear}:</span>
          {meta.recommended_gear.map((g) => (
            <span key={g} className="rounded px-1.5 py-0.5 text-[10px] text-white/60 bg-white/[0.05] border border-white/[0.08]">{humanize(g)}</span>
          ))}
        </div>
      )}

      {meta.requires_advance_booking && (
        <div className="text-[10px] text-amber-300/90">📅 {t.booking}</div>
      )}
    </div>
  );
}
