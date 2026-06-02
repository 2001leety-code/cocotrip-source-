// PR-E SAFETY (2026-06-02): 트레킹/러닝 day 의 난이도·위험·부적합 화면 표시 (외국인 사고 예방).
// backend buildActivityMeta(blockMode.js)가 채운 day.activity_meta 를 사용자에게 노출. 그동안
// admin 패널(TrekkingMetaTab)에만 있고 사용자 plan 화면엔 미렌더였음 (plan.ts 타입도 없었음).
// flag OFF / city_day day = activity_meta undefined → 부모가 falsy guard (미렌더, byte-identical).
// 2026-06-02 잔여 SAFETY: 컷오프(예: 한라산 12:30 진달래밭)를 전용 시간 배너로 분리 + 위험/부적합 4개국어.
//   미등록 토큰은 humanize 폴백 — 라벨 없다고 위험을 절대 숨기지 않음(미표시 금지).
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
  ko: { difficulty: '난이도', notFor: '부적합', hazards: '주의', gear: '준비물', trekking: '트레킹/등산', running_route: '러닝 코스', booking: '사전 예약 필요', cutoff: '시간 통과 제한' },
  en: { difficulty: 'Difficulty', notFor: 'Not suitable for', hazards: 'Caution', gear: 'Bring', trekking: 'Hiking', running_route: 'Running', booking: 'Advance booking required', cutoff: 'Time cutoff' },
  ja: { difficulty: '難易度', notFor: '不適合', hazards: '注意', gear: '持ち物', trekking: 'トレッキング', running_route: 'ランニング', booking: '事前予約必要', cutoff: '通過時間制限' },
  zh: { difficulty: '难度', notFor: '不适合', hazards: '注意', gear: '装备', trekking: '徒步', running_route: '跑步', booking: '需提前预订', cutoff: '通过时间限制' },
};

// 난이도 값 4-lang (SAFETY).
const DIFF_LABEL: Record<Language, Record<string, string>> = {
  ko: { easy: '쉬움', beginner: '초보', moderate: '보통', intermediate: '중급', hard: '어려움', advanced: '상급', expert: '전문가' },
  en: { easy: 'Easy', beginner: 'Beginner', moderate: 'Moderate', intermediate: 'Intermediate', hard: 'Hard', advanced: 'Advanced', expert: 'Expert' },
  ja: { easy: '初級', beginner: '初心者', moderate: '中級', intermediate: '中級', hard: '上級', advanced: '上級', expert: '専門' },
  zh: { easy: '简单', beginner: '初级', moderate: '中等', intermediate: '中级', hard: '困难', advanced: '高级', expert: '专业' },
};

// 위험 요소 토큰 4-lang (SAFETY). 미등록 토큰은 humanize 폴백.
const HAZARD_LABEL: Record<Language, Record<string, string>> = {
  ko: { high_altitude_weather_change: '고산 날씨 급변', no_water_above_4km: '4km 이후 식수 없음', snow_winter: '겨울 적설', icy_winter: '겨울 빙판', fog_visibility_drop: '안개·시야 저하', steep_rock_climb: '가파른 암벽', iron_railing_section: '철제 난간 구간', falling_rock: '낙석', summer_heatstroke: '여름 온열질환', no_cellular_signal: '통신 두절 구간', sudden_weather_change: '날씨 급변', river_crossing: '하천 도하', wild_animal: '야생동물', weekend_overcrowding: '주말 혼잡' },
  en: { high_altitude_weather_change: 'Sudden alpine weather', no_water_above_4km: 'No water past 4km', snow_winter: 'Winter snow', icy_winter: 'Icy in winter', fog_visibility_drop: 'Fog / low visibility', steep_rock_climb: 'Steep rock climb', iron_railing_section: 'Iron-railing section', falling_rock: 'Falling rocks', summer_heatstroke: 'Summer heat risk', no_cellular_signal: 'No phone signal', sudden_weather_change: 'Sudden weather change', river_crossing: 'River crossing', wild_animal: 'Wildlife', weekend_overcrowding: 'Weekend crowds' },
  ja: { high_altitude_weather_change: '高山の急な天候変化', no_water_above_4km: '4km以降水場なし', snow_winter: '冬季積雪', icy_winter: '冬季の凍結', fog_visibility_drop: '霧・視界低下', steep_rock_climb: '急な岩場', iron_railing_section: '鉄製手すり区間', falling_rock: '落石', summer_heatstroke: '夏の熱中症', no_cellular_signal: '圏外区間', sudden_weather_change: '急な天候変化', river_crossing: '渡渉', wild_animal: '野生動物', weekend_overcrowding: '週末の混雑' },
  zh: { high_altitude_weather_change: '高山天气突变', no_water_above_4km: '4km后无补水', snow_winter: '冬季积雪', icy_winter: '冬季结冰', fog_visibility_drop: '雾·能见度下降', steep_rock_climb: '陡峭岩壁', iron_railing_section: '铁栏杆路段', falling_rock: '落石', summer_heatstroke: '夏季中暑', no_cellular_signal: '无手机信号', sudden_weather_change: '天气突变', river_crossing: '涉水过河', wild_animal: '野生动物', weekend_overcrowding: '周末拥挤' },
};

