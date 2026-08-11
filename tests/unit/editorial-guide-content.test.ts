/**
 * /guide + /guide/:slug — Korea Editorial Concierge 전환 계약 (2026-08-11).
 *
 * 전환 전 실측한 결함(이 테스트가 잡는 것):
 *   1. 두 화면 모두 자체 다크 그라데이션 셸(`bg-gradient-to-b from-[#0a0412]`)과
 *      raw hex(`#B668FC`/`#FF6B9D`)를 들고 있었다 — 토큰층을 우회한 두 번째 색 원천.
 *   2. 목록이 동일 카드 21장 반복 — 디자인 문서가 명시적으로 금지한 형태이고,
 *      "한국 전문 정보 자산"이 아니라 링크 더미로 읽힌다.
 *   3. 상세는 청크가 오는 동안 **아무것도** 그리지 않았다(빈 로딩). 청크 로드 실패는
 *      404 와 같은 화면으로 흘러 "글이 없다"고 거짓말했다 — 재시도 경로 없음.
 *   4. 목록 빈 상태 없음(빈 그리드), 본문이 영어 고정이라는 안내 없음,
 *      가격·운행시간이 변한다는 갱신 안내 없음.
 *
 * 왜 source-text 단언인가: 실제 import 는 firebase/react-router 를 node 테스트로
 * 끌고 온다. 렌더 계약은 editorial-guide.component.test.tsx 가 jsdom 에서 본다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { GUIDE_COPY, pickGuideCopy, readingMinutes, WORDS_PER_MINUTE } from '../../src/sections/guide/guideCopy';
import guidesIndexRaw from '../../src/content/guides/_index.json';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const LANGS = ['en', 'ko', 'ja', 'zh'] as const;

type IndexEntry = {
  slug: string;
  title: string;
  description: string;
  published: string;
  updated: string;
  labels: string[];
  image?: string;
  words?: number;
};
const guidesIndex = guidesIndexRaw as IndexEntry[];

const GUIDE_DIR = 'src/content/guides';
const GUIDE_FILES = [
  ...readdirSync(path.join(ROOT, 'src/sections/guide')).map((f) => `src/sections/guide/${f}`),
  'src/pages/GuidePage.tsx',
  'src/styles/guide-editorial.css',
];

/** Structural key path list — value-independent, so translations can differ. */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => keyPaths(v, `${prefix}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .flatMap((k) => keyPaths((value as Record<string, unknown>)[k], prefix ? `${prefix}.${k}` : k));
  }
  return [prefix];
}

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('가이드 카피 — 4언어 parity', () => {
  it('ko/en/ja/zh 가 완전히 같은 키 구조를 갖는다', () => {
    const reference = keyPaths(GUIDE_COPY.en);
    expect(reference.length).toBeGreaterThan(20);
    for (const lang of LANGS) {
      expect(keyPaths(GUIDE_COPY[lang]), `${lang} diverged from en`).toEqual(reference);
    }
  });

  it('어떤 언어에도 빈 문자열이 없다', () => {
    for (const lang of LANGS) {
      const blanks = keyPaths(GUIDE_COPY[lang]).filter((p) => {
        const value = p
          .replace(/\[(\d+)\]/g, '.$1')
          .split('.')
          .reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], GUIDE_COPY[lang]);
        return typeof value === 'string' && value.trim() === '';
      });
      expect(blanks, `${lang} has blank copy`).toEqual([]);
    }
  });

  it('pickGuideCopy 는 모르는 언어를 en 으로 폴백한다', () => {
    expect(pickGuideCopy('ja')).toBe(GUIDE_COPY.ja);
    expect(pickGuideCopy('de')).toBe(GUIDE_COPY.en);
    expect(pickGuideCopy('')).toBe(GUIDE_COPY.en);
  });

  // 본문은 영어 고정(블로그 채널과 같은 정책). 한국어 UI 로 들어온 사람이 제목만 보고
  // 열었다가 영어 벽을 만나는 것이 전환 전 실제 동작이었다 — 네 언어 모두에서
  // 그 언어의 글자로 "본문은 영어" 라고 말해야 한다.
  it('본문 언어 안내가 4언어 각자의 문자로 "영어"를 지목한다', () => {
    const ENGLISH_IN: Record<(typeof LANGS)[number], RegExp> = {
      en: /english/i,
      ko: /영어/,
      ja: /英語/,
      zh: /英语|英文/,
    };
    for (const lang of LANGS) {
      expect(GUIDE_COPY[lang].article.bodyLanguage, `${lang} body-language notice`).toMatch(ENGLISH_IN[lang]);
    }
  });

  // 값이 변하는 정보(요금·운행시간)는 "언제 기준인지"를 반드시 달고 나가야 한다.
  // 출처는 지어내지 않는다 — 우리가 가진 진짜 값은 글의 updated 날짜뿐이다.
  it('갱신 안내는 {date} 자리표시자를 갖고, 4언어 모두 재확인을 요구한다', () => {
    for (const lang of LANGS) {
      expect(GUIDE_COPY[lang].article.freshness, `${lang} freshness`).toContain('{date}');
    }
  });

  it('목록 카운트 문구는 {n} 자리표시자로 실제 개수를 받는다 (숫자 박제 금지)', () => {
    for (const lang of LANGS) {
      expect(GUIDE_COPY[lang].index.count, `${lang} count`).toContain('{n}');
      expect(GUIDE_COPY[lang].index.count, `${lang} count hardcodes a number`).not.toMatch(/\d/);
    }
  });
});

describe('읽는 시간 — 실제 낱말 수에서만 파생', () => {
  it('낱말 수가 없으면 null 을 준다 (허위 숫자 금지)', () => {
    expect(readingMinutes(undefined)).toBeNull();
    expect(readingMinutes(0)).toBeNull();
    expect(readingMinutes(-5)).toBeNull();
  });

  it('WORDS_PER_MINUTE 로 반올림하고 최소 1분', () => {
    expect(readingMinutes(WORDS_PER_MINUTE)).toBe(1);
    expect(readingMinutes(10)).toBe(1);
    expect(readingMinutes(WORDS_PER_MINUTE * 3)).toBe(3);
  });

  it('실제 글 21편이 전부 1~15분 사이로 떨어진다 (파생식 sanity)', () => {
    for (const g of guidesIndex) {
      const minutes = readingMinutes(g.words);
      expect(minutes, `${g.slug} has no word count`).not.toBeNull();
      expect(minutes!).toBeGreaterThanOrEqual(1);
      expect(minutes!).toBeLessThanOrEqual(15);
    }
  });
});

describe('_index.json 파생 필드 ↔ 실제 본문 (드리프트 잠금)', () => {
  const files = readdirSync(path.join(ROOT, GUIDE_DIR)).filter((f) => f.endsWith('.json') && f !== '_index.json');
  const docOf = (slug: string) => JSON.parse(read(`${GUIDE_DIR}/${slug}.json`)) as { html: string };

  it('목록 항목 수 == 로컬 글 파일 수', () => {
    expect(guidesIndex.length).toBe(files.length);
  });

  // image/words 는 사람이 적는 값이 아니라 본문에서 계산된 값이다. 손으로 고치거나
  // 동기화 스크립트가 회귀하면 화면의 사진·읽는 시간이 글과 어긋난다.
  it('image 는 그 글 본문의 첫 <img src> 와 정확히 같다', () => {
    for (const g of guidesIndex) {
      const first = /<img[^>]+src="([^"]+)"/.exec(docOf(g.slug).html)?.[1];
      expect(g.image, `${g.slug} lead image`).toBe(first);
    }
  });

  it('본문에 이미지가 없으면 image 키 자체가 없다 (빈 문자열·플레이스홀더 금지)', () => {
    for (const g of guidesIndex) {
      if (g.image === undefined) continue;
      expect(g.image, `${g.slug} placeholder image`).not.toBe('');
      expect(g.image!.startsWith('http') || g.image!.startsWith('/'), `${g.slug} image is not a URL`).toBe(true);
    }
  });

  it('words 가 본문 낱말 수와 ±0 으로 일치한다', () => {
    const count = (html: string) =>
      html
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[a-z#0-9]+;/gi, ' ')
        .split(/\s+/)
        .filter(Boolean).length;
    for (const g of guidesIndex) {
      expect(g.words, `${g.slug} words`).toBe(count(docOf(g.slug).html));
    }
  });
});

describe('시각 언어 — 다크 셸·그라데이션·글로우·글래스 금지', () => {
  const FORBIDDEN: [RegExp, string][] = [
    [/bg-clip-text/, 'gradient text'],
    [/\bbg-gradient-to-/, 'tailwind gradient background'],
    [/linear-gradient|radial-gradient|conic-gradient/, 'CSS gradient'],
    [/shadow-glow/, 'glow shadow'],
    [/drop-shadow-\[/, 'arbitrary glow'],
    [/backdrop-blur/, 'glass card'],
    [/framer-motion|from ['"]motion/, 'animation library'],
  ];

  it('가이드 트리에 금지 시각 효과가 없다', () => {
    const offences: string[] = [];
    for (const file of GUIDE_FILES) {
      const code = stripComments(read(file));
      for (const [re, label] of FORBIDDEN) if (re.test(code)) offences.push(`${file}: ${label}`);
    }
    expect(offences).toEqual([]);
  });

  // 전환 전 두 화면이 들고 있던 것들. 토큰층 밖의 두 번째 색 원천이라 되돌아오면 안 된다.
  it('다크 시스템 잔재(raw hex·흰 알파·다크 그라데이션)가 남아 있지 않다', () => {
    const LEGACY: [RegExp, string][] = [
      [/#[0-9a-fA-F]{3,8}\b/, 'raw hex'],
      [/text-white|bg-white\/|border-white\//, 'white-alpha dark palette'],
      [/#0a0412|#0d0618|#080210/, 'dark page gradient'],
    ];
    const offences: string[] = [];
    for (const file of GUIDE_FILES) {
      const code = stripComments(read(file));
      for (const [re, label] of LEGACY) if (re.test(code)) offences.push(`${file}: ${label}`);
    }
    expect(offences).toEqual([]);
  });

  it('새 코드는 nullish 병합 연산자를 쓰지 않는다 (mojibake 가드 오탐 회피)', () => {
    const NULLISH = new RegExp(String.fromCharCode(63, 63).replace(/./g, '\\$&'));
    for (const file of GUIDE_FILES) {
      expect(read(file), `${file} uses the nullish coalescing operator`).not.toMatch(NULLISH);
    }
  });
});

describe('스코프 — 다른 레인의 파일을 건드리지 않는다', () => {
  // #1275 가 src/index.css 와 src/i18n/locales/*.json 을 동시에 고치고 있다.
  // 본문 프로즈 스타일은 index.css 의 `.guide-article`(다크) 을 덮어쓰는 대신
  // 새 클래스로 갈아탄다 — 특이도 싸움도, 같은 줄 충돌도 없다.
  it('본문 프로즈는 index.css 의 .guide-article 이 아니라 자체 .ec-prose 를 쓴다', () => {
    const page = read('src/pages/GuidePage.tsx');
    const article = read('src/sections/guide/GuideArticleBody.tsx');
    expect(`${page}${article}`, 'still bound to the dark .guide-article cascade').not.toMatch(
      /className="[^"]*\bguide-article\b/,
    );
    expect(read('src/styles/guide-editorial.css')).toMatch(/\.ec-prose\b/);
    expect(page).toMatch(/guide-editorial\.css/);
  });

  it('가이드 카피는 로컬 사전이라 locales/*.json 을 늘리지 않는다', () => {
    const en = read('src/i18n/locales/en.json');
    expect(en).not.toMatch(/"guideIndex"|"guideArticle"/);
  });
});

describe('상태 배선 — 로딩·빈 목록·오류·재시도·글 없음', () => {
  const article = read('src/sections/guide/GuideArticleBody.tsx');
  const index = read('src/sections/guide/GuideIndexBody.tsx');
  const page = read('src/pages/GuidePage.tsx');

  it('상세는 공용 상태 구성요소(EcLoading/EcError/EcEmpty)를 쓴다', () => {
    expect(article).toMatch(/EcLoading/);
    expect(article).toMatch(/EcError/);
    expect(article).toMatch(/EcEmpty/);
  });

  it('목록은 빈 상태를 그린다 (빈 그리드 금지)', () => {
    expect(index).toMatch(/EcEmpty/);
  });

  // 전환 전: 청크 로드 실패가 404 와 같은 화면으로 흘렀다. "없는 글"과 "못 불러온 글"은
  // 사용자가 할 수 있는 일이 다르다 — 하나는 목록으로, 하나는 재시도다.
  it('로드 실패와 404 를 다른 상태로 구분한다', () => {
    expect(page).toMatch(/'error'|"error"/);
    expect(page).toMatch(/'missing'|"missing"/);
  });

  // 2026-08-11 Chromium 실측: 동적 import 가 한 번 거절되면 모듈 맵에 실패가 남아
  // 같은 loader 를 다시 부르면 네트워크를 타지 않고 즉시 거절된다. 상태만 올리는
  // 소프트 재시도는 영원히 성공할 수 없는 버튼이 된다(브라우저에서 눌러 확인함).
  it('재시도는 전체 새로고침이다 (소프트 재호출 금지)', () => {
    expect(page, 'retry must force a fresh fetch, not re-call the cached loader').toMatch(
      /window\.location\.reload\(\)/,
    );
  });

  // 라우트 청크가 오는 동안 뜨던 것은 다크 플래너 스켈레톤(#080b14)이었다 —
  // 종이 배경 위에 검은 판이 번쩍이고, 모양도 가이드 화면과 무관했다.
  it('가이드 라우트의 Suspense 폴백이 플래너 스켈레톤이 아니다', () => {
    const app = read('src/App.tsx');
    const guideRoutes = app.split('\n').filter((l) => /path="\/guide/.test(l)).join('\n');
    expect(guideRoutes, 'guide routes not found').toMatch(/path="\/guide"/);
    expect(guideRoutes, 'guide still falls back to the dark planner skeleton').not.toMatch(/PlannerSkeleton/);
  });
});
