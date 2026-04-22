/**
 * 3-Pass Pipeline — Replaces single Gemini call with 3 focused passes.
 *
 * Pass 1 (Intent):  Gemini generates itinerary with INTENT SLOTS instead of real names.
 *                   e.g. { "food_intent": "Korean BBQ lunch", "cuisine": "korean" }
 * Pass 2 (Resolve): DB matcher replaces intent slots with verified restaurant data.
 * Pass 3 (Enrich):  Gemini adds narrative tips for the resolved restaurants.
 */

// ── Pass 1: Intent Generation ────────────────────────────────────────────────
// Calls Gemini with an instruction to output food slots as "intent" objects
// rather than specific restaurant names. This decouples AI creativity from
// data accuracy.
export async function pass1Intent(model, systemPrompt, userMessage) {
  const intentInstruction = `
IMPORTANT: For ALL food/restaurant stops, instead of naming a specific restaurant,
output a "food_intent" field describing WHAT the user should eat at that time slot.
Example:
{
  "order": 3,
  "start_time": "12:00",
  "name": "FOOD_SLOT",
  "category": "food",
  "food_intent": "Korean BBQ lunch with premium hanwoo beef",
  "cuisine": "korean_bbq",
  "stay_min": 60,
  "price_range": "moderate"
}

Non-food stops (culture, shopping, nature, etc.) should use real place names as usual.
`;

  const augmentedSystem = systemPrompt + '\n\n' + intentInstruction;

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    systemInstruction: { role: 'system', parts: [{ text: augmentedSystem }] },
  });

  return result.response.text().trim();
}

// ── Pass 2: DB Resolution ────────────────────────────────────────────────────
// Replaces FOOD_SLOT intent objects with actual verified restaurant data from
// _food_index.json. Matches based on cuisine type, price range, and area.
export function pass2Resolve(itinerary, foodIndex, area) {
  if (!foodIndex || foodIndex.length === 0) return itinerary;

  const matchCity = (area || '').replace(/_.*$/, '').toLowerCase();
  const usedNames = new Set(); // prevent duplicates within same plan

  for (const day of (itinerary.days || [])) {
    for (const stop of (day.stops || [])) {
      if (stop.category !== 'food') continue;
      if (!stop.food_intent && stop.name !== 'FOOD_SLOT') continue;

      const intent = (stop.food_intent || '').toLowerCase();
      const cuisine = (stop.cuisine || '').toLowerCase();

      // Score each DB entry by relevance to the intent
      let bestMatch = null;
      let bestScore = -1;

      for (const entry of foodIndex) {
        if (usedNames.has(entry.name)) continue;

        let score = 0;
        const dbName = (entry.name || '').split('|')[0].trim();
        const dbCity = (entry.city || '').toLowerCase();
        const dbCategory = (entry.category || '').toLowerCase();
        const dbTags = (entry.tags || '').toLowerCase();

        // City match (strong signal)
        if (dbCity && matchCity && dbCity === matchCity) score += 5;

        // Cuisine / category match
        if (cuisine && (dbCategory.includes(cuisine) || dbTags.includes(cuisine))) score += 3;

        // Intent keyword match (check if any word from intent appears in DB entry)
        const intentWords = intent.split(/\s+/).filter(w => w.length > 2);
        for (const word of intentWords) {
          if (dbName.toLowerCase().includes(word) || dbTags.includes(word) || dbCategory.includes(word)) {
            score += 2;
          }
        }

        // Price range match
        if (stop.price_range && entry.priceRange) {
          const pMap = { budget: 1, moderate: 2, premium: 3, luxury: 4 };
          const stopP = pMap[stop.price_range] || 2;
          const entryP = pMap[entry.priceRange] || 2;
          if (stopP === entryP) score += 2;
          else if (Math.abs(stopP - entryP) === 1) score += 1;
        }

        if (score > bestScore) {
          bestScore = score;
          bestMatch = entry;
        }
      }

      if (bestMatch) {
        const resolvedName = (bestMatch.name || '').split('|')[0].trim();
        usedNames.add(bestMatch.name);

        // Apply DB data to the stop
        stop.name = resolvedName;
        stop.display_name = bestMatch.nameEn || resolvedName;
        if (bestMatch.address) {
          stop.address = bestMatch.address
            .replace(/^대한민국\s+/, '')
            .replace(/\bKR\s+/g, '');
        }
        if (bestMatch.lat) stop.lat = bestMatch.lat;
        if (bestMatch.lng) stop.lng = bestMatch.lng;
        if (bestMatch.googleMapsUrl) stop.googleMapsUrl = bestMatch.googleMapsUrl;
        stop.verified = true;
        stop._dbMatchedName = resolvedName;
        stop._resolvedFrom = 'pass2';
        stop._intentScore = bestScore;

        console.log(`[pass2] Resolved: "${stop.food_intent}" → "${resolvedName}" (score: ${bestScore})`);
      } else {
        // No match found — keep the intent for Pass 3 to handle
        stop.name = stop.food_intent || 'Local Restaurant';
        stop.verified = false;
        stop._resolvedFrom = 'pass2_fallback';
        console.log(`[pass2] No DB match for intent: "${stop.food_intent}"`);
      }

      // Clean up intent fields (no longer needed after resolution)
      delete stop.food_intent;
      delete stop.cuisine;
    }
  }

  return itinerary;
}

