// ─────────────────────────────────────────────────────────────────────────────
// planToMarkdown.ts — Plan → Markdown 변환 (P115, 2026-05-20)
//
// PDF 다운로드 fallback. 사용자가 PDF 깨지면 "텍스트로 다운로드" 클릭 → .md 파일
// 받음 → 메모장/Notion/Apple Notes/Google Docs 어디서나 열림.
//
// 출력 구조:
//   # {tour_title}
//   {region} · {pax} pax · {startDate} ~ {endDate}
//
//   ## Day 1 — {theme} ({date})
//   ### 도착 안내 (T1/T2 + 호텔까지)
//   {arrival_guide details}
//   ### 일정
//   - 09:00-10:00 | {category icon} {display_name}
//     - 주소: {address}
//     - 팁: {tip}
//   ...
//   ## 도시 간 이동 (Seoul → Busan)
//   - KTX 서울역 → 부산역, 출발 09:00 / 도착 11:45
//
// 사진 없음 (텍스트 only). URL 만 옵션으로 포함 (사용자 mobile share 가능).
// ─────────────────────────────────────────────────────────────────────────────
import type { PlanDocument } from '../types';

const CATEGORY_ICON: Record<string, string> = {
  food: '🍽️',
  lodging: '🛏️',
  culture: '🏛️',
  shopping: '🛍️',
  activity: '🎢',
  attraction: '🌄',
  nature: '🌳',
  airport: '✈️',
  transit: '🚆',
};

function escapeMd(s: string | undefined | null): string {
  if (!s) return '';
  // Markdown 특수문자 minimal escape — | (테이블), \ (escape) 만 처리.
  // 본문 가독성 위해 *, _, # 등은 그대로 (대부분 본문 텍스트 안에서 의미 X).
  return String(s).replace(/\|/g, '\\|').replace(/\r/g, '');
}

function nonEmpty(arr: Array<string | undefined | null | false>): string[] {
  return arr.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
}

function timeRange(start?: string, end?: string): string {
  if (start && end) return `${start}-${end}`;
  if (start) return start;
  return '';
}

/**
 * Convert plan document to Markdown string. Browser Blob download ready.
 *
 * @param plan Firestore plan document
 * @param opts Optional config
 * @returns Markdown string (UTF-8)
 */
