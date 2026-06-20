/** 일회성. 적대검증 지적 수정 → 38 계절코스 빌드 → draft 시드. 실행 후 삭제. */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
for (const file of ['.env', '.env.local', '.env.admin.local', '.env.test.local']) {
  try { const t = readFileSync(file, 'utf8'); const p = /^([A-Z0-9_]+)\s*=\s*(.*)$/gm; let m; while ((m = p.exec(t)) !== null) { const k = m[1]; let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1).replace(/\\n/g, '\n'); if (!process.env[k]) process.env[k] = v; } } catch { /* ignore */ }
}
const WINTER = ['pyeongchang', 'taebaek', 'gapyeong', 'seoul', 'jeju', 'gangneung', 'busan', 'chuncheon', 'jeonju', 'yeosu', 'incheon', 'daegu', 'andong', 'suncheon'];
const SPRING = ['changwon', 'gyeongju', 'seoul', 'jeju', 'gangneung', 'busan', 'jeonju', 'gwangju', 'suncheon', 'daejeon', 'daegu', 'andong'];
const FALL = ['sokcho', 'seoul', 'gyeongju', 'gapyeong', 'andong', 'jeonju', 'pyeongchang', 'jeju', 'chuncheon', 'gangneung', 'gwangju', 'busan'];
const ALL = [...WINTER.map((k) => `${k}_winter`), ...SPRING.map((k) => `${k}_spring`), ...FALL.map((k) => `${k}_fall`)];

// ── 0) 적대검증 수정 (주소 오류 + 핵심 사실오역) ──
const FIXES = {
  andong_fall: [['경상북도 안동시 민속촌길 190', '경상북도 안동시 석주로 202']],
  gwangju_fall: [['광주광역시 북구 하서로 50', '광주광역시 북구 하서로 52']],
  suncheon_winter: [['black-necked crane', 'hooded crane'], ['黑颈鹤', '白头鹤'], ['承仙橋', '昇仙橋'], ['承仙桥', '昇仙桥']],
};
console.log('=== 0) 수정 ===');
for (const [base, reps] of Object.entries(FIXES)) {
  const f = `src/data/zone_courses/templates/${base}.json`;
  if (!existsSync(f)) { console.log(`  ${base}: 파일없음`); continue; }
  let txt = readFileSync(f, 'utf8'); let n = 0;
  for (const [a, b] of reps) { if (txt.includes(a)) { txt = txt.split(a).join(b); n++; } }
  writeFileSync(f, txt); console.log(`  ${base}: ${n}건`);
}

// ── 1) 빌드 ──
console.log('\n=== 1) 빌드 (38) ===');
const missing = [];
for (const base of ALL) {
  const tmpl = `src/data/zone_courses/templates/${base}.json`;
  if (!existsSync(tmpl)) { console.log(`  ${base}: 템플릿X`); missing.push(base); continue; }
  try { execFileSync('node', ['scripts/build-zone-course.mjs', '--input', tmpl, '--output', `src/data/zone_courses/${base}.json`], { env: process.env, stdio: 'pipe' }); }
  catch (e) { console.log(`  ${base} 빌드✗ ${(e.stderr || e.message || '').toString().slice(0, 120)}`); }
}

// ── 2) 좌표 검증 ──
console.log('\n=== 2) 좌표 검증 (실패만 표시) ===');
const built = []; const geocodeFails = [];
for (const base of ALL) {
  const out = `src/data/zone_courses/${base}.json`;
  if (!existsSync(out)) continue;
  try {
    const d = JSON.parse(readFileSync(out, 'utf8'));
    const nonFood = (d.stops || []).filter((s) => s.category !== 'food' && s.placeholder == null);
    const fails = nonFood.filter((s) => !s.lat || s.lat === 0);
    if (fails.length) { geocodeFails.push(base); fails.forEach((s) => console.log(`  ⚠️ ${base}: ${s.name} (${s.address})`)); }
    built.push(d);
  } catch (e) { console.log(`  ${base}: 파싱✗`); }
}
console.log(`  좌표 전부 성공: ${built.length - geocodeFails.length}/${built.length}`);

// ── 3) draft 시드 ──
console.log('\n=== 3) draft 시드 ===');
const { initializeApp, cert } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const rawKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/^["']|["']$/g, '').replace(/\\n/g, '\n').trim();
const pem = rawKey.match(/-----BEGIN[^-]*-----([^-]+)-----END[^-]*-----/s); let privateKey = rawKey;
if (pem) { const b64 = pem[1].replace(/\s+/g, ''); privateKey = '-----BEGIN PRIVATE KEY-----\n' + (b64.match(/.{1,64}/g) || []).join('\n') + '\n-----END PRIVATE KEY-----\n'; }
initializeApp({ credential: cert({ projectId: (process.env.FIREBASE_PROJECT_ID || '').trim(), clientEmail: (process.env.FIREBASE_CLIENT_EMAIL || '').trim(), privateKey }) });
const db = getFirestore();
let seeded = 0;
for (const d of built) {
  const season = d.id.includes('_WINTER_') ? 'winter' : d.id.includes('_SPRING_') ? 'spring' : 'fall';
  await db.collection('zone_courses').doc(d.id).set({ ...d, status: 'draft', seeded_at: new Date().toISOString(), source: 'cocotrip_curated', season }, { merge: true });
  seeded++;
}
console.log(`  ${seeded}개 draft 시드 완료`);
console.log(`\nDONE | 빌드 ${built.length}/${ALL.length} | 좌표실패코스 ${geocodeFails.length}(${geocodeFails.join(',') || '없음'}) | 템플릿누락 ${missing.join(',') || '없음'}`);
process.exit(0);
