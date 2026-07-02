/**
 * 버그 #10 회귀 테스트 — PWA 스플래시 signalAppReady 미호출 (4.5초 강제 노출)
 *
 * 수정: App 최상위 useEffect 에서 signalAppReady() 1회 호출로 모든 진입 경로 커버.
 * appReady.ts 멱등성 가드(_appReadyFired) 추가로 중복 호출 안전.
 *
 * 커버하는 경로:
 *   - VITE_FEATURE_MOBILE_V2 OFF 시 구 MobileHome 렌더 → 기존엔 signalAppReady 없음
 *   - 데스크탑 standalone 분기 → 기존엔 signalAppReady 없음
 *   - /planner, /tours, /charter 등 홈 외 라우트 진입 → 기존엔 signalAppReady 없음
 *   - MobileHomeV2 / MoodPortal 의 기존 호출 → 멱등성 가드로 중복 흡수
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const r = (p: string) => resolve(process.cwd(), p);

// ── 소스 읽기 (한 번만) ─────────────────────────────────────────────────────
const appSrc = readFileSync(r('src/App.tsx'), 'utf8');
const appReadySrc = readFileSync(r('src/lib/appReady.ts'), 'utf8');

describe('Bug #10 — App 최상위 signalAppReady 호출 (모든 진입 경로 커버)', () => {
  it('App.tsx 가 appReady 모듈을 import 한다', () => {
    // import { signalAppReady } from '@/lib/appReady'
    expect(appSrc).toMatch(/import\s*\{[^}]*signalAppReady[^}]*\}\s*from\s*['"]@\/lib\/appReady['"]/);
  });

  it('App 컴포넌트 내부에 useEffect(() => { signalAppReady(); }, []) 가 존재한다', () => {
    // App() 함수 영역에 signalAppReady() 호출이 있어야 함
    expect(appSrc).toContain('signalAppReady()');

    // useEffect 와 빈 deps [] 와 함께 쓰임
    // 패턴: useEffect(()=>{...signalAppReady()...},[])
    expect(appSrc).toMatch(/useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]{0,200}signalAppReady\(\)/);
  });

  it('App() 함수 내 signalAppReady 호출은 deps=[] (마운트 1회) 이다', () => {
    // App 함수 선택: function App() { ... }
    const appFnMatch = appSrc.match(/function\s+App\s*\(\s*\)\s*\{([\s\S]*?)^\}/m);
    // 함수 전체가 매치 안 될 수 있으니 App 함수 시작 이후 충분한 범위를 검사
    const appFnStart = appSrc.indexOf('function App()');
    expect(appFnStart).toBeGreaterThan(0);

    // 900자: 2026-07-02 /mood 예외 주석 추가로 600자 밖으로 밀림 (불변식 자체는 동일 — deps=[])
    const appFnBody = appSrc.slice(appFnStart, appFnStart + 900);
    // useEffect + signalAppReady + 빈 배열 deps
    expect(appFnBody).toContain('signalAppReady');
    expect(appFnBody).toMatch(/useEffect/);
    expect(appFnBody).toMatch(/\[\s*\]/);
  });
});

describe('Bug #10 — appReady.ts 멱등성 가드 (_appReadyFired)', () => {
  it('_appReadyFired 모듈 레벨 플래그가 존재한다', () => {
    expect(appReadySrc).toContain('_appReadyFired');
  });

  it('signalAppReady 내부에서 이미 발화했으면 early return 한다', () => {
    // if (_appReadyFired) return; 패턴
    expect(appReadySrc).toMatch(/if\s*\(_appReadyFired\)\s*return/);
  });

  it('첫 호출 직후 _appReadyFired = true 로 세팅한다', () => {
    expect(appReadySrc).toMatch(/_appReadyFired\s*=\s*true/);
  });

  it('테스트 전용 _resetAppReadyForTest export 가 존재한다', () => {
    expect(appReadySrc).toContain('_resetAppReadyForTest');
    expect(appReadySrc).toMatch(/export\s+function\s+_resetAppReadyForTest/);
  });

  it('_resetAppReadyForTest 는 _appReadyFired 를 false 로 되돌린다', () => {
    expect(appReadySrc).toMatch(/_appReadyFired\s*=\s*false/);
  });
});

describe('Bug #10 — 멱등성 동작 검증 (런타임 시뮬레이션)', () => {
  // vitest 기본 환경 = node. globalThis 를 window 대신 사용해 node 에서도 동작.
  // appReady.ts 내부도 window → globalThis 관점에서 동일하게 동작함
  // (TypeScript 캐스트 대상만 다를 뿐 런타임 동작 동일).

  type G = typeof globalThis & { __appReady?: () => void };

  let signalAppReady: () => void;
  let _resetAppReadyForTest: () => void;

  beforeEach(async () => {
    // 매 테스트 전 모듈 캐시를 우회하기 위해 동적 import + 초기화
    const mod = await import('../../src/lib/appReady');
    signalAppReady = mod.signalAppReady;
    _resetAppReadyForTest = mod._resetAppReadyForTest;
    _resetAppReadyForTest(); // 플래그 초기화
    delete (globalThis as G).__appReady;
  });

  it('첫 번째 호출 시 globalThis.__appReady(=window.__appReady) 를 발화한다', () => {
    let called = 0;
    (globalThis as G).__appReady = () => { called++; };
    signalAppReady();
    expect(called).toBe(1);
  });

  it('두 번째 호출은 __appReady 를 다시 발화하지 않는다 (멱등성)', () => {
    let called = 0;
    (globalThis as G).__appReady = () => { called++; };
    signalAppReady(); // App useEffect 에서 첫 번째
    signalAppReady(); // MobileHomeV2 또는 MoodPortal 에서 두 번째
    signalAppReady(); // 혹시 세 번째
    expect(called).toBe(1); // 단 1회만
  });

  it('__appReady 가 없을 때(일반 웹 탭) 예외 없이 no-op 으로 동작한다', () => {
    delete (globalThis as G).__appReady;
    expect(() => signalAppReady()).not.toThrow();
  });

  it('__appReady 가 throw 해도 예외가 바깥으로 전파되지 않는다', () => {
    (globalThis as G).__appReady = () => { throw new Error('crash'); };
    expect(() => signalAppReady()).not.toThrow();
  });
});

describe('Bug #10 — 기존 호출 지점 유지 (MobileHomeV2·MoodPortal 제거 안 됨)', () => {
  it('MobileHomeV2 는 여전히 signalAppReady 를 호출한다 (제거 금지)', () => {
    const src = readFileSync(r('src/pages/MobileHomeV2.tsx'), 'utf8');
    expect(src).toContain('signalAppReady');
  });

  it('MoodPortal 은 loading 끝난 뒤 signalAppReady 를 호출한다 (인증 완료 후 = 보존)', () => {
    const src = readFileSync(r('src/pages/MoodPortal.tsx'), 'utf8');
    expect(src).toContain('signalAppReady');
    // loading 완료 조건부 호출 패턴 (if (!loading) signalAppReady())
    expect(src).toMatch(/if\s*\(!loading\)\s*signalAppReady\(\)/);
  });
});
