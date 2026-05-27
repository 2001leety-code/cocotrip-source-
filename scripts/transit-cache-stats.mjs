#!/usr/bin/env node
/**
 * transit-cache-stats.mjs — P228 transit cache + ODsay quota 모니터링 (P234, 2026-05-27).
 *
 * 운영자 한 줄 비유:
 *   "손님이 오기 전 미리 메뉴판 출력해 두었는지 확인하는 것 (없으면 주방이 매번 새로 요리 = ODsay 호출)"
 *
 * 출력:
 *   1. Firestore zone_courses 컬렉션 — transit_matrix prefill 비율
 *   2. 도시별 real(odsay_api) vs mock 현황 표
 *   3. 최근 plan transit source 분포 (odsay vs _fromCache vs mock)
 *   4. ODsay quota 소진 추정 (plan 수 × 평균 stops × miss rate)
 *
 * 주의:
 *   - ODsay 직접 호출 0 (운영자 quota 보호 — Firestore inspect only)
 *   - env 파일: .env.admin.local 또는 .env (FIREBASE_* 필수)
 *
 * Usage:
 *   node scripts/transit-cache-stats.mjs
 *   node scripts/transit-cache-stats.mjs --cities seoul,busan
 *   node scripts/transit-cache-stats.mjs --plans 20   (최근 plan N개 검사)
 *   node scripts/transit-cache-stats.mjs --json        (JSON 출력)
 */

