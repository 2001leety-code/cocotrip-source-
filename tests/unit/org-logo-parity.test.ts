// 회사 로고가 두 곳에 따로 적혀 있다 — 두 벌이 어긋나지 않게 잠근다 (2026-08-06).
//
// 왜: 구글에 보내는 회사 로고가
//     ① index.html 의 전역 TravelAgency (정적 HTML — 상수 import 불가)
//     ② src/lib/jsonLd.ts 의 PUBLISHER (Article/글 페이지의 발행처)
//     두 곳에 있다. 한쪽만 바꾸면 홈과 글 페이지가 서로 다른 로고를 광고한다.
//     이 레포에서 "한쪽만 고침" 이 8/3~6 에만 7번 났다 — 값이 2곳이면 잠근다.
//
// 그리고 로고 파일이 실제로 존재하는지도 본다. 경로만 바꾸고 파일을 안 올리면
// 구글이 404 를 받고 로고가 통째로 사라진다(파비콘일 때보다 나빠진다).
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildArticleJsonLd } from '../../src/lib/jsonLd';

const ROOT = path.resolve(__dirname, '../..');

function logoFromIndexHtml(): string {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const block = html.match(/"@type":\s*"TravelAgency"[\s\S]*?\n\s*\}/);
  expect(block, 'index.html 에 TravelAgency 스키마가 없다').not.toBeNull();
  const m = block![0].match(/"logo":\s*"([^"]+)"/);
  expect(m, 'TravelAgency 에 logo 가 없다').not.toBeNull();
  return m![1];
}

function logoFromArticle(): string {
  const ld = buildArticleJsonLd({
    path: '/guide/x',
    title: 't',
    description: 'd',
    datePublished: '2026-01-01',
    dateModified: '2026-01-01',
  }) as { publisher?: { logo?: { url?: string } } };
  const url = ld?.publisher?.logo?.url;
  expect(url, 'Article publisher 에 로고 URL 이 없다').toBeTruthy();
  return url!;
}

describe('회사 로고 — 두 곳의 값이 같아야 한다', () => {
  it('index.html TravelAgency 와 Article publisher 의 로고가 같다', () => {
    expect(logoFromArticle()).toBe(logoFromIndexHtml());
  });

  it('로고 파일이 public/ 에 실제로 있다', () => {
    const url = logoFromArticle();
    const rel = url.replace('https://cocotripkr.com/', '');
    const file = path.join(ROOT, 'public', rel);
    expect(fs.existsSync(file), `${rel} 파일이 없다 — 구글이 404 를 받는다`).toBe(true);
  });

  it('구글 권장 크기(112px 이상)를 넘는다', () => {
    // PNG 헤더에서 폭·높이를 직접 읽는다(의존성 추가 없이).
    const url = logoFromArticle();
    const rel = url.replace('https://cocotripkr.com/', '');
    const buf = fs.readFileSync(path.join(ROOT, 'public', rel));
    expect(buf.subarray(1, 4).toString('ascii'), 'PNG 가 아니다').toBe('PNG');
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    expect(width, `가로 ${width}px`).toBeGreaterThanOrEqual(112);
    expect(height, `세로 ${height}px`).toBeGreaterThanOrEqual(112);
  });

  it('앱 아이콘(어두운 배경)이 아니라 투명 배경 마크를 쓴다', () => {
    // icon-*.png 는 둥근 사각 + 어두운 배경이라 흰 검색 화면에서 검은 네모가 뜬다.
    expect(logoFromArticle()).not.toMatch(/\/icon[-.]/);
    expect(logoFromArticle()).toMatch(/logo-mark/);
  });
});