// 부적합 대상 토큰 4-lang (SAFETY 최고 — 절대 누락 금지).
const UNSUITABLE_LABEL: Record<Language, Record<string, string>> = {
  ko: { wheelchair_user: '휠체어 이용자', elderly: '노약자', young_children: '어린이', altitude_sensitive: '고산증 민감자', winter_first_time: '겨울 초보자', pregnant: '임산부', heart_condition: '심장질환자' },
  en: { wheelchair_user: 'Wheelchair users', elderly: 'Elderly', young_children: 'Young children', altitude_sensitive: 'Altitude-sensitive', winter_first_time: 'Winter first-timers', pregnant: 'Pregnant', heart_condition: 'Heart conditions' },
  ja: { wheelchair_user: '車椅子利用者', elderly: '高齢者', young_children: '幼児', altitude_sensitive: '高山病に敏感な方', winter_first_time: '冬山初心者', pregnant: '妊婦', heart_condition: '心臓疾患のある方' },
  zh: { wheelchair_user: '轮椅使用者', elderly: '老年人', young_children: '幼童', altitude_sensitive: '高原反应敏感者', winter_first_time: '冬季初次者', pregnant: '孕妇', heart_condition: '心脏病患者' },
};

// hazards/gear/unsuitable 값(snake_case, zone_courses 동적) humanize 폴백 — 라벨 미등록이어도 항상 표시.
const humanize = (s: string) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const labelToken = (map: Record<Language, Record<string, string>>, token: string, lang: Language): string =>
  (map[lang] && map[lang][token]) || (map.en && map.en[token]) || humanize(token);

// 컷오프 토큰 (예: 12_30_pm_cutoff_at_jindallae) → 시간 + 장소 추출. 안 잡히면 humanize 폴백(미표시 금지).
const isCutoff = (tok: string) => /cutoff|deadline|_pm_|_am_|_pm$|_am$/i.test(tok);
function parseCutoff(tok: string): { time: string | null; place: string } {
  const m = tok.match(/(\d{1,2})_?(\d{2})_(am|pm)/i);
  const time = m ? `${m[1].padStart(2, '0')}:${m[2]} ${m[3].toUpperCase()}` : null;
  const locM = tok.match(/cutoff_at_(.+)$/i) || tok.match(/at_(.+)$/i);
  return { time, place: locM ? humanize(locM[1]) : humanize(tok) };
}

const metric = 'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] text-white/60 bg-white/[0.05] border border-white/[0.08]';

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

      {/* 부적합 경고 배너 (SAFETY — 가장 눈에 띄게, 4개국어) */}
      {Array.isArray(meta.unsuitable_for) && meta.unsuitable_for.length > 0 && (
        <div className="flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px]"
          style={{ background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.3)' }}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: '#f87171' }} />
          <span className="text-red-300"><b>{t.notFor}:</b> {meta.unsuitable_for.map((u) => labelToken(UNSUITABLE_LABEL, u, language)).join(', ')}</span>
        </div>
      )}

      {/* 시간 통과 제한 전용 배너 (SAFETY — 예: 한라산 진달래밭 12:30. 깨진 영어 대신 시간 명시) */}
      {cutoffs.length > 0 && (
        <div className="flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px]"
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
          <span className="text-[10px] text-red-400/80 font-medium">{t.hazards}:</span>
          {regularHazards.map((h) => (
            <span key={h} className="rounded px-1.5 py-0.5 text-[10px] text-red-300 bg-red-500/10 border border-red-500/20">{labelToken(HAZARD_LABEL, h, language)}</span>
          ))}
        </div>
      )}

      {/* 준비물 칩 (advisory — humanize 폴백) */}
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
