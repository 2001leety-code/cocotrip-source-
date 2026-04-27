// Vercel serverless function — server-side PDF generation via Puppeteer + Chromium.
// Replaces client html2canvas pipeline 5대 root cause:
//   1. CJK 폰트 timing: 서버 컨테이너에 Noto Sans 사전 로드 → 100% 보장
//   2. scrollHeight > 12000px: Chromium은 메모리 1GB+ → 수십 페이지 OK
//   3. 모바일 OOM: 클라이언트 메모리 무관
//   4. 이미지 CORS: 서버에서 직접 fetch
//   5. iOS 백그라운드 throttle: 서버는 throttle 없음
//
// Auth: Firebase ID token으로 plan 소유자만 접근 (다른 사람 plan PDF 생성 차단).
// Vercel Pro 플랜 한정 — Hobby의 50MB function size 제한으로 Chromium 안 들어감.

import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { initAdminDb } from '../_shared/firebase-admin.js';
import { verifyIdToken } from '../_shared/admin-auth.js';

export const config = {
  // Vercel Pro: 최대 60초. cold start 5-10s + render 10-30s + output 5s
  maxDuration: 60,
  // memory 설정은 Active CPU billing에서 무시됨 (Vercel 2025 변경) — 자동 할당.
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  // === Auth: Firebase ID token으로 사용자 식별 ===
  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!idToken) {
    return res.status(401).json({ error: 'unauthorized', detail: 'Missing Bearer token' });
  }
  let uid;
  try {
    const decoded = await verifyIdToken(idToken);
    uid = decoded.uid;
  } catch (e) {
    return res.status(401).json({ error: 'unauthorized', detail: e.message });
  }

  // === Plan ID 검증 ===
  const { planId } = req.body || {};
  if (!planId || typeof planId !== 'string') {
    return res.status(400).json({ error: 'invalid_plan_id' });
  }

  // === Firestore에서 plan 가져오기 + 소유권 검증 ===
  let plan;
  try {
    const db = initAdminDb();
    const doc = await db.collection('plans').doc(planId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'plan_not_found' });
    }
    plan = doc.data();
    if (plan.userId !== uid && plan.uid !== uid) {
      return res.status(403).json({ error: 'forbidden', detail: 'Plan owned by another user' });
    }
  } catch (e) {
    console.error('[PDF] Firestore fetch failed:', e);
    return res.status(500).json({ error: 'firestore_error', detail: e.message });
  }

  // === Puppeteer + @sparticuz/chromium 으로 PDF 생성 ===
  let browser = null;
  try {
    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
      defaultViewport: { width: 800, height: 1200, deviceScaleFactor: 2 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
    const page = await browser.newPage();

    // HTML 템플릿 — 클라이언트 pdfGenerator.ts와 동일한 구조 (간소화).
    // 추후 별도 모듈로 추출해 클라이언트/서버 공유 (Phase 3 후속).
    const html = buildPlanHtml(plan);
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

    // 폰트 로드 대기 — Chromium 컨테이너에 Noto Sans 사전 설치되어 있어 빠름
    await page.evaluateHandle('document.fonts.ready');

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' },
      preferCSSPageSize: false,
    });

    await browser.close();
    browser = null;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="cocotrip-${planId}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-cache');
    return res.status(200).send(pdfBuffer);
  } catch (e) {
    console.error('[PDF] generation failed:', e);
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
    return res.status(500).json({ error: 'pdf_generation_failed', detail: e.message });
  }
}

// === Plan → HTML 변환 ===
// 클라이언트 pdfGenerator.ts의 HTML build 로직을 단순화한 server-side 버전.
// 추후 shared module로 통합 권장. CJK 폰트는 서버 Chromium이 자동 fallback.
function buildPlanHtml(plan) {
  const it = plan.itinerary || {};
  const days = it.days || [];
  const input = plan.input || {};

  const css = `
    body { font-family: 'Noto Sans KR', 'Noto Sans JP', 'Noto Sans SC', system-ui, sans-serif; line-height: 1.6; color: #1a1a2e; padding: 0; margin: 0; }
    .container { padding: 40px; max-width: 800px; margin: 0 auto; }
    h1 { font-size: 26px; color: #7C5CFC; margin: 0 0 6px; text-align: center; }
    h2 { font-size: 18px; color: #1a1a2e; margin: 16px 0 8px; }
    .header { text-align: center; padding-bottom: 20px; border-bottom: 2px solid #7C5CFC; margin-bottom: 28px; }
    .meta { color: #888; font-size: 13px; }
    .day { margin-bottom: 24px; page-break-inside: avoid; }
    .day-title { background: #f0edff; padding: 10px 14px; border-radius: 8px; font-weight: 700; font-size: 16px; color: #7C5CFC; }
    .stop { padding: 12px; border: 1px solid #e0e0e0; border-radius: 8px; margin-top: 8px; background: #f8f9fc; }
    .stop-time { font-weight: 700; color: #7C5CFC; font-size: 14px; }
    .stop-name { font-weight: 700; font-size: 15px; margin: 2px 0; }
    .stop-desc { font-size: 13px; color: #555; }
    .stop-tip { font-size: 12px; color: #888; font-style: italic; margin-top: 4px; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e0e0e0; text-align: center; font-size: 11px; color: #888; }
  `;

  let body = `<div class="container">`;
  body += `<div class="header">
    <h1>${escapeHtml(it.tour_title || 'Your Korea Itinerary')}</h1>
    <p class="meta">${escapeHtml(input.startDate || '')} | ${input.adults || input.pax || '-'} pax</p>
    <p class="meta">Generated by CocoTrip AI · cocotripkr.com</p>
  </div>`;

  for (let di = 0; di < days.length; di++) {
    const day = days[di];
    body += `<div class="day"><div class="day-title">Day ${day.day || di + 1}: ${escapeHtml(day.theme || '')}</div>`;
    const stops = day.stops || [];
    for (const stop of stops) {
      const name = stop.display_name || stop.name || stop.name_ko || stop.name_en || '';
      body += `<div class="stop">
        <div class="stop-time">${escapeHtml(stop.time || stop.start_time || '')}</div>
        <div class="stop-name">${escapeHtml(name)}</div>
        ${stop.description ? `<div class="stop-desc">${escapeHtml(stop.description)}</div>` : ''}
        ${stop.tip ? `<div class="stop-tip">Tip: ${escapeHtml(stop.tip)}</div>` : ''}
      </div>`;
    }
    body += `</div>`;
  }

  body += `<div class="footer">CocoTrip · cocotripkr.com · WhatsApp: +82-10-8714-0611</div></div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
