/**
 * 공개 메타데이터(index.html 의 twitter/og/JSON-LD, public/llms.txt)에 AI 를
 * 서비스 행위자로 내세우는 문구가 없는지 잠근다 (2026-08-11).
 *
 * 배경: PR #1276/#1280 은 렌더된 화면 문구를 정리했지만, 검색·소셜·LLM 크롤러가
 * 읽는 정적 메타데이터(index.html <head>, public/llms.txt)는 별도 경로라
 * 두 PR 모두 손대지 않았다. 라이브 검증에서 twitter:description, TravelAgency
 * JSON-LD description, llms.txt 의 플래너 항목 3곳에 "AI travel planner" /
 * "AI-powered" 가 남아 있는 것이 확인됐다.
 *
 * 내부 API/GEMINI/model 식별자는 검사 대상이 아니다 — 이 테스트는 공개 메타데이터만 본다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');

// `/AI/i` 는 못 쓴다 — "AI" 를 포함하지 않는 단어(예: 없음)라도 대소문자 무시 검사는
// 사고 위험이 있어 단어 경계로 고정한다. 대시 뒤 AI(-AI, AI-)도 걸리게 한다.
const AI_ACTOR_PATTERNS = [/\bAI\b/, /\bAI-powered\b/i, /\bAI-curated\b/i];

function readIndexHtml(): string {
  return fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
}

function readLlmsTxt(): string {
  return fs.readFileSync(path.join(ROOT, 'public', 'llms.txt'), 'utf8');
}

function extractMetaContent(html: string, matcher: RegExp): string {
  const m = html.match(matcher);
  expect(m, `메타 태그를 못 찾음: ${matcher}`).not.toBeNull();
  return m![1];
}

describe('index.html 공개 메타데이터에 AI 행위자 표기가 없다', () => {
  const html = readIndexHtml();

  it('twitter:description', () => {
    const content = extractMetaContent(html, /<meta name="twitter:description" content="([^"]+)"/);
    for (const p of AI_ACTOR_PATTERNS) expect(content, `${p}: ${content}`).not.toMatch(p);
  });

  it('og:description', () => {
    const content = extractMetaContent(html, /<meta property="og:description" content="([^"]+)"/);
    for (const p of AI_ACTOR_PATTERNS) expect(content, `${p}: ${content}`).not.toMatch(p);
  });

  it('meta name="description"', () => {
    const content = extractMetaContent(html, /<meta name="description" content="([^"]+)"/);
    for (const p of AI_ACTOR_PATTERNS) expect(content, `${p}: ${content}`).not.toMatch(p);
  });

  it('<title>', () => {
    const content = extractMetaContent(html, /<title>([^<]+)<\/title>/);
    for (const p of AI_ACTOR_PATTERNS) expect(content, `${p}: ${content}`).not.toMatch(p);
  });

  it('TravelAgency JSON-LD description', () => {
    const block = html.match(/"@type":\s*"TravelAgency"[\s\S]*?\n\s*\}/);
    expect(block, 'index.html 에 TravelAgency 스키마가 없다').not.toBeNull();
    const content = extractMetaContent(block![0], /"description":\s*"([^"]+)"/);
    for (const p of AI_ACTOR_PATTERNS) expect(content, `${p}: ${content}`).not.toMatch(p);
  });

  it('twitter/og/JSON-LD 가 "한국 현지 데이터 기반 자동 일정" 이라는 같은 의미를 공유한다', () => {
    const twitter = extractMetaContent(html, /<meta name="twitter:description" content="([^"]+)"/);
    const og = extractMetaContent(html, /<meta property="og:description" content="([^"]+)"/);
    const block = html.match(/"@type":\s*"TravelAgency"[\s\S]*?\n\s*\}/)![0];
    const jsonLd = extractMetaContent(block, /"description":\s*"([^"]+)"/);
    for (const content of [twitter, og, jsonLd]) {
      expect(content, content).toMatch(/Korea itinerar(y|ies)/i);
    }
  });

  it('결제·상품 의미(No hidden fees)는 그대로다 — 이 정리가 상품 정보를 지우면 안 된다', () => {
    const twitter = extractMetaContent(html, /<meta name="twitter:description" content="([^"]+)"/);
    expect(twitter).toMatch(/No hidden fees/);
  });
});

describe('public/llms.txt 에 AI 행위자 표기가 없다', () => {
  const txt = readLlmsTxt();
  // "## Notes for AI assistants" 는 독자(크롤러)를 부르는 제목이지 서비스 행위자
  // 주장이 아니다 — 이 한 줄만 빼고 본문 전체를 검사한다.
  const bodyWithoutAudienceHeading = txt.replace(/^## Notes for AI assistants$/m, '');

  it('본문 전체에 AI 행위자 패턴이 없다', () => {
    for (const p of AI_ACTOR_PATTERNS) expect(bodyWithoutAudienceHeading).not.toMatch(p);
  });

  it('플래너 항목은 여전히 실제 경로/기능(날짜·인원·예산·식이)을 설명한다', () => {
    expect(txt).toMatch(/Trip planner/);
    expect(txt).toMatch(/halal, vegetarian, allergies/);
    expect(txt).toMatch(/cocotripkr\.com\/planner/);
  });

  it('"Notes for AI assistants" 제목은 그대로다 — 이건 독자(크롤러)를 부르는 이름이지 서비스 행위자 주장이 아니다', () => {
    expect(txt).toMatch(/## Notes for AI assistants/);
  });
});

describe('npm run build 산출물(dist)에도 같은 잠금이 적용된다', () => {
  const distIndex = path.join(ROOT, 'dist', 'index.html');
  const distLlms = path.join(ROOT, 'dist', 'llms.txt');
  const hasDist = fs.existsSync(distIndex) && fs.existsSync(distLlms);

  it.runIf(hasDist)('dist/index.html 메타데이터에 AI 행위자 표기가 없다', () => {
    const html = fs.readFileSync(distIndex, 'utf8');
    const twitter = extractMetaContent(html, /<meta name="twitter:description" content="([^"]+)"/);
    const og = extractMetaContent(html, /<meta property="og:description" content="([^"]+)"/);
    const block = html.match(/"@type":\s*"TravelAgency"[\s\S]*?\n\s*\}/)![0];
    const jsonLd = extractMetaContent(block, /"description":\s*"([^"]+)"/);
    for (const content of [twitter, og, jsonLd]) {
      for (const p of AI_ACTOR_PATTERNS) expect(content, `${p}: ${content}`).not.toMatch(p);
    }
  });

  it.runIf(hasDist)('dist/llms.txt 에 AI 행위자 표기가 없다', () => {
    const txt = fs.readFileSync(distLlms, 'utf8').replace(/^## Notes for AI assistants$/m, '');
    for (const p of AI_ACTOR_PATTERNS) expect(txt).not.toMatch(p);
  });

  if (!hasDist) {
    it.skip('dist/ 미존재 — npm run build 이후에만 검증됨 (CI unit 잡은 build 없이 실행)', () => {});
  }
});
