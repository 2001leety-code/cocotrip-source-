/**
 * CocoTripKR — Telegram 에러 알림 5분 단위 집계 + dedup (K Tier 2-E)
 *
 * 배경
 *   기존 sendErrorAlert / notify('error', ...) 호출은 매 에러마다 즉시 텔레그램 API 호출.
 *   동일 원인 (예: Gemini quota / PayPal 인증) 으로 5분 안에 100건 발생하면
 *   채팅창이 폭주해 운영자가 의미 있는 알림을 놓침.
 *
 * 동작
 *   1. 모든 호출은 항상 Firestore `error_log` 콜렉션에 raw 저장 (분석용).
 *   2. 텔레그램 발송 여부는 Firestore `telegram_throttle/{key}` 트랜잭션으로 결정:
 *      - 신규 키 → 즉시 발송 + window 시작.
 *      - 5분 윈도우 내 동일 key 재발생 → count++, 발송 X.
 *      - 5분 만료 후 첫 호출 → 발송 (직전 누적 count 메시지에 첨부) + 새 window 시작.
 *   3. Firestore 미초기화 시 라이브러리 fallback — 즉시 텔레그램 호출 (legacy 동작) + warn log.
 *
 * 사용 (fire-and-forget 권장)
 *   import { throttledTelegramAlert } from './_shared/telegram-throttle.js';
 *   throttledTelegramAlert({
 *     key: 'booking-processor-fail',
 *     channel: 'error',
 *     message: '...html...',
 *     severity: 'high',
 *     context: { bookingRef, orderID },
 *   }).catch(() => {});
 *
 * 키 네이밍 가이드
 *   `<source>-<failure-type>` 형식. 예:
 *     - 'booking-processor-fail'
 *     - 'ai-planner-unhandled'
 *     - 'gemini-quota-exceeded'
 *     - 'odsay-departure-fail'
 *     - 'pdf-generate-puppeteer'
 *   key 가 너무 세분화되면 dedup 효과 저하, 너무 광범위하면 다른 원인 묶임 — 원인 단위로 묶는다.
 *
 * 주의
 *   - Firestore 트랜잭션 1회 추가 → 평균 100-200ms 지연. await 강제 X (호출자 fire-and-forget).
 *   - error_log 는 PII 최소화 (booking ref / userId 정도만, 결제 token / 평문 비밀번호 X).
 *   - 콜렉션 크기 관리는 후속 PR (TTL cron 또는 30일 보관 정책).
 */

import { initAdminDb } from './firebase-admin.js';
import { notify } from './notify.js';
import { logger } from './log.js';
// PR #421 (CZ2): consolidate escapeHtml helper. Telegram parse_mode=HTML only
// needs &/</> escaping (no quote escape — attributes aren't part of the parse).
import { escapeTelegram as escapeHtml } from './escape.js';

const THROTTLE_WINDOW_MS = 5 * 60 * 1000; // 5분
const ERROR_LOG_COLLECTION = 'error_log';
const THROTTLE_COLLECTION = 'telegram_throttle';

// PR #443 (Audit Z-H12 — 2026-05-16): in-memory fallback throttle.
//
// Pre-fix: if Firestore was down OR the transaction threw, we fell through
// to a direct notify() with NO throttle (fail-OPEN). Combined with a
// high-rate error (Gemini quota exceeded → 100+ alerts/min), this would
// flood the operator Telegram channel — exactly the spam the dedup was
// meant to prevent.
//
// In-memory Map keyed by dedup key holds the last-sent timestamp. Per
// serverless instance only — different containers don't share, but each
// container caps its own flood. Worst case: N concurrent containers each
// send 1 alert per window = N alerts/window instead of unbounded.
// Acceptable trade — Firestore outages are rare AND short, and the
// operator gets enough signal without spam.
const _inMemoryThrottle = new Map();
const _IN_MEMORY_MAX_KEYS = 500; // bounded LRU-ish to avoid leaks
function _checkInMemoryThrottle(key) {
  const now = Date.now();
  const last = _inMemoryThrottle.get(key);
  if (last && (now - last) < THROTTLE_WINDOW_MS) {
    return { shouldAlert: false };
  }
  // Trim if oversize (oldest first).
  if (_inMemoryThrottle.size >= _IN_MEMORY_MAX_KEYS) {
    const oldestKey = _inMemoryThrottle.keys().next().value;
    if (oldestKey !== undefined) _inMemoryThrottle.delete(oldestKey);
  }
  _inMemoryThrottle.set(key, now);
  return { shouldAlert: true };
}

