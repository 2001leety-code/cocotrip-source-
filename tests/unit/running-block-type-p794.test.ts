/**
 * 러닝 zone_course 블록 block_type 가드 (#794, 2026-06-03 자율).
 *
 * 배경: *_running.json 16개 중 14개가 block_type=city_day 오타이핑 → 러닝 미감지(#784/#786) + 일반 플랜 leak.
 * fix: eligibility 안전 + 평지 urban 6개를 running_route 로 정정(+running_meta). 나머지 8개는 보류(KNOWN-RISKS #10):
 *   - igidae 10km 해안(지형 위험, 운영자 실측 필요)
 *   - 소도시 7개(retype 시 city_day < 3 → block_mode ineligible → legacy 폴백)
 *
 * 본 가드: running_route 로 정정된 것은 유지(+ running_meta SAFETY 동반), 보류된 것은 의도적 city_day 임을 잠금.
 * 운영자가 소도시 블록 추가 시드/igidae 실측 후 retype 하면 이 테스트의 분류를 옮기면 됨.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'src', 'data', 'zone_courses');

// running_route 로 정정됨(평지 urban) — 2 기존 + 6 retype(#794).
const RUNNING_ROUTE = new Set([
  'jeju_olle_7_5km_running.json',
  'seoul_hangang_mangwon_5km_running.json',
  'seoul_jamsil_5km_running.json',
  'daegu_sincheon_5km_running.json',
  'gangneung_gyeongpo_5km_running.json',
  'gyeongju_bomun_5km_running.json',
  'busan_gwangalli_5km_running.json',
  'busan_haeundae_5km_running.json',
]);
// 의도적 city_day 보류 (KNOWN-RISKS #10): igidae 해안 + 소도시 7.
const CITY_DAY_PENDING = new Set([
  'busan_igidae_10km_running.json',
  'gwangju_518park_5km_running.json',
  'incheon_songdo_5km_running.json',
  'jeonju_deokjin_5km_running.json',
  'pohang_yeongildae_5km_running.json',
  'sokcho_cheongcho_5km_running.json',
  'suncheon_garden_5km_running.json',
  'yeosu_dolsan_5km_running.json',
]);

const runningFiles = readdirSync(DIR).filter((f) => /_running\.json$/.test(f));
const readBlock = (f: string) => JSON.parse(readFileSync(join(DIR, f), 'utf8'));

describe('러닝 블록 block_type 가드 (#794)', () => {
  it('모든 *_running.json 이 두 분류 중 하나에 등록됨 (신규 파일 누락 방지)', () => {
    for (const f of runningFiles) {
      expect(RUNNING_ROUTE.has(f) || CITY_DAY_PENDING.has(f), `${f} 미분류 — 가드에 추가 필요`).toBe(true);
    }
  });

  it('running_route 정정 블록은 block_type=running_route + running_meta(SAFETY) 동반', () => {
    for (const f of RUNNING_ROUTE) {
      const b = readBlock(f);
      expect(b.block_type, `${f}`).toBe('running_route');
      // PR-E SAFETY: 러닝 day 난이도 표기 의무 — running_meta 존재 + difficulty.
      expect(b.running_meta, `${f} running_meta 누락`).toBeTruthy();
      expect(b.running_meta.difficulty, `${f} difficulty 누락`).toBeTruthy();
    }
  });

  it('보류 블록은 의도적 city_day (KNOWN-RISKS #10 — 소도시 eligibility/해안 실측 선행)', () => {
    for (const f of CITY_DAY_PENDING) {
      const b = readBlock(f);
      expect(b.block_type, `${f}`).toBe('city_day');
    }
  });
});
