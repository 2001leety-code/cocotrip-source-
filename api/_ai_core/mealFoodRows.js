import { readFileSync } from 'node:fs';
import { loadFoodIndex } from './geminiPipeline.js';
import { restaurantIdentity } from './verifiedMealOptions.js';

// Supplemental dated facts are deliberately separate from search results and dietary certification.
// Missing entries stay unknown. No scraping, fabricated schedules, or source-tier promotion.
export async function loadMealFoodRows() {
  const rows = await loadFoodIndex();
  let facts;
  try { facts = JSON.parse(readFileSync(new URL('../_food_opening_evidence.json', import.meta.url), 'utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT') return rows;
    const failure = new Error('Opening evidence source cannot be read'); failure.code = 'MEAL_OPENING_INFORMATION_UNKNOWN'; throw failure;
  }
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) {
    const failure = new Error('Invalid opening evidence source'); failure.code = 'MEAL_OPENING_INFORMATION_UNKNOWN'; throw failure;
  }
  return rows.map((row) => ({ ...row,
    opening_evidence: Array.isArray(facts[restaurantIdentity(row)]) ? facts[restaurantIdentity(row)]
      : Array.isArray(row.opening_evidence) ? row.opening_evidence : [],
  }));
}
