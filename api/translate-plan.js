/**
 * POST /api/translate-plan
 * 
 * Translates an existing plan's user-facing text fields to a target language
 * using Gemini Flash (fast, cheap model).
 * 
 * Body: { planId: string, targetLang: 'ko' | 'en' | 'ja' | 'zh' }
 * Returns: { translated: { days: [...], arrival_guide, departure_guide } }
 */
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Fields to translate per stop
const TRANSLATE_FIELDS = ['display_name', 'tip', 'entry_fee_note'];
const TRANSLATE_ITEM_FIELDS = ['name', 'note'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { plan, targetLang } = req.body;
  if (!plan || !targetLang) return res.status(400).json({ error: 'plan and targetLang required' });

  const LANG_NAMES = { ko: 'Korean', en: 'English', ja: 'Japanese', zh: 'Chinese (Simplified)' };
  const langName = LANG_NAMES[targetLang] || 'English';

  try {
    // Extract translatable text
    const textsToTranslate = [];
    const mapping = []; // Track where each text came from

    // Tour title
    if (plan.tour_title) {
      textsToTranslate.push(plan.tour_title);
      mapping.push({ section: 'root', field: 'tour_title' });
    }

    // Arrival guide steps
    if (plan.arrival_guide?.steps) {
      plan.arrival_guide.steps.forEach((step, si) => {
        if (step.title) { textsToTranslate.push(step.title); mapping.push({ section: 'arrival', stepIdx: si, field: 'title' }); }
        if (step.description) { textsToTranslate.push(step.description); mapping.push({ section: 'arrival', stepIdx: si, field: 'description' }); }
      });
    }

    // Days & stops
    if (plan.days) {
      plan.days.forEach((day, di) => {
        if (day.theme) { textsToTranslate.push(day.theme); mapping.push({ section: 'day', dayIdx: di, field: 'theme' }); }
        if (day.stops) {
          day.stops.forEach((stop, si) => {
            TRANSLATE_FIELDS.forEach(f => {
              if (stop[f] && typeof stop[f] === 'string') {
                textsToTranslate.push(stop[f]);
                mapping.push({ section: 'stop', dayIdx: di, stopIdx: si, field: f });
              }
            });
            if (stop.recommended_items) {
              stop.recommended_items.forEach((item, ii) => {
                TRANSLATE_ITEM_FIELDS.forEach(f => {
                  if (item[f] && typeof item[f] === 'string') {
                    textsToTranslate.push(item[f]);
                    mapping.push({ section: 'item', dayIdx: di, stopIdx: si, itemIdx: ii, field: f });
                  }
                });
              });
            }
          });
        }
      });
    }

    // Departure guide
    if (plan.departure_guide) {
      if (plan.departure_guide.recommended_departure_time) {
        textsToTranslate.push(plan.departure_guide.recommended_departure_time);
        mapping.push({ section: 'departure', field: 'recommended_departure_time' });
      }
      if (plan.departure_guide.last_minute_shopping) {
        textsToTranslate.push(plan.departure_guide.last_minute_shopping);
        mapping.push({ section: 'departure', field: 'last_minute_shopping' });
      }
    }

    if (textsToTranslate.length === 0) {
      return res.status(200).json({ translated: plan, message: 'Nothing to translate' });
    }

    // Batch translate with Gemini Flash
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    
    const prompt = `You are a professional travel guide translator. Translate ALL of the following texts to ${langName}.

RULES:
- Keep Korean place names (like 경복궁, 명동) as-is — do NOT translate place names
- Keep numbers, prices (₩), times, and addresses as-is
- Translate ONLY the descriptive/informational text
- Return ONLY a JSON array of translated strings, in the same order
- The array length must be exactly ${textsToTranslate.length}

Input texts (JSON array):
${JSON.stringify(textsToTranslate)}

Output: JSON array of ${textsToTranslate.length} translated strings in ${langName}`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    
    // Parse response
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error('[translate-plan] Failed to parse response:', responseText.substring(0, 200));
      return res.status(500).json({ error: 'Translation parsing failed' });
    }

    const translated = JSON.parse(jsonMatch[0]);
    if (translated.length !== textsToTranslate.length) {
      console.warn(`[translate-plan] Length mismatch: expected ${textsToTranslate.length}, got ${translated.length}`);
    }

    // Apply translations back to plan copy
    const result_plan = JSON.parse(JSON.stringify(plan));

    translated.forEach((text, i) => {
      if (i >= mapping.length) return;
      const m = mapping[i];
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
        console.warn(`[translate-plan] Failed to apply translation at index ${i}:`, e.message);
      }
    });

    return res.status(200).json({
      translated: result_plan,
      stats: { total_texts: textsToTranslate.length, translated: translated.length, target: targetLang }
    });

  } catch (err) {
    console.error('[translate-plan] Error:', err);
    return res.status(500).json({ error: err.message || 'Translation failed' });
  }
}
