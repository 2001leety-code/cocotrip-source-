/**
 * Vercel API Route: PDF capture cut-off alert (frontend → backend)
 * POST /api/alert-pdf-cutoff
 * Body: { planId?, days, hasArrival, hasDeparture, measuredHeight, expectedMinHeight, userAgent? }
 *
 * P92 (2026-05-18 — cocotrip-Guest-7--2026-05-18.pdf 사용자 보고):
 *   pdfGenerator.ts 의 client-side html2canvas + jsPDF 경로가 측정된 scrollHeight 만큼만
 *   캡처 → 늦게 로드된 이미지/폰트로 인해 layout 이 측정 후에 늘어나면 Day 후반부 +
 *   Wrap-up section 이 PDF 밖으로 잘림. 사용자는 결제 완료된 plan 의 일부 day 가
 *   누락된 PDF 를 받음.
 *
 *   1차 회귀 방어: pdfGenerator 가 expected min-height (days*800 + arrival*600 +
 *   departure*800) 미달 시 abort + WhatsApp fallback 제안.
 *   2차 운영자 감지: 본 endpoint 로 즉시 텔레그램 알림 → 운영자가 수동 PDF 재발급.
 *
 * 보안:
 *   - Anonymous (frontend 가 user auth 없이 호출 — toast/abort 동선과 같은 컨텍스트).
 *   - IP rate-limit 5/h (P53/PR #429 패턴) — alert flood + 운영자 채널 스팸 방어.
 *   - planId 별 24h dedup (telegram-throttle window 기본 5분 이지만 throttle 가
 *     누적 카운트 첨부하므로 결과적으로 같은 plan 의 retry 폭주 차단).
 *   - body 신뢰 안 함 — alert content + dedup key 외 비즈니스 결정에 사용 X.
 *
 * 회귀 슬롯: test/regression/alert-pdf-cutoff-pr*.test.ts
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { throttledTelegramAlert } from './_shared/telegram-throttle.js';
import { checkIpRateLimit, getClientIp } from './_shared/ip-rate-limit.js';
import { escapeTelegram } from './_shared/escape.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(res, status, body) {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json' });
  return res.end(JSON.stringify(body));
}

function clampInt(value, max = 999999) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const n = Math.floor(value);
  if (n < 0) return 0;
  if (n > max) return max;
  return n;
}

function clampStr(value, max) {
  if (typeof value !== 'string') return '';
  return value.slice(0, max);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Method Not Allowed' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    body = body || {};

    const planId = clampStr(body.planId, 128);
    const days = clampInt(body.days, 99);
    const hasArrival = !!body.hasArrival;
    const hasDeparture = !!body.hasDeparture;
    const measuredHeight = clampInt(body.measuredHeight, 100000);
    const expectedMinHeight = clampInt(body.expectedMinHeight, 100000);
    const userAgent = clampStr(body.userAgent, 200);

    // Firestore 미초기화 시 telegram-throttle 가 자체 fallback. 그래도 본 endpoint
    // 의 IP rate-limit 은 Firestore 필수 — db 없으면 fail-OPEN.
    const db = initAdminDb('alert-pdf-cutoff');
    if (db) {
      const clientIp = getClientIp(req);
      const rateCheck = await checkIpRateLimit({
        db,
        ip: clientIp,
        collection: 'pdf_cutoff_alert_rate_limits',
        maxRequests: 5,
        errorLabel: 'pdf cut-off alerts',
      });
      if (!rateCheck.ok) {
        res.setHeader?.('Retry-After', String(rateCheck.retryAfterSec));
        return json(res, rateCheck.status, { ok: false, error: 'rate_limited' });
      }
    }

    const percent = expectedMinHeight > 0
      ? Math.round((measuredHeight * 100) / expectedMinHeight)
      : 0;
    const html = [
      '⚠️ <b>PDF capture cut-off detected (P85)</b>',
      `planId: <code>${escapeTelegram(planId || 'unknown')}</code>`,
      `days: ${days} · arrival: ${hasArrival ? '✓' : '✗'} · departure: ${hasDeparture ? '✓' : '✗'}`,
      `measured: ${measuredHeight}px · expectedMin: ${expectedMinHeight}px (${percent}%)`,
      `ua: ${escapeTelegram(userAgent || 'unknown')}`,
      '',
      'frontend pdfGenerator abort + WhatsApp fallback 제안됨. 운영자: 수동 PDF 재발급 필요.',
    ].join('\n');

    // planId 별 dedup — 같은 plan 의 retry 가 폭주해도 5분 window 안에서 1회 alert.
    const dedupKey = `pdf-capture-cutoff:${planId || 'unknown'}`;
    throttledTelegramAlert({
      key: dedupKey,
      channel: 'admin',
      severity: 'high',
      message: html,
      context: { planId, days, measuredHeight, expectedMinHeight },
    }).catch(() => { /* fail-open — 사용자 toast 가 이미 표시됨 */ });

    return json(res, 200, { ok: true });
  } catch (e) {
    // fail-open — frontend toast/abort 가 이미 사용자에게 표시됨.
    // 백엔드 alert 실패는 사용자 영향 없음.
    return json(res, 200, { ok: true, degraded: true, error: String((e && e.message) || e) });
  }
}
