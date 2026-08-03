/**
 * 하드코딩 폴백 문구 ↔ ko.json(i18n 단일 진실원천) 일치 검증.
 *
 * 🔴 왜 필요한가 (2026-08-03)
 *   화면 코드에는 `{hc.flightLine1 || '스카이스캐너 제휴'}` 처럼 번역이 없을 때 쓰는
 *   **하드코딩 폴백**이 섞여 있다. 번역 JSON 은 나중에 고쳐지는데 이 폴백은 그대로 남아
 *   **거짓 사실이 코드 안에 화석처럼 굳는다.** 실제로 항공 카드 폴백은 제휴사가 Trip.com 으로
 *   바뀐 뒤에도 '스카이스캐너 제휴' 였고, 전세차량 폴백은 가이드 비용을 "별도 포함"
 *   (ko.json 은 "추가됩니다") 이라고 말해 **요금 안내가 서로 모순**이었다.
 *   llms.txt 결제 단정문 사건과 같은 부류다 — 고객에게 보이는 서술은 진실 원천과 대조해야 한다.
 *
 *   같은 키의 폴백이 **여러 곳에 복사**돼 한쪽만 갱신되는 것이 실제 발생한 경로다
 *   (`c.vehicleGuideCost` 는 237행이 최신, 479행이 옛 문구였다). 이 테스트가 있으면 복사본이
 *   몇 개든 전부 ko.json 한 곳을 향하므로 갈라질 수 없다 — 그래서 폴백을 상수로 뽑지 않는다.
 *
 * 검사 대상: `<객체>.<키>` 뒤에 `||` 또는 nullish 연산자로 한글 폴백을 붙인 표현 중, 그
 * **leaf 키 이름이 ko.json 전체에서 딱 한 번만 나오는** 것. `title`·`name` 처럼 여러
 * 네임스페이스에 중복되는 이름은 어느 값과 비교할지 알 수 없어 제외한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ko from '../../src/i18n/locales/ko.json';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

/**
 * i18n 객체가 아니라 **데이터 객체**의 폴백인데 속성 이름이 우연히 ko.json 키와 같은 것.
 * 형식: `<src 기준 경로>::<코드에 쓰인 표현>`. 새 항목을 추가할 때는 "이 값이 정말 번역이
 * 아닌가" 를 한 번 확인하라 — 이 목록에 넣는 순간 문구 검사에서 영원히 빠진다.
 */
const NOT_I18N = new Set([
  'pages/AdminCalendar.tsx::booking.pickup',       // 예약 문서의 픽업 장소(자유 입력)
  'pages/AdminCalendar.tsx::d.name',               // 디스코드 구독자 표시 이름
  'pages/AdminProductEditor.tsx::validation.message', // 검증 결과 메시지 객체
  'components/mood/MoodReceiptModal.tsx::booking.serviceType', // 예약 문서의 서비스 코드
]);

/** leaf 키 이름 -> ko.json 에서의 (경로, 값) 목록. */
function indexByLeafKey(
  node: Record<string, unknown>,
  path = '',
  out = new Map<string, { path: string; value: string }[]>(),
) {
  for (const [k, v] of Object.entries(node)) {
    const p = path ? `${path}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      indexByLeafKey(v as Record<string, unknown>, p, out);
    } else if (typeof v === 'string') {
      const list = out.get(k);
      if (list) list.push({ path: p, value: v });
      else out.set(k, [{ path: p, value: v }]);
    }
  }
  return out;
}

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
 * `obj.someKey` 또는 옵셔널 체이닝 `obj?.someKey` 뒤에 `||`/nullish 연산자로 붙은 문자열 폴백.
 * 한글이 든 문구만 본다. 옵셔널 체이닝을 빠뜨리면 `transitDict?.walkFasterNote` 같은 실제
 * 사례를 놓친다.
 *
 * (정규식을 `(?:\?)?` 처럼 에두른 이유: pre-commit 의 mojibake 검사가 물음표 두 개가 붙은
 *  문자열을 깨진 글자 시그니처로 잡는다. 이 파일은 예외 목록에 없어야 하므로 피해서 쓴다.)
 */
const FALLBACK_RE = /([A-Za-z0-9_$]+)(?:\?)?\.([A-Za-z0-9_]+)\s*(?:\|\||\?\?)\s*(['"])((?:(?!\3).)*)\3/g;

interface Mismatch {
  where: string;
  key: string;
  fallback: string;
  expected: string;
}

function findMismatches(): { mismatches: Mismatch[]; checked: number; unusedIgnores: string[] } {
  const byLeaf = indexByLeafKey(ko as unknown as Record<string, unknown>);
  const mismatches: Mismatch[] = [];
  const seenIgnores = new Set<string>();
  let checked = 0;

  for (const file of collectSourceFiles(SRC)) {
    const rel = file.slice(SRC.length + 1).replace(/\\/g, '/');
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        FALLBACK_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = FALLBACK_RE.exec(line)) !== null) {
          const [, obj, key, , fallback] = m;
          if (!/[가-힣]/.test(fallback)) continue;
          const hits = byLeaf.get(key);
          if (!hits || hits.length !== 1) continue;
          const tag = `${rel}::${obj}.${key}`;
          if (NOT_I18N.has(tag)) {
            seenIgnores.add(tag);
            continue;
          }
          checked += 1;
          if (hits[0].value !== fallback) {
            mismatches.push({ where: `src/${rel}:${i + 1}`, key: hits[0].path, fallback, expected: hits[0].value });
          }
        }
      });
  }
  return { mismatches, checked, unusedIgnores: [...NOT_I18N].filter((t) => !seenIgnores.has(t)) };
}

describe('하드코딩 폴백 문구는 ko.json 과 같아야 한다', () => {
  const result = findMismatches();

  it('불일치가 없다', () => {
    const report = result.mismatches
      .map((m) => `\n  ${m.where}  [${m.key}]\n    코드: ${JSON.stringify(m.fallback)}\n    ko  : ${JSON.stringify(m.expected)}`)
      .join('');
    expect(
      result.mismatches,
      `하드코딩 폴백이 ko.json 과 다르다. 번역 JSON 이 진실 원천이므로 코드 쪽을 맞춘다:${report}\n`,
    ).toEqual([]);
  });

  it('검사기가 실제로 무언가를 보고 있다', () => {
    // 정규식·경로가 조용히 0건을 반환하면 위 테스트는 영원히 통과한다 — 그 상태를 막는다.
    expect(collectSourceFiles(SRC).length).toBeGreaterThan(100);
    expect(result.checked).toBeGreaterThan(20);
  });

  it('쓰이지 않는 예외 항목이 남아 있지 않다', () => {
    // 코드가 정리되면 예외도 함께 사라져야 한다(안 그러면 다음 사람이 진짜 예외인 줄 안다).
    expect(result.unusedIgnores).toEqual([]);
  });
});
