/**
 * migrate-dietary-verification.mjs — _food_index.json 에 신뢰 등급 필드 부여 (1회 마이그레이션).
 *
 * 운영자 지시 3단계-B (2026-07-11): 기존 tag 를 인증 증거처럼 쓰는 것 금지.
 * 삭제 없이 dietary 레코드에 dietary_claim / verification_status (+수동 검증 스캐폴드
 * source_url / verified_at / verified_by / certification_type — 오버라이드 파일로만 부여) 추가.
 *
 * 재수집 시에도 유지되도록 build-food-index.js 에 동일 파생이 들어감 —
 * 이 스크립트는 재수집 없이 현행 인덱스를 즉시 마이그레이션하는 용도.
 *
 * 수동 승격: food_data/verified_overrides.json (있으면)
 *   [{ "name": "...", "city": "...", "verification_status": "halal_certified",
 *      "source_url": "...", "certification_type": "KMF", "verified_by": "operator" }]
 *
 * Usage: node scripts/migrate-dietary-verification.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { deriveVerificationStatus, DIETARY_TAGS } from '../api/_shared/dietary-trust.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INDEX_PATH = join(ROOT, 'api', '_food_index.json');
const OVERRIDES_PATH = join(ROOT, '..', '..', 'food_data', 'verified_overrides.json');

const index = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
const overrides = existsSync(OVERRIDES_PATH)
  ? JSON.parse(readFileSync(OVERRIDES_PATH, 'utf-8'))
  : [];
const ovKey = (r) => `${r.name}|${r.city}`;
const ovMap = new Map(overrides.map((o) => [ovKey(o), o]));

const stats = { dietary: 0, unverified: 0, friendly: 0, certified: 0 };
for (const r of index) {
  const tag = String(r.tag || '').toLowerCase();
  if (!DIETARY_TAGS.includes(tag)) continue;
  stats.dietary++;
  r.dietary_claim = tag; // 원 주장 보존 (tag 는 하위호환 위해 유지)
  const ov = ovMap.get(ovKey(r));
  if (ov && ov.verification_status) {
    r.verification_status = ov.verification_status;
    if (ov.source_url) r.source_url = ov.source_url;
    if (ov.certification_type) r.certification_type = ov.certification_type;
    r.verified_by = ov.verified_by || 'operator';
    r.verified_at = ov.verified_at || new Date().toISOString().slice(0, 10);
    stats.certified++;
    continue;
  }
  r.verification_status = deriveVerificationStatus(r);
  if (r.verification_status === 'unverified') stats.unverified++;
  else stats.friendly++;
}

writeFileSync(INDEX_PATH, JSON.stringify(index, null, 0), 'utf-8');
console.log('✅ migrated:', JSON.stringify(stats));
console.log('   (unverified = dietary 매칭·프롬프트·검증 증거에서 제외됨)');
