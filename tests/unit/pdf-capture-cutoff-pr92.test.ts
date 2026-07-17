/**
 * P92 (2026-05-18) — PDF capture cut-off regression slot.
 *
 * Pre-fix: src/pages/PlanDetailPage/pdfGenerator.ts measured `container.scrollHeight`
 * once, immediately after a fixed `setTimeout(200+300=500ms)` post-image-preload.
 * For 7+ day plans with many stop photos (especially external-origin via
 * /api/image-proxy from P78), the layout reflow finished AFTER the measurement
 * — html2canvas then captured only the early measured height, silently dropping
 * Day 6 후반 + Day 7 + Wrap-up. The user paid for a 7-day plan but received a
 * PDF that ended mid-Day-6 at a lunch arrival (cocotrip-Guest-7--2026-05-18.pdf).
 *
 * Post-fix:
 *   1) Real image-load await (load / error events, 5s cap each) before measurement.
 *   2) `scrollHeight` stabilization loop — measure every 200ms up to 5 tries
 *      until two consecutive samples agree.
 *   3) `expectedMinHeight = days*800 + arrival*600 + departure*800` hard gate
 *      (was fail-open warn). On miss: abort + WhatsApp fallback toast + fire
 *      /api/alert-pdf-cutoff for operator Telegram alert. Better to refuse the
 *      download than to ship a silently truncated PDF.
 *
 * Backend P85 alert endpoint:
 *   - Anonymous (frontend-only flow) → IP rate-limit 5/h on
 *     pdf_cutoff_alert_rate_limits (P53/PR #429 shared helper).
 *   - planId-keyed Telegram throttle (P67/PR #443) — same plan retries within
 *     the 5-min window collapse to one alert.
 *
 * If a future refactor reintroduces single-shot scrollHeight measurement OR
 * loosens the min-height gate to warn-only OR drops the backend alert path,
 * one of these assertions fails — operator sees the regression before users do.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const generatorSrc = readFileSync(
  resolve(process.cwd(), 'src/pages/PlanDetailPage/pdfGenerator.ts'),
  'utf8',
);
const alertSrc = readFileSync(
  resolve(process.cwd(), 'api/alert-pdf-cutoff.js'),
  'utf8',
);

describe('P92 —pdfGenerator capture cut-off prevention (frontend)', () => {
  it('awaits real image load events (load + error) before measuring height', () => {
    // The fix moved away from `setTimeout(N)` timing guesses. Both events
    // signal "layout is stable for this img" — load = success, error =
    // browser gave up (still no further reflow).
    expect(generatorSrc).toMatch(/addEventListener\(\s*['"]load['"]/);
    expect(generatorSrc).toMatch(/addEventListener\(\s*['"]error['"]/);
    // 5s hard cap per image so /api/image-proxy hang doesn't stall PDF gen forever.
    expect(generatorSrc).toMatch(/setTimeout\(\s*done\s*,\s*5000\s*\)/);
  });

  it('stabilizes scrollHeight across multiple measurements (not single-shot)', () => {
    // Loop until two consecutive samples match OR cap reached. Single-shot
    // measurement is what shipped the truncated PDF — block its return.
    const hasLoop = /while\s*\(\s*h1\s*!==\s*h2[\s\S]{0,200}container\.scrollHeight/.test(generatorSrc);
    expect(hasLoop).toBe(true);
  });

  it('forces a double-rAF flush before measurement (paint settles)', () => {
    expect(generatorSrc).toMatch(/requestAnimationFrame\([\s\S]{0,80}requestAnimationFrame/);
  });

  it('hard-aborts with WhatsApp fallback when measured < expectedMinHeight', () => {
    // expectedMinH = days*800 + arrival*600 + departure*800. Below that = the
    // capture is shorter than the html builder's output → truncation cert.
    expect(generatorSrc).toMatch(/expectedMinH\s*=\s*days\.length\s*\*\s*800/);
    expect(generatorSrc).toMatch(/scrollH\s*<\s*expectedMinH/);
    // Toast + return (not just console.warn + continue).
    // 2026-07-17: 토스트 문구가 4언어 사전(PDF_TOAST_STR.missingDays)으로 이동 —
    // 잠금 의도(에러 토스트 존재)는 사전 키 + toast.error 호출로 검증.
    expect(generatorSrc).toMatch(/toast\.error\(\s*toastStr\.missingDays/);
    expect(generatorSrc).toMatch(/missingDays:\s*'PDF generated with missing days'/);
    expect(generatorSrc).toMatch(/wa\.me\/821087140611/);
  });

  it('auto-escalates to server PDF endpoint on cut-off (VITE flag bypassed)', () => {
    // The whole point of P92 — if client capture is short, don't dump the user
    // into manual WhatsApp triage; force the server endpoint that already
    // exists (`api/pdf/generate.js`, Puppeteer + Chromium, immune to all 5
    // root causes the client path has). VITE_USE_SERVER_PDF env stays
    // optional for the happy path, but cut-off recovery must NOT depend on it.
    expect(generatorSrc).toMatch(/tryServerPdf\(\s*plan\s*,\s*\{\s*force\s*:\s*true\s*\}\s*\)/);
    // The tryServerPdf helper must honor force by skipping the VITE check.
    expect(generatorSrc).toMatch(/if\s*\(\s*!opts\.force\s*&&\s*import\.meta\.env\.VITE_USE_SERVER_PDF/);
    // When server recovery succeeds, open the blob and return success-toast
    // (NOT the error toast / WhatsApp path).
    expect(generatorSrc).toMatch(/recoveredViaServer\s*=\s*true/);
    expect(generatorSrc).toMatch(/toast\.success\([^)]*pdfReady/);
    // Recovery telemetry — operator must be able to distinguish auto-recovered
    // hits from manual-intervention hits.
    expect(generatorSrc).toMatch(/format\s*:\s*['"]pdf-server-recovery['"]/);
  });

  it('reports recoveredViaServer in the backend alert payload', () => {
    // Operator gets a different signal for auto-recovered (env nudge) vs
    // unrecovered (critical: server endpoint also broken, manual reissue).
    expect(generatorSrc).toMatch(/recoveredViaServer\s*,?\s*\}/);
  });

  it('fires backend alert with planId + heights + UA on cut-off', () => {
    // The fetch is fire-and-forget but the call site must exist with the
    // right URL and key payload fields (operator needs planId for replay).
    expect(generatorSrc).toMatch(/fetch\(\s*['"]\/api\/alert-pdf-cutoff['"]/);
    expect(generatorSrc).toMatch(/planId\s*:\s*cutPlanId/);
    expect(generatorSrc).toMatch(/measuredHeight\s*:\s*scrollH/);
    expect(generatorSrc).toMatch(/expectedMinHeight\s*:\s*expectedMinH/);
  });

  it('still aborts via toast even if backend alert fetch fails (fail-open)', () => {
    // .catch on the alert fetch — operator-side notification is best-effort,
    // never block the user-side abort + WhatsApp fallback path on it.
    // 800-char window accommodates the recoveredViaServer payload body.
    expect(generatorSrc).toMatch(/\/api\/alert-pdf-cutoff[\s\S]{0,800}\.catch\(/);
  });
});

describe('P92 —/api/alert-pdf-cutoff backend (operator alert)', () => {
  it('is POST-only with OPTIONS preflight', () => {
    expect(alertSrc).toMatch(/req\.method\s*===\s*['"]OPTIONS['"]/);
    expect(alertSrc).toMatch(/req\.method\s*!==\s*['"]POST['"]/);
  });

  it('uses the shared IP rate-limit helper (5/h) — anonymous flood guard', () => {
    expect(alertSrc).toMatch(
      /import\s*\{[^}]*checkIpRateLimit[^}]*\}\s*from\s*['"]\.\/_shared\/ip-rate-limit\.js['"]/,
    );
    const callMatch = alertSrc.match(/checkIpRateLimit\s*\(\s*\{[\s\S]*?\}\s*\)/);
    expect(callMatch, 'checkIpRateLimit must be invoked').not.toBeNull();
    expect(callMatch![0]).toMatch(/collection\s*:\s*['"]pdf_cutoff_alert_rate_limits['"]/);
    expect(callMatch![0]).toMatch(/maxRequests\s*:\s*5/);
  });

  it('routes through throttledTelegramAlert (admin channel, recovery-aware dedup key)', () => {
    expect(alertSrc).toMatch(/from\s*['"]\.\/_shared\/telegram-throttle\.js['"]/);
    expect(alertSrc).toMatch(/key\s*:\s*dedupKey/);
    // dedup key includes recovery state so 'auto-recovered' and 'critical' hits
    // don't collapse together — operator sees both as separate signals.
    expect(alertSrc).toMatch(/recoveredViaServer\s*\?\s*['"]recovered['"]\s*:\s*['"]critical['"]/);
    expect(alertSrc).toMatch(/channel\s*:\s*['"]admin['"]/);
    // Severity downgrades to 'medium' when auto-recovery succeeded (user is OK).
    expect(alertSrc).toMatch(/severity\s*:\s*recoveredViaServer\s*\?\s*['"]medium['"]\s*:\s*['"]high['"]/);
  });

  it('parses recoveredViaServer flag and reflects it in the message body', () => {
    expect(alertSrc).toMatch(/const\s+recoveredViaServer\s*=\s*!!body\.recoveredViaServer/);
    // Status line differs based on flag — operator-readable action guidance.
    expect(alertSrc).toMatch(/자동 복구 성공/);
    expect(alertSrc).toMatch(/자동 복구 실패/);
  });

  it('escapes planId + UA before HTML interpolation (P46 hygiene)', () => {
    expect(alertSrc).toMatch(
      /import\s*\{[^}]*escapeTelegram[^}]*\}\s*from\s*['"]\.\/_shared\/escape\.js['"]/,
    );
    // Both untrusted fields go through escapeTelegram before being put in the message.
    expect(alertSrc).toMatch(/escapeTelegram\(\s*planId\s*\|\|\s*['"]unknown['"]\s*\)/);
    expect(alertSrc).toMatch(/escapeTelegram\(\s*userAgent\s*\|\|\s*['"]unknown['"]\s*\)/);
  });

  it('clamps numeric and string inputs (no untrusted body amplification)', () => {
    // clampInt for measuredHeight / expectedMinHeight prevents a malicious
    // body from baking 999_999_999 into the operator message.
    expect(alertSrc).toMatch(/function\s+clampInt/);
    expect(alertSrc).toMatch(/function\s+clampStr/);
    expect(alertSrc).toMatch(/clampInt\(\s*body\.measuredHeight\s*,\s*100000\s*\)/);
    expect(alertSrc).toMatch(/clampStr\(\s*body\.userAgent\s*,\s*200\s*\)/);
  });

  it('fail-open on internal error (frontend toast already shown to user)', () => {
    // Endpoint returning 5xx would make the frontend .catch swallow it anyway,
    // but returning 200 keeps response.ok semantics clean for any future caller.
    expect(alertSrc).toMatch(/degraded\s*:\s*true/);
  });
});
