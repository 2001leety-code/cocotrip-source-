// S2 (2026-06-01): 자사 투어 업셀 lazy-split 회귀 방지.
//
// ItineraryResult.tsx 가 OwnTourUpsellSection 을 React.lazy() + 플래그 게이트로 유지하는지
// 소스 텍스트로 검증한다. static import 로 되돌리면 청크가 main 번들에 다시 포함되어
// 플래그 OFF(prod 기본)에서도 로드 → 번들 size 증가 + byte-identical 보장 깨짐.
//
// 컴포넌트를 직접 import 하면 firebase 를 끌어와 CI(키 없음) "0 test" crash 가 나므로
// (R_Phase1_testNoFirebaseClientImport 클래스) 소스를 fs 로 읽어 패턴만 검사한다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/pages/PlannerPage/components/ItineraryResult.tsx',
);
const src = readFileSync(FILE, 'utf8');

describe('ItineraryResult — 자사투어 업셀 lazy-split (S2)', () => {
  it('OwnTourUpsellSection 을 정적 import 하지 않는다 (main 번들 회귀 방지)', () => {
    expect(src).not.toMatch(/import\s*\{[^}]*\bOwnTourUpsellSection\b[^}]*\}\s*from/);
  });

  it('OwnTourUpsellSection 을 lazy(() => import()) 로 동적 로드한다', () => {
    expect(src).toMatch(/lazy\(\s*\(\)\s*=>\s*import\(\s*['"][^'"]*OwnTourUpsellSection['"]/);
  });

  it('플래그 상수로 게이트해 OFF 시 chunk 미로드 + Suspense 로 감싼다', () => {
    expect(src).toMatch(/VITE_FEATURE_OWN_TOUR_UPSELL\s*===\s*['"]true['"]/);
    expect(src).toMatch(/&&[\s\S]{0,160}<Suspense[\s\S]{0,160}OwnTourUpsellSection/);
  });
});