import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, exit } from 'node:process';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── env 파일 로더 (audit-transit.mjs 패턴 재사용) ────────────────────────────
for (const file of ['.env.admin.local', '.env', '.env.test.local']) {
  try {
    const envText = readFileSync(join(ROOT, file), 'utf8');
    const pattern = /^([A-Z0-9_]+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|.*)$/gm;
    let m;
    while ((m = pattern.exec(envText)) !== null) {
      const key = m[1];
      let val = m[2];
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"');
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {}
}

// ── CLI 파싱 ─────────────────────────────────────────────────────────────────
function parseCli(args) {
  const opts = { citiesFilter: null, planLimit: 10, jsonOutput: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--cities' && args[i + 1]) {
      opts.citiesFilter = args[++i].split(',').map((c) => c.trim().toLowerCase());
    } else if (args[i] === '--plans' && args[i + 1]) {
      opts.planLimit = parseInt(args[++i], 10) || 10;
    } else if (args[i] === '--json') {
      opts.jsonOutput = true;
    }
  }
  return opts;
}

// ── Firebase Admin 초기화는 메인 블록에서 top-level await 로 수행 ──────────────
// (audit-transit.mjs 동일 패턴: 아래 메인 섹션 참조)

// ── zone_courses Firestore 컬렉션 분석 ──────────────────────────────────────
async function analyzeZoneCourses(db, citiesFilter) {
  const snap = await db.collection('zone_courses').get();
  const zones = [];

  snap.forEach((doc) => {
    const data = doc.data();
    const city = (data.city || 'unknown').toLowerCase();
    if (citiesFilter && !citiesFilter.includes(city)) return;

    const tm = data.transit_matrix || {};
    const tmKeys = Object.keys(tm);
    const realEntries = tmKeys.filter((k) => tm[k]?.source === 'odsay_api');
    const mockEntries = tmKeys.filter((k) => tm[k]?.source === 'mock');
    const missingEntries = tmKeys.filter(
      (k) => !tm[k]?.source || (tm[k]?.source !== 'odsay_api' && tm[k]?.source !== 'mock')
    );

    zones.push({
      id: doc.id,
      city: data.city || 'unknown',
      theme: data.theme || '',
      status: data.status || 'unknown',
      stopCount: (data.stops || []).length,
      tmTotal: tmKeys.length,
      tmReal: realEntries.length,
      tmMock: mockEntries.length,
      tmMissing: missingEntries.length,
      // P228 캐시 hit 가능 조건: tmReal > 0
      cacheReady: realEntries.length > 0,
      seededAt: data.seeded_at || data.verified_at || null,
    });
  });

  return zones;
}

// ── 최근 plans transit source 분포 분석 ──────────────────────────────────────
async function analyzePlanTransits(db, planLimit) {
  const snap = await db
    .collection('plans')
    .orderBy('createdAtMs', 'desc')
    .limit(planLimit)
    .get();

  const sourceCounts = {};
  const fromCacheCount = { yes: 0, no: 0 };
  const planSamples = [];

  snap.forEach((doc) => {
    const data = doc.data();
    const days = data.itinerary?.days || [];
    let planOdsay = 0, planCache = 0, planMock = 0, planTotal = 0;

    for (const day of days) {
      for (const stop of day.stops || []) {
        const t = stop.transit_from_prev;
        if (!t) continue;
        planTotal++;
        const src = t.source || 'unknown';
        sourceCounts[src] = (sourceCounts[src] || 0) + 1;

        // P228 cache hit 마커: _fromCache=true
        if (t._fromCache === true) {
          fromCacheCount.yes++;
          planCache++;
        } else {
          fromCacheCount.no++;
          if (src === 'odsay') planOdsay++;
          else planMock++;
        }
      }
    }

    planSamples.push({
      planId: doc.id.slice(0, 8),
      area: data.input?.area || '?',
      createdAt: data.createdAtMs
        ? new Date(data.createdAtMs).toISOString().slice(0, 16)
        : '?',
      total: planTotal,
      odsay: planOdsay,
      cache: planCache,
      mock: planMock,
    });
  });

  const totalTransits = Object.values(sourceCounts).reduce((s, v) => s + v, 0);
  const cacheHits = fromCacheCount.yes;
  const hitRate = totalTransits > 0 ? Math.round((cacheHits / totalTransits) * 100) : 0;

  return { sourceCounts, fromCacheCount, hitRate, totalTransits, planSamples };
}

// ── 도시별 집계 ───────────────────────────────────────────────────────────────
function aggregateByCity(zones) {
  const byCity = {};
  for (const z of zones) {
    const c = z.city;
    if (!byCity[c]) byCity[c] = { zones: 0, cacheReady: 0, tmReal: 0, tmMock: 0, stops: 0 };
    byCity[c].zones++;
    if (z.cacheReady) byCity[c].cacheReady++;
    byCity[c].tmReal += z.tmReal;
    byCity[c].tmMock += z.tmMock;
    byCity[c].stops += z.stopCount;
  }
  return byCity;
}

// ── ODsay quota 추정 ──────────────────────────────────────────────────────────
function estimateOdsayUsage({ zones, planSamples, hitRate }) {
  // 하루 plan 생성 추정 (최근 N plan 기준 — 실제는 Vercel logs 로 보완 필요)
  const ODSAY_FREE_QUOTA = 1000; // 출처: lab.odsay.com/doc/totalPolicy 확인
  // zone_courses 시드 시 소진 (Track C --all-cities 실적): 운영자 보고 기준
  const SEED_ESTIMATE = 192; // 5/27 Track C 실제 ODsay 호출 수
  // 자연 traffic 추정: plan 당 평균 transit 수 × (1 - hit_rate)
  const avgTransitsPerPlan =
    planSamples.length > 0
      ? planSamples.reduce((s, p) => s + p.total, 0) / planSamples.length
      : 0;
  const missRate = 1 - hitRate / 100;
  // plan 당 예상 ODsay 호출 수 (cache miss 만)
  const odsayPerPlan = Math.ceil(avgTransitsPerPlan * missRate);

  return {
    ODSAY_FREE_QUOTA,
    SEED_ESTIMATE,
    avgTransitsPerPlan: Math.round(avgTransitsPerPlan * 10) / 10,
    hitRatePct: hitRate,
    missRatePct: Math.round(missRate * 100),
    odsayPerPlan,
    // 1000 quota 에서 시드 192 제거 후 남은 여유
    remainingAfterSeed: ODSAY_FREE_QUOTA - SEED_ESTIMATE,
    // 남은 여유로 감당할 수 있는 plan 수 (cache 효과 포함)
    plansBeforeQuotaEmpty:
      odsayPerPlan > 0 ? Math.floor((ODSAY_FREE_QUOTA - SEED_ESTIMATE) / odsayPerPlan) : '∞',
  };
}

// ── 한국어 표 출력 ────────────────────────────────────────────────────────────
function printReport(zones, transitStats, opts) {
  const byCity = aggregateByCity(zones);
  const quota = estimateOdsayUsage({
    zones,
    planSamples: transitStats.planSamples,
    hitRate: transitStats.hitRate,
  });

  // 도시별 cache 준비 현황
  const totalZones = zones.length;
  const cacheReadyZones = zones.filter((z) => z.cacheReady).length;
  const totalTmReal = zones.reduce((s, z) => s + z.tmReal, 0);
  const totalTmMock = zones.reduce((s, z) => s + z.tmMock, 0);
  const totalTmEntries = totalTmReal + totalTmMock;
  const prefillPct = totalTmEntries > 0 ? Math.round((totalTmReal / totalTmEntries) * 100) : 0;

  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  P234 — ODsay quota + P228 transit cache 모니터링 리포트');
  console.log('  날짜:', new Date().toISOString().slice(0, 16), 'UTC');
  console.log('════════════════════════════════════════════════════════════\n');

  // 1. 전체 요약
  console.log('【1】 Firestore zone_courses 전체 현황');
  console.log('  비유: "손님용 메뉴판이 미리 출력된 테이블 수"');
  console.log(`  총 zone 수:        ${totalZones}`);
  console.log(`  cache 준비된 zone: ${cacheReadyZones} / ${totalZones} (odsay_api real data 있음)`);
  console.log(`  transit 항목 합계: real=${totalTmReal}, mock=${totalTmMock}, prefill=${prefillPct}%`);
  console.log();

  // 2. 도시별 표
  console.log('【2】 도시별 transit_matrix prefill 현황');
  console.log('  도시         | zone수 | cache준비 | real | mock | prefill');
  console.log('  ' + '-'.repeat(60));
  const sorted = Object.entries(byCity).sort((a, b) => b[1].tmReal - a[1].tmReal);
  for (const [city, s] of sorted) {
    const pct =
      s.tmReal + s.tmMock > 0 ? Math.round((100 * s.tmReal) / (s.tmReal + s.tmMock)) : 0;
    const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
    const cityPad = city.padEnd(12);
    console.log(
      `  ${cityPad} | ${String(s.zones).padStart(6)} | ${String(s.cacheReady).padStart(9)} | ${String(s.tmReal).padStart(4)} | ${String(s.tmMock).padStart(4)} | ${bar} ${pct}%`
    );
  }
  console.log();

  // 3. 최근 plan transit 분포
  console.log(`【3】 최근 plan ${opts.planLimit}개 — transit source 분포`);
  console.log('  (P228 _fromCache=true 가 transit cache hit 마커)');
  const { sourceCounts, fromCacheCount, hitRate, totalTransits } = transitStats;
  console.log(`  총 transit 구간:   ${totalTransits}`);
  console.log(`  P228 cache hit:    ${fromCacheCount.yes} (${hitRate}%)`);
  console.log(`  ODsay 직접 호출:   ${fromCacheCount.no - (sourceCounts.mock || 0)} (나머지 hit miss)`);
  console.log('  source별 세부:');
  for (const [src, cnt] of Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])) {
    const pct = totalTransits > 0 ? Math.round((cnt / totalTransits) * 100) : 0;
    console.log(`    ${src.padEnd(20)} ${cnt} (${pct}%)`);
  }
  console.log();

  // plan 샘플 표
  console.log('  plan별 샘플:');
  console.log('  planId   | 지역      | 생성시간         | 총  | odsay | cache | mock');
  console.log('  ' + '-'.repeat(72));
  for (const p of transitStats.planSamples.slice(0, 8)) {
    const areaStr = (p.area || '?').slice(0, 9).padEnd(9);
    const dt = p.createdAt.padEnd(16);
    console.log(
      `  ${p.planId} | ${areaStr} | ${dt} | ${String(p.total).padStart(3)} | ${String(p.odsay).padStart(5)} | ${String(p.cache).padStart(5)} | ${p.mock}`
    );
  }
  console.log();

  // 4. ODsay quota 추정
  console.log('【4】 ODsay quota 소진 추정');
  console.log(`  ODsay 무료 quota:  ${quota.ODSAY_FREE_QUOTA} 건/일 (lab.odsay.com Basic 티어)`);
  console.log(`  Track C 시드 소진: ${quota.SEED_ESTIMATE} 건 (5/27 --all-cities 실측)`);
  console.log(`  남은 일일 여유:    ${quota.remainingAfterSeed} 건`);
  console.log(`  평균 transit/plan: ${quota.avgTransitsPerPlan} 구간`);
  console.log(`  cache miss rate:   ${quota.missRatePct}%  →  plan당 ODsay ${quota.odsayPerPlan} 건 추가 소진`);
  if (quota.plansBeforeQuotaEmpty === '∞') {
    console.log('  quota 여유:        무한 (cache miss = 0 또는 plan 0건)');
  } else {
    console.log(
      `  quota 소진까지:    약 ${quota.plansBeforeQuotaEmpty} plan 생성 가능 (오늘 남은 여유 기준)`
    );
    if (quota.plansBeforeQuotaEmpty < 20) {
      console.log('  ⚠️  경고: quota 여유 부족 — block mode 미사용 plan 이 cache miss 다수면 소진 위험');
    }
  }
  console.log();

  // 5. 운영자 액션 권고
  console.log('【5】 운영자 액션 권고');
  if (cacheReadyZones === 0) {
    console.log('  🔴 Firestore zone_courses 에 real transit 데이터 없음');
    console.log(
      '     → scripts/seed-zone-courses-firestore.mjs --all-cities 재실행 필요 (ODSAY_API_KEY ENV 있는 환경)'
    );
    console.log('     → 내일 오전까지 실행 권장 (오늘 quota 소진 후 재시작)');
  } else if (prefillPct < 50) {
    console.log(`  🟠 prefill ${prefillPct}% — 절반 이상이 mock. 추가 시드 권장`);
    const unfilledCities = sorted
      .filter(([, s]) => s.tmReal === 0)
      .map(([c]) => c)
      .join(', ');
    if (unfilledCities) console.log(`     미완료 도시: ${unfilledCities}`);
  } else {
    console.log(`  ✅ prefill ${prefillPct}% — P228 cache 정상 작동 중`);
  }

  if (hitRate < 30 && totalTransits > 5) {
    console.log(
      `  🟠 cache hit ${hitRate}% 저조 — PLANNER_BLOCK_MODE=auto ENV 확인 필요 (block mode 꺼지면 zoneId=null → cache miss)`
    );
  } else if (totalTransits < 5) {
    console.log('  🟡 최근 plan 수 부족 — hit rate 측정 불충분 (plan 생성 후 재실행 권장)');
  } else {
    console.log(`  ✅ cache hit ${hitRate}% — 정상 범위`);
  }

  console.log('\n════════════════════════════════════════════════════════════\n');

  return {
    zoneCount: totalZones,
    cacheReadyZones,
    prefillPct,
    totalTmReal,
    totalTmMock,
    transitHitRatePct: hitRate,
    odsayQuota: quota,
  };
}

