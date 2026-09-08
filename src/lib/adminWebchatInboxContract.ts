import type { Language } from '@/i18n';

export type WebchatSender = 'customer' | 'ai' | 'admin';
export interface WebchatSession {
  sessionId: string; lastMessageAtMs: number; lastMessageFrom: WebchatSender | 'unknown';
  ownerType: 'user' | 'guest'; language: Language | null;
}
export interface WebchatMessage {
  id: string; from: WebchatSender; text: string; truncated: boolean; language: Language | null; ts: number;
}
export interface WebchatOverview { generatedAtMs: number; sessions: WebchatSession[]; possiblyTruncated: boolean }
export interface WebchatDetail { generatedAtMs: number; session: WebchatSession; messages: WebchatMessage[]; messagesPossiblyTruncated: boolean }
export interface WebchatReply { session: WebchatSession; requestId: string; translated: false; message: WebchatMessage }

const sessionPattern = /^sess_[A-Za-z0-9_-]{24,120}$/;
const messagePattern = /^[A-Za-z0-9_-]{1,128}$/;
const requestPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const timestamp = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= Date.now() + 60_000;
const member = (value: unknown, allowed: string[]) => typeof value === 'string' && allowed.includes(value);
const language = (value: unknown) => value === null || member(value, ['ko', 'en', 'ja', 'zh']);
function session(value: unknown): value is WebchatSession {
  return object(value) && typeof value.sessionId === 'string' && sessionPattern.test(value.sessionId)
    && timestamp(value.lastMessageAtMs) && member(value.lastMessageFrom, ['customer', 'ai', 'admin', 'unknown'])
    && member(value.ownerType, ['user', 'guest']) && language(value.language);
}
function message(value: unknown): value is WebchatMessage {
  return object(value) && typeof value.id === 'string' && messagePattern.test(value.id)
    && member(value.from, ['customer', 'ai', 'admin']) && typeof value.text === 'string'
    && Array.from(value.text).length <= 4000 && typeof value.truncated === 'boolean' && timestamp(value.ts) && language(value.language);
}
export function isWebchatOverview(value: unknown): value is WebchatOverview {
  return object(value) && timestamp(value.generatedAtMs) && Array.isArray(value.sessions) && value.sessions.length <= 50
    && value.sessions.every(session) && new Set(value.sessions.map(item => item.sessionId)).size === value.sessions.length
    && typeof value.possiblyTruncated === 'boolean';
}
export function isWebchatDetail(value: unknown): value is WebchatDetail {
  return object(value) && timestamp(value.generatedAtMs) && session(value.session) && Array.isArray(value.messages)
    && value.messages.length <= 50 && value.messages.every(message)
    && new Set(value.messages.map(item => item.id)).size === value.messages.length
    && value.messages.every((item, index, items) => index === 0 || items[index - 1].ts <= item.ts)
    && typeof value.messagesPossiblyTruncated === 'boolean';
}
export function isWebchatReply(value: unknown): value is WebchatReply {
  return object(value) && session(value.session) && typeof value.requestId === 'string' && requestPattern.test(value.requestId)
    && value.translated === false && message(value.message) && value.message.from === 'admin'
    && value.session.lastMessageFrom === 'admin' && value.session.lastMessageAtMs === value.message.ts;
}
