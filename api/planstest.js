// /planstest — 서버 렌더링 플랜 뷰 (AI/봇 읽기 전용).
//
// 배경: 우리 사이트는 CSR SPA 라 /my-plans/:id 는 JS 로 화면을 그린다 → 봇/AI(코덱스
//   등)가 주소만 fetch 하면 빈 페이지만 본다. 이 엔드포인트는 플랜 내용을 **서버에서
//   HTML 로 채워** 반환하므로 AI 가 바로 읽는다 (자문/리뷰용).
//
// 보안:
//   - get-plan 과 동일 게이트 — plan.isPublic === true 인 플랜만 노출.
//     (운영자가 플랜 화면의 "공유" 토글을 Public 으로 켜야 열림.)
//   - PII 는 resolvePlanAccess 의 masked 경로로 자동 제거 (uid/email/pricing/주소 등).
//   - 비공개 플랜은 안내 메시지만 (내용 0).
//
// 라우팅: vercel.json rewrites 에 { "/planstest" -> "/api/planstest" } (catch-all 보다 위).
// planId: ?planId= 쿼리, 없으면 DEFAULT_PLAN_ID (운영자 데모 플랜).

import { initAdminDb } from './_ai_core/firestoreAdmin.js';
import { resolvePlanAccess } from './get-plan.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const DEFAULT_PLAN_ID = 'f6fa12ce-f353-4038-92cf-1677bc6eb6cf';

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function won(n) {
  const v = Number(n);
  if (!v || Number.isNaN(v)) return '';
  return v.toLocaleString('en-US') + '원';
}

// 필드명 폴백 (신 || 구 스키마 — CLAUDE.md C 규칙)
function stopName(s) {
  return s.display_name || s.name_en || s.name || s.name_ko || '(이름 없음)';
}
function stopTip(s) {
  return s.tip || s.tip_en || '';
}

function renderTransit(label, t) {
  if (!t) return '';
  const min = t.est_min ? `${t.est_min}분` : '';
  const fare = t.est_fare_krw ? ` · ${won(t.est_fare_krw)}` : '';
  const instr = t.instruction || t.instruction_en || '';
  const parts = [esc(t.method || ''), esc(min) + esc(fare), esc(instr)].filter(Boolean);
  return `<p class="transit">🚍 ${esc(label)}: ${parts.join(' · ')}</p>`;
}

function renderStop(s) {
  const meta = [];
  if (s.category) meta.push(esc(s.category));
  if (s.stay_min) meta.push(`${esc(s.stay_min)}분 체류`);
  if (s.entry_fee_krw) meta.push(`입장료 ${won(s.entry_fee_krw)}`);
  else if (s.entry_fee_note) meta.push(esc(s.entry_fee_note));
  const addr = s.address || s.address_en || '';
  const tip = stopTip(s);
  const resv = s.reservation_required
    ? `<p class="resv">⚠️ 예약 필요${s.reservation_note ? ' — ' + esc(s.reservation_note) : ''}</p>`
    : '';
  return `
    <article class="stop">
      ${renderTransit('직전 → 이곳', s.transit_from_prev || s.travelFromPrev)}
      <h4>${esc(s.start_time || '')} · ${esc(stopName(s))}</h4>
      ${meta.length ? `<p class="meta">${meta.join(' · ')}</p>` : ''}
      ${addr ? `<p class="addr">📍 ${esc(addr)}</p>` : ''}
      ${resv}
      ${tip ? `<p class="tip">💡 ${esc(tip)}</p>` : ''}
    </article>`;
}

function renderDay(d) {
  const head = `Day ${esc(d.day)}${d.city ? ' — ' + esc(d.city) : ''}${d.theme ? ' · ' + esc(d.theme) : ''}${d.date ? ` (${esc(d.date)})` : ''}`;
  const inter = d.intercity_transit
    ? `<p class="intercity">🚄 도시 간 이동: ${esc(d.intercity_transit.mode || '')} ${esc(d.intercity_transit.from_city || '')}→${esc(d.intercity_transit.to_city || '')} · ${esc(d.intercity_transit.est_min || '')}분 · ${won(d.intercity_transit.est_fare_krw)}${d.intercity_transit.recommended_depart ? ' · 출발 ' + esc(d.intercity_transit.recommended_depart) : ''}</p>`
    : '';
  const stops = Array.isArray(d.stops) ? d.stops.map(renderStop).join('') : '';
  return `
    <section class="day">
      <h3>${head}</h3>
      ${inter}
      ${renderTransit('숙소 → 첫 장소', d.lodging_to_first)}
      ${stops}
      ${renderTransit('마지막 → 숙소', d.last_to_lodging)}
    </section>`;
}

