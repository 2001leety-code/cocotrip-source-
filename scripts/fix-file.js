/**
 * JSON-escaped 파일 복원 스크립트 (v2)
 * truncated 마커를 포함한 파일도 처리
 */
const fs = require('fs');
const path = require('path');

const files = process.argv.slice(2);
if (files.length === 0) {
  console.log('Usage: node fix-file.js <file1> [file2] ...');
  process.exit(1);
}

const root = process.cwd();

for (const file of files) {
  const fullPath = path.resolve(root, file);
  if (!fs.existsSync(fullPath)) {
    console.log(`SKIP (not found): ${file}`);
    continue;
  }
  
  const raw = fs.readFileSync(fullPath, 'utf8');
  const trimmed = raw.trim();
  
  if (!trimmed.startsWith('"')) {
    console.log(`OK (already normal): ${file}`);
    continue;
  }
  
  // Check for truncated sections
  if (raw.includes('<truncated')) {
    console.log(`WARNING: ${file} contains truncated data — cannot fully restore`);
    console.log(`  Manual restoration required from conversation logs`);
    continue;
  }
  
  // Concatenate all lines, strip surrounding quotes
  const lines = raw.split(/\r?\n/);
  const parts = [];
  for (const line of lines) {
    let t = line.trim();
    if (!t) continue;
    if (t.startsWith('"') && t.endsWith('"')) {
      t = t.substring(1, t.length - 1);
    }
    parts.push(t);
  }
  
  const joined = parts.join('');
  const decoded = joined
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
  
  fs.writeFileSync(fullPath, decoded, 'utf8');
  console.log(`FIXED: ${file} (${decoded.split('\n').length} lines)`);
}
