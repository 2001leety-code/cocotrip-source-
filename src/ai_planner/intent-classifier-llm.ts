/**
 * intent-classifier-llm.ts — Gemini 폴백 분류기 (P128, 2026-05-21).
 *
 * 규칙기반 classifier (intent-classifier.ts) 의 confidence 가 0.5 미만일 때 호출.
 * Gemini 2.5 Flash Lite 사용 — maxDuration < 15초 (cheap + fast).
 *
 * 사용 패턴:
 *   1) classifyModification(rawText) — rule-based
 *   2) result.confidence < 0.5 → llmClassifyModification(rawText, options)
 *   3) Gemini 결과 + 규칙기반 결과 중 confidence 높은 쪽 채택
 *
 * 핵심 원칙 ("오류 없이 진행할 수 있는 시스템"):
 *   - Gemini 호출 실패 시 throw 금지. 규칙기반 결과 그대로 반환 가능하도록 wrapper 호출자가 책임.
 *   - 응답 파싱 실패 시 fallback (intent='no_change' + reason='llm_parse_failed').
 *
 * NOTE: 이 모듈은 client (browser) bundle 에 포함되지 않음. 서버 (API endpoint) 에서만 호출.
 *       client 측에서 모달 사용 시 /api/ai-planner-modify 가 내부에서 호출.
 */

import type { ClassifiedModification, ModificationIntent } from './intent-classifier';

/** Gemini 호출 옵션 */
export interface LLMClassifyOptions {
  /** Gemini API 키 — 서버 측 env 에서 inject */
  apiKey: string;
  /** Gemini 모델 — 기본 'gemini-2.5-flash-lite' */
  model?: string;
  /** classifier 가 받은 day_index hint (Gemini context 보조) */
  hintDayIndex?: number;
  /** 호출 timeout (ms) — 기본 12초 */
  timeoutMs?: number;
}

/** 분류 응답 — ClassifiedModification 와 동일 + source='llm' */
export interface LLMClassifiedModification extends ClassifiedModification {
  source: 'llm';
}

const ALLOWED_INTENTS: ModificationIntent[] = [
  'block_swap',
  'stop_swap',
  'stop_add',
  'stop_remove',
  'no_change',
];

/**
 * Gemini 폴백 분류 — rule-based 가 confidence 미달일 때 호출.
 * 호출자 (api/ai-planner-modify.js) 는 결과 가 ClassifiedModification 와 호환됨을 보장.
 *
 * @throws Error — Gemini API 호출 자체가 실패하면 throw. caller 가 catch 해서 rule-based 결과 폴백.
 */
export async function llmClassifyModification(
  rawText: string,
  options: LLMClassifyOptions,
): Promise<LLMClassifiedModification> {
  if (typeof rawText !== 'string' || rawText.trim().length === 0) {
    return {
      intent: 'no_change',
      raw_text: rawText || '',
      confidence: 0,
      fallback_reason: 'empty input (LLM skipped)',
      source: 'llm',
    };
  }
  if (!options || !options.apiKey) {
    throw new Error('llmClassifyModification: apiKey required');
  }

  const modelName = options.model || 'gemini-2.5-flash-lite';
  const timeoutMs = Number(options.timeoutMs) || 12000;

  // dynamic import — type 만 server 환경에 필요. 모듈 미설치 (브라우저) 환경 호출 차단.
  let GoogleGenerativeAI: typeof import('@google/generative-ai').GoogleGenerativeAI;
  try {
    ({ GoogleGenerativeAI } = await import('@google/generative-ai'));
  } catch (err) {
    throw new Error(`llmClassifyModification: @google/generative-ai not available — ${(err as Error)?.message || err}`);
  }

  const genAI = new GoogleGenerativeAI(options.apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 800,
      responseMimeType: 'application/json',
    },
  });

  const system = buildLLMSystemPrompt();
  const user = JSON.stringify({
    user_request_text: rawText.slice(0, 1000),
    hint_day_index: options.hintDayIndex,
  });

  // race against timeout
  const callPromise = model.generateContent({
    contents: [{ role: 'user', parts: [{ text: user }] }],
    systemInstruction: { role: 'system', parts: [{ text: system }] },
  });
  const result = await Promise.race([
    callPromise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('llmClassifyModification timeout')), timeoutMs)),
  ]);

  const raw = (result as { response?: { text?: () => string } })?.response?.text?.()?.trim() || '';
  if (!raw) {
    return {
      intent: 'no_change',
      raw_text: rawText,
      confidence: 0,
      fallback_reason: 'llm_empty_response',
      source: 'llm',
    };
  }

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      intent: 'no_change',
      raw_text: rawText,
      confidence: 0,
      fallback_reason: 'llm_parse_failed',
      source: 'llm',
    };
  }

  let intent: ModificationIntent = 'no_change';
  if (typeof parsed.intent === 'string' && (ALLOWED_INTENTS as string[]).includes(parsed.intent)) {
    intent = parsed.intent as ModificationIntent;
  }

  let confidence = Number(parsed.confidence);
  if (!Number.isFinite(confidence)) confidence = 0;
  confidence = Math.max(0, Math.min(1, confidence));

  const rawTarget = (parsed.target && typeof parsed.target === 'object')
    ? (parsed.target as Record<string, unknown>)
    : {};

  const target: ClassifiedModification['target'] = {};
  if (typeof rawTarget.day_index === 'number' && Number.isFinite(rawTarget.day_index)) {
    target.day_index = Math.max(1, Math.min(30, Math.floor(rawTarget.day_index)));
  }
  if (typeof rawTarget.stop_order === 'number' && Number.isFinite(rawTarget.stop_order)) {
    target.stop_order = Math.max(1, Math.min(30, Math.floor(rawTarget.stop_order)));
  }
  if (typeof rawTarget.block_id === 'string') {
    target.block_id = rawTarget.block_id.slice(0, 80);
  }
  if (typeof rawTarget.stop_name === 'string') {
    target.stop_name = rawTarget.stop_name.slice(0, 200);
  }
  if (typeof rawTarget.stop_address === 'string') {
    target.stop_address = rawTarget.stop_address.slice(0, 300);
  }

  return {
    intent,
    target: Object.keys(target).length > 0 ? target : undefined,
    raw_text: rawText,
    confidence,
    fallback_reason: typeof parsed.fallback_reason === 'string'
      ? String(parsed.fallback_reason).slice(0, 200)
      : undefined,
    source: 'llm',
  };
}

