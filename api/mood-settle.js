/**
 * POST /api/mood-settle — MOOD 운행 종료 정산 (운영자 전용)
 *
 * 예약(가예약, status='confirmed')을 실제 운행시간으로 최종 정산:
 *   최종금액 = 시급 × max(3, 실제시간) + (실제 거리추가 + 톨비)
 *   차액 = 최종 − 선결제(원래 차감액) → 잔액 조정(초과면 추가차감 / 적으면 환원), 한 트랜잭션.
 *   status → 'completed', 실제시간·최종금액·조정액·실제 경로 저장 + 최종 정산 영수증 메일.
 *
 * 🛣️ 거리 재측정 (추가 방문지): origin/destination(+waypoints) 가 body 로 오면
 *   운행 중 실제로 들른 경로로 Naver Directions 를 다시 호출해 정확한 km/톨비를 구한다.
 *   (운행 종료 시 매니저가 "추가 방문지" 를 넣으면 정확한 거리 합산이 나온다.)
 *   route 가 안 오면 예약 시 측정값(breakdown.km/tollKRW) 재사용. 클라가 보낸 km/금액은 무시.
 *
 * 🔴 멱등성: status!=='confirmed' 면 거부(이미 정산/취소). 공항(정액)은 정산 무관.
 * 🔴 금액 SSOT: 최종 금액은 백엔드 computeMoodTotalKRW 로만 계산 (P311).
 * 인증: Bearer Firebase ID token, allowlist.admins (mood-topup 동일 게이트).
 * Body: { bookingId, actualHours, origin?, destination?, waypoints?(string[] | "A|B"), coursePayers? }
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyUserToken } from './_shared/user-auth.js';
import { captureError } from './_shared/sentry.js';
import { buildAdminJsonCors } from './_shared/cors.js';
import { getMoodAllowlist, isAdminEmail } from './_shared/mood-allowlist.js';
import { computeMoodTotalKRW, fixedPriceFor, MOOD_MAX_DURATION_HOURS } from './_shared/mood-pricing.js';
import { computeRoute } from './_shared/mood-route.js';
import { notify } from './_shared/notify.js';
import { buildMoodSettlementReceiptEmail } from './_shared/mood-receipt.js';
import { sendEmail } from './_send-email.js';

/** body.waypoints 정규화 — 배열 또는 "A|B" 문자열 둘 다 허용 (mood-book 과 동일 규칙). */
function normalizeWaypoints(raw) {
  if (Array.isArray(raw)) return raw.map((w) => String(w || '').trim()).filter(Boolean);
  if (typeof raw === 'string') return raw.split('|').map((w) => w.trim()).filter(Boolean);
  return [];
}

function compactPath(path, limit = 600) {
  if (!Array.isArray(path) || path.length <= limit) return Array.isArray(path) ? path : [];
  const step = (path.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => path[Math.round(index * step)]);
}

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS_METHODS = 'POST, OPTIONS';

