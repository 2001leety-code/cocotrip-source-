// PR-E SAFETY (2026-06-02): 트레킹/러닝 day 의 난이도·위험·부적합 화면 표시 (외국인 사고 예방).
// backend buildActivityMeta(blockMode.js)가 채운 day.activity_meta 를 사용자에게 노출.
// flag OFF / city_day day = activity_meta undefined → 부모가 falsy guard (미렌더, byte-identical).
// 2026-06-02: 컷오프(한라산 12:30) 전용 시간 배너 + 위험/부적합 4개국어. 미등록 토큰=humanize 폴백(미표시 금지).
// 라벨·헬퍼는 src/lib/activityMetaLabels (PDF pdfGenerator 와 SSOT 공유 — 번역 드리프트 방지).
import { AlertTriangle, Mountain, Footprints, Clock, TrendingUp, Ruler } from 'lucide-react';
import type { Language } from '@/i18n';
import type { ActivityMeta } from '@/types/plan';
import { T, DIFF_LABEL, HAZARD_LABEL, UNSUITABLE_LABEL, GEAR_LABEL, humanize, labelToken, isCutoff, parseCutoff } from '@/lib/activityMetaLabels';

const metric = 'ec-chip inline-flex items-center gap-1 text-[12px]';

export function ActivityMetaChips({ meta, language }: { meta: ActivityMeta; language: Language }) {
  if (!meta || (meta.activity_type !== 'trekking' && meta.activity_type !== 'running_route')) return null;
  const t = T[language] || T.en;
  const dl = DIFF_LABEL[language] || DIFF_LABEL.en;
  const diff = meta.difficulty ? String(meta.difficulty).toLowerCase() : '';
  const difficultyTone = diff === 'easy' || diff === 'beginner'
    ? 'text-ec-success'
    : diff === 'moderate' || diff === 'intermediate'
      ? 'text-ec-notice'
      : diff
        ? 'text-ec-critical'
        : 'text-ec-ink-2';
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
        <span className={`ec-chip inline-flex items-center gap-1 text-[13px] font-semibold ${difficultyTone}`}>
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
        <div className="flex items-start gap-1.5 border-l-2 border-ec-critical bg-ec-sunken px-2.5 py-1.5 text-[13px]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ec-critical" aria-hidden />
          <span className="text-ec-critical"><b>{t.notFor}:</b> {meta.unsuitable_for.map((u) => labelToken(UNSUITABLE_LABEL, u, language)).join(', ')}</span>
        </div>
      )}

      {/* 시간 통과 제한 전용 배너 (SAFETY — 예: 한라산 진달래밭 12:30. 깨진 영어 대신 시간 명시) */}
      {cutoffs.length > 0 && (
        <div className="flex items-start gap-1.5 border-l-2 border-ec-notice bg-ec-sunken px-2.5 py-1.5 text-[13px]">
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ec-notice" aria-hidden />
          <span className="text-ec-notice">
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
          <span className="text-[12px] font-medium text-ec-critical">{t.hazards}:</span>
          {regularHazards.map((h) => (
            <span key={h} className="rounded-ec-sm border border-ec-line bg-ec-sunken px-2 py-1 text-[12px] text-ec-critical">{labelToken(HAZARD_LABEL, h, language)}</span>
          ))}
        </div>
      )}

      {/* 준비물 칩 (advisory — 4개국어, 미등록 토큰은 humanize 폴백) */}
      {Array.isArray(meta.recommended_gear) && meta.recommended_gear.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[12px] font-medium text-ec-ink-2">{t.gear}:</span>
          {meta.recommended_gear.map((g) => (
            <span key={g} className="rounded-ec-sm border border-ec-line bg-ec-raised px-2 py-1 text-[12px] text-ec-ink-2">{labelToken(GEAR_LABEL, g, language)}</span>
          ))}
        </div>
      )}

      {meta.requires_advance_booking && (
        <div className="text-[12px] text-ec-notice">📅 {t.booking}</div>
      )}
    </div>
  );
}