// ── Pass 3: Narrative Enrichment ─────────────────────────────────────────────
// Sends the resolved itinerary back to Gemini for adding tips, local insights,
// and context-aware descriptions for each food stop.
export async function pass3Enrich(model, itinerary, language) {
  const foodStops = [];
  for (const day of (itinerary.days || [])) {
    for (const stop of (day.stops || [])) {
      if (stop.category === 'food' && stop.name && stop.name !== 'FOOD_SLOT') {
        foodStops.push({
          name: stop.name,
          display_name: stop.display_name || stop.name,
          day: day.day,
          start_time: stop.start_time,
          address: stop.address,
        });
      }
    }
  }

  if (foodStops.length === 0) return itinerary;

  const langMap = { ko: '한국어', en: 'English', ja: '日本語', zh: '中文' };
  const langLabel = langMap[language] || 'English';

  const enrichPrompt = `You are a local food expert in Korea. For each restaurant below, provide:
1. "tip": A concise, insider tip about what to order or how to enjoy it (1-2 sentences, in ${langLabel})
2. "recommended_items": Array of 2-3 must-try menu items (in ${langLabel})

Respond in JSON array format:
[{ "name": "...", "tip": "...", "recommended_items": ["...", "..."] }]

Restaurants:
${JSON.stringify(foodStops, null, 2)}`;

  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: enrichPrompt }] }],
      systemInstruction: {
        role: 'system',
        parts: [{ text: `You are a Korean food and restaurant expert. Always respond with valid JSON array. Language: ${langLabel}.` }],
      },
    });

    const rawEnrich = result.response.text().trim();
    let enrichData;
    try {
      enrichData = JSON.parse(rawEnrich.replace(/^```(?:json)?|```$/gm, '').trim());
    } catch {
      console.warn('[pass3] Failed to parse enrichment response');
      return itinerary;
    }

    if (!Array.isArray(enrichData)) {
      console.warn('[pass3] Enrichment response is not an array');
      return itinerary;
    }

    // Apply enrichment data back to stops
    const enrichMap = new Map();
    for (const item of enrichData) {
      if (item.name) enrichMap.set(item.name, item);
    }

    for (const day of (itinerary.days || [])) {
      for (const stop of (day.stops || [])) {
        if (stop.category !== 'food') continue;
        const enrichment = enrichMap.get(stop.name);
        if (enrichment) {
          if (enrichment.tip) stop.tip = enrichment.tip;
          if (enrichment.recommended_items) stop.recommended_items = enrichment.recommended_items;
        }
      }
    }

    console.log(`[pass3] Enriched ${enrichMap.size}/${foodStops.length} food stops`);
  } catch (err) {
    console.warn('[pass3] Enrichment failed (non-critical):', err.message);
    // Non-critical — itinerary already has resolved restaurants from Pass 2
  }

  return itinerary;
}