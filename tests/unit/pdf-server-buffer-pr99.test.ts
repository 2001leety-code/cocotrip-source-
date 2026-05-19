/**
 * P99 (2026-05-19) — api/pdf/generate.js Puppeteer `page.pdf()` 응답 Uint8Array 회귀 차단.
 *
 * Pre-fix: `return res.status(200).send(pdfBuffer)` where pdfBuffer 는 Puppeteer 21+
 * 의 `page.pdf()` return type 인 `Uint8Array` (Buffer 아님). Vercel serverless
 * `res.send(Uint8Array)` 는 그 객체를 JSON-serialize → `{"0":37,"1":80,"2":68,...}`
 * (PDF magic bytes 의 ASCII codes). Content-Type 은 `application/pdf` 인데 body 는
 * JSON. 사용자 다운로드 파일을 PDF reader 가 못 열음.
 *
 * 발견 경로: 2026-05-19 상용화 전 prod 점검에서 pdf-golden-check.mjs 가 received
 * binary 의 첫 100 bytes 검사 → `%PDF-` magic bytes 아닌 `{"0":37,...` JSON 발견.
 * happy path 사용자는 client html2canvas 만 사용하므로 영향 X. P92 cut-off
 * fallback (tryServerPdf force) 또는 VITE_USE_SERVER_PDF=true 일 때만 발동.
 *
 * Post-fix:
 *   1) `Buffer.from(pdfRaw)` 명시 변환 — Uint8Array → Buffer
 *   2) `res.end(pdfBuffer)` (lower-level binary) — `res.send()` 의 JSON-serialize 경로 회피
 *   3) `Content-Length` header — explicit binary length
 *
 * 회귀 시: PDF golden CI (PR #484) 의 A1 assertion (pages >= 5) 가 즉시 fail —
 * pdf-parse 가 InvalidPDFException throw. 본 unit test 는 source-level backup.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'api/pdf/generate.js'),
  'utf8',
);

describe('P99 — api/pdf/generate.js Buffer/Uint8Array binary response', () => {
  it('explicitly wraps page.pdf() return in Buffer.from', () => {
    // Puppeteer 21+ returns Uint8Array. Buffer.from() 명시 변환 필수.
    expect(src).toMatch(/const\s+pdfBuffer\s*=\s*Buffer\.from\(\s*pdfRaw\s*\)/);
  });

  it('uses res.end() instead of res.send() for binary response', () => {
    // res.send() 는 일부 Vercel runtime 에서 Buffer 를 JSON-serialize 함.
    // res.end() 는 raw binary 강제 — Express-like lower-level API.
    expect(src).toMatch(/res\.end\(\s*pdfBuffer\s*\)/);
    // 본 endpoint 에 res.send(pdfBuffer) 패턴 절대 없어야 함.
    expect(src).not.toMatch(/res\.\w*send\([^)]*pdfBuffer/);
  });

  it('sets Content-Length header explicitly', () => {
    // res.end() 사용 시 Content-Length 명시 권장 — 일부 client (browser
    // download) 가 length 없으면 streaming 모드로 처리해 retry 안전성 떨어짐.
    expect(src).toMatch(/setHeader\([^)]*Content-Length[^)]*pdfBuffer\.length/);
  });

  it('still sets Content-Type: application/pdf', () => {
    // 회귀 가드 — content-type 빠지면 browser 가 octet-stream 으로 처리.
    expect(src).toMatch(/setHeader\(\s*['"]Content-Type['"]\s*,\s*['"]application\/pdf['"]/);
  });

  it('still sets Content-Disposition attachment with filename', () => {
    expect(src).toMatch(/setHeader\(\s*['"]Content-Disposition['"]\s*,\s*[`'"]attachment;\s*filename=/);
  });
});
