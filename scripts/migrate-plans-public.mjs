#!/usr/bin/env node
/**
 * migrate-plans-public.mjs
 * 기존 plans 컬렉션 전체에 isPublic: false 필드 병합.
 *
 * Usage:
 *   node scripts/migrate-plans-public.mjs --dry-run   # 영향 범위만 출력
 *   node scripts/migrate-plans-public.mjs --apply      # 실제 쓰기
 *
 * 환경변수 필요: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 * 자동 로드 경로: .env.admin.local (gitignored), .env (fallback)
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// ── .env.admin.local 자동 로드 (존재하면) ───────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env.admin.local');
if (existsSync(envPath)) {
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    // 양쪽 따옴표 제거 (single or double)
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
  console.log(`[env] Loaded ${envPath}`);
}

// ── 플래그 파싱 ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isApply = args.includes('--apply');

if (!isDryRun && !isApply) {
  console.error('Usage: node scripts/migrate-plans-public.mjs --dry-run | --apply');
  process.exit(1);
}

// ── Firebase Admin 초기화 ───────────────────────────────────────────────────
const projectId = (process.env.FIREBASE_PROJECT_ID || '').trim();
const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || '').trim();
let rawKey = (process.env.FIREBASE_PRIVATE_KEY || '')
  .replace(/^\uFEFF/, '')
  .replace(/^["']|["']$/g, '')
  .replace(/\\n/g, '\n')
  .trim();

let privateKey = '';
const pemMatch = rawKey.match(/-----BEGIN[^-]*-----([^-]+)-----END[^-]*-----/s);
if (pemMatch) {
  const base64Clean = pemMatch[1].replace(/\s+/g, '');
  const lines = base64Clean.match(/.{1,64}/g) || [];
  privateKey = '-----BEGIN PRIVATE KEY-----\n' + lines.join('\n') + '\n-----END PRIVATE KEY-----\n';
} else {
  privateKey = rawKey;
}

if (!projectId || !clientEmail || !privateKey) {
  console.error('ERROR: FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY 환경변수가 필요합니다.');
  process.exit(1);
}

const app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

// ── 마이그레이션 ────────────────────────────────────────────────────────────
const BATCH_SIZE = 500;

async function migrate() {
  console.log(`\n=== migrate-plans-public.mjs (${isDryRun ? 'DRY RUN' : 'APPLY'}) ===\n`);

  const plansRef = db.collection('plans');
  const snapshot = await plansRef.get();

  const total = snapshot.size;
  let needsMigration = 0;
  let alreadyHasField = 0;

  // 1차: 카운트
  snapshot.forEach((doc) => {
    const data = doc.data();
    if (data.isPublic === undefined || data.isPublic === null) {
      needsMigration++;
    } else {
      alreadyHasField++;
    }
  });

  console.log(`Total plans:        ${total}`);
  console.log(`Needs migration:    ${needsMigration}`);
  console.log(`Already has field:  ${alreadyHasField}`);

  if (isDryRun) {
    console.log('\n✅ Dry run 완료. 실제 쓰기하려면 --apply 플래그로 실행하세요.\n');
    process.exit(0);
  }

  if (needsMigration === 0) {
    console.log('\n✅ 마이그레이션 불필요 — 모든 문서에 isPublic 필드 존재.\n');
    process.exit(0);
  }

  // 2차: 배치 쓰기
  let processed = 0;
  let batchCount = 0;
  let batch = db.batch();

  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (data.isPublic !== undefined && data.isPublic !== null) continue;

    batch.update(doc.ref, { isPublic: false });
    batchCount++;

    if (batchCount >= BATCH_SIZE) {
      await batch.commit();
      processed += batchCount;
      console.log(`  Committed batch: ${processed}/${needsMigration}`);
      batch = db.batch();
      batchCount = 0;
    }
  }

  // 잔여 배치
  if (batchCount > 0) {
    await batch.commit();
    processed += batchCount;
    console.log(`  Committed final batch: ${processed}/${needsMigration}`);
  }

  console.log(`\n✅ 마이그레이션 완료: ${processed}건 업데이트됨.\n`);
}

migrate().catch((err) => {
  console.error('MIGRATION ERROR:', err);
  process.exit(1);
});