export default async function handler(req, res) {
  const JSON_HEADERS = { 'Cache-Control': 'no-store', ...buildAdminJsonCors(req, { methods: CORS_METHODS, headers: 'Authorization, Content-Type' }) };

  if (req.method === 'OPTIONS') { res.writeHead(200, JSON_HEADERS); return res.end(); }
  if (req.method !== 'POST') {
    res.writeHead(405, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'POST only' }));
  }

  const auth = await verifyUserToken(req);
  if (!auth.ok) {
    res.writeHead(auth.status, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: auth.error }));
  }
  if (!auth.emailVerified) {
    res.writeHead(403, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '이메일 미검증' }));
  }
  const email = auth.email;

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

  const bookingId = String(body.bookingId || '').trim();
  if (!bookingId) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'bookingId 필수' }));
  }
  const actualHours = Number(body.actualHours);
  if (!Number.isFinite(actualHours) || actualHours <= 0 || actualHours > MOOD_MAX_DURATION_HOURS) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: `actualHours 는 0 초과 ${MOOD_MAX_DURATION_HOURS} 이하` }));
  }

  const rawTollMode = body.tollMode === undefined || body.tollMode === null || body.tollMode === ''
    ? 'estimated'
    : String(body.tollMode);
  if (!['estimated', 'none', 'actual'].includes(rawTollMode)) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'INVALID_TOLL_MODE' }));
  }
  const tollMode = rawTollMode;
  const hasActualTollKRW = body.actualTollKRW !== undefined
    && body.actualTollKRW !== null
    && String(body.actualTollKRW).trim() !== '';
  const actualTollKRW = hasActualTollKRW ? Number(body.actualTollKRW) : Number.NaN;
  const manualAdjustmentKRW = Number(body.manualAdjustmentKRW || 0);
  const settlementReason = String(body.settlementReason || '').trim();
  if (tollMode === 'actual' && (!hasActualTollKRW || !Number.isInteger(actualTollKRW) || actualTollKRW < 0 || actualTollKRW > 1000000)) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'INVALID_ACTUAL_TOLL' }));
  }
  if (!Number.isInteger(manualAdjustmentKRW) || Math.abs(manualAdjustmentKRW) > 10000000) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'INVALID_MANUAL_ADJUSTMENT' }));
  }
  if ((tollMode !== 'estimated' || manualAdjustmentKRW !== 0) && !settlementReason) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'SETTLEMENT_REASON_REQUIRED' }));
  }
  if (settlementReason.length > 500) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'SETTLEMENT_REASON_TOO_LONG' }));
  }

  try {
    const db = initAdminDb('mood-settle');
    if (!db) {
      res.writeHead(500, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'Firestore unavailable' }));
    }

    const allowlist = await getMoodAllowlist(db);
    if (!isAdminEmail(allowlist, email)) {
      res.writeHead(403, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: '권한 없음 (운영자 전용)' }));
    }

    const bookingRef = db.collection('mood_bookings').doc(bookingId);

    // ── 1) 사전 read — serviceType + 기존 경로/거리 (route 기본값·재사용·정액 게이트) ──
    // computeRoute(네트워크)는 Firestore 트랜잭션 안에서 돌릴 수 없어 먼저 읽고 밖에서 측정.
    // serviceType·예약 거리는 불변이라 트랜잭션 밖 사전 read 로 충분 (멱등성은 tx 안에서 재확인).
    const preSnap = await bookingRef.get();
    if (!preSnap.exists) {
      res.writeHead(404, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'BOOKING_NOT_FOUND' }));
    }
    const pre = preSnap.data() || {};
    if (pre.status !== 'confirmed') {
      res.writeHead(409, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'ALREADY_SETTLED' }));
    }
    const preRevision = Number.isInteger(pre.revision) ? pre.revision : 0;
    if (fixedPriceFor(pre.serviceType) !== null) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'AIRPORT_NO_SETTLE' }));
    }
    const preBd = pre.breakdown || {};
    const hasStoredRate = pre.ratePerHour !== undefined && pre.ratePerHour !== null;
    if (
      hasStoredRate
      && (!Number.isSafeInteger(pre.ratePerHour) || pre.ratePerHour <= 0)
    ) {
      res.writeHead(409, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'INVALID_BOOKING_RATE' }));
    }

    // ── 2) 거리/톨비 — 추가 방문지(route) 오면 Naver 재측정, 없으면 예약값 재사용 ──
    const newOrigin = String(body.origin || '').trim();
    const newDest = String(body.destination || '').trim();
    const newWaypoints = normalizeWaypoints(body.waypoints);
    if (!!newOrigin !== !!newDest) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'ROUTE_PAIR_REQUIRED' }));
    }
    if (newWaypoints.length > 5 || newOrigin.length > 300 || newDest.length > 300 || newWaypoints.some((waypoint) => waypoint.length > 300)) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'INVALID_ROUTE_INPUT' }));
    }
    const hasRouteOverride = !!(newOrigin && newDest);
    let settledCoursePayers = null;
    if (hasRouteOverride) {
      const expectedCourseCount = newWaypoints.length + 2;
      if (
        !Array.isArray(body.coursePayers)
        || body.coursePayers.length !== expectedCourseCount
        || body.coursePayers.some((payer) => payer !== 'mood' && payer !== 'influencer')
      ) {
        res.writeHead(400, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: false, error: 'INVALID_COURSE_PAYERS' }));
      }
      settledCoursePayers = body.coursePayers.slice();
    } else if (body.coursePayers !== undefined) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'INVALID_COURSE_PAYERS' }));
    }

    if (
      !hasRouteOverride
      && (
      typeof preBd.km !== 'number'
      || !Number.isFinite(preBd.km)
      || preBd.km < 0
      || typeof preBd.tollKRW !== 'number'
      || !Number.isFinite(preBd.tollKRW)
      || preBd.tollKRW < 0
      )
    ) {
      res.writeHead(409, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'INVALID_BOOKING_BREAKDOWN' }));
    }
    let km = preBd.km;
    let tollKRW = preBd.tollKRW;
    if (hasRouteOverride) {
      km = 0;
      tollKRW = 0;
    }
    let routeMeta = {
      origin: preBd.origin || null,
      destination: preBd.destination || null,
      waypoints: preBd.waypoints || null,
      recomputed: false,
    };
    let routeError = null;
    let finalRouteSnapshot = null;
    if (hasRouteOverride) {
      const route = await computeRoute({ origin: newOrigin, destination: newDest, waypoints: newWaypoints });
      if (
        route.ok
        && Number.isFinite(Number(route.km))
        && Number(route.km) >= 0
        && Number.isFinite(Number(route.tollKRW))
        && Number(route.tollKRW) >= 0
        && Number.isFinite(Number(route.durationMin))
        && Number(route.durationMin) >= 0
      ) {
        km = route.km;
        tollKRW = route.tollKRW;
        routeMeta = {
          origin: newOrigin,
          destination: newDest,
          waypoints: newWaypoints.length ? newWaypoints : null,
          recomputed: true,
        };
        finalRouteSnapshot = {
          km: route.km,
          tollKRW: route.tollKRW,
          durationMin: route.durationMin,
          path: compactPath(route.path),
          points: route.points || [],
          calculatedAt: Date.now(),
        };
      } else {
        // 경로 재측정 실패 = 비치명적 → 예약 시 거리값 유지 (외상 "막지 않는다" 철학과 일관).
        routeError = route.error || 'INVALID_ROUTE_RESULT';
        console.warn('[mood-settle] route 재측정 실패:', route.error, route.detail || '');
      }
    }
    if (routeError) {
      res.writeHead(422, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'ROUTE_RECALCULATION_FAILED', detail: routeError }));
    }

    const estimatedTollKRW = tollKRW;
    if (tollMode === 'none') tollKRW = 0;
    if (tollMode === 'actual') tollKRW = actualTollKRW;

    // ── 3) 최종 금액 (백엔드 SSOT — 클라 금액 무시) ──
    // 예약 당시 단가 보존(2026-07-04 요율 개정 33k→30k/44k→40k) — 옛 예약을 새 단가로
    // 정산하면 예약가와 어긋남. 거리단가는 현행 상수(재측정 km 대상, ±60원/km 허용).
    const finalPriced = computeMoodTotalKRW({
      serviceType: pre.serviceType,
      durationHours: actualHours,
      km,
      tollKRW,
      ratePerHourOverride: hasStoredRate ? pre.ratePerHour : undefined,
    });
    if (!finalPriced.ok) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: finalPriced.error }));
    }

    // ── 4) 트랜잭션 — 멱등 재확인 + 잔액 조정 (모든 read 를 write 전에) ──
    const result = await db.runTransaction(async (tx) => {
      const bSnap = await tx.get(bookingRef);
      if (!bSnap.exists) return { ok: false, status: 404, error: 'BOOKING_NOT_FOUND' };
      const b = bSnap.data() || {};
      if (b.status !== 'confirmed') return { ok: false, status: 409, error: 'ALREADY_SETTLED' }; // 멱등(동시정산 방지)
      const currentRevision = Number.isInteger(b.revision) ? b.revision : 0;
      if (currentRevision !== preRevision) return { ok: false, status: 409, error: 'BOOKING_CHANGED' };
      if (fixedPriceFor(b.serviceType) !== null) return { ok: false, status: 400, error: 'AIRPORT_NO_SETTLE' };

      const finalAmount = finalPriced.amountKRW + manualAdjustmentKRW;
      const originalAmount = b.amountKRW;
      if (!Number.isInteger(finalAmount) || finalAmount < 0) return { ok: false, status: 400, error: 'INVALID_FINAL_AMOUNT' };
      if (!Number.isInteger(originalAmount) || originalAmount < 0) return { ok: false, status: 409, error: 'INVALID_BOOKING_AMOUNT' };
      const diff = finalAmount - originalAmount; // >0 추가차감 / <0 환원

      const clientRef = db.collection('mood_clients').doc(String(b.clientId || ''));
      const cSnap = await tx.get(clientRef);
      if (!cSnap.exists) return { ok: false, status: 404, error: 'CLIENT_NOT_FOUND' };
      const clientData = cSnap.data() || {};
      const balance = clientData.balanceKRW;
      if (!Number.isInteger(balance)) return { ok: false, status: 409, error: 'INVALID_CLIENT_BALANCE' };
      const newBalance = balance - diff;
      if (!Number.isSafeInteger(diff) || !Number.isSafeInteger(newBalance)) {
        return { ok: false, status: 409, error: 'INVALID_CALCULATED_BALANCE' };
      }
      const creditLimitKRW = clientData.creditLimitKRW;
      if (creditLimitKRW !== undefined && creditLimitKRW !== null) {
        if (!Number.isSafeInteger(creditLimitKRW) || creditLimitKRW <= 0) {
          return { ok: false, status: 409, error: 'INVALID_CREDIT_LIMIT' };
        }
        if (diff > 0 && newBalance < -creditLimitKRW) {
          return { ok: false, status: 409, error: 'CREDIT_LIMIT_EXCEEDED' };
        }
      }

      tx.update(clientRef, { balanceKRW: newBalance });
      tx.update(bookingRef, {
        status: 'completed',
        actualHours,
        finalAmountKRW: finalAmount,
        finalBreakdown: {
          baseKRW: finalPriced.baseKRW,
          distanceSurchargeKRW: finalPriced.distanceSurchargeKRW,
          tollKRW: finalPriced.tollKRW,
          estimatedTollKRW,
          km: finalPriced.km,
          ...routeMeta,
        },
        adjustmentKRW: diff,
        manualAdjustmentKRW,
        estimatedTollKRW,
        tollMode,
        settlementReason: settlementReason || null,
        revision: currentRevision + 1,
        ...(settledCoursePayers ? { coursePayers: settledCoursePayers } : {}),
        ...(finalRouteSnapshot ? { finalRouteSnapshot } : {}),
        settledAt: Date.now(),
        settledByEmail: email,
      });

      return { ok: true, finalAmount, originalAmount, diff, newBalance, booking: b };
    });

    if (!result.ok) {
      res.writeHead(result.status, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: result.error }));
    }

    const b = result.booking;
    const clientName = b.clientName || b.clientId || '-';

    // ── 텔레그램 알림 (best-effort) ──
    try {
      const adj = result.diff > 0 ? `추가 ${result.diff.toLocaleString('ko-KR')}원`
        : result.diff < 0 ? `환원 ${(-result.diff).toLocaleString('ko-KR')}원` : '변동 없음';
      await notify('booking',
        `<b>MOOD 운행 종료 · 최종 정산</b>\n` +
        `${clientName} · ${b.date} ${b.startTime}\n` +
        `실제 ${actualHours}시간 — 최종 ${result.finalAmount.toLocaleString('ko-KR')}원 (${adj})\n` +
        `잔액 ${result.newBalance.toLocaleString('ko-KR')}원`);
    } catch (e) { console.warn('[mood-settle] notify 실패:', e?.message); }

    // ── 고객 최종 정산 영수증 메일 (best-effort) — 예약↔실제 비교 + 항목별 분해 ──
    try {
      const toEmail = b.createdByEmail;
      if (toEmail) {
        const receipt = buildMoodSettlementReceiptEmail({
          clientName,
          bookingId,
          date: b.date,
          startTime: b.startTime,
          serviceType: b.serviceType,
          // 예약 vs 실제 비교
          bookedHours: Number(b.durationHours) || 0,
          actualHours,
          bookedKm: Number(preBd.km) || 0,
          actualKm: finalPriced.km,
          // 최종 항목별 분해
          ratePerHour: finalPriced.ratePerHour,
          baseKRW: finalPriced.baseKRW,
          distanceSurchargeKRW: finalPriced.distanceSurchargeKRW,
          tollKRW: finalPriced.tollKRW,
          bookedAmountKRW: result.originalAmount,
          finalAmountKRW: result.finalAmount,
          adjustmentKRW: result.diff,
          newBalance: result.newBalance,
          // 거리 재측정 여부 (추가 방문지)
          routeRecomputed: routeMeta.recomputed,
          waypointCount: Array.isArray(routeMeta.waypoints) ? routeMeta.waypoints.length : 0,
        });
        await sendEmail({ to: toEmail, subject: receipt.subject, html: receipt.html, text: receipt.text });
      }
    } catch (e) { console.warn('[mood-settle] receipt 메일 실패:', e?.message); }

    console.log('[mood-settle]', email, '→', bookingId, '| 실제', actualHours, 'h |',
      routeMeta.recomputed ? `거리재측정 ${finalPriced.km}km` : `거리재사용 ${finalPriced.km}km`,
      '| 최종', result.finalAmount, '| 차액', result.diff, routeError ? `| routeErr=${routeError}` : '');
    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({
      ok: true,
      data: {
        bookingId,
        actualHours,
        finalAmountKRW: result.finalAmount,
        adjustmentKRW: result.diff,
        balanceKRW: result.newBalance,
        km: finalPriced.km,
        routeRecomputed: routeMeta.recomputed,
        estimatedTollKRW,
        tollKRW: finalPriced.tollKRW,
        manualAdjustmentKRW,
        settlementReason: settlementReason || null,
        coursePayers: settledCoursePayers || (Array.isArray(result.booking.coursePayers) ? result.booking.coursePayers : null),
      },
    }));
  } catch (err) {
    console.error('[mood-settle] failed:', err.message);
    await captureError(err, { route: '/api/mood-settle', email });
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '서버 오류' }));
  }
}
