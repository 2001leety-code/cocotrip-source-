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
import { getLocaleSync, type Language } from '@/i18n';
import { getPlanDetailDict } from '../types';
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

/**
 * 마크다운 라벨 — **전부 `planDetail` 사전에서 온다** (2026-08-08).
 *
 * 🔴 왜: 같은 문서의 PDF 판(`pdfGenerator.ts`)은 진작 `planDetail.ui.pdf*` 를 쓰는데,
 *   마크다운 판만 `도착 안내`·`일정`·`수단`·`소요 N분`·`요금 N원`·`일별 예산`·`추천 식당`·
 *   `호텔→역` 을 한국어로 박아 두고 있었다. 영어·일본어·중국어 손님이 받는 .md 파일에
 *   한글 라벨이 그대로 나갔다 (#1254 는 `'역'` **한 개**만 고쳤다).
 *
 * ⚠️ 새 i18n 키는 만들지 않았다 — 필요한 값이 4개 로케일에 **이미 전부** 있었다.
 *   폴백은 **영어**로 둔다. 한국어로 두면 사전이 비었을 때 같은 사고가 조용히 재발한다.
 */
function mdLabels(lang: string) {
  const t = getPlanDetailDict(getLocaleSync(lang as Language));
  const ui = (t.ui as Record<string, string> | undefined) || {};
  const ic = (t.intercity as Record<string, string> | undefined) || {};
  const lg = (t.lodging as Record<string, string> | undefined) || {};
  return {
    arrival: ui.pdfArrivalGuide || 'Airport Arrival Guide',
    departure: ui.pdfDepartureGuide || 'Departure Guide',
    toHotel: ui.toHotel || 'To Hotel',
    toAirport: ui.toAirport || 'To Airport',
    schedule: ui.planRouteTimeline || 'Route timeline',
    budget: ui.pdfBudgetSummary || 'Daily Budget Summary',
    budgetDay: ui.budgetDay || 'Day',
    budgetMeals: ui.budgetMeals || 'Meals',
    budgetTransport: ui.budgetTransport || 'Transport',
    budgetEntry: ui.budgetEntry || 'Entry',
    budgetTotal: ui.budgetTotal || 'Total',
    tmoney: ui.tmoneyRecommended || 'Recommended T-money load',
    restaurants: ui.recommendedRestaurantsTitle || 'Must-visit restaurants nearby',
    stay: lg.label || 'Stay',
    station: ic.station || 'Station',
    intercityTitle: ic.title || 'Intercity Transit — {{mode}}',
    depart: ic.depart || 'Depart {{time}}',
    arrive: ic.arrive || 'Arrive {{time}}',
    duration: ic.duration || '~{{min}} min',
    fare: ic.fare || '₩{{krw}} / pax',
    book: ic.book || 'Book',
    bucketGeneral: ui.recRestaurantsGeneral || 'General',
    bucketVegan: ui.recRestaurantsVegan || 'Vegan',
    bucketHalal: ui.recRestaurantsHalal || 'Halal',
  };
}
type MdLabels = ReturnType<typeof mdLabels>;

/** 소요 시간 — 4개 언어 템플릿(`~{{min}} min` / `약 {{min}}분` …)을 그대로 쓴다. */
function dur(L: MdLabels, min: unknown): string {
  return L.duration.replace('{{min}}', min == null ? '?' : String(min));
}

/**
 * 금액 — `₩` 기호를 쓴다. 사전의 `intercity.fare` 가 이미 4개 로케일 전부 `₩` 라
 * 표기가 어긋나지 않고, 언어별 통화 단어를 새로 만들 필요도 없다.
 * (예전 `12,000원` 은 한국어 손님에게만 맞는 표기였다.)
 */
function krw(n: unknown): string {
  return `₩${(typeof n === 'number' ? n : 0).toLocaleString()}`;
}

