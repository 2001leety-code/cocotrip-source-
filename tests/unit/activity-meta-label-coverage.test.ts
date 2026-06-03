/**
 * 활동(트레킹/러닝) 블록 hazards/unsuitable_for 토큰 ↔ 4개국어 라벨 맵 커버리지 가드 (2026-06-04 자율).
 *
 * 배경: zone_courses JSON(데이터)과 activityMetaLabels(프론트 라벨)은 별도 소스. 활동 블록이 라벨 맵에
 *   없는 토큰을 쓰면 ActivityMetaChips/buildActivityMetaHtml 가 humanize(영어) 폴백 → 외국인(ja/zh/ko)
 *   사용자가 SAFETY 위험/부적합 문구를 영어로 봄(번역 드리프트). 발견: 설악산 울산바위 trekking 블록의
 *   steep_iron_stairs/crowded_weekend/vertigo_sensitive 3토큰 미등록.
 *
 * 가드: block_type∈{trekking,running_route} 블록의 모든 hazards(컷오프 제외)·unsuitable_for 토큰이
 *   HAZARD_LABEL/UNSUITABLE_LABEL 의 4개국어 전부에 존재해야 함. city_day 블록은 activity_meta 로 안 가
 *   화면 무관 → 제외.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { HAZARD_LABEL, UNSUITABLE_LABEL, isCutoff } from '../../src/lib/activityMetaLabels';

const DIR = join(process.cwd(), 'src', 'data', 'zone_courses');
const LANGS = ['ko', 'en', 'ja', 'zh'] as const;
const ACTIVITY_TYPES = new Set(['trekking', 'running_route']);

// JSON 재귀 수집 — 모든 hazards[] / unsuitable_for[] (top-level + trekking_meta/running_meta 중첩).
function collect(obj: any, haz: Set<string>, uns: Set<string>): void {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) { obj.forEach((x) => collect(x, haz, uns)); return; }
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'hazards' && Array.isArray(v)) v.forEach((t) => typeof t === 'string' && haz.add(t));
    else if (k === 'unsuitable_for' && Array.isArray(v)) v.forEach((t) => typeof t === 'string' && uns.add(t));
    else collect(v, haz, uns);
  }
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
const haz = new Set<string>(), uns = new Set<string>();
let activityBlocks = 0;
const tokenFiles: Record<string, string[]> = {};
for (const f of files) {
  let data: any;
  try { data = JSON.parse(readFileSync(join(DIR, f), 'utf8')); } catch { continue; }
  if (!ACTIVITY_TYPES.has(data.block_type)) continue;
  activityBlocks++;
  const h = new Set<string>(), u = new Set<string>();
  collect(data, h, u);
  for (const t of h) { haz.add(t); (tokenFiles[t] ||= []).push(f); }
  for (const t of u) { uns.add(t); (tokenFiles[t] ||= []).push(f); }
}

describe('활동 블록 SAFETY 토큰 4개국어 라벨 커버리지', () => {
  it('활동 블록(trekking/running_route)이 존재 (가드 유효성)', () => {
    expect(activityBlocks).toBeGreaterThan(0);
  });

  it('모든 hazards 토큰(컷오프 제외)이 HAZARD_LABEL 4개국어 전부에 등록', () => {
    const regularHaz = [...haz].filter((t) => !isCutoff(t));
    for (const t of regularHaz) {
      for (const lang of LANGS) {
        expect(HAZARD_LABEL[lang][t], `hazard '${t}' (${(tokenFiles[t] || []).join(',')}) — ${lang} 라벨 누락 → 외국인 영어 폴백`).toBeTruthy();
      }
    }
  });

  it('모든 unsuitable_for 토큰이 UNSUITABLE_LABEL 4개국어 전부에 등록 (SAFETY 최고)', () => {
    for (const t of uns) {
      for (const lang of LANGS) {
        expect(UNSUITABLE_LABEL[lang][t], `unsuitable '${t}' (${(tokenFiles[t] || []).join(',')}) — ${lang} 라벨 누락 → 외국인 영어 폴백`).toBeTruthy();
      }
    }
  });
});
