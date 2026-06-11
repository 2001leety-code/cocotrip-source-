// 트레킹/러닝 activity_meta 라벨·헬퍼 SSOT (2026-06-02) — 화면(ActivityMetaChips.tsx)과 PDF(pdfGenerator.ts)
// 둘 다 사용. 두 곳에 4개국어 맵을 복제하면 드리프트(번역 불일치) 위험 → 단일 소스로 통합.
// SAFETY: 미등록 토큰은 humanize 폴백(라벨 없다고 위험/부적합 절대 숨김 금지). gear 는 advisory=humanize.
import type { Language } from '@/i18n';
import type { ActivityMeta } from '@/types/plan';

// 난이도 색상 (초록→노랑→주황→빨강). 위험 강조 (SAFETY).
export const DIFF_STYLE: Record<string, { color: string; bg: string }> = {
  easy: { color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  beginner: { color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  moderate: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  intermediate: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  hard: { color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
  advanced: { color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
  expert: { color: '#dc2626', bg: 'rgba(220,38,38,0.14)' },
};

// 헤더/공통 라벨 4-lang.
export const T: Record<Language, Record<string, string>> = {
  ko: { difficulty: '난이도', notFor: '부적합', hazards: '주의', gear: '준비물', trekking: '트레킹/등산', running_route: '러닝 코스', booking: '사전 예약 필요', cutoff: '시간 통과 제한' },
  en: { difficulty: 'Difficulty', notFor: 'Not suitable for', hazards: 'Caution', gear: 'Bring', trekking: 'Hiking', running_route: 'Running', booking: 'Advance booking required', cutoff: 'Time cutoff' },
  ja: { difficulty: '難易度', notFor: '不適合', hazards: '注意', gear: '持ち物', trekking: 'トレッキング', running_route: 'ランニング', booking: '事前予約必要', cutoff: '通過時間制限' },
  zh: { difficulty: '难度', notFor: '不适合', hazards: '注意', gear: '装备', trekking: '徒步', running_route: '跑步', booking: '需提前预订', cutoff: '通过时间限制' },
};

// 난이도 값 4-lang.
export const DIFF_LABEL: Record<Language, Record<string, string>> = {
  ko: { easy: '쉬움', beginner: '초보', moderate: '보통', intermediate: '중급', hard: '어려움', advanced: '상급', expert: '전문가' },
  en: { easy: 'Easy', beginner: 'Beginner', moderate: 'Moderate', intermediate: 'Intermediate', hard: 'Hard', advanced: 'Advanced', expert: 'Expert' },
  ja: { easy: '初級', beginner: '初心者', moderate: '中級', intermediate: '中級', hard: '上級', advanced: '上級', expert: '専門' },
  zh: { easy: '简单', beginner: '初级', moderate: '中等', intermediate: '中级', hard: '困难', advanced: '高级', expert: '专业' },
};

// 위험 요소 토큰 4-lang. 미등록은 humanize 폴백.
export const HAZARD_LABEL: Record<Language, Record<string, string>> = {
  ko: { high_altitude_weather_change: '고산 날씨 급변', no_water_above_4km: '4km 이후 식수 없음', snow_winter: '겨울 적설', icy_winter: '겨울 빙판', fog_visibility_drop: '안개·시야 저하', steep_rock_climb: '가파른 암벽', steep_iron_stairs: '급경사 철계단', iron_railing_section: '철제 난간 구간', falling_rock: '낙석', summer_heatstroke: '여름 온열질환', no_cellular_signal: '통신 두절 구간', sudden_weather_change: '날씨 급변', river_crossing: '하천 도하', wild_animal: '야생동물', weekend_overcrowding: '주말 혼잡', crowded_weekend: '주말 혼잡' },
  en: { high_altitude_weather_change: 'Sudden alpine weather', no_water_above_4km: 'No water past 4km', snow_winter: 'Winter snow', icy_winter: 'Icy in winter', fog_visibility_drop: 'Fog / low visibility', steep_rock_climb: 'Steep rock climb', steep_iron_stairs: 'Steep iron stairs', iron_railing_section: 'Iron-railing section', falling_rock: 'Falling rocks', summer_heatstroke: 'Summer heat risk', no_cellular_signal: 'No phone signal', sudden_weather_change: 'Sudden weather change', river_crossing: 'River crossing', wild_animal: 'Wildlife', weekend_overcrowding: 'Weekend crowds', crowded_weekend: 'Weekend crowds' },
  ja: { high_altitude_weather_change: '高山の急な天候変化', no_water_above_4km: '4km以降水場なし', snow_winter: '冬季積雪', icy_winter: '冬季の凍結', fog_visibility_drop: '霧・視界低下', steep_rock_climb: '急な岩場', steep_iron_stairs: '急な鉄階段', iron_railing_section: '鉄製手すり区間', falling_rock: '落石', summer_heatstroke: '夏の熱中症', no_cellular_signal: '圏外区間', sudden_weather_change: '急な天候変化', river_crossing: '渡渉', wild_animal: '野生動物', weekend_overcrowding: '週末の混雑', crowded_weekend: '週末の混雑' },
  zh: { high_altitude_weather_change: '高山天气突变', no_water_above_4km: '4km后无补水', snow_winter: '冬季积雪', icy_winter: '冬季结冰', fog_visibility_drop: '雾·能见度下降', steep_rock_climb: '陡峭岩壁', steep_iron_stairs: '陡峭铁梯', iron_railing_section: '铁栏杆路段', falling_rock: '落石', summer_heatstroke: '夏季中暑', no_cellular_signal: '无手机信号', sudden_weather_change: '天气突变', river_crossing: '涉水过河', wild_animal: '野生动物', weekend_overcrowding: '周末拥挤', crowded_weekend: '周末拥挤' },
};

// 부적합 대상 토큰 4-lang (SAFETY 최고 — 절대 누락 금지).
export const UNSUITABLE_LABEL: Record<Language, Record<string, string>> = {
  ko: { wheelchair_user: '휠체어 이용자', elderly: '노약자', young_children: '어린이', altitude_sensitive: '고산증 민감자', winter_first_time: '겨울 초보자', vertigo_sensitive: '고소공포증 민감자', pregnant: '임산부', heart_condition: '심장질환자', mobility_impaired: '거동 불편자', mobility_limited: '거동 제한자', senior_traveler: '고령 여행자', family_with_young_kids: '어린아이 동반 가족', claustrophobic: '폐소공포증 민감자', crowd_averse: '혼잡 기피자', budget_traveler: '저예산 여행자', vegan_only: '비건 전용 식단' },
  en: { wheelchair_user: 'Wheelchair users', elderly: 'Elderly', young_children: 'Young children', altitude_sensitive: 'Altitude-sensitive', winter_first_time: 'Winter first-timers', vertigo_sensitive: 'Vertigo-sensitive', pregnant: 'Pregnant', heart_condition: 'Heart conditions', mobility_impaired: 'Mobility-impaired', mobility_limited: 'Limited mobility', senior_traveler: 'Senior travelers', family_with_young_kids: 'Families with young kids', claustrophobic: 'Claustrophobic', crowd_averse: 'Crowd-averse', budget_traveler: 'Budget travelers', vegan_only: 'Vegan-only diets' },
  ja: { wheelchair_user: '車椅子利用者', elderly: '高齢者', young_children: '幼児', altitude_sensitive: '高山病に敏感な方', winter_first_time: '冬山初心者', vertigo_sensitive: '高所恐怖症の方', pregnant: '妊婦', heart_condition: '心臓疾患のある方', mobility_impaired: '歩行が困難な方', mobility_limited: '歩行に制限のある方', senior_traveler: '高齢の旅行者', family_with_young_kids: '小さな子供連れ家族', claustrophobic: '閉所恐怖症の方', crowd_averse: '混雑が苦手な方', budget_traveler: '低予算の旅行者', vegan_only: 'ビーガン専用の食事' },
  zh: { wheelchair_user: '轮椅使用者', elderly: '老年人', young_children: '幼童', altitude_sensitive: '高原反应敏感者', winter_first_time: '冬季初次者', vertigo_sensitive: '恐高者', pregnant: '孕妇', heart_condition: '心脏病患者', mobility_impaired: '行动不便者', mobility_limited: '行动受限者', senior_traveler: '年长旅客', family_with_young_kids: '带幼童的家庭', claustrophobic: '幽闭恐惧者', crowd_averse: '不喜拥挤者', budget_traveler: '低预算旅客', vegan_only: '纯素饮食者' },
};

// 준비물(장비) 토큰 4-lang. advisory 지만 외국인은 영어 token(예: 'crampons_winter')을 못 읽음
//  → humanize 로는 '겨울 아이젠' 같은 의미 전달 불가. 미등록 토큰은 humanize 폴백(미표시 금지).
export const GEAR_LABEL: Record<Language, Record<string, string>> = {
  ko: { trekking_pole: '등산 스틱', crampons_winter: '겨울 아이젠', headlamp: '헤드랜턴', rain_gear: '우비·비옷', wind_breaker: '바람막이', gloves: '장갑', hat: '모자', ankle_support_shoes: '발목 보호 등산화', water_1_5L: '식수 1.5L', water_2L: '식수 2L', sunscreen: '자외선 차단제', first_aid: '구급약', spare_socks: '여분 양말', thermal_layer: '보온 내의' },
  en: { trekking_pole: 'Trekking poles', crampons_winter: 'Winter crampons', headlamp: 'Headlamp', rain_gear: 'Rain gear', wind_breaker: 'Windbreaker', gloves: 'Gloves', hat: 'Hat', ankle_support_shoes: 'Ankle-support boots', water_1_5L: 'Water 1.5L', water_2L: 'Water 2L', sunscreen: 'Sunscreen', first_aid: 'First-aid kit', spare_socks: 'Spare socks', thermal_layer: 'Thermal layer' },
  ja: { trekking_pole: 'トレッキングポール', crampons_winter: '冬用アイゼン', headlamp: 'ヘッドランプ', rain_gear: 'レインウェア', wind_breaker: 'ウインドブレーカー', gloves: '手袋', hat: '帽子', ankle_support_shoes: '足首保護の登山靴', water_1_5L: '飲料水1.5L', water_2L: '飲料水2L', sunscreen: '日焼け止め', first_aid: '救急セット', spare_socks: '替えの靴下', thermal_layer: '防寒インナー' },
  zh: { trekking_pole: '登山杖', crampons_winter: '冬季冰爪', headlamp: '头灯', rain_gear: '雨具', wind_breaker: '防风外套', gloves: '手套', hat: '帽子', ankle_support_shoes: '护踝登山鞋', water_1_5L: '饮用水1.5L', water_2L: '饮用水2L', sunscreen: '防晒霜', first_aid: '急救包', spare_socks: '备用袜子', thermal_layer: '保暖内层' },
};

export const humanize = (s: string): string => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const labelToken = (map: Record<Language, Record<string, string>>, token: string, lang: Language): string =>
  (map[lang] && map[lang][token]) || (map.en && map.en[token]) || humanize(token);

// 컷오프 토큰 (예: 12_30_pm_cutoff_at_jindallae) → 시간 + 장소. 안 잡히면 humanize 폴백(미표시 금지).
export const isCutoff = (tok: string): boolean => /cutoff|deadline|_pm_|_am_|_pm$|_am$/i.test(tok);
export function parseCutoff(tok: string): { time: string | null; place: string } {
  const m = tok.match(/(\d{1,2})_?(\d{2})_(am|pm)/i);
  const time = m ? `${m[1].padStart(2, '0')}:${m[2]} ${m[3].toUpperCase()}` : null;
  const locM = tok.match(/cutoff_at_(.+)$/i) || tok.match(/at_(.+)$/i);
  return { time, place: locM ? humanize(locM[1]) : humanize(tok) };
}

// HTML escape (PDF 는 HTML 문자열 — zone_courses 동적 값 주입 시 XSS/깨짐 방어).
const esc = (s: string): string => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c));

/**
 * PDF용 activity_meta HTML 블록 (2026-06-02 SAFETY). 화면 ActivityMetaChips 와 동일 데이터·라벨.
 * 오프라인 등산객이 PDF 에서도 난이도·위험·부적합·컷오프를 봐야 함. activity_meta 없으면 '' (additive).
 */
export function buildActivityMetaHtml(meta: ActivityMeta | null | undefined, lang: Language): string {
  if (!meta || (meta.activity_type !== 'trekking' && meta.activity_type !== 'running_route')) return '';
  const t = T[lang] || T.en;
  const dl = DIFF_LABEL[lang] || DIFF_LABEL.en;
  const diff = meta.difficulty ? String(meta.difficulty).toLowerCase() : '';
  const ds = DIFF_STYLE[diff] || { color: '#9ca3af', bg: 'rgba(156,163,175,0.12)' };
  const rows: string[] = [];

  // 난이도 + 거리/고도 (1줄)
  const metaBits: string[] = [];
  if (meta.difficulty) metaBits.push(`<span style="color:${ds.color};font-weight:700;">${esc(t[meta.activity_type] || '')} · ${esc(t.difficulty)} ${esc(dl[diff] || humanize(meta.difficulty))}</span>`);
  else metaBits.push(`<span style="font-weight:700;">${esc(t[meta.activity_type] || '')}</span>`);
  if (typeof meta.distance_km === 'number') metaBits.push(`${meta.distance_km}km`);
  if (typeof meta.elevation_gain_m === 'number') metaBits.push(`↑${meta.elevation_gain_m}m`);
  rows.push(`<p style="font-size:10.5px;margin:0 0 4px;color:#374151;">${metaBits.join('  ·  ')}</p>`);

  // 부적합 배너 (SAFETY 최고 — 빨강)
  if (Array.isArray(meta.unsuitable_for) && meta.unsuitable_for.length > 0) {
    const list = meta.unsuitable_for.map((u) => esc(labelToken(UNSUITABLE_LABEL, u, lang))).join(', ');
    rows.push(`<p style="font-size:10px;margin:0 0 3px;color:#b91c1c;background:rgba(220,38,38,0.08);border:1px solid rgba(220,38,38,0.3);border-radius:4px;padding:3px 6px;"><b>⚠ ${esc(t.notFor)}:</b> ${list}</p>`);
  }

  // 컷오프 전용 시간 배너 (amber)
  const allHaz = Array.isArray(meta.hazards) ? meta.hazards : [];
  const cutoffs = allHaz.filter(isCutoff);
  if (cutoffs.length > 0) {
    const list = cutoffs.map((c) => { const { time, place } = parseCutoff(c); return `${time ? esc(time) + ' ' : ''}${esc(place)}`; }).join('  ·  ');
    rows.push(`<p style="font-size:10px;margin:0 0 3px;color:#b45309;background:rgba(245,158,11,0.10);border:1px solid rgba(245,158,11,0.4);border-radius:4px;padding:3px 6px;"><b>⏰ ${esc(t.cutoff)}:</b> ${list}</p>`);
  }

  // 위험 칩 (컷오프 제외)
  const regular = allHaz.filter((h) => !isCutoff(h));
  if (regular.length > 0) {
    const list = regular.map((h) => esc(labelToken(HAZARD_LABEL, h, lang))).join(', ');
    rows.push(`<p style="font-size:10px;margin:0 0 3px;color:#b91c1c;"><b>${esc(t.hazards)}:</b> ${list}</p>`);
  }

  // 준비물 (advisory — 4개국어, 미등록은 humanize 폴백)
  if (Array.isArray(meta.recommended_gear) && meta.recommended_gear.length > 0) {
    const list = meta.recommended_gear.map((g) => esc(labelToken(GEAR_LABEL, g, lang))).join(', ');
    rows.push(`<p style="font-size:10px;margin:0;color:#6b7280;"><b>${esc(t.gear)}:</b> ${list}</p>`);
  }

  return `<div style="margin:0 0 12px;padding:8px 10px;background:rgba(124,92,252,0.05);border:1px solid rgba(124,92,252,0.2);border-radius:6px;page-break-inside:avoid;break-inside:avoid;">${rows.join('')}</div>`;
}