/** Test-only helper — wipe the in-memory map between vitest cases. */
export function __resetInMemoryThrottleForTests() {
  _inMemoryThrottle.clear();
}

/**
 * @param {Object} args
 * @param {string} args.key - dedup key (예: 'booking-processor-fail').
 * @param {string} args.message - HTML 메시지 (notify 와 동일 포맷).
 * @param {string} [args.channel='error'] - notify 채널. 일반 에러는 'error'.
 * @param {'low'|'medium'|'high'|'critical'} [args.severity='medium']
 * @param {Object} [args.context={}] - 추가 메타 (bookingRef, orderID 등). PII 주의.
 * @returns {Promise<{ ok: boolean, alerted: boolean, throttled?: boolean, totalCount?: number, fallback?: boolean, error?: string }>}
 */
export async function throttledTelegramAlert({
  key,
  message,
  channel = 'error',
  severity = 'medium',
  context = {},
}) {
  if (!key || typeof key !== 'string') {
    // No key → can't dedup. Apply an in-memory throttle keyed on a stable
    // hash of the message so a runaway no-key caller can't flood the channel.
    // PR #443 (Z-H12): was direct notify (fail-OPEN).
    const noKeyBucket = `__no_key__:${(message || '').slice(0, 80)}`;
    const noKeyAllow = _checkInMemoryThrottle(noKeyBucket);
    if (!noKeyAllow.shouldAlert) {
      logger.warn('[telegram-throttle] missing key — in-memory throttled (same message in 5min window)');
      return { ok: true, alerted: false, throttled: true, fallback: true, error: 'no_key' };
    }
    logger.warn('[telegram-throttle] missing key — falling back to direct notify (in-memory throttled)');
    await notify(channel, message);
    return { ok: true, alerted: true, fallback: true, error: 'no_key' };
  }

  const adminDb = initAdminDb('telegram-throttle');
  const now = Date.now();

  // Firestore 미초기화 — PR #443 (Z-H12): 이전엔 direct notify (fail-OPEN) 였다.
  // 같은 키로 1초에 100건 firing 하면 100건 다 Telegram 으로 직진 → 운영자 채팅
  // flood. 이제 in-memory Map throttle (per-instance, 5분 window). Firestore
  // 복구되면 자동으로 본래 분산 throttle 경로로 돌아감.
  if (!adminDb) {
    const memAllow = _checkInMemoryThrottle(key);
    if (!memAllow.shouldAlert) {
      logger.warn(`[telegram-throttle] adminDb unavailable + in-memory throttled (key=${key})`);
      return { ok: true, alerted: false, throttled: true, fallback: true, error: 'no_admin_db' };
    }
    logger.warn(`[telegram-throttle] adminDb unavailable — direct notify (in-memory throttled, key=${key})`);
    const r = await notify(channel, message);
    return { ok: !!r.ok, alerted: true, fallback: true, error: 'no_admin_db' };
  }

  // 1. error_log raw 저장 (always, best-effort)
  try {
    await adminDb.collection(ERROR_LOG_COLLECTION).add({
      key,
      message,
      channel,
      severity,
      context: sanitizeContext(context),
      createdAt: now,
      createdAtISO: new Date(now).toISOString(),
    });
  } catch (e) {
    logger.warn(`[telegram-throttle] error_log write failed: ${e.message}`);
  }

  // 2. throttle 트랜잭션
  let result;
  try {
    const throttleRef = adminDb.collection(THROTTLE_COLLECTION).doc(key);
    result = await adminDb.runTransaction(async (tx) => {
      const doc = await tx.get(throttleRef);
      if (doc.exists) {
        const data = doc.data() || {};
        const firstAlertAt = data.firstAlertAt || 0;
        const elapsed = now - firstAlertAt;
        const prevCount = data.count || 0;
        if (elapsed < THROTTLE_WINDOW_MS) {
          // 5분 윈도우 내 — count 증가만, 발송 안 함.
          tx.update(throttleRef, { count: prevCount + 1, lastSeenAt: now });
          return { shouldAlert: false, totalCount: prevCount + 1, prevAccumulated: 0 };
        }
        // 5분 만료 — 누적 count 첨부 후 새 window.
        tx.set(throttleRef, { firstAlertAt: now, count: 1, lastSeenAt: now });
        return { shouldAlert: true, totalCount: 1, prevAccumulated: prevCount };
      }
      // 신규 키.
      tx.set(throttleRef, { firstAlertAt: now, count: 1, lastSeenAt: now });
      return { shouldAlert: true, totalCount: 1, prevAccumulated: 0 };
    });
  } catch (e) {
    // PR #443 (Z-H12): 트랜잭션 실패 시 같은 in-memory throttle. fail-open 이
    // 100x/sec 로 firing 되면 운영자 채팅 flood. in-memory map 으로 같은 instance
    // 안에선 5분당 1회 제한.
    const txAllow = _checkInMemoryThrottle(key);
    if (!txAllow.shouldAlert) {
      logger.warn(`[telegram-throttle] transaction failed (${e.message}) + in-memory throttled (key=${key})`);
      return { ok: true, alerted: false, throttled: true, fallback: true, error: e.message };
    }
    logger.warn(`[telegram-throttle] transaction failed: ${e.message} — fail-open notify (in-memory throttled, key=${key})`);
    const r = await notify(channel, message);
    return { ok: !!r.ok, alerted: true, fallback: true, error: e.message };
  }

  if (!result.shouldAlert) {
    return { ok: true, alerted: false, throttled: true, totalCount: result.totalCount };
  }

  const finalMsg =
    result.prevAccumulated > 0
      ? `${message}\n\n<i>(직전 5분 누적: ${result.prevAccumulated}건 — dedup key: <code>${escapeHtml(key)}</code>)</i>`
      : message;
  const r = await notify(channel, finalMsg);
  return { ok: !!r.ok, alerted: true, throttled: false, totalCount: 1 };
}

