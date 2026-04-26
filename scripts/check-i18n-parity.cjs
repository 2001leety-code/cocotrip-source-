#!/usr/bin/env node
/**
 * i18n key parity checker.
 *
 * Compares the key shape of src/i18n/locales/{ko,en,ja,zh}.json against the
 * Korean reference (ko.json is canonical — types are derived from it via
 * `typeof ko`). Reports keys missing in any non-Korean locale and keys
 * present only in non-Korean locales (i.e. drift). Exits with code 1 when
 * any difference is found.
 *
 * Run: node scripts/check-i18n-parity.cjs
 * CI:  npm run check:i18n
 */
const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '..', 'src', 'i18n', 'locales');
const REFERENCE = 'ko';
const TARGETS = ['en', 'ja', 'zh'];

function flattenKeys(obj, prefix = '') {
  const keys = new Set();
  if (obj === null || typeof obj !== 'object') return keys;
  if (Array.isArray(obj)) {
    // Arrays compared by length only — element shape varies (e.g. attractions list)
    keys.add(`${prefix}[length=${obj.length}]`);
    return keys;
  }
  for (const k of Object.keys(obj)) {
    const next = prefix ? `${prefix}.${k}` : k;
    keys.add(next);
    const child = flattenKeys(obj[k], next);
    for (const c of child) keys.add(c);
  }
  return keys;
}

function loadLocale(name) {
  const file = path.join(LOCALES_DIR, `${name}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const refKeys = flattenKeys(loadLocale(REFERENCE));
let totalDrift = 0;

for (const target of TARGETS) {
  const targetKeys = flattenKeys(loadLocale(target));

  const missing = [...refKeys].filter((k) => !targetKeys.has(k)).sort();
  const extra = [...targetKeys].filter((k) => !refKeys.has(k)).sort();

  if (missing.length === 0 && extra.length === 0) {
    console.log(`[i18n-parity] ${target}: OK (${targetKeys.size} keys)`);
    continue;
  }

  totalDrift += missing.length + extra.length;
  console.error(`[i18n-parity] ${target}: ${missing.length} missing, ${extra.length} extra`);
  for (const k of missing) console.error(`  MISSING in ${target}: ${k}`);
  for (const k of extra) console.error(`  EXTRA in ${target} (not in ${REFERENCE}): ${k}`);
}

if (totalDrift > 0) {
  console.error(`\n[i18n-parity] FAIL — ${totalDrift} differences across 4 locales`);
  process.exit(1);
}
console.log(`\n[i18n-parity] PASS — all 4 locales aligned (reference: ${REFERENCE}.json, ${refKeys.size} keys)`);