// ── 메인 ──────────────────────────────────────────────────────────────────────
const opts = parseCli(argv.slice(2));

// Firebase Admin 은 ESM dynamic import 필요
const { initializeApp, cert, getApps } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');

if (getApps().length === 0) {
  const rawKey = (process.env.FIREBASE_PRIVATE_KEY || '')
    .replace(/^﻿/, '')
    .replace(/^["']|["']$/g, '')
    .replace(/\\n/g, '\n');
  const pemMatch = rawKey.match(/-----BEGIN[^-]*-----([^-]+)-----END[^-]*-----/s);
  let privateKey = rawKey;
  if (pemMatch) {
    const base64Clean = pemMatch[1].replace(/\s+/g, '');
    const lines = base64Clean.match(/.{1,64}/g) || [];
    privateKey =
      '-----BEGIN PRIVATE KEY-----\n' + lines.join('\n') + '\n-----END PRIVATE KEY-----\n';
  }

  const projectId = (process.env.FIREBASE_PROJECT_ID || '').trim();
  const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || '').trim();

  if (!projectId || !clientEmail || !privateKey.includes('PRIVATE KEY')) {
    console.error('[P234] Firebase ENV 미설정 (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY)');
    console.error('       .env.admin.local 또는 .env 파일에 설정 후 재실행');
    exit(1);
  }

  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

const db = getFirestore();
console.log('[P234] Firestore 연결 완료. 분석 시작...');

// zone_courses 분석 (ODsay 직접 호출 없음 — quota 보호)
console.log('[P234] zone_courses 컬렉션 로딩...');
const zones = await analyzeZoneCourses(db, opts.citiesFilter);
if (zones.length === 0) {
  console.warn('[P234] zone_courses 도큐먼트 없음 (빈 컬렉션 또는 city 필터 미매칭)');
}

// 최근 plan transit source 분포
console.log(`[P234] 최근 plan ${opts.planLimit}개 transit 분석...`);
const transitStats = await analyzePlanTransits(db, opts.planLimit);

// 리포트 출력
const summary = printReport(zones, transitStats, opts);

// JSON 출력 옵션
if (opts.jsonOutput) {
  const output = {
    generatedAt: new Date().toISOString(),
    zones: zones.map((z) => ({
      id: z.id,
      city: z.city,
      theme: z.theme,
      status: z.status,
      cacheReady: z.cacheReady,
      tmReal: z.tmReal,
      tmMock: z.tmMock,
    })),
    summary,
  };
  console.log('\n--- JSON OUTPUT ---');
  console.log(JSON.stringify(output, null, 2));
}

exit(0);