/**
 * context 객체에서 잠재적 PII / 비밀 토큰을 제거. 보수적 allowlist 패턴.
 */
function sanitizeContext(context) {
  if (!context || typeof context !== 'object') return {};
  const SAFE_KEYS = [
    'bookingRef', 'orderID', 'orderId', 'planId', 'userId', 'uid', 'email',
    'productType', 'product', 'region', 'route', 'method', 'status',
    'errorCode', 'reason', 'step', 'durationDays', 'paxCount',
    'pickupLocation', 'dropoffLocation', 'tourDate',
  ];
  const out = {};
  for (const k of SAFE_KEYS) {
    if (context[k] !== undefined && context[k] !== null) {
      const v = context[k];
      // 문자열은 길이 제한.
      if (typeof v === 'string') out[k] = v.slice(0, 200);
      else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
      else out[k] = String(v).slice(0, 200);
    }
  }
  return out;
}

// escapeHtml moved to shared helper above (PR #421).

/**
 * 디버그용 — throttle 키의 현재 윈도우 상태 조회. 운영 / 테스트 보조.
 */
export async function getThrottleStatus(key) {
  const adminDb = initAdminDb('telegram-throttle');
  if (!adminDb || !key) return null;
  try {
    const doc = await adminDb.collection(THROTTLE_COLLECTION).doc(key).get();
    if (!doc.exists) return null;
    return doc.data();
  } catch (e) {
    logger.warn(`[telegram-throttle] getStatus failed: ${e.message}`);
    return null;
  }
}