/**
 * 예산 표의 '일차' 칸.
 *
 * ⚠️ `ui.budgetDay` 는 로케일마다 모양이 다르다 — en/ko/ja 는 낱말(`Day`·`일차`·`日目`)인데
 *   **zh 만 자리표시자 템플릿(`第{n}天`)** 이다. 그래서 이 값은 **열 이름으로 쓸 수 없다**
 *   (중국어 손님에게 `第{n}天` 이 그대로 보인다). 값을 칸에 넣고 번호를 채워 쓴다.
 *   → 열 이름은 언어 무관 기호 `#`.
 */
function dayCell(L: MdLabels, n: unknown): string {
  const v = n == null ? '?' : String(n);
  return L.budgetDay.includes('{n}') ? L.budgetDay.replace('{n}', v) : `${L.budgetDay} ${v}`;
}

/** 추천 식당 버킷 이름 — 사전 값이 있으면 쓰고 없으면 원본 키. */
function bucketLabel(L: MdLabels, bucket: string): string {
  if (bucket === 'general') return L.bucketGeneral;
  if (bucket === 'vegan') return L.bucketVegan;
  if (bucket === 'halal') return L.bucketHalal;
  return bucket;
}

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
  const L = mdLabels(lang);

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
    out.push(`## ✈️ ${L.arrival} (${escapeMd(ag.airport)})`);
    out.push('');
    if (Array.isArray(ag.steps)) {
      for (const step of ag.steps) {
        const stepLine = `${step.step ?? '?'}. **${escapeMd(step.title || '')}** (${dur(L, step.est_min)})`;
        out.push(`- ${stepLine}`);
        if (step.description) out.push(`  - ${escapeMd(step.description)}`);
      }
    }
    if (ag.route_to_hotel) {
      const r = ag.route_to_hotel;
      out.push('');
      out.push(`**${L.toHotel}**: ${escapeMd(r.instruction || r.summary || '')} (${dur(L, r.est_min)}, ${krw(r.est_fare_krw)})`);
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
    // B7 (P308): mode/est_min/est_fare_krw 우선, P291~P308 오명명 plan 은 method/duration_min/cost_krw 폴백.
    const ict = day.intercity_transit;
    if (ict && (ict.mode || ict.method)) {
      const ictMode = ict.mode || ict.method;
      const ictEstMin = ict.est_min ?? ict.duration_min;
      const ictEstFare = ict.est_fare_krw ?? ict.cost_krw;
      // 제목이 수단을 이미 담는다(`Intercity Transit — KTX` / `도시 간 이동 — KTX`) —
      // 예전의 별도 `- **수단**:` 줄은 같은 값을 두 번 쓰던 것이라 없앴다.
      out.push(`### 🚆 ${L.intercityTitle.replace('{{mode}}', escapeMd(ictMode))} (${escapeMd(ict.from_city_display || ict.from_city || '?')} → ${escapeMd(ict.to_city_display || ict.to_city || '?')})`);
      const intercityLines = nonEmpty([
        ict.from_station && ict.to_station ? `- **${escapeMd(ict.from_station)} → ${escapeMd(ict.to_station)}**` : null,
        ict.recommended_depart ? `- ${L.depart.replace('{{time}}', escapeMd(ict.recommended_depart))}` : null,
        ict.arrival_at ? `- ${L.arrive.replace('{{time}}', escapeMd(ict.arrival_at))}` : null,
        ictEstMin ? `- ${dur(L, ictEstMin)}` : null,
        ictEstFare ? `- ${L.fare.replace('{{krw}}', ictEstFare.toLocaleString())}` : null,
        ict.booking_url ? `- ${L.book}: ${ict.booking_url}` : null,
        ict.instruction ? `- ${escapeMd(ict.instruction)}` : null,
      ]);
      out.push(...intercityLines);
      // lodging_to_station / station_to_lodging bookend (P111 enrichment 결과)
      // 역명·숙소 라벨 모두 사전에서 온다 — 예전엔 '역'·'호텔' 이 하드코딩이라
      // 전 언어 손님에게 한글이 노출됐다.
      if (ict.lodging_to_station) {
        const lts = ict.lodging_to_station;
        out.push(`- 🛏️→🚆 ${L.stay}→${escapeMd(ict.from_station || L.station)}: ${escapeMd(lts.instruction || '')} (${dur(L, lts.est_min)})`);
      }
      if (ict.station_to_lodging) {
        const stl = ict.station_to_lodging;
        out.push(`- 🚆→🛏️ ${escapeMd(ict.to_station || L.station)}→${L.stay}: ${escapeMd(stl.instruction || '')} (${dur(L, stl.est_min)})`);
      }
      out.push('');
    }

    // Stops
    out.push(`### ${L.schedule}`);
    out.push('');
    for (const stop of (day.stops || [])) {
      const icon = CATEGORY_ICON[stop.category] || '📍';
      const time = timeRange(stop.start_time, stop.end_time);
      const timeStr = time ? `**${time}**` : '';
      const name = escapeMd(stop.display_name || stop.name || '?');
      out.push(`- ${timeStr} ${icon} **${name}**`);

      const subLines = nonEmpty([
        stop.address ? `  - 📍 ${escapeMd(stop.address)}` : null,
        stop.entry_fee_krw && stop.entry_fee_krw > 0 ? `  - 💰 ${L.budgetEntry}: ${krw(stop.entry_fee_krw)}` : null,
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
          tp.est_min ? `    (${dur(L, tp.est_min)}, ${krw(tp.est_fare_krw ?? 0)})` : null,
        ]);
        out.push(...transit);
      }
    }
    out.push('');
  }

  // ── Departure Guide ───────────────────────────────────────────────────
  const dg = it.departure_guide;
  if (dg && dg.airport) {
    out.push(`## 🛫 ${L.departure} (${escapeMd(dg.airport)})`);
    if (dg.route_to_airport) {
      const r = dg.route_to_airport;
      out.push('');
      out.push(`**${L.toAirport}**: ${escapeMd(r.instruction || r.summary || '')} (${dur(L, r.est_min)}, ${krw(r.est_fare_krw)})`);
    }
    out.push('');
  }

  // ── Budget Summary ────────────────────────────────────────────────────
  if (Array.isArray(it.daily_budget_summary) && it.daily_budget_summary.length > 0) {
    out.push(`## 💰 ${L.budget}`);
    out.push('');
    out.push(`| # | ${L.budgetMeals} | ${L.budgetTransport} | ${L.budgetEntry} | ${L.budgetTotal} |`);
    out.push('|-----|------|---------|-------|-------|');
    for (const b of it.daily_budget_summary) {
      // P300/B2 (2026-05-29): SSOT field names (meals_krw/transport_krw/entry_fees_krw) first + legacy fallback.
      const meals = (b as Record<string, number>).meals_krw ?? b.food_krw ?? 0;
      const transit = (b as Record<string, number>).transport_krw ?? b.transit_krw ?? 0;
      const entry = (b as Record<string, number>).entry_fees_krw ?? b.entry_krw ?? 0;
      out.push(`| ${dayCell(L, b.day)} | ${krw(meals)} | ${krw(transit)} | ${krw(entry)} | **${krw(b.total_krw ?? 0)}** |`);
    }
    if (it.t_money_recommended_load) {
      out.push('');
      out.push(`🚇 **${L.tmoney}**: ${krw(it.t_money_recommended_load)}`);
    }
    out.push('');
  }

  // ── Recommended Restaurants (must-visit) ─────────────────────────────
  const rr = it.recommended_restaurants;
  if (rr && typeof rr === 'object') {
    out.push(`## 🍴 ${L.restaurants}`);
    out.push('');
    for (const [bucket, list] of Object.entries(rr as Record<string, unknown[]>)) {
      if (!Array.isArray(list) || list.length === 0) continue;
      out.push(`**${escapeMd(bucketLabel(L, bucket))}**`);
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
