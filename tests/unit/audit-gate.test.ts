/**
 * 잠금 (2026-08-04) — 운영 의존성 취약점 게이트.
 *
 * Security Audit 워크플로우가 8/1~8/3 내내 빨간불이었다. 원인은 react-router
 * GHSA-qwww-vcr4-c8h2 인데 이 앱엔 해당 없고(RSC 모드 전용) 패치가 v8 에만 있어
 * 올릴 수도 없었다 — 즉 **구조적으로 영원히 빨강**. 상시 빨간불은 아무도 안 보므로
 * 게이트로서 기능하지 않는다.
 *
 * 그래서 근거를 적은 허용 목록을 도입했는데, 허용 목록의 위험은 **조용히 다 통과시키는
 * 것**이다. 여기서 잠그는 것: 허용된 1건만 있으면 통과하고, 다른 high/critical 이
 * 하나라도 있으면 실패한다. 파일이 깨지면 통과가 아니라 실패한다.
 *
 * 소스 문자열 검사가 아니라 **실제 스크립트를 돌려서** 확인한다.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
// @ts-expect-error — JS module
import { collectAdvisories, blockingAdvisories } from '../../scripts/audit-gate.mjs';

const ALLOWED_URL = 'https://github.com/advisories/GHSA-qwww-vcr4-c8h2';

const advisory = (severity: string, name: string, url: string) => ({ severity, name, url, title: `${name} issue` });

/** execFileSync 예외에서 종료 코드. 0 도 유효한 값이라 || 는 못 쓰고, nullish 연산자는 레포 금지. */
const exitCodeOf = (e: unknown): number => {
  const status = (e as { status?: number }).status;
  return typeof status === 'number' ? status : -1;
};

/** npm audit --json 모양. via 에는 문자열(경유)과 advisory 객체가 섞여 온다. */
const report = (...vias: unknown[][]) => ({
  vulnerabilities: Object.fromEntries(
    vias.map((via, i) => [`pkg-${i}`, { name: `pkg-${i}`, severity: 'high', via }]),
  ),
});

const runGate = (json: unknown): { code: number; out: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-gate-'));
  const file = join(dir, 'audit.json');
  writeFileSync(file, JSON.stringify(json), 'utf8');
  try {
    const out = execFileSync(process.execPath, ['scripts/audit-gate.mjs', file], {
      cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { code: exitCodeOf(e), out: `${err.stdout || ''}${err.stderr || ''}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe('운영 의존성 취약점 게이트', () => {
  it('허용된 advisory 만 있으면 통과한다', () => {
    const r = runGate(report([advisory('high', 'react-router', ALLOWED_URL)]));
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('허용');
  });

  it('같은 advisory 가 여러 패키지로 중복돼도 통과한다 (react-router + react-router-dom)', () => {
    const r = runGate(report(
      [advisory('high', 'react-router', ALLOWED_URL)],
      ['react-router', advisory('high', 'react-router-dom', ALLOWED_URL)],
    ));
    expect(r.code, r.out).toBe(0);
  });

  // 🔴 허용 목록의 진짜 위험 — 조용히 전부 통과시키는 것.
  it('허용 목록에 없는 high 가 하나라도 있으면 실패한다', () => {
    const r = runGate(report(
      [advisory('high', 'react-router', ALLOWED_URL)],
      [advisory('high', 'ip-address', 'https://github.com/advisories/GHSA-mwp4-54f8-5fhr')],
    ));
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain('ip-address');
  });

  it('critical 도 막는다', () => {
    const r = runGate(report([advisory('critical', 'evil', 'https://github.com/advisories/GHSA-0000-0000-0000')]));
    expect(r.code, r.out).toBe(1);
  });

  it('moderate·low 는 게이트 대상이 아니다', () => {
    const r = runGate(report([advisory('moderate', 'uuid', 'https://github.com/advisories/GHSA-moderate-x')]));
    expect(r.code, r.out).toBe(0);
  });

  it('취약점이 없으면 통과한다', () => {
    const r = runGate({ vulnerabilities: {} });
    expect(r.code, r.out).toBe(0);
  });

  // 파손을 통과로 처리하면 게이트가 조용히 사라진다.
  it('audit JSON 이 깨졌으면 통과가 아니라 실패한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'audit-gate-'));
    const file = join(dir, 'audit.json');
    writeFileSync(file, '{not json', 'utf8');
    let code = 0;
    try {
      execFileSync(process.execPath, ['scripts/audit-gate.mjs', file], { cwd: process.cwd(), stdio: 'pipe' });
    } catch (e) {
      code = exitCodeOf(e);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(code).toBe(2);
  });

  it('파일 인자가 없으면 실패한다', () => {
    let code = 0;
    try {
      execFileSync(process.execPath, ['scripts/audit-gate.mjs'], { cwd: process.cwd(), stdio: 'pipe' });
    } catch (e) {
      code = exitCodeOf(e);
    }
    expect(code).toBe(2);
  });

  it('via 의 문자열 항목(경유 패키지)은 advisory 로 세지 않는다', () => {
    const all = collectAdvisories(report([['socks-proxy-agent', 'socks'] as unknown as string[]].flat() as unknown[]));
    expect(all).toHaveLength(0);
    expect(blockingAdvisories(report(['socks'] as unknown[]))).toHaveLength(0);
  });
});