export function planToMarkdown(
  plan: PlanDocument | undefined | null,
  opts: { language?: string; planUrl?: string } = {},
): string {
  if (!plan) return '';
  const it = (plan as any).itinerary || {};
  const input = (plan as any).input || {};
  const lang = opts.language || input.language || 'ko';

  const out: string[] = [];

  // ── Header ────────────────────────────────────────────────────────────
  const title = it.tour_title || `${input.guestName || 'Guest'}'s Trip`;
  out.push(`# ${escapeMd(title)}`);
  out.push('');

  const headerMeta = nonEmpty([
    input.startDate ? `📅 ${input.startDate}${input.endDate ? ' ~ ' + input.endDate : ''}` : null,
    input.regions && input.regions.length > 0 ? `📍 ${(input.regions as string[]).join(' · ')}` : null,
    input.pax ? `👥 ${input.pax} pax` : null,
    input.vehicle ? `🚐 ${input.vehicle}` : null,
  ]);
  if (headerMeta.length > 0) {
    out.push(headerMeta.join(' · '));
    out.push('');
  }

  if (opts.planUrl) {
    out.push(`🔗 Online: ${opts.planUrl}`);
    out.push('');
  }

  // ── Arrival Guide ─────────────────────────────────────────────────────
  const ag = it.arrival_guide;
  if (ag && ag.airport) {
    out.push(`## ✈️ 도착 안내 (${escapeMd(ag.airport)})`);
    out.push('');
    if (Array.isArray(ag.steps)) {
      for (const step of ag.steps) {
        const stepLine = `${step.step ?? '?'}. **${escapeMd(step.title || '')}** (${step.est_min ?? '?'}분)`;
        out.push(`- ${stepLine}`);
        if (step.description) out.push(`  - ${escapeMd(step.description)}`);
      }
    }
    if (ag.route_to_hotel) {
      const r = ag.route_to_hotel;
      out.push('');
      out.push(`**호텔 가는 길**: ${escapeMd(r.instruction || r.summary || '')} (${r.est_min ?? '?'}분, ${(r.est_fare_krw ?? 0).toLocaleString()}원)`);
    }
    out.push('');
  }

  // ── Days ──────────────────────────────────────────────────────────────
  for (const day of (it.days || [])) {
    const dayNum = day.day ?? '?';
    const dayDate = day.date ? ` (${day.date})` : '';
    const dayCity = day.city ? ` · ${escapeMd(day.city)}` : '';
    out.push(`## Day ${dayNum}${dayDate}${dayCity}`);
    if (day.theme) {
      out.push('');
      out.push(`> ${escapeMd(day.theme)}`);
    }
    out.push('');

    // Intercity transit (KTX/항공/버스) — 도시 간 이동
    const ict = day.intercity_transit;
    if (ict && ict.mode) {
      out.push(`### 🚆 도시 간 이동 (${escapeMd(ict.from_city_display || ict.from_city || '?')} → ${escapeMd(ict.to_city_display || ict.to_city || '?')})`);
      const intercityLines = nonEmpty([
        `- **수단**: ${escapeMd(ict.mode)}`,
        ict.from_station && ict.to_station ? `- **${escapeMd(ict.from_station)} → ${escapeMd(ict.to_station)}**` : null,
        ict.recommended_depart ? `- 출발 시간: ${escapeMd(ict.recommended_depart)}` : null,
        ict.arrival_at ? `- 도착 시간: ${escapeMd(ict.arrival_at)}` : null,
        ict.est_min ? `- 소요: ${ict.est_min}분` : null,
        ict.est_fare_krw ? `- 요금: ${ict.est_fare_krw.toLocaleString()}원` : null,
        ict.booking_url ? `- 예매: ${ict.booking_url}` : null,
        ict.instruction ? `- ${escapeMd(ict.instruction)}` : null,
      ]);
      out.push(...intercityLines);
      // lodging_to_station / station_to_lodging bookend (P111 enrichment 결과)
      if (ict.lodging_to_station) {
        const lts = ict.lodging_to_station;
        out.push(`- 🛏️→🚆 호텔→${escapeMd(ict.from_station || '역')}: ${escapeMd(lts.instruction || '')} (${lts.est_min ?? '?'}분)`);
      }
      if (ict.station_to_lodging) {
        const stl = ict.station_to_lodging;
        out.push(`- 🚆→🛏️ ${escapeMd(ict.to_station || '역')}→호텔: ${escapeMd(stl.instruction || '')} (${stl.est_min ?? '?'}분)`);
      }
      out.push('');
    }

    // Stops
    out.push('### 일정');
    out.push('');
    for (const stop of (day.stops || [])) {
      const icon = CATEGORY_ICON[stop.category] || '📍';
      const time = timeRange(stop.start_time, stop.end_time);
      const timeStr = time ? `**${time}**` : '';
      const name = escapeMd(stop.display_name || stop.name || '?');
      out.push(`- ${timeStr} ${icon} **${name}**`);

      const subLines = nonEmpty([
        stop.address ? `  - 📍 ${escapeMd(stop.address)}` : null,
        stop.entry_fee_krw && stop.entry_fee_krw > 0 ? `  - 💰 입장료: ${stop.entry_fee_krw.toLocaleString()}원` : null,
        stop.tip ? `  - 💡 ${escapeMd(stop.tip)}` : null,
        stop.personalization_reasoning ? `  - 🎯 ${escapeMd(stop.personalization_reasoning)}` : null,
        stop.naverMapUrl ? `  - 🗺️ ${stop.naverMapUrl}` : null,
      ]);
      out.push(...subLines);

      // Transit from prev stop
      if (stop.transit_from_prev) {
        const tp = stop.transit_from_prev;
        const transit = nonEmpty([
          tp.instruction ? `  - ↳ ${escapeMd(tp.instruction)}` : null,
          tp.est_min ? `    (${tp.est_min}분, ${(tp.est_fare_krw ?? 0).toLocaleString()}원)` : null,
        ]);
        out.push(...transit);
      }
    }
    out.push('');
  }

  // ── Departure Guide ───────────────────────────────────────────────────
  const dg = it.departure_guide;
  if (dg && dg.airport) {
    out.push(`## 🛫 출발 안내 (${escapeMd(dg.airport)})`);
    if (dg.route_to_airport) {
      const r = dg.route_to_airport;
      out.push('');
      out.push(`**공항 가는 길**: ${escapeMd(r.instruction || r.summary || '')} (${r.est_min ?? '?'}분, ${(r.est_fare_krw ?? 0).toLocaleString()}원)`);
    }
    out.push('');
  }

  // ── Budget Summary ────────────────────────────────────────────────────
  if (Array.isArray(it.daily_budget_summary) && it.daily_budget_summary.length > 0) {
    out.push('## 💰 일별 예산');
    out.push('');
    out.push('| Day | Food | Transit | Entry | Total |');
    out.push('|-----|------|---------|-------|-------|');
    for (const b of it.daily_budget_summary) {
      // P300/B2 (2026-05-29): SSOT field names (meals_krw/transport_krw/entry_fees_krw) first + legacy fallback.
      const meals = (b as Record<string, number>).meals_krw ?? b.food_krw ?? 0;
      const transit = (b as Record<string, number>).transport_krw ?? b.transit_krw ?? 0;
      const entry = (b as Record<string, number>).entry_fees_krw ?? b.entry_krw ?? 0;
      out.push(`| Day ${b.day ?? '?'} | ${meals.toLocaleString()}원 | ${transit.toLocaleString()}원 | ${entry.toLocaleString()}원 | **${(b.total_krw ?? 0).toLocaleString()}원** |`);
    }
    if (it.t_money_recommended_load) {
      out.push('');
      out.push(`🚇 **T-money 추천 충전액**: ${it.t_money_recommended_load.toLocaleString()}원`);
    }
    out.push('');
  }

  // ── Recommended Restaurants (must-visit) ─────────────────────────────
  const rr = it.recommended_restaurants;
  if (rr && typeof rr === 'object') {
    out.push('## 🍴 추천 식당 (Must-visit)');
    out.push('');
    for (const [bucket, list] of Object.entries(rr as Record<string, unknown[]>)) {
      if (!Array.isArray(list) || list.length === 0) continue;
      out.push(`**${bucket}**`);
      for (const r of list.slice(0, 10)) {
        const rr = r as any;
        out.push(`- ${escapeMd(rr.name || rr.display_name)} · ${escapeMd(rr.cuisine || '')} · ⭐ ${rr.rating || '?'} · ${escapeMd(rr.address || '')}`);
      }
      out.push('');
    }
  }

  // ── Footer ─────────────────────────────────────────────────────────────
  out.push('---');
  out.push('');
  out.push(`Generated by CocoTrip · ${new Date().toISOString().slice(0, 10)}`);
  out.push(`Language: ${lang}`);
  if ((plan as any).planId) {
    out.push(`Plan ID: ${(plan as any).planId}`);
  }

  return out.join('\n');
}

/**
 * Trigger browser download of plan as .md file. Caller wraps in try/catch
 * for graceful fallback to PDF or print.
 */
export function downloadPlanAsMarkdown(
  plan: PlanDocument | undefined | null,
  opts: { filename?: string; language?: string; planUrl?: string } = {},
): void {
  const md = planToMarkdown(plan, opts);
  if (!md) throw new Error('Plan markdown empty (plan missing or invalid)');

  const filename = opts.filename
    || `cocotrip-plan-${(plan as any)?.planId?.slice(0, 8) || 'export'}.md`;

  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Cleanup blob URL — Safari 비동기 timing 안전을 위해 setTimeout.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
