/**
 * Customer Chat 양방향 릴레이 헬퍼.
 *
 * 흐름:
 *   1. 고객이 ChatWidget으로 메시지 → /api/chat
 *      → notify('inquiry', ...) → 텔레그램 메시지 발송, message_id 반환
 *      → recordInquiryMessage(messageId, sessionId) 매핑 저장
 *      → saveChatMessage(sessionId, 'customer'/'ai', text)
 *
 *   2. 관리자가 텔레그램에서 해당 메시지에 "답장(Reply)"
 *      → 봇 webhook이 reply_to_message.message_id 수신
 *      → relayAdminReply(replyToMessageId, text)
 *      → 매핑 조회 → chat_sessions/{sessionId}/messages 에 admin 메시지 추가
 *
 *   3. 고객의 ChatWidget이 /api/chat-poll 폴링
 *      → 새 admin 메시지를 표시
 *
 * Firestore:
 *   inquiry_messages/{telegramMessageId} → { sessionId, sentAt }  (TTL 7일 권장)
 *   chat_sessions/{sessionId}/messages/{auto-id} → { from, text, ts, ... }
 */
import { initAdminDb } from './firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { translate } from './translator.js';

/**
 * 인쿼리 메시지 → 세션 매핑 저장.
 * 관리자가 답장할 때 reply_to_message.message_id로 sessionId 찾는 데 사용.
 */
export async function recordInquiryMessage({ telegramMessageId, sessionId, language }) {
  if (!telegramMessageId || !sessionId) return false;
  const db = initAdminDb('chat-relay');
  if (!db) return false;
  await db.collection('inquiry_messages').doc(String(telegramMessageId)).set({
    sessionId,
    language: language || 'en',
    sentAt: FieldValue.serverTimestamp(),
  });
  return true;
}

/**
 * 채팅 세션에 메시지 추가.
 * @param {object} args
 * @param {string} args.sessionId
 * @param {'customer'|'ai'|'admin'} args.from
 * @param {string} args.text — 화면에 표시될 텍스트 (번역 후 텍스트)
 * @param {string} [args.adminName]
 * @param {string} [args.originalText] — 운영자 원문 (번역 전 한국어). 감사용
 * @param {string} [args.language] — 텍스트의 언어 (ko/en/ja/zh)
 * @param {boolean} [args.translationFailed] — 번역 시도가 실패했는지 (운영자 한글이 그대로 노출됨)
 */
export async function saveChatMessage({ sessionId, from, text, adminName, originalText, language, translationFailed, ownerFields }) {
  if (!sessionId || !from || !text) return false;
  const db = initAdminDb('chat-relay');
  if (!db) return false;

  const sessionRef = db.collection('chat_sessions').doc(sessionId);
  const msgRef = sessionRef.collection('messages').doc();

  const payload = {
    from,
    text,
    adminName: adminName || null,
    ts: FieldValue.serverTimestamp(),
  };
  if (originalText && originalText !== text) payload.originalText = originalText;
  if (language) payload.language = language;
  if (translationFailed) payload.translationFailed = true;

  await Promise.all([
    msgRef.set(payload),
    sessionRef.set({
      lastMessageAt: FieldValue.serverTimestamp(),
      lastMessageFrom: from,
      ...(ownerFields || {}),
    }, { merge: true }),
  ]);
  return true;
}

/**
 * 관리자가 인쿼리 메시지에 reply한 경우 → 채팅 세션에 admin 메시지 추가.
 *
 * 번역 흐름:
 *   - inquiry_messages/{telegramMessageId}.language = 고객의 마지막 언어
 *   - 한국어가 아니면 → translator.translate(text, customerLang)으로 번역 후 사이트 노출
 *   - 번역 실패 시 → 한국어 원문 그대로 노출 + translationFailed=true 기록
 *
 * @returns {Promise<{
 *   relayed: boolean,
 *   sessionId?: string,
 *   targetLang?: string,
 *   translated?: boolean,
 *   translationFailed?: boolean,
 * }>}
 */
export async function relayAdminReply({ replyToMessageId, text, adminName }) {
  if (!replyToMessageId || !text) return { relayed: false };
  const db = initAdminDb('chat-relay');
  if (!db) return { relayed: false };

  const mapDoc = await db.collection('inquiry_messages').doc(String(replyToMessageId)).get();
  if (!mapDoc.exists) {
    // 인쿼리 매핑 없음 — 일반 메시지로 처리 (보통 다른 명령어)
    return { relayed: false };
  }

  const { sessionId, language } = mapDoc.data();
  const targetLang = ['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en';

  // 운영자는 한국어로 답장 → 고객 언어가 한국어가 아니면 번역해서 보여줌
  let displayText = text;
  let translated = false;
  let translationFailed = false;
  if (targetLang !== 'ko') {
    try {
      const t = await translate(text, targetLang);
      if (t) {
        displayText = t;
        translated = true;
      } else {
        translationFailed = true;
      }
    } catch (err) {
      console.warn('[chat-relay.relayAdminReply] translate failed:', err.message);
      translationFailed = true;
    }
  }

  await saveChatMessage({
    sessionId,
    from: 'admin',
    text: displayText,
    adminName,
    originalText: translated ? text : undefined,
    language: targetLang,
    translationFailed,
  });
  return { relayed: true, sessionId, targetLang, translated, translationFailed };
}

/**
 * 채팅 세션의 신규 메시지 조회 (since 이후).
 * /api/chat-poll에서 사용.
 *
 * @param {string} sessionId
 * @param {number} sinceMs - epoch ms; 이후 timestamp만 반환
 * @returns {Promise<Array<{ id, from, text, adminName?, ts: number }>>}
 */
export async function getMessagesSince(sessionId, sinceMs = 0) {
  if (!sessionId) return [];
  const db = initAdminDb('chat-relay');
  if (!db) return [];

  const since = new Date(sinceMs || 0);
  const snap = await db.collection('chat_sessions').doc(sessionId)
    .collection('messages')
    .where('ts', '>', since)
    .orderBy('ts', 'asc')
    .limit(50)
    .get();

  const out = [];
  snap.forEach((doc) => {
    const d = doc.data();
    const ms = d.ts?.toMillis ? d.ts.toMillis() : Date.now();
    out.push({
      id: doc.id,
      from: d.from,
      text: d.text,
      adminName: d.adminName || null,
      ts: ms,
    });
  });
  return out;
}
