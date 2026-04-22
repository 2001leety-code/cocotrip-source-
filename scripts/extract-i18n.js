/**
 * Git blob에서 직접 i18n 데이터 추출 (v3)
 * child_process.execSync로 바이너리 버퍼를 직접 받아 처리
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const localesDir = path.join(root, 'src', 'i18n', 'locales');

if (!fs.existsSync(localesDir)) {
  fs.mkdirSync(localesDir, { recursive: true });
}

// Get the raw git blob as a buffer
const buf = execSync('git show HEAD~4:src/i18n/index.ts', {
  cwd: root,
  maxBuffer: 1024 * 1024,
  encoding: 'buffer',
});

// Detect encoding and convert to string
let content;
if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
  content = buf.toString('utf8').slice(1); // UTF-8 BOM
} else if (buf[0] === 0xFF && buf[1] === 0xFE) {
  content = buf.toString('utf16le').slice(1); // UTF-16 LE BOM
} else {
  content = buf.toString('utf8');
}

console.log('Buffer size:', buf.length);
console.log('First 100 chars:', content.substring(0, 100));
console.log('Contains 홈:', content.includes('홈'));
console.log('Contains nav:', content.includes('nav'));

// Convert to module.exports
content = content.replace(/export\s+const\s+translations\s*=\s*\{/, 'module.exports = {');
content = content.replace(/export\s+type\s+.*/g, '');

// Write temp file
const tmpPath = path.join(root, 'scripts', '_i18n_temp.js');
fs.writeFileSync(tmpPath, content, 'utf8');

// Require it
try {
  delete require.cache[tmpPath];
  const translations = require(tmpPath);
  
  const langs = ['ko', 'en', 'ja', 'zh'];
  for (const lang of langs) {
    if (!translations[lang]) {
      console.error(`Missing language: ${lang}`);
      continue;
    }
    const json = JSON.stringify(translations[lang], null, 2);
    const outPath = path.join(localesDir, `${lang}.json`);
    fs.writeFileSync(outPath, json + '\n', 'utf8');
    
    const topKeys = Object.keys(translations[lang]);
    console.log(`✅ ${lang}.json — ${topKeys.length} top-level keys, ${json.split('\n').length} lines`);
  }
  
  console.log('\n✅ All locales created!');
} catch (err) {
  console.error('Parse error:', err.message);
  // Show the problematic line
  const lines = content.split('\n');
  const match = err.stack.match(/:(\d+)/);
  if (match) {
    const lineNum = parseInt(match[1]);
    console.log(`\nAround line ${lineNum}:`);
    for (let i = Math.max(0, lineNum - 3); i < Math.min(lines.length, lineNum + 3); i++) {
      console.log(`  ${i + 1}: ${lines[i]}`);
    }
  }
} finally {
  try { fs.unlinkSync(tmpPath); } catch(e) {}
}