/**
 * LLM 분류 + rule-based 결과 중 confidence 높은 쪽 채택.
 * caller (api/ai-planner-modify.js) 가 사용. LLM 호출 실패 시 rule-based 그대로 반환.
 */
export async function combineRuleAndLLMClassification(
  ruleBased: ClassifiedModification,
  options: LLMClassifyOptions,
): Promise<ClassifiedModification & { source?: 'rule' | 'llm' }> {
  // confidence ≥ 0.5 면 rule-based 충분 — LLM 호출 skip (cost 절감).
  if (!ruleBased || ruleBased.confidence >= 0.5) {
    return { ...ruleBased, source: 'rule' };
  }
  try {
    const llmResult = await llmClassifyModification(ruleBased.raw_text || '', {
      ...options,
      hintDayIndex: ruleBased.target?.day_index,
    });
    if (llmResult.confidence > ruleBased.confidence) {
      return llmResult;
    }
    return { ...ruleBased, source: 'rule' };
  } catch {
    // graceful fallback — rule-based 그대로 반환.
    return { ...ruleBased, source: 'rule' };
  }
}

function buildLLMSystemPrompt(): string {
  return `You are CocoTrip's modification intent classifier. Your job is to classify a user's plan-modification request into one of 5 intents.

## OUTPUT FORMAT — STRICT JSON ONLY
No markdown. No code blocks. No explanation. Pure JSON only.

{
  "intent": "block_swap | stop_swap | stop_add | stop_remove | no_change",
  "target": {
    "day_index": 1,           // optional 1-based day index
    "stop_order": 3,          // optional 1-based stop order within day
    "block_id": "...",        // optional new block ID (block_swap only)
    "stop_name": "경복궁",     // optional Korean stop name (stop_swap/add/remove)
    "stop_address": "..."     // optional address (stop_add only)
  },
  "confidence": 0.85,         // 0..1 — how confident you are
  "fallback_reason": "..."    // optional — when intent='no_change'
}

## INTENT DEFINITIONS

- block_swap: User wants to replace a whole day's plan with a different zone/theme.
  Examples: "2일차 DMZ로 바꿔줘" / "Day 3 add trekking" / "강남 데이로 변경"
- stop_swap: User wants to change a single stop with another of similar category.
  Examples: "다른 식당으로 바꿔" / "이 카페 말고 다른 곳" / "swap restaurant"
- stop_add: User wants to add a stop to a day.
  Examples: "N서울타워 추가" / "경복궁 끼워줘" / "add Lotte World"
- stop_remove: User wants to remove a stop.
  Examples: "인사동 빼" / "remove 광장시장" / "cancel that"
- no_change: User text is ambiguous, off-topic, or vague.
  Examples: "good" / "thanks" / "별로네" (no actionable change)

## CONFIDENCE
- 0.9-1.0: Crystal clear with explicit day + target
- 0.7-0.9: Clear intent but missing day index
- 0.5-0.7: Intent inferred from context
- 0.3-0.5: Ambiguous — prefer no_change with fallback_reason
- 0.0-0.3: Reject — no_change

## TARGET FIELDS
- day_index is 1-based (Day 1 → 1, Day 2 → 2). Extract from "X일차", "X일째", "Day X".
- stop_order is 1-based within the day. Extract from "X번째", "stop X".
- stop_name should be in Korean if user wrote Korean, English otherwise.
- block_id ONLY for block_swap. Use the keyword the user mentioned (e.g. "DMZ", "강남", "북한산") — actual ID lookup happens later.
- stop_address ONLY for stop_add and only if user explicitly gave it.

## SAFETY
- ALWAYS return valid JSON matching the schema.
- NEVER add extra fields outside the schema.
- For non-Korean/English requests, still parse — they may be Japanese/Chinese travelers.`;
}
