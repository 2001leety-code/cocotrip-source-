/**
 * Dispatch timeout sweep — 만료된 배차 메시지 자동 거절 처리.
 *
 * 호출 시점:
 *   1. 관리자/기사 webhook의 첫 단계 (lazy expiry — Vercel Hobby cron 제약 회피)
 *   2. (옵션) cron-runner의 dispatch-timeout-sweep 엔드포인트
 *
 * 처리:
 *   - dispatch_messages where status='sent' AND expiresAt <= now
 *   - 각 만료 메시지:
 *     a) Telegram 메시지 편집 → "만료됨" 표시 (PII 제거)
 *     b) Telegram 메시지 deleteMessage (48h 이내) — 채팅창에서 완전 제거
 *     c) dispatch_messages.status = 'expired'
 *     d) 어드민에게 알림
 *   - 멱등 — 동시 실행되어도 status 가드로 중복 처리 안 됨
 *
 * 주의:
 *   - bookings 도큐먼트는 변경하지 않음 (re-dispatch 가능하도록).
 *     dispatchedAt만 남고 driver/acceptedAt는 미설정 상태 유지.
 */
import { initAdminDb } from './firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { callBot } from './telegram-bot.js';
import { notify } from './notify.js';

const TIMEOUT_MS = 10 * 60 * 1000; // 10분

/**
 * 만료된 dispatch_messages를 처리.
 * @param {object} opts
 * @param {string} opts.driverBotToken - 기사봇 토큰 (메시지 편집/삭제용)
 * @param {string} [opts.adminBotToken] - 어드민봇 토큰 (알림용, 없으면 알림 스킵)
 * @param {string} [opts.adminChatId]   - 어드민 chat_id
 * @param {number} [opts.maxBatch=20]   - 1회 호출당 최대 처리 건수
 * @returns {Promise<{ swept: number, errors: number }>}
 */
export async function sweepExpiredDispatches(opts = {}) {
  const { driverBotToken, adminBotToken, adminChatId, maxBatch = 20 } = opts;
  if (!driverBotToken) {
    return { swept: 0, errors: 0, skipped: 'no driver bot token' };
  }

  const db = initAdminDb('dispatch-sweep');
  if (!db) return { swept: 0, errors: 0, skipped: 'no db' };

  const now = new Date();
  const snap = await db.collection('dispatch_messages')
    .where('status', '==', 'sent')
    .where('expiresAt', '<=', now)
    .limit(maxBatch)
    .get();

  if (snap.empty) return { swept: 0, errors: 0 };

  let swept = 0;
  let errors = 0;

  for (const doc of snap.docs) {
    const d = doc.data();
    try {
      // 1. Firestore status 갱신 (re-entry 방지)
      //   🔴 경합 fix (2026-06-14 버그헌트 #9 — sweep-accept-race): 쿼리 스냅샷 시점엔
      //   'sent' 였어도, 기사가 만료 직전 [수락] 을 누르면 handleAccept 트랜잭션이
      //   sent→accepted + bookings.dispatchStatus='accepted' 를 먼저 커밋할 수 있다.
      //   비트랜잭션 update 는 이를 무시하고 'expired' 로 덮어써 dispatch_messages=expired
      //   인데 bookings=accepted 불일치 + 허위 '재배차 필요' 알림 → 한 예약에 기사 2명 배정.
      //   handleAccept 의 CAS 패턴과 동형으로 트랜잭션 내 재확인 — freshStatus==='sent'
      //   일 때만 'expired' 로 전이(accept 가 먼저 커밋했으면 스킵).
      let transitioned = false;
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(doc.ref);
        if (!fresh.exists || fresh.data().status !== 'sent') {
          // accept/reject 가 먼저 커밋 — 덮어쓰지 않고 스킵
          return;
        }
        tx.update(doc.ref, {
          status: 'expired',
          respondedAt: FieldValue.serverTimestamp(),
        });
        transitioned = true;
      });

      if (!transitioned) {
        // 실제로 expired 전이가 일어나지 않음 (accept 가 이김) → PII 편집·삭제·알림 모두 스킵
        continue;
      }

      // 2. Telegram 메시지 편집 → PII 제거 (48h 이후엔 실패해도 이미 status는 expired)
      if (d.telegramMessageId && d.driverChatId) {
        try {
          await callBot(driverBotToken, 'editMessageText', {
            chat_id: d.driverChatId,
            message_id: d.telegramMessageId,
            text: `<b>만료된 배차 요청</b>\n예약번호: <code>${d.orderID}</code>\n\n10분 무응답으로 자동 취소되었습니다.\n고객 정보는 파기되었습니다.`,
            parse_mode: 'HTML',
          });
        } catch (err) {
          console.warn('[dispatch-sweep] editMessageText 실패:', err.message);
        }

        // 3. 메시지 삭제 시도 (48h 이내만 가능 — 실패해도 무시)
        try {
          await callBot(driverBotToken, 'deleteMessage', {
            chat_id: d.driverChatId,
            message_id: d.telegramMessageId,
          });
        } catch {
          // 메시지 삭제 실패는 정상 — 이미 편집된 메시지로 PII는 제거됨
        }
      }

      // 4. 어드민 알림 — dispatch 채널 (TELEGRAM_DISPATCH_BOT_TOKEN 또는 폴백)
      try {
        await notify('dispatch',
          `⏰ 배차 만료\n${d.orderID} ← ${d.driverName || d.driverChatId}\n10분 무응답으로 자동 취소. 재배차 필요.`);
      } catch (err) {
        console.warn('[dispatch-sweep] dispatch notify 실패:', err.message);
      }

      swept++;
    } catch (err) {
      console.error('[dispatch-sweep] 처리 실패:', doc.id, err.message);
      errors++;
    }
  }

  console.log(`[dispatch-sweep] swept=${swept} errors=${errors}`);
  return { swept, errors };
}

/**
 * sentAt + 10분 후의 Date 객체 반환.
 * 사용처: admin webhook이 dispatch_messages 생성 시 expiresAt 필드.
 */
export function computeExpiryDate(sentAt = new Date()) {
  return new Date(sentAt.getTime() + TIMEOUT_MS);
}
