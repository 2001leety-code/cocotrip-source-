/**
 * Phase 3-4: 프론트엔드/API 필드명 일괄 교체
 * name_ko → name, name_en → display_name, tip_en → tip
 * 
 * 대상: PlanDetailPage.tsx, _email-renderer.js, RouteAgent.js, ai-planner-full.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const files = [
  'src/pages/PlanDetailPage.tsx',
  'api/_email-renderer.js',
  'api/_ai_core/agents/RouteAgent.js',
  'api/ai-planner-full.js',
];

const replacements = [
  // PlanDetailPage: UI card + PDF references
  // stop.name_en || stop.name_ko → stop.display_name || stop.name
  [/stop\.name_en\s*\|\|\s*stop\.name_ko/g, 'stop.display_name || stop.name'],
  // stop.name_ko || stop.name_en → stop.name || stop.display_name
  [/stop\.name_ko\s*\|\|\s*stop\.name_en/g, 'stop.name || stop.display_name'],
  // stop.name_ko && stop.name_en → stop.name && stop.display_name
  [/stop\.name_ko\s*&&\s*stop\.name_en/g, 'stop.name && stop.display_name'],
  // stop.tip_en → stop.tip (BUT not in string literals that define the field)
  [/stop\.tip_en/g, 'stop.tip'],
  // stop.name_ko (standalone, remaining) → stop.name
  [/stop\.name_ko(?!\w)/g, 'stop.name'],
  // stop.name_en (standalone, remaining) → stop.display_name
  [/stop\.name_en(?!\w)/g, 'stop.display_name'],

  // _email-renderer.js patterns
  [/stop\.name_ko\s*\|\|\s*stop\.name\b/g, 'stop.name'],  // already covered by above
  [/stop\.nameEn/g, 'stop.display_name'],
  [/s\.name_ko\s*\|\|\s*s\.name\b/g, 's.name'],
  [/s\.name_en\s*\|\|\s*s\.nameEn/g, 's.display_name'],
  [/s\.tip_en\s*\|\|\s*s\.tip/g, 's.tip'],
  [/s\.tip_en/g, 's.tip'],
  [/s\.name_ko/g, 's.name'],
  [/s\.name_en/g, 's.display_name'],

  // RouteAgent.js patterns  
  [/place\.name_en\s*\|\|\s*place\.name_ko/g, 'place.display_name || place.name'],
  [/place\.name_ko\s*\|\|\s*place\.name_en/g, 'place.name || place.display_name'],
  [/place\.name_ko/g, 'place.name'],
  [/place\.name_en/g, 'place.display_name'],
  [/curr\.name_en\s*\|\|\s*curr\.name_ko/g, 'curr.display_name || curr.name'],
  [/curr\.name_ko/g, 'curr.name'],
  [/curr\.name_en/g, 'curr.display_name'],

  // ai-planner-full.js: merge section
  [/tip_en,/g, 'tip,'],
  // Log references
  [/'tip_en'/g, "'tip'"],
];

let totalChanges = 0;

for (const rel of files) {
  const fp = path.join(ROOT, rel);
  if (!fs.existsSync(fp)) {
    console.log(`⚠️ SKIP (not found): ${rel}`);
    continue;
  }

  let content = fs.readFileSync(fp, 'utf-8');
  let fileChanges = 0;

  for (const [pattern, replacement] of replacements) {
    const matches = content.match(pattern);
    if (matches) {
      content = content.replace(pattern, replacement);
      fileChanges += matches.length;
    }
  }

  if (fileChanges > 0) {
    fs.writeFileSync(fp, content, 'utf-8');
    console.log(`✅ ${rel}: ${fileChanges} replacements`);
    totalChanges += fileChanges;
  } else {
    console.log(`   ${rel}: 0 changes (already clean)`);
  }
}

console.log(`\n📊 Total: ${totalChanges} replacements across ${files.length} files`);

// Verify: grep for old field names
console.log('\n🔍 Verification — remaining old field references:');
for (const rel of files) {
  const fp = path.join(ROOT, rel);
  if (!fs.existsSync(fp)) continue;
  const content = fs.readFileSync(fp, 'utf-8');
  const lines = content.split('\n');
  let found = 0;
  lines.forEach((line, i) => {
    // Skip if in a comment or in the prompt template string
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
    // Check for old field usage (not in string literals for prompts)
    if (/\bname_ko\b/.test(line) && !line.includes('"name_ko"') && !line.includes("'name_ko'") && !line.includes('name_ko:')) {
      console.log(`   ⚠️ ${rel}:${i+1}: ${line.trim().substring(0, 100)}`);
      found++;
    }
    if (/\bname_en\b/.test(line) && !line.includes('"name_en"') && !line.includes("'name_en'") && !line.includes('name_en:')) {
      console.log(`   ⚠️ ${rel}:${i+1}: ${line.trim().substring(0, 100)}`);
      found++;
    }
    if (/\btip_en\b/.test(line) && !line.includes('"tip_en"') && !line.includes("'tip_en'") && !line.includes('tip_en:')) {
      console.log(`   ⚠️ ${rel}:${i+1}: ${line.trim().substring(0, 100)}`);
      found++;
    }
  });
  if (found === 0) console.log(`   ✅ ${rel}: clean`);
});