function renderGuideSteps(title, guide) {
  if (!guide || !Array.isArray(guide.steps) || guide.steps.length === 0) return '';
  const steps = guide.steps
    .map((st) => `<li>${esc(st.instruction || '')}${st.details ? ' — ' + esc(st.details) : ''}${st.est_min ? ` (${esc(st.est_min)}분)` : ''}${st.fare_krw ? ` · ${won(st.fare_krw)}` : ''}</li>`)
    .join('');
  return `<section class="guide"><h3>${esc(title)}${guide.airport ? ' — ' + esc(guide.airport) : ''}</h3><ol>${steps}</ol></section>`;
}

function renderBudget(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const trs = rows
    .map((r) => `<tr><td>Day ${esc(r.day)}</td><td>${won(r.transport_krw)}</td><td>${won(r.entry_fees_krw)}</td><td>${won(r.meals_krw)}</td><td>${won(r.activities_krw)}</td><td><b>${won(r.total_krw)}</b></td></tr>`)
    .join('');
  return `<section class="budget"><h3>일별 예산 (1인 추정)</h3><table><thead><tr><th>날</th><th>교통</th><th>입장</th><th>식사</th><th>활동</th><th>합계</th></tr></thead><tbody>${trs}</tbody></table></section>`;
}

export function renderPlanHtml(plan) {
  const it = plan.itinerary || {};
  const title = it.tour_title || '여행 플랜';
  const days = Array.isArray(it.days) ? it.days.map(renderDay).join('') : '<p>일정 데이터 없음.</p>';
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} — CocoTrip Plan</title>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; max-width: 820px; margin: 0 auto; padding: 24px 16px 80px; line-height: 1.6; color: #1a1a2e; }
  h1 { font-size: 1.6rem; border-bottom: 2px solid #7C5CFC; padding-bottom: 8px; }
  h3 { margin-top: 28px; color: #7C5CFC; }
  .day { border-left: 3px solid #e5e0f5; padding-left: 14px; margin: 16px 0; }
  .stop { background: #faf9ff; border: 1px solid #eee; border-radius: 10px; padding: 10px 14px; margin: 10px 0; }
  .stop h4 { margin: 4px 0; }
  .meta, .addr, .tip, .resv, .transit, .intercity { font-size: 0.9rem; margin: 3px 0; }
  .meta { color: #666; } .addr { color: #444; } .tip { color: #0a7; }
  .resv { color: #c50; } .transit { color: #7C5CFC; } .intercity { color: #c0392b; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; margin-top: 8px; }
  th, td { border: 1px solid #eee; padding: 6px 8px; text-align: right; } th:first-child, td:first-child { text-align: left; }
  .note { color: #888; font-size: 0.8rem; margin-top: 40px; border-top: 1px solid #eee; padding-top: 12px; }
</style>
</head>
<body>
<h1>${esc(title)}</h1>
${days}
${renderGuideSteps('공항 도착 가이드', it.arrival_guide)}
${renderGuideSteps('출국 가이드', it.departure_guide)}
${renderBudget(it.daily_budget_summary)}
<p class="note">CocoTrip AI Planner · 서버 렌더링 뷰 (AI 자문용). 개인정보는 표시되지 않습니다.</p>
</body>
</html>`;
}

export default async function handler(req, res) {
  const HTML = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };
  try {
    const query = req.query || {};
    const planId = ((query.planId || DEFAULT_PLAN_ID) + '').trim();

    const adminDb = initAdminDb('planstest');
    if (!adminDb) {
      res.writeHead(500, HTML);
      return res.end('<!doctype html><meta charset=utf-8><p>일시적으로 사용할 수 없습니다.</p>');
    }

    const snap = await adminDb.collection('plans').doc(planId).get();
    if (!snap.exists) {
      res.writeHead(404, HTML);
      return res.end('<!doctype html><meta charset=utf-8><p>플랜을 찾을 수 없습니다.</p>');
    }

    const planRaw = snap.data() || {};
    const result = resolvePlanAccess(planRaw, ''); // 토큰 없음 → isPublic 이면 masked, 아니면 denied

    if (result.access === 'denied') {
      res.writeHead(403, HTML);
      return res.end(`<!doctype html><meta charset=utf-8><body style="font-family:sans-serif;max-width:560px;margin:60px auto;padding:0 16px;line-height:1.6">
        <h2>이 플랜은 아직 비공개입니다 🔒</h2>
        <p>AI(코덱스 등)가 읽으려면 먼저 <b>플랜 화면의 "공유" 버튼에서 Public 으로 켜주세요.</b> 켜면 이 주소가 바로 열립니다 (개인정보는 표시 안 됨).</p>
      </body>`);
    }

    res.writeHead(200, HTML);
    return res.end(renderPlanHtml(result.plan));
  } catch (err) {
    console.error('[planstest] error:', err);
    res.writeHead(500, HTML);
    return res.end('<!doctype html><meta charset=utf-8><p>오류가 발생했습니다.</p>');
  }
}
