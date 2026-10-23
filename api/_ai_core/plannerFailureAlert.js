/**
 * AI 플래너 처리 실패 운영 알림 본문 (2026-10-23) — handlerCore catch 가 throttledTelegramAlert 로 보낸다.
 *
 * 텔레그램은 parse_mode HTML 이라 오류 메시지에 `<`·`&` 가 섞이면 "can't parse entities: Unsupported start tag"
 * 로 **알림 자체가 실패**했다(운영 로그 실측). 오류 메시지·모드는 외부 문자열 → escapeTelegram.
 */
import { escapeTelegram } from '../_shared/escape.js';

export function plannerFailureAlertMessage(errorMessage, plannerMode) {
  return `🔴 <b>AI 플래너 처리 실패</b>\n\n${escapeTelegram(errorMessage || '알 수 없는 오류')}\n\n`
    + `경로: /api/ai-planner-full | 모드: ${escapeTelegram(plannerMode)}`;
}
