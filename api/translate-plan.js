/**
 * POST /api/translate-plan
 *
 * Translates an existing plan's user-facing text fields to a target language
 * using Gemini Flash (fast, cheap model).
 *
 * Body: { plan: itinerary, targetLang: 'ko' | 'en' | 'ja' | 'zh' }
 * Returns: { translated: itinerary, translatorVersion: number, stats: {...} }
 *
 * Two-batch translation:
 *   - descriptive: prose like tour_title, tip, theme. Keep Korean proper nouns
 *     (경복궁, 명동) as-is so the user can show them at the venue.
 *   - transit: subway/bus station + line names. For ja/zh, convert to Hanja
 *     (e.g. "강남" -> "江南", "2호선" -> "2号線" / "2号线"). Written back as
 *     suffixed fields (lineJa/lineZh/fromJa/...) without overwriting Korean
 *     originals. The PDF/UI then shows "강남 (江南)" — Korean primary so it's
 *     useful to local staff, translation in parens for the traveller.
 *     Skipped for ko (already Korean) and en (lineEn/fromRoman already exist).
 */
// ESM, not CommonJS — root package.json sets "type": "module" so Vercel treats
// every api/*.js as ESM. The previous CommonJS form crashed at module-load on
// every invocation ("FUNCTION_INVOCATION_FAILED"), masking earlier ja/zh
// translation failures behind warm Firestore cache hits.
import { GoogleGenerativeAI } from '@google/generative-ai';

export const maxDuration = 60;
export const config = { runtime: 'nodejs' };

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Bumped when the translator emits new fields; useAutoTranslate compares this
// against cached.translatorVersion and re-translates on mismatch so old caches
// (without translated transit fields) get refreshed.
const TRANSLATOR_VERSION = 2;

const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

