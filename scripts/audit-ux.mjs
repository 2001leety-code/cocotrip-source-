#!/usr/bin/env node
/**
 * CocoTrip — UX/i18n Audit (auto-screenshot all pages × langs × viewports)
 *
 * Detects:
 *   - i18n parity gaps  (keys in ko but missing in en/ja/zh, etc.)
 *   - Untranslated text  (Latin words rendered on a ko/ja/zh page)
 *   - Duplicate text     (likely render bug — same string ≥3x)
 *   - Truncation         (text-overflow:ellipsis + scrollWidth > offsetWidth)
 *   - Tap target misses  (button/link < 44x44 on mobile, WCAG 2.5.5)
 *   - Horizontal scroll  (page wider than viewport — layout overflow)
 *
 * Outputs:
 *   reports/ux-audit-YYYY-MM-DD.md   — Markdown summary
 *   reports/ux-audit-YYYY-MM-DD.json — full structured findings
 *   reports/ux-screenshots/*.jpg     — page × lang × viewport captures
 *
 * Usage:
 *   node scripts/audit-ux.mjs                            # local: http://localhost:5173 (dev server must be running)
 *   node scripts/audit-ux.mjs https://cocotripkr.com     # production
 *   node scripts/audit-ux.mjs http://localhost:5173 --quick   # 1 viewport, 1 lang sample
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const BASE_URL = (process.argv.find(a => a.startsWith('http')) || 'http://localhost:5173').replace(/\/$/, '');
const QUICK = process.argv.includes('--quick');

const LANGS = QUICK ? ['ko'] : ['ko', 'en', 'ja', 'zh'];
const VIEWPORTS = QUICK
  ? [{ name: 'iphone-se', w: 375, h: 667 }]
  : [
      { name: 'iphone-se',   w: 375,  h: 667 },
      { name: 'iphone-14',   w: 393,  h: 852 },
      { name: 'tablet',      w: 768,  h: 1024 },
      { name: 'desktop',     w: 1280, h: 800 },
    ];

// Auth-gated pages (mypage, my-plans) are skipped — login screen would dominate findings.
const PAGES = [
  { path: '/',        name: 'home' },
  { path: '/tours',   name: 'tours' },
  { path: '/charter', name: 'charter' },
  { path: '/planner', name: 'planner' },
  { path: '/about',   name: 'about' },
];

const REPORT_DIR = path.join(ROOT, 'reports');
const SHOTS_DIR = path.join(REPORT_DIR, 'ux-screenshots');
fs.mkdirSync(SHOTS_DIR, { recursive: true });

// Brand / proper-noun keep-as-is list. These won't count as "untranslated" even on non-en pages.
const KEEP_AS_IS = [
  'CocoTrip', 'COCOTRIP', 'COCO', 'Trip.com', 'PayPal', 'WhatsApp', 'KakaoTalk',
  'Google', 'Naver', 'AI', 'AREX', 'ICN', 'GMP', 'PUS', 'CJU', 'PWA', 'T-money',
  'OK', 'PDF', 'JPG', 'PNG', 'KRW', 'USD', 'JPY', 'CNY', 'EUR', 'CocoTripKR',
  'WiFi', 'Wi-Fi', 'SIM', 'eSIM', 'KT', 'SKT', 'LG', 'GPS', 'URL', 'API',
  'K-pop', 'K-Pop', 'KPOP', 'K-beauty', 'K-Beauty', 'K-Drama', 'K-drama',
  'Kpop', 'KFood', 'KBeauty', 'EARLY50', 'BBQ', 'DMZ', 'JSA',
];

// ──────────────────────────────────────────────────────────────────
// STATIC CHECK 1: i18n parity (keys present in ko but missing elsewhere)
// ──────────────────────────────────────────────────────────────────
function flattenKeys(obj, prefix = '') {
  const out = new Set();
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const sub of flattenKeys(v, key)) out.add(sub);
    } else {
      out.add(key);
    }
  }
  return out;
}

function auditI18nParity() {
  const dir = path.join(ROOT, 'src/i18n/locales');
  const data = {};
  for (const lang of ['ko', 'en', 'ja', 'zh']) {
    const p = path.join(dir, `${lang}.json`);
    if (!fs.existsSync(p)) continue;
    data[lang] = JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  if (!data.ko) return [];
  const baseKeys = flattenKeys(data.ko);
  const findings = [];
  for (const lang of ['en', 'ja', 'zh']) {
    if (!data[lang]) continue;
    const k = flattenKeys(data[lang]);
    const missing = [...baseKeys].filter(x => !k.has(x));
    const extra = [...k].filter(x => !baseKeys.has(x));
    if (missing.length || extra.length) {
      findings.push({
        type: 'i18n_parity',
        lang,
        missing_count: missing.length,
        extra_count: extra.length,
        missing_sample: missing.slice(0, 10),
        extra_sample: extra.slice(0, 5),
      });
    }
  }
  return findings;
}

// ──────────────────────────────────────────────────────────────────
// RUNTIME CHECK (per page × lang × viewport)
// ──────────────────────────────────────────────────────────────────
async function auditPage(page, ctx) {
  const { lang, viewport, pageInfo } = ctx;
  const findings = [];

  // 1. Untranslated text (Latin > 70%) on non-en page
  if (lang !== 'en') {
    const items = await page.evaluate((keep) => {
      const out = [];
      const seen = new Set();
      const sels = 'button, a, h1, h2, h3, h4, h5, p, span, label, li, td, th';
      document.querySelectorAll(sels).forEach((el) => {
        // Only check leaf-ish elements to avoid summing children twice.
        if (el.children.length > 1) return;
        const text = (el.textContent || '').trim();
        if (!text || text.length < 4) return;
        if (seen.has(text)) return;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        // Skip pure number / time / currency
        if (/^[\d\s$₩,.\-+/:%~]+$/.test(text)) return;
        // Latin ratio
        const latin = (text.match(/[a-zA-Z]/g) || []).length;
        const denom = text.replace(/\s/g, '').length;
        if (denom < 4) return;
        const ratio = latin / denom;
        if (ratio < 0.7) return;
        if (!/[a-zA-Z]{3,}/.test(text)) return;
        // Skip brand keep-list
        if (keep.some((k) => text === k || text.startsWith(k + ' ') || text.endsWith(' ' + k) || text.includes(' ' + k + ' '))) return;
        // Skip ALL-CAPS short labels (likely abbreviations)
        if (/^[A-Z0-9\s\-]{2,8}$/.test(text)) return;
        seen.add(text);
        out.push({ tag: el.tagName, text: text.slice(0, 100) });
      });
      return out;
    }, KEEP_AS_IS);
    for (const it of items) {
      findings.push({ type: 'untranslated', page: pageInfo.name, lang, viewport: viewport.name, ...it });
    }
  }

  // 2. Duplicate visible text (≥3 occurrences of same heading/button text on a single page)
  const dups = await page.evaluate(() => {
    const counts = new Map();
    const els = new Map();
    document.querySelectorAll('h1, h2, h3, h4, button, a').forEach((el) => {
      const text = (el.textContent || '').trim();
      if (!text || text.length < 5 || text.length > 80) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      counts.set(text, (counts.get(text) || 0) + 1);
      if (!els.has(text)) els.set(text, el.tagName);
    });
    const out = [];
    for (const [text, n] of counts) {
      if (n >= 3) out.push({ text: text.slice(0, 80), count: n, tag: els.get(text) });
    }
    return out;
  });
  for (const it of dups) {
    findings.push({ type: 'duplicate_text', page: pageInfo.name, lang, viewport: viewport.name, ...it });
  }

  // 3. Truncation
  const trunc = await page.evaluate(() => {
    const out = [];
    const seen = new Set();
    document.querySelectorAll('*').forEach((el) => {
      if (el.children.length > 0) return; // leaf only
      const cs = getComputedStyle(el);
      if (cs.textOverflow !== 'ellipsis' && cs.overflow !== 'hidden' && cs.overflowX !== 'hidden') return;
      if (el.scrollWidth <= el.offsetWidth + 1) return;
      const text = (el.textContent || '').trim();
      if (!text || text.length < 3 || seen.has(text)) return;
      seen.add(text);
      out.push({ tag: el.tagName, text: text.slice(0, 80), scroll: el.scrollWidth, offset: el.offsetWidth });
    });
    return out;
  });
  for (const it of trunc) {
    findings.push({ type: 'truncation', page: pageInfo.name, lang, viewport: viewport.name, ...it });
  }

  // 4. Tap target violations (mobile only)
  if (viewport.w < 768) {
    const tap = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('button, a[href], [role="button"]').forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        if (rect.width < 44 || rect.height < 44) {
          const text = (el.textContent || '').trim().slice(0, 40);
          // Skip elements that are inside a 44+ tappable parent (common pattern for icon-only links wrapped in a row)
          let p = el.parentElement;
          let safe = false;
          for (let i = 0; i < 3 && p; i++) {
            const pr = p.getBoundingClientRect();
            if ((p.tagName === 'A' || p.tagName === 'BUTTON' || p.getAttribute('role') === 'button')
                && pr.width >= 44 && pr.height >= 44) { safe = true; break; }
            p = p.parentElement;
          }
          if (!safe) {
            out.push({ tag: el.tagName, text, w: Math.round(rect.width), h: Math.round(rect.height) });
          }
        }
      });
      return out;
    });
    for (const it of tap) {
      findings.push({ type: 'tap_target', page: pageInfo.name, lang, viewport: viewport.name, ...it });
    }
  }

  // 5. Horizontal scroll
  const horiz = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  if (horiz.scroll > horiz.client + 1) {
    findings.push({
      type: 'horizontal_scroll', page: pageInfo.name, lang, viewport: viewport.name,
      overflow_px: horiz.scroll - horiz.client,
    });
  }

  return findings;
}

// ──────────────────────────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now();
  console.log(`\n┌─ CocoTrip UX Audit`);
  console.log(`│  base:      ${BASE_URL}`);
  console.log(`│  langs:     ${LANGS.join(', ')}`);
  console.log(`│  viewports: ${VIEWPORTS.map((v) => v.name).join(', ')}`);
  console.log(`│  pages:     ${PAGES.map((p) => p.path).join(', ')}`);
  console.log(`└─ ${LANGS.length * VIEWPORTS.length * PAGES.length} runs total\n`);

  // Static
  console.log('▶ Static i18n parity check');
  const all = auditI18nParity();
  console.log(`  ${all.length} parity finding(s)\n`);

  // Runtime
  console.log('▶ Launching Chromium');
  const browser = await chromium.launch();

  for (const lang of LANGS) {
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({
        viewport: { width: vp.w, height: vp.h },
        deviceScaleFactor: 1,
        ignoreHTTPSErrors: true,
      });
      // Set language before any page loads
      await ctx.addInitScript((l) => {
        try { localStorage.setItem('cocotrip_lang', l); } catch (e) { /* noop */ }
      }, lang);
      const page = await ctx.newPage();
      page.on('pageerror', (err) => {
        all.push({ type: 'js_error', lang, viewport: vp.name, error: err.message.slice(0, 200) });
      });
      for (const pg of PAGES) {
        const tag = `${lang.padEnd(3)} / ${vp.name.padEnd(11)} / ${pg.path}`;
        try {
          await page.goto(`${BASE_URL}${pg.path}`, { waitUntil: 'load', timeout: 30000 });
          await page.waitForTimeout(1500); // settle animations / lazy loads
          const before = all.length;
          const f = await auditPage(page, { lang, viewport: vp, pageInfo: pg });
          all.push(...f);
          const shotName = `${pg.name}-${lang}-${vp.name}.jpg`;
          await page.screenshot({
            path: path.join(SHOTS_DIR, shotName),
            fullPage: true,
            quality: 60,
            type: 'jpeg',
          });
          console.log(`  ✓ ${tag}  +${all.length - before} findings`);
        } catch (e) {
          all.push({ type: 'navigation_error', page: pg.name, lang, viewport: vp.name, error: e.message.slice(0, 200) });
          console.log(`  ✗ ${tag}  ERROR: ${e.message.slice(0, 60)}`);
        }
      }
      await ctx.close();
    }
  }
  await browser.close();

  // Build reports
  const stamp = new Date().toISOString().slice(0, 10);
  const jsonPath = path.join(REPORT_DIR, `ux-audit-${stamp}.json`);
  const mdPath = path.join(REPORT_DIR, `ux-audit-${stamp}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify({ base: BASE_URL, generated: new Date().toISOString(), findings: all }, null, 2));
  fs.writeFileSync(mdPath, buildMarkdown(all));

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n┌─ Done in ${elapsed}s`);
  console.log(`│  ${all.length} findings`);
  console.log(`│  ${mdPath}`);
  console.log(`│  ${jsonPath}`);
  console.log(`└─ ${SHOTS_DIR}/  (${fs.readdirSync(SHOTS_DIR).length} screenshots)\n`);
}

