// PR-E SAFETY (2026-06-02): 트레킹/러닝 day 의 난이도·위험·부적합 화면 표시 (외국인 사고 예방).
// backend buildActivityMeta(blockMode.js)가 채운 day.activity_meta 를 사용자에게 노출.
// flag OFF / city_day day = activity_meta undefined → 부모가 falsy guard (미렌더, byte-identical).
// 2026-06-02: 컷오프(한라산 12:30) 전용 시간 배너 + 위험/부적합 4개국어. 미등록 토큰=humanize 폴백(미표시 금지).
// 라벨·헬퍼는 src/lib/activityMetaLabels (PDF pdfGenerator 와 SSOT 공유 — 번역 드리프트 방지).
import { AlertTriangle, Mountain, Footprints, Clock, TrendingUp, Ruler } from 'lucide-react';
import type { Language } from '@/i18n';
import type { ActivityMeta } from '@/types/plan';
import { DIFF_STYLE, T, DIFF_LABEL, HAZARD_LABEL, UNSUITABLE_LABEL, GEAR_LABEL, humanize, labelToken, isCutoff, parseCutoff } from '@/lib/activityMetaLabels';

const metric = 'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[12px] text-white/60 bg-white/[0.05] border border-white/[0.08]';

export function ActivityMetaChips({ meta, language }: { meta: ActivityMeta; language: Language }) {
  if (!meta || (meta.activity_type !== 'trekking' && meta.activity_type !== 'running_route')) return null;
  const t = T[language] || T.en;
  const dl = DIFF_LABEL[language] || DIFF_LABEL.en;
  const diff = meta.difficulty ? String(meta.difficulty).toLowerCase() : '';
  const ds = DIFF_STYLE[diff] || { color: '#9ca3af', bg: 'rgba(156,163,175,0.12)' };
  const Icon = meta.activity_type === 'trekking' ? Mountain : Footprints;
  const hours = typeof meta.estimated_duration_min === 'number' ? Math.round((meta.estimated_duration_min / 60) * 10) / 10 : null;

  // 컷오프(시간 통과 제한)는 일반 위험 칩에서 분리해 전용 시간 배너로 — humanize 된 깨진 영어 방지.
  const allHazards = Array.isArray(meta.hazards) ? meta.hazards : [];
  const cutoffs = allHazards.filter(isCutoff);
  const regularHazards = allHazards.filter((h) => !isCutoff(h));

  return (
    <div className="mt-2 space-y-2" data-testid="activity-meta">
      {/* 활동 + 난이도 + 메트릭 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[13px] font-semibold"
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

      {/* 부적합 경고 배너 (SAFETY — 가장 눈에 띄게, 4개국어) */}
      {Array.isArray(meta.unsuitable_for) && meta.unsuitable_for.length > 0 && (
        <div className="flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px]"
          style={{ background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.3)' }}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: '#f87171' }} />
          <span className="text-red-300"><b>{t.notFor}:</b> {meta.unsuitable_for.map((u) => labelToken(UNSUITABLE_LABEL, u, language)).join(', ')}</span>
        </div>
      )}

      {/* 시간 통과 제한 전용 배너 (SAFETY — 예: 한라산 진달래밭 12:30. 깨진 영어 대신 시간 명시) */}
      {cutoffs.length > 0 && (
        <div className="flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px]"
          style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)' }}>
          <Clock className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: '#fbbf24' }} />
          <span className="text-amber-200">
            <b>{t.cutoff}:</b>{' '}
            {cutoffs.map((c, i) => {
              const { time, place } = parseCutoff(c);
              return <span key={c}>{i > 0 ? ' · ' : ''}{time ? `${time} ` : ''}{place}</span>;
            })}
          </span>
        </div>
      )}

      {/* 위험 요소 칩 (컷오프 제외, 4개국어) */}
      {regularHazards.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[12px] text-red-400/80 font-medium">{t.hazards}:</span>
          {regularHazards.map((h) => (
            <span key={h} className="rounded px-1.5 py-0.5 text-[12px] text-red-300 bg-red-500/10 border border-red-500/20">{labelToken(HAZARD_LABEL, h, language)}</span>
          ))}
        </div>
      )}

      {/* 준비물 칩 (advisory — 4개국어, 미등록 토큰은 humanize 폴백) */}
      {Array.isArray(meta.recommended_gear) && meta.recommended_gear.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[12px] text-white/50 font-medium">{t.gear}:</span>
          {meta.recommended_gear.map((g) => (
            <span key={g} className="rounded px-1.5 py-0.5 text-[12px] text-white/60 bg-white/[0.05] border border-white/[0.08]">{labelToken(GEAR_LABEL, g, language)}</span>
          ))}
        </div>
      )}

      {meta.requires_advance_booking && (
        <div className="text-[12px] text-amber-300/90">📅 {t.booking}</div>
      )}
    </div>
  );
}
