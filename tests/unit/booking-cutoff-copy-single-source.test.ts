/**
 * 예약 마감 문구 단일화 (2026-07-30, P1-5).
 *
 * 🔴 고친 문제: 실제 정책은 **전세차량 1시간 · 투어 8시간**(api/_shared/booking-cutoff.js)인데,
 *   화면 여러 곳이 "12h cutoff" · "출발 12시간 전" 이라고 말하고 있었다. 옛 정책(전 상품 12h)
 *   문구가 그대로 남은 것이다. 결과는 **과소약속** — 실제로는 예약할 수 있는 손님에게 "이미
 *   마감" 이라고 알려 주고 돌려보내는 셈이었다.
 *
 * 규칙: 모든 마감 문구의 숫자는 `lib/bookingCutoff` 상수(= 서버 SSOT 미러)에서 파생한다.
 *   번역 문구는 `{h}` 자리표시자를 쓰고 컴포넌트가 숫자를 채운다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  CHARTER_VEHICLE_CUTOFF_HOURS,
  TOUR_CUTOFF_HOURS,
  getCutoffHours,
  isCharterVehicleProduct,
} from '../../src/lib/bookingCutoff';

const ROOT = process.cwd();
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

describe('정책 상수', () => {
  it('전세차량 1시간 · 투어 8시간', () => {
    expect(CHARTER_VEHICLE_CUTOFF_HOURS).toBe(1);
    expect(TOUR_CUTOFF_HOURS).toBe(8);
  });

  it('상품별 판정이 서버와 같은 집합을 쓴다', () => {
    for (const p of ['charter_transfer', 'charter_multiday', 'tour_hourly', 'charter_custom_estimate',
      'kpop_shuttle_oneway', 'kpop_shuttle_roundtrip', 'airport_seoul_central']) {
      expect(isCharterVehicleProduct(p), p).toBe(true);
      expect(getCutoffHours(p), p).toBe(1);
    }
    for (const p of ['dmz_tour', 'seoul_city_full_day', null, undefined, '']) {
      expect(getCutoffHours(p), String(p)).toBe(8);
    }
  });

  it('백엔드 정본과 숫자가 같다', () => {
    const server = read('api/_shared/booking-cutoff.js');
    expect(server).toMatch(new RegExp(`CHARTER_VEHICLE_CUTOFF_HOURS\\s*=\\s*${CHARTER_VEHICLE_CUTOFF_HOURS}\\b`));
    expect(server).toMatch(new RegExp(`TOUR_CUTOFF_HOURS\\s*=\\s*${TOUR_CUTOFF_HOURS}\\b`));
  });
});

describe('🔴 하드코딩 12시간이 남아 있지 않다', () => {
  /** src 전체를 훑어 마감 문구에 12가 박힌 곳을 찾는다. */
  function walk(dir, acc = []) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) { walk(p, acc); continue; }
      if (/\.(ts|tsx|json)$/.test(name)) acc.push(p);
    }
    return acc;
  }

  const PATTERNS = [
    /12h cutoff/i,
    /12\s*시간\s*전/,
    /12\s*時間前/,
    /提前\s*12\s*小时/,
    /12\s*hours? before departure/i,
    /Booking closes 12h/i,
  ];

  it('src/ 어디에도 12시간 마감 문구가 없다', () => {
    const offenders = [];
    for (const file of walk(join(ROOT, 'src'))) {
      const code = readFileSync(file, 'utf8');
      for (const re of PATTERNS) {
        if (re.test(code)) {
          // 주석에서 "옛 문구는 12시간이었다" 라고 설명하는 것은 허용한다.
          const line = (code.split('\n').find((l) => re.test(l)) || '').trim();
          if (/^(\/\/|\*|\/\*)/.test(line)) continue;
          offenders.push(`${file.replace(ROOT, '')} :: ${line.slice(0, 120)}`);
        }
      }
    }
    expect(offenders, `12시간 하드코딩 잔존:\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('문구가 상수에서 파생된다', () => {
  it('CharterIntroModal — 번역 {h} 자리표시자를 상수로 채운다', () => {
    const code = read('src/components/CharterIntroModal.tsx');
    expect(code).toMatch(/withCutoffHours\(/);
    expect(code).toMatch(/String\(CHARTER_VEHICLE_CUTOFF_HOURS\)/);
  });

  it('4개 언어 번역에 {h} 자리표시자가 들어 있다', () => {
    for (const lang of ['ko', 'en', 'ja', 'zh']) {
      const j = JSON.parse(read(`src/i18n/locales/${lang}.json`));
      expect(j.charterPage.charterIntroDeadline, `${lang} deadline`).toContain('{h}');
      expect(j.charterPage.charterIntroChatBody, `${lang} chat body`).toContain('{h}');
    }
  });

  it('CharterWizard 헤더 칩은 고른 상품의 실제 마감을 보여 준다', () => {
    const code = read('src/components/charter/CharterWizard.tsx');
    expect(code).toMatch(/const cutoffHours = cutoffProductType \? getCutoffHours\(cutoffProductType\) : CHARTER_VEHICLE_CUTOFF_HOURS;/);
    expect(code).toMatch(/\$\{cutoffHours\}시간 전 마감/);
    expect(code).toMatch(/\$\{cutoffHours\}h cutoff/);
  });

  it('투어 상세는 투어 마감(8h)에서 파생한다', () => {
    const code = read('src/pages/TourDetailPage.tsx');
    expect(code).toMatch(/TOUR_CUTOFF_HOURS/);
    expect(code).toMatch(/예약 마감: 출발 \$\{TOUR_CUTOFF_HOURS\}시간 전/);
  });

  it('SEO FAQ 는 두 상수를 모두 주입받는다', () => {
    const code = read('src/components/charter/CharterSeoInfo.tsx');
    expect(code).toMatch(/charterCutoff: CHARTER_VEHICLE_CUTOFF_HOURS/);
    expect(code).toMatch(/tourCutoff: TOUR_CUTOFF_HOURS/);
  });
});