function buildMarkdown(findings) {
  const byType = {};
  for (const f of findings) (byType[f.type] = byType[f.type] || []).push(f);

  let md = `# CocoTrip UX Audit\n\n`;
  md += `- **Generated**: ${new Date().toISOString()}\n`;
  md += `- **Base**: \`${BASE_URL}\`\n`;
  md += `- **Total findings**: ${findings.length}\n\n`;

  md += `## Summary by type\n\n`;
  md += `| Type | Count | What it means |\n|---|---|---|\n`;
  const meanings = {
    i18n_parity: 'Locale JSON files have key gaps (ko has it, en/ja/zh missing)',
    untranslated: 'Latin text rendered on a ko/ja/zh page (likely missing i18n key)',
    duplicate_text: 'Same heading/button rendered ≥3 times — likely render bug',
    truncation: 'Text cut off by ellipsis (consider wider container or shorter copy)',
    tap_target: 'Button/link smaller than WCAG 44×44 minimum on mobile',
    horizontal_scroll: 'Page wider than viewport — layout overflow',
    js_error: 'Uncaught JavaScript error during page load',
    navigation_error: 'Page failed to load',
  };
  const order = ['i18n_parity', 'duplicate_text', 'js_error', 'navigation_error', 'horizontal_scroll', 'untranslated', 'truncation', 'tap_target'];
  for (const t of order) {
    if (byType[t]) md += `| **${t}** | ${byType[t].length} | ${meanings[t] || ''} |\n`;
  }

  // Group "untranslated" by page+lang for digestibility
  if (byType.untranslated) {
    md += `\n## Untranslated text (page × lang summary)\n\n`;
    const grouped = {};
    for (const f of byType.untranslated) {
      const k = `${f.page} / ${f.lang}`;
      grouped[k] = (grouped[k] || 0) + 1;
    }
    md += `| Page / Lang | Untranslated count |\n|---|---|\n`;
    for (const [k, n] of Object.entries(grouped).sort((a, b) => b[1] - a[1])) {
      md += `| ${k} | ${n} |\n`;
    }
    md += `\n### Top offending strings\n\n`;
    const txtCounts = new Map();
    for (const f of byType.untranslated) {
      txtCounts.set(f.text, (txtCounts.get(f.text) || 0) + 1);
    }
    const top = [...txtCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
    md += `| String | Pages × langs |\n|---|---|\n`;
    for (const [text, n] of top) md += `| \`${text.replace(/\|/g, '\\|')}\` | ${n} |\n`;
  }

  // Detailed sections
  for (const t of order) {
    if (!byType[t] || t === 'untranslated') continue;
    md += `\n## ${t} (${byType[t].length})\n\n`;
    const items = byType[t].slice(0, 50);
    if (t === 'i18n_parity') {
      for (const f of items) {
        md += `### ${f.lang}\n`;
        md += `- Missing: ${f.missing_count} keys, Extra: ${f.extra_count} keys\n`;
        if (f.missing_sample.length) md += `- Sample missing: ${f.missing_sample.map((x) => '`' + x + '`').join(', ')}\n`;
        md += `\n`;
      }
    } else {
      md += `| Page | Lang | Viewport | Detail |\n|---|---|---|---|\n`;
      for (const f of items) {
        const detail = JSON.stringify(
          Object.fromEntries(Object.entries(f).filter(([k]) => !['type', 'page', 'lang', 'viewport'].includes(k))),
        );
        md += `| ${f.page || '-'} | ${f.lang || '-'} | ${f.viewport || '-'} | \`${detail.slice(0, 120).replace(/\|/g, '\\|')}\` |\n`;
      }
      if (byType[t].length > 50) md += `\n... ${byType[t].length - 50} more (see JSON)\n`;
    }
  }

  md += `\n---\n\n`;
  md += `_Run again: \`node scripts/audit-ux.mjs ${BASE_URL}\` (add \`--quick\` for 1 lang × 1 viewport sample)_\n`;
  return md;
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
