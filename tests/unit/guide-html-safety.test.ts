// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
// @ts-expect-error — Node import audit module has no declaration file.
import { auditGuideHtml } from '../../scripts/guide-html-safety.mjs';
import { sanitizeGuideHtml } from '../../src/lib/sanitizeGuideHtml';

const SAFE = '<p class="post-summary"><em>Summary</em></p><h2>Plan</h2><p><a href="/planner">Planner</a> <img src="https://cocotripkr.com/a.webp" alt="A" loading="lazy"></p>';

const MALICIOUS = [
  '<p class="post-summary evil" style="position:fixed" onclick="alert(1)">Text</p>',
  '<script>alert(1)</script><style>body{display:none}</style>',
  '<iframe src="https://evil.example"></iframe><form action="https://evil.example"><input></form>',
  '<a href="jav&#x61;script:alert(1)" target="_blank">bad</a>',
  '<img src="data:image/svg+xml,<svg onload=alert(1)>" onerror="alert(1)" srcset="https://evil 2x">',
  '<svg><a href="javascript:alert(1)">svg</a></svg>',
  '<a href="https://example.com/path">safe link</a>',
].join('');

describe('guide HTML shared sanitizer', () => {
  it('Brain과 byte 계약을 맺은 DOMPurify/JSDOM 정확 버전을 잠근다', () => {
    const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
      dependencies: { dompurify: string };
      devDependencies: { jsdom: string };
    };
    const packageLock = JSON.parse(readFileSync(path.join(process.cwd(), 'package-lock.json'), 'utf8')) as {
      packages: Record<string, {
        version?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      }>;
    };

    expect(packageJson.dependencies.dompurify).toBe('3.4.12');
    expect(packageJson.devDependencies.jsdom).toBe('29.1.1');
    expect(packageLock.packages[''].dependencies?.dompurify).toBe('3.4.12');
    expect(packageLock.packages[''].devDependencies?.jsdom).toBe('29.1.1');
    expect(packageLock.packages['node_modules/dompurify'].version).toBe('3.4.12');
    expect(packageLock.packages['node_modules/jsdom'].version).toBe('29.1.1');
  });

  it('안전 allowlist HTML은 그대로 두고 Node/browser 결과가 같다', () => {
    const node = auditGuideHtml(SAFE);
    expect(node.changed).toBe(false);
    expect(node.html).toBe(SAFE);
    expect(sanitizeGuideHtml(SAFE)).toBe(SAFE);
  });

  it('Brain rights-complete figure fixture를 한 글자도 바꾸지 않는다', () => {
    const figure = '<figure><img src="https://cocotripkr.com/blog-images/2026/rain.webp" alt="Seoul rain &amp; subway"><figcaption>KTO-approved photo &amp; source</figcaption></figure>\n<p>Plan the route.</p>';
    const node = auditGuideHtml(figure);
    expect(node).toEqual({ html: figure, changed: false });
    expect(sanitizeGuideHtml(figure)).toBe(figure);
  });

  it('Brain 승인 전 canonicalizer와 같은 double-quote/void-tag 바이트를 잠근다', () => {
    const generated = "<p><a href='/planner'>Plan</a><br/></p>";
    const canonical = '<p><a href="/planner">Plan</a><br></p>';
    expect(auditGuideHtml(generated)).toEqual({ html: canonical, changed: true });
    expect(auditGuideHtml(canonical)).toEqual({ html: canonical, changed: false });
    expect(sanitizeGuideHtml(canonical)).toBe(canonical);
  });

  it('script/style/form/svg/handler/javascript/data URL을 결정적으로 제거한다', () => {
    const node = auditGuideHtml(MALICIOUS);
    const browser = sanitizeGuideHtml(MALICIOUS);
    expect(browser).toBe(node.html);
    expect(node.changed).toBe(true);
    expect(node.html).not.toMatch(/<script|<style|<iframe|<form|<input|<svg/i);
    expect(node.html).not.toMatch(/\son[a-z]+\s*=|javascript:|data:|srcset=|style=/i);
    expect(node.html).toContain('<p class="post-summary">Text</p>');
    expect(node.html).toContain('<a>bad</a>');
    expect(node.html).toContain('<a href="https://example.com/path">safe link</a>');
  });

  it('정제 결과는 다시 정제해도 바뀌지 않는다', () => {
    const once = auditGuideHtml(MALICIOUS).html;
    const twice = auditGuideHtml(once);
    expect(twice.changed).toBe(false);
    expect(twice.html).toBe(once);
  });

  it('현재 guide 파일 전부와 다음 Brain projection도 개수 고정 없이 안전 검증한다', () => {
    const dir = path.join(process.cwd(), 'src', 'content', 'guides');
    const files = readdirSync(dir).filter((file) => file.endsWith('.json') && file !== '_index.json');
    const index = JSON.parse(readFileSync(path.join(dir, '_index.json'), 'utf8')) as { slug: string }[];
    expect(files.length).toBeGreaterThan(0);
    expect(files.map((file) => file.replace(/\.json$/, '')).sort())
      .toEqual(index.map((guide) => guide.slug).sort());

    const docs = files.map((file) => ({
      file,
      doc: JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as { html: string; contentSha256?: string },
    }));
    const projectionFixtureHtml = '<figure><img src="https://cocotripkr.com/blog-images/2026/new.webp" alt="New guide"><figcaption>Approved source</figcaption></figure>\n<p>New safe guide body.</p>';
    docs.push({
      file: 'next-brain-projection-fixture.json',
      doc: {
        html: projectionFixtureHtml,
        contentSha256: createHash('sha256').update(projectionFixtureHtml, 'utf8').digest('hex'),
      },
    });

    for (const { file, doc } of docs) {
      expect(doc.html, file).not.toMatch(/<script|<iframe|<form|<svg|\son[a-z]+\s*=|(?:href|src)\s*=\s*['"]\s*(?:javascript|data):/i);
      const clean = auditGuideHtml(doc.html).html;
      expect(clean.trim(), file).not.toBe('');
      expect(clean, file).not.toMatch(/<script|<style|<iframe|<form|<svg|\son[a-z]+\s*=|(?:href|src)\s*=\s*['"]\s*(?:javascript|data):/i);
      if (doc.contentSha256) {
        expect(doc.contentSha256, `${file} contentSha256`)
          .toBe(createHash('sha256').update(doc.html, 'utf8').digest('hex'));
      }
    }
  });
});
