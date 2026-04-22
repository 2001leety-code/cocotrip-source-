/**
 * JSON-escaped 파일 복원 스크립트
 * 문제: 일부 파일이 리터럴 \n, \t 등으로 저장됨 (JSON 문자열 직렬화)
 * 해결: 이스케이프 시퀀스를 실제 문자로 변환
 */
const fs = require('fs');
const path = require('path');

const files = [
  'vitest.config.ts',
  'src/schemas/index.ts',
  'tests/unit/schemas.test.ts',
  'tests/unit/i18n-keys.test.ts',
  'tests/unit/concerts.test.ts',
  'tests/unit/pricing.test.ts',
  'tests/unit/seasonal.test.ts',
];

const root = path.resolve(__dirname, '..');

for (const file of files) {
  const fullPath = path.join(root, file);
  if (!fs.existsSync(fullPath)) {
    console.log(`SKIP (not found): ${file}`);
    continue;
  }
  
  const raw = fs.readFileSync(fullPath, 'utf8');
  
  // Check if the file starts with a quote (JSON serialized)
  const trimmed = raw.trim();
  if (!trimmed.startsWith('"')) {
    console.log(`OK (already normal): ${file}`);
    continue;
  }
  
  // Concatenate all lines, strip surrounding quotes from each
  const lines = raw.split(/\r?\n/);
  const parts = [];
  for (const line of lines) {
    let t = line.trim();
    if (!t) continue;
    if (t.startsWith('<truncated')) continue;
    // Strip surrounding quotes
    if (t.startsWith('"') && t.endsWith('"')) {
      t = t.substring(1, t.length - 1);
    }
    parts.push(t);
  }
  
  const joined = parts.join('');
  
  // Unescape JSON string escapes
  let decoded = joined
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
  
  fs.writeFileSync(fullPath, decoded, 'utf8');
  console.log(`FIXED: ${file} (${decoded.split('\n').length} lines)`);
}

console.log('\nDone!');