const TRANSLATE_FIELDS = ['display_name', 'tip', 'entry_fee_note'];
const TRANSLATE_ITEM_FIELDS = ['name', 'note'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json(_err('POST only', 'METHOD_NOT_ALLOWED'));

  const { plan, targetLang } = req.body;
  if (!plan || !targetLang) return res.status(400).json(_err('plan and targetLang required', 'MISSING_FIELDS'));

  const LANG_NAMES = { ko: 'Korean', en: 'English', ja: 'Japanese', zh: 'Chinese (Simplified)' };
  const langName = LANG_NAMES[targetLang] || 'English';
  const isCJKTarget = targetLang === 'ja' || targetLang === 'zh';
  const transitSuffix = targetLang === 'ja' ? 'Ja' : targetLang === 'zh' ? 'Zh' : '';

  try {
    // ── Batch 1: descriptive prose (keep Korean proper nouns) ──
    const descTexts = [];
    const descMapping = [];

    if (plan.tour_title) {
      descTexts.push(plan.tour_title);
      descMapping.push({ section: 'root', field: 'tour_title' });
    }

    if (plan.arrival_guide?.steps) {
      plan.arrival_guide.steps.forEach((step, si) => {
        if (step.title) { descTexts.push(step.title); descMapping.push({ section: 'arrival', stepIdx: si, field: 'title' }); }
        if (step.description) { descTexts.push(step.description); descMapping.push({ section: 'arrival', stepIdx: si, field: 'description' }); }
      });
    }

    if (plan.days) {
      plan.days.forEach((day, di) => {
        if (day.theme) { descTexts.push(day.theme); descMapping.push({ section: 'day', dayIdx: di, field: 'theme' }); }
        if (day.stops) {
          day.stops.forEach((stop, si) => {
            TRANSLATE_FIELDS.forEach(f => {
              if (stop[f] && typeof stop[f] === 'string') {
                descTexts.push(stop[f]);
                descMapping.push({ section: 'stop', dayIdx: di, stopIdx: si, field: f });
              }
            });
            if (stop.recommended_items) {
              stop.recommended_items.forEach((item, ii) => {
                TRANSLATE_ITEM_FIELDS.forEach(f => {
                  if (item[f] && typeof item[f] === 'string') {
                    descTexts.push(item[f]);
                    descMapping.push({ section: 'item', dayIdx: di, stopIdx: si, itemIdx: ii, field: f });
                  }
                });
              });
            }
          });
        }
      });
    }

    if (plan.departure_guide) {
      if (plan.departure_guide.recommended_departure_time) {
        descTexts.push(plan.departure_guide.recommended_departure_time);
        descMapping.push({ section: 'departure', field: 'recommended_departure_time' });
      }
      if (plan.departure_guide.last_minute_shopping) {
        descTexts.push(plan.departure_guide.last_minute_shopping);
        descMapping.push({ section: 'departure', field: 'last_minute_shopping' });
      }
    }

    // ── Batch 2: transit station/line names (ja/zh only) ──
    // Dedupe identical strings so "강남" repeated across 6 segments hits Gemini once.
    const transitTexts = [];
    const transitMapping = [];
    const transitDedupe = new Map(); // text -> index in transitTexts
    const pushTransit = (text, mapEntry) => {
      if (!text || typeof text !== 'string') return;
      let idx = transitDedupe.get(text);
      if (idx === undefined) {
        idx = transitTexts.length;
        transitTexts.push(text);
        transitDedupe.set(text, idx);
      }
      transitMapping.push({ ...mapEntry, transitIdx: idx });
    };

    if (isCJKTarget && plan.days) {
      plan.days.forEach((day, di) => {
        (day.stops || []).forEach((stop, si) => {
          const t = stop.transit_from_prev;
          const steps = Array.isArray(t?.steps_detail) ? t.steps_detail : [];
          steps.forEach((step, ti) => {
            const base = { section: 'transit', dayIdx: di, stopIdx: si, stepIdx: ti };
            if (step.mode === 'subway') {
              pushTransit(step.lineKo, { ...base, field: 'line' });
              pushTransit(step.from,   { ...base, field: 'from' });
              pushTransit(step.to,     { ...base, field: 'to' });
              pushTransit(step.way,    { ...base, field: 'way' });
              // Also translate transfer line names shown in PDF/UI ("Also transfers: 3호선/9호선")
              const transferLines = step.fromStationInfo?.transferLines || [];
              transferLines.forEach((line, li) => {
                pushTransit(line.lineKo, { ...base, field: 'transferLine', transferIdx: li });
              });
            } else if (step.mode === 'bus') {
              pushTransit(step.from,    { ...base, field: 'from' });
              pushTransit(step.to,      { ...base, field: 'to' });
              pushTransit(step.busType, { ...base, field: 'busType' });
            }
          });
        });
      });
    }

    if (descTexts.length === 0 && transitTexts.length === 0) {
      return res.status(200).json(_ok({ translated: plan, translatorVersion: TRANSLATOR_VERSION, message: 'Nothing to translate' }));
    }

    // ── Single Gemini call with two arrays ──
    // temperature: 0 — translation is a strict mapping task, and at the default
    // creative temperature Gemini occasionally returns the response array out of
    // order, which breaks the index-based writeback (we'd attach 蚕室 to 강남).
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    });

    const transitRule = isCJKTarget
      ? `Convert each Korean station/line name to its Hanja form in ${langName}. Examples: "강남" -> "${targetLang === 'ja' ? '江南' : '江南'}", "2호선" -> "${targetLang === 'ja' ? '2号線' : '2号线'}", "신분당선" -> "${targetLang === 'ja' ? '新盆唐線' : '新盆唐线'}", "잠실" -> "${targetLang === 'ja' ? '蚕室' : '蚕室'}". For Korean station names without a standard Hanja equivalent, use the most common ${langName} reading. For Korean bus type words like "일반"/"좌석"/"공항"/"마을", translate to ${langName} (e.g. "${targetLang === 'ja' ? '一般/座席/空港/村' : '普通/座席/机场/区间'}").`
      : 'Leave unchanged.';

    const prompt = `You are a professional travel guide translator. Translate the input into ${langName}.

The input is a JSON object with two arrays:
- "descriptive": Travel guide prose (titles, themes, tips, descriptions). Translate the prose but KEEP Korean proper nouns (경복궁, 명동, 광장시장, etc.) as-is so travellers can show them to locals.
- "transit": Subway/bus station, line, and bus-type names. ${transitRule}

General rules:
- Keep numbers, prices (₩), times, and addresses as-is
- Output ONLY a JSON object: {"descriptive": [array of length ${descTexts.length}], "transit": [array of length ${transitTexts.length}]}
- Each array length must match exactly. Preserve order.

Input:
${JSON.stringify({ descriptive: descTexts, transit: transitTexts })}`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    // Robust JSON extract: outermost braces
    const firstBrace = responseText.indexOf('{');
    const lastBrace = responseText.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace <= firstBrace) {
      console.error('[translate-plan] Failed to parse response:', responseText.substring(0, 200));
      return res.status(500).json(_err('Translation parsing failed', 'PARSE_ERROR'));
    }
    let parsed;
    try {
      parsed = JSON.parse(responseText.slice(firstBrace, lastBrace + 1));
    } catch (e) {
      console.error('[translate-plan] JSON parse failed:', e.message);
      return res.status(500).json(_err('Translation parsing failed', 'PARSE_ERROR'));
    }

    const descTr = Array.isArray(parsed.descriptive) ? parsed.descriptive : [];
    const transitTr = Array.isArray(parsed.transit) ? parsed.transit : [];

    if (descTr.length !== descTexts.length) {
      console.warn(`[translate-plan] descriptive length mismatch: expected ${descTexts.length}, got ${descTr.length}`);
    }
    if (transitTr.length !== transitTexts.length) {
      console.warn(`[translate-plan] transit length mismatch: expected ${transitTexts.length}, got ${transitTr.length}`);
    }

    const result_plan = JSON.parse(JSON.stringify(plan));

    // Apply descriptive translations (in-place)
    descTr.forEach((text, i) => {
      const m = descMapping[i];
      if (!m) return;
      try {
        if (m.section === 'root') {
          result_plan[m.field] = text;
        } else if (m.section === 'arrival') {
          result_plan.arrival_guide.steps[m.stepIdx][m.field] = text;
        } else if (m.section === 'day') {
          result_plan.days[m.dayIdx][m.field] = text;
        } else if (m.section === 'stop') {
          result_plan.days[m.dayIdx].stops[m.stopIdx][m.field] = text;
        } else if (m.section === 'item') {
          result_plan.days[m.dayIdx].stops[m.stopIdx].recommended_items[m.itemIdx][m.field] = text;
        } else if (m.section === 'departure') {
          result_plan.departure_guide[m.field] = text;
        }
      } catch (e) {
        console.warn(`[translate-plan] Failed to apply descriptive[${i}]:`, e.message);
      }
    });

    // Apply transit translations as suffixed fields (preserve Korean originals)
    if (transitSuffix && transitMapping.length > 0) {
      transitMapping.forEach((m) => {
        const text = transitTr[m.transitIdx];
        if (typeof text !== 'string' || !text) return;
        try {
          const step = result_plan.days?.[m.dayIdx]?.stops?.[m.stopIdx]?.transit_from_prev?.steps_detail?.[m.stepIdx];
          if (!step) return;
          if (m.field === 'transferLine') {
            const line = step.fromStationInfo?.transferLines?.[m.transferIdx];
            if (line) line[`lineKo${transitSuffix}`] = text; // e.g. lineKoJa
          } else {
            // line/from/to/way/busType -> lineJa, fromJa, ... (or Zh)
            step[`${m.field}${transitSuffix}`] = text;
          }
        } catch (e) {
          console.warn(`[translate-plan] Failed to apply transit translation:`, e.message);
        }
      });
    }

    return res.status(200).json(_ok({
      translated: result_plan,
      translatorVersion: TRANSLATOR_VERSION,
      stats: {
        descriptive: descTexts.length,
        transit_unique: transitTexts.length,
        transit_total_refs: transitMapping.length,
        target: targetLang,
      },
    }));

  } catch (err) {
    console.error('[translate-plan] Error:', err);
    return res.status(500).json(_err(err.message || 'Translation failed', 'INTERNAL_ERROR'));
  }
};
