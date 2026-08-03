/**
 * `import.meta.env` 는 **정적 키로만** 읽어야 한다.
 *
 * 🔴 왜 (2026-08-03, 운영 번들 실측으로 발견)
 *   Vite 는 `import.meta.env.어떤키` 형태만 빌드 시점에 그 값으로 치환한다. 키가 변수면
 *   (`import.meta.env[key]`, `import.meta.env as Record<…>`, 스프레드, `Object.keys(...)`)
 *   치환 대상을 특정할 수 없어 **env 객체를 통째로 번들에 심는다.**
 *
 *   실제로 `src/config/affiliateLinks.ts` 의 동적 접근 한 줄 때문에, 운영
 *   `entry-*.js` 에 클라이언트가 쓰지도 않는 `VITE_` 변수 113개가 전부 실렸다 —
 *   서버용 시크릿(`VITE_NAVER_CLIENT_SECRET`)과 배포 커밋 메시지 전문까지 공개됐다.
 *
 *   `VITE_` 접두사가 붙은 값은 원래 "브라우저에 공개해도 되는 값" 이라는 뜻이다. 그래서
 *   진짜 방어선은 두 겹이다: ①서버 시크릿에 `VITE_` 를 붙이지 않는다(운영 env 설정)
 *   ②쓰지 않는 값까지 번들에 싣지 않는다(이 테스트).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'node_modules') collectSourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 주석을 지운다. 이 파일과 `affiliateLinks.ts` 처럼 **주석에서 금지 형태를 인용**하는
 * 경우가 있어서, 지우지 않으면 설명글이 위반으로 잡힌다.
 * URL 의 `//` 를 주석으로 오인하지 않도록 `:` 뒤의 `//` 는 건드리지 않는다.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** 정적 접근이 아닌 `import.meta.env` 사용. 뒤에 `.식별자` 가 붙지 않은 것 전부. */
const BARE_ENV_RE = /import\.meta\.env(?!\s*\.\s*[A-Za-z_$])/g;

describe('import.meta.env 는 정적 키로만 읽는다', () => {
  const files = collectSourceFiles(SRC);

  it('동적/객체 접근이 없다', () => {
    const violations: string[] = [];
    for (const file of files) {
      const rel = `src/${file.slice(SRC.length + 1).replace(/\\/g, '/')}`;
      stripComments(readFileSync(file, 'utf8'))
        .split('\n')
        .forEach((line, i) => {
          BARE_ENV_RE.lastIndex = 0;
          if (BARE_ENV_RE.test(line)) violations.push(`${rel}:${i + 1}  ${line.trim().slice(0, 120)}`);
        });
    }
    expect(
      violations,
      `import.meta.env 를 객체째로 다루면 Vite 가 env 전체를 번들에 심는다.\n` +
        `읽고 싶은 키를 직접 적을 것 (import.meta.env.VITE_XXX):\n  ${violations.join('\n  ')}\n`,
    ).toEqual([]);
  });

  it('검사기가 실제로 소스를 보고 있다', () => {
    // 경로·정규식이 조용히 0건이면 위 테스트는 영원히 통과한다.
    expect(files.length).toBeGreaterThan(100);
    let staticUses = 0;
    for (const f of files) {
      const hits = readFileSync(f, 'utf8').match(/import\.meta\.env\s*\.\s*[A-Za-z_$]/g);
      if (hits) staticUses += hits.length;
    }
    expect(staticUses).toBeGreaterThan(10);
  });

  it('주석 제거가 URL 을 먹지 않는다', () => {
    expect(stripComments('const u = "https://a.b/c"; // 설명')).toContain('https://a.b/c');
    expect(stripComments('// import.meta.env[key] 는 금지')).not.toContain('import.meta.env');
  });
});
