/**
 * 마케팅 콘텐츠 직원 cron — 매일 아침 SNS 캡션 초안을 운영자 텔레그램으로. 자가운영 에이전시 P3.
 *
 * 2026-06-10. 모닝브리핑과 동형: 순수함수(셀렉터·빌더·포맷) 분리 + cron 은 fetch+AI+발송만.
 * AI = 캡션 윤문 1회(최저가 gemini-3.5-flash-lite, 월 ~13원). 사실은 코드가 잠금 → 환각 3층 방어.
 *
 * 🔒 안전:
 *   - CONTENT_WORKER_ENABLED='true' 일 때만 동작. 미설정=즉시 return(prod 무영향, 운영자 스위치).
 *   - 발행 토큰(IG/TikTok) import 0 → 자동 발행 물리적 불가. draft 만 생성·전달.
 *   - 고객 데이터(bookings/users/plans) 미조회. 공개 맛집 DB 만.
 *
 * cron-runner JOBS + vercel.json("0 23 * * *" = KST 08:00) 등록.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { initAdminDb } from '../_shared/firebase-admin.js';
import { notifyOperatorLong } from '../_shared/operator-alerts.js';
import { resolveGeminiModel } from '../_ai_core/geminiModelResolver.js';
import { selectFoodMaterials, pickDailyMaterial, kstDayIndex } from '../_shared/contentDraftSelector.js';
import { buildContentPrompt } from '../_shared/contentPromptBuilder.js';
import { parseContentJson, sanitizeDraft, formatDraftMessage } from '../_shared/contentDraftFormat.js';
import { enqueueDecision } from '../_shared/decisionQueue.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Gemini 1콜 — 캡션 초안 생성. 실패 시 null (graceful, 사실 카드만 발송). */
async function generateDraft(material) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  try {
    const { systemInstruction, userPrompt } = buildContentPrompt(material);
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: resolveGeminiModel('classifier'), systemInstruction });
    const result = await model.generateContent({ contents: [{ role: 'user', parts: [{ text: userPrompt }] }] });
    return sanitizeDraft(parseContentJson(result.response.text()));
  } catch (e) {
    console.error('[content-draft] Gemini 실패:', e && e.message);
    return null;
  }
}

async function contentDraftTask() {
  if (process.env.CONTENT_WORKER_ENABLED !== 'true') {
    return { statusCode: 200, body: 'disabled (CONTENT_WORKER_ENABLED 미설정)' };
  }

  let foodIndex = [];
  try { foodIndex = JSON.parse(readFileSync(join(__dirname, '../_food_index.json'), 'utf-8')); } catch (e) { console.error('[content-draft] food_index 로드 실패:', e && e.message); }

  const materials = selectFoodMaterials(foodIndex);
  const material = pickDailyMaterial(materials, kstDayIndex(new Date()));
  if (!material) {
    await notifyOperatorLong('todo', '📝 <b>오늘의 콘텐츠 초안</b>\n소재 없음 (데이터 수집 중).', { skipPrefix: true }).catch(() => {});
    return { statusCode: 200, body: 'no-material' };
  }

  const draft = await generateDraft(material); // null 이면 사실 카드만 (graceful)
  const msg = formatDraftMessage(material, draft);

  // Firestore 보관 (admin 웹 조회용). 실패해도 텔레그램은 발송.
  try {
    const db = initAdminDb('cron/content-draft');
    if (db) {
      await db.collection('content_drafts').add({
        material, draft: draft || null, hasDraft: !!draft,
        createdAtMs: Date.now(), channel: 'instagram', published: false,
      });
      // P5 의사결정 큐: "발행 검토" 카드 enqueue (멱등=하루 1건). draft 가 있을 때만.
      if (draft) {
        await enqueueDecision(db, {
          type: 'content_publish',
          title: `오늘 콘텐츠 발행 검토 — ${material.name}`,
          summary: `${material.cityLabel}${material.dong ? ' ' + material.dong : ''} 맛집 캡션 초안 ${draft.variants.length}안. 검토 후 인스타 발행.`,
          link: '/admin/decisions',
          dedupeKey: `content-${kstDayIndex(new Date())}`,
        }).catch(() => {});
      }
    }
  } catch (e) { console.error('[content-draft] Firestore 저장 실패:', e && e.message); }

  const result = await notifyOperatorLong('todo', msg, { skipPrefix: true });
  if (!result.ok) {
    console.error('[content-draft] 텔레그램 발송 실패:', result.error);
    return { statusCode: 500, body: `send-fail:${result.error || 'unknown'}` };
  }
  return { statusCode: 200, body: `sent (${material.name}, draft=${draft ? draft.variants.length : 0})` };
}

export default async function vercelHandler(req, res) {
  if (req && req.method === 'OPTIONS') return res.status(200).end();
  try {
    const r = await contentDraftTask();
    return res.status(r.statusCode || 200).json({ ok: (r.statusCode || 200) < 400, body: r.body });
  } catch (e) {
    console.error('[content-draft] 실패:', e && e.message);
    return res.status(500).json({ error: e && e.message });
  }
}
