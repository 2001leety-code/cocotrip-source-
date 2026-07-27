/**
 * NCP Maps 키 해석 SSOT 소스 불변식 — 2026-07-27 prod 장애 잠금.
 *
 * 사고 요약:
 *   prod 는 NAVER_CLIENT_* 를 Naver Developers(openapi 검색) 키로 갱신해 두었고,
 *   살아있는 NCP Maps 키는 VITE_NAVER_CLIENT_* 에만 있다. 그런데 maps.apigw.ntruss.com
 *   (map-geocode / map-direction) 을 호출하는 파일들이 각자 키 목록을 복붙해 두고
 *   폴백 한 칸(VITE_NAVER_CLIENT_*)을 빼먹어 prod 에서만 조용히 401 로 죽었다:
 *     - api/mood-parse-schedule.js                 (#1183 — 주소 인식 전멸)
 *     - api/calculator-distance.js                 (실측 401 — /calculator 거리 fallback)
 *     - api/recalc-transit.js                      (편집 후 재계산 → flat 25분)
 *     - api/admin-rebuild-zone-course-transit.js   (항상 lat/lng=0 placeholder)
 *     - api/_ai_core/agents/RouteAgent.js          (호텔 anchor → city_center fallback)
 *   복붙이라 어떤 유닛테스트도 깨지지 않았고, 타입도 통과했다.
 *
 * 이 테스트는 "NCP Maps 를 호출하는 파일은 키를 직접 읽지 않는다" 를 레포 전체에
 * 강제한다 — 새 파일이 같은 병을 들고 들어와도 파일 목록 갱신 없이 자동으로 깨진다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';

const ROOT = resolve(__dirname, '../..');

/** NCP Maps API 호스트 — geocode + directions 양쪽 다 이 호스트다. */
const NCP_MAPS_HOST = 'maps.apigw.ntruss.com';

/** 키 SSOT 자신. 여기만 process.env 를 직접 읽어야 한다. */
const SSOT_FILE = 'api/_shared/mood-route.js';

/**
 * 키 직독 패턴 — `process.env.X_CLIENT_ID` 와 (scripts 의) `env.X_CLIENT_ID` 양쪽.
 * scripts/*.mjs 는 `import { env } from 'node:process'` 로 구조분해해 쓴다.
 */
const DIRECT_KEY_READ = /\benv\.(NCP|VITE_NAVER|NAVER)_CLIENT_(ID|SECRET)/;

/** 주석 줄 제거 — 설명 주석엔 키 이름이 의도적으로 등장한다. */
function stripComments(src: string): string {
  return src
    .split('\n')
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
    })
    .join('\n');
}

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

/** maps.apigw.ntruss.com 을 실제 코드(주석 아님)에서 참조하는 파일 전부. */
const ncpMapsCallers = [
  ...walk(resolve(ROOT, 'api'), ['.js', '.mjs']),
  ...walk(resolve(ROOT, 'scripts'), ['.js', '.mjs']),
]
  .map((full) => ({ rel: relative(ROOT, full).replace(/\\/g, '/'), src: readFileSync(full, 'utf8') }))
  .filter(({ src }) => stripComments(src).includes(NCP_MAPS_HOST));

describe('NCP Maps 키 해석 SSOT — 키 목록 복제 금지 (2026-07-27 prod 401 장애 잠금)', () => {
  it('NCP Maps 를 호출하는 파일이 최소 한 개는 잡힌다 (스캐너 자체 검증)', () => {
    // 스캐너가 조용히 0건을 훑으면 아래 검사가 전부 무의미하게 통과한다.
    expect(ncpMapsCallers.length).toBeGreaterThan(3);
    expect(ncpMapsCallers.map((f) => f.rel)).toContain(SSOT_FILE);
  });

  it.each(ncpMapsCallers.map((f) => f.rel).filter((rel) => rel !== SSOT_FILE))(
    '%s — 키를 직접 읽지 않고 resolveNcpKeys 에서 파생한다',
    (rel) => {
      const { src } = ncpMapsCallers.find((f) => f.rel === rel)!;
      const code = stripComments(src);
      // ① 키 목록 복제 금지
      expect(code).not.toMatch(DIRECT_KEY_READ);
      // ② SSOT 를 실제로 import 했는지 (①은 "키를 아예 안 쓰는" 파일도 통과시키므로 필요)
      expect(code).toMatch(/\b(resolveNcpKeys|geocodeAddress|computeRoute)\b/);
    },
  );

  it('SSOT(mood-route) 의 폴백에 3개 이름이 이 순서로 살아 있다', () => {
    const src = readFileSync(resolve(ROOT, SSOT_FILE), 'utf8');
    const line = stripComments(src)
      .split('\n')
      .find((l) => l.includes('NCP_CLIENT_ID'));
    expect(line).toBeTruthy();
    // prod 유일 생존 키가 VITE_NAVER_CLIENT_* 다 — 이 칸이 빠지는 게 이번 장애였다.
    expect(line).toContain('process.env.NCP_CLIENT_ID');
    expect(line).toContain('process.env.VITE_NAVER_CLIENT_ID');
    expect(line).toContain('process.env.NAVER_CLIENT_ID');
    // 순서: NCP(운영자 명시) → VITE(prod 생존) → NAVER(레거시, prod 는 Developers 키라 401)
    expect(line!.indexOf('NCP_CLIENT_ID')).toBeLessThan(line!.indexOf('VITE_NAVER_CLIENT_ID'));
    expect(line!.indexOf('VITE_NAVER_CLIENT_ID')).toBeLessThan(line!.indexOf('process.env.NAVER_CLIENT_ID'));
  });

  it('resolveNcpKeys 는 export 되어 있다 (호출자가 파생할 수 있어야 함)', () => {
    const src = readFileSync(resolve(ROOT, SSOT_FILE), 'utf8');
    expect(src).toMatch(/export function resolveNcpKeys\(/);
  });

  it('planner 진단 로그는 실제 해석된 키를 찍는다 (env 이름 존재 여부 아님)', () => {
    // 이 로그가 `NAVER: !!process.env.NAVER_CLIENT_ID` 였던 탓에 키가 죽어 있는데도
    // Vercel 로그상 "NAVER: true" 로 정상처럼 보여 3주간 진단을 방해했다.
    const src = readFileSync(resolve(ROOT, 'api/_ai_core/routeEnrichment.js'), 'utf8');
    const code = stripComments(src);
    expect(code).not.toMatch(DIRECT_KEY_READ);
    expect(code).toMatch(/resolveNcpKeys\(\)/);
  });
});
