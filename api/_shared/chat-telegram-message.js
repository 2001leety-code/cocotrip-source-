/**
 * Customer chat -> Telegram inquiry alert formatter.
 *
 * All dynamic values are escaped for Telegram HTML parse mode. Only the
 * formatting tags written in this module remain as markup, so customer/model
 * text cannot break the alert or impersonate operator formatting.
 */
import { escapeTelegram } from './escape.js';

export function buildChatTelegramMessage({
  escalate = false,
  sessionId = '',
  detectedLang = 'en',
  customerMessage = '',
  customerTranslation = null,
  customerTranslationFailed = false,
  customerReply = '',
  internalReply = '',
  aiTranslation = null,
  kst = '',
} = {}) {
  const safeSessionId = escapeTelegram(sessionId);
  const safeLang = escapeTelegram(detectedLang);
  const safeCustomerMessage = escapeTelegram(customerMessage);
  const safeCustomerTranslation = escapeTelegram(customerTranslation);
  const safeCustomerReply = escapeTelegram(customerReply);
  const safeInternalReply = escapeTelegram(internalReply);
  const safeAiTranslation = escapeTelegram(aiTranslation);
  const safeKst = escapeTelegram(kst);

  const header = escalate
    ? '🚨 <b>긴급 — AI 미답변 (담당자 응답 필요)</b>'
    : '💬 <b>웹 채팅 문의</b>';
  const customerSection = customerTranslation
    ? `<b>📨 고객 (${safeLang}):</b> ${safeCustomerMessage}\n<b>🇰🇷 번역:</b> ${safeCustomerTranslation}`
    : `<b>고객${customerTranslationFailed ? ' ⚠️ 번역 실패' : ''}:</b> ${safeCustomerMessage}`;
  const aiSection = escalate
    ? `<b>AI 판단:</b> 답변 불가 — 다음과 같이 자동 안내됨\n<i>${safeCustomerReply}</i>${internalReply ? `\n<b>AI 노트:</b> ${safeInternalReply}` : ''}`
    : aiTranslation
      ? `<b>AI답변:</b> ${safeCustomerReply}\n<b>🇰🇷 번역:</b> ${safeAiTranslation}`
      : `<b>AI답변:</b> ${safeCustomerReply}`;

  return `${header}\n\n👤 세션: <code>${safeSessionId}</code>\n🌐 언어: ${safeLang}\n\n${customerSection}\n${aiSection}\n\n⏰ ${safeKst}\n\n💡 이 메시지에 "답장(Reply)" 하면 고객에게 직접 전달됩니다.`;
}

export default buildChatTelegramMessage;
