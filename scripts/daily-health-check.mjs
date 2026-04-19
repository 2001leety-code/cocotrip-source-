#!/usr/bin/env node
/**
 * CocoTrip — Daily Health Check
 *
 * Runs endpoint pings + validate-planner + appends results to JSONL log.
 * Designed for GitHub Actions cron (UTC 00:00 daily).
 *
 * Usage:
 *   node scripts/daily-health-check.mjs [base-url]
 *   Default: https://cocotripkr.com
 *
 * Output: scripts/health-log.jsonl (append)
 *
 * Exit codes:
 *   0 = healthy (issues ≤ 9)
 *   1 = degraded (issues > 9 or endpoint failures)
 */

import { execSync } from 'child_process';
import { appendFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || 'https://cocotripkr.com';
const LOG_PATH = join(__dirname, 'health-log.jsonl');

// ── 1. Endpoint Pings ──────────────────────────────────────────────────
async function pingEndpoints() {
  const endpoints = [
    { name: 'homepage', url: `${BASE}/`, method: 'HEAD' },
    { name: 'plan-status', url: `${BASE}/api/plan-status`, method: 'GET' },
    { name: 'planner-page', url: `${BASE}/planner`, method: 'HEAD' },
  ];

  const results = [];
  for (const ep of endpoints) {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const res = await fetch(ep.url, {
        method: ep.method,
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timeout);

      results.push({
        name: ep.name,
        status: res.status,
        ok: res.status < 500,
        elapsed_ms: Date.now() - start,
      });
    } catch (err) {
      results.push({
        name: ep.name,
        status: 0,
        ok: false,
        error: err.message,
        elapsed_ms: Date.now() - start,
      });
    }
  }
  return results;
}

// ── 2. Run validate-planner.js ──────────────────────────────────────────
function runValidatePlanner() {
  const reportPath = join(__dirname, 'planner-report.json');

  try {
    console.log('🧪 Running validate-planner.js...');
    execSync(`node "${join(__dirname, 'validate-planner.js')}" "${BASE}"`, {
      stdio: 'inherit',
      timeout: 600_000, // 10 min timeout
      env: { ...process.env },
    });

    if (existsSync(reportPath)) {
      const report = JSON.parse(readFileSync(reportPath, 'utf-8'));
      return {
        ok: true,
        total_issues: report.total_issues,
        success_count: report.success_count,
        fail_count: report.fail_count,
        avg_elapsed_ms: report.avg_elapsed_ms,
        diversity_overlap: (report.diversity_overlap && report.diversity_overlap.overlap_ratio) || null,
        issue_breakdown: (report.results || []).reduce((acc, r) => {
          for (const iss of (r.issues || [])) {
            acc[iss.type] = (acc[iss.type] || 0) + 1;
          }
          return acc;
        }, {}),
      };
    }
    return { ok: false, error: 'Report file not found after execution' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── 3. Main ─────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🏥 CocoTrip Daily Health Check`);
  console.log(`   Base: ${BASE}`);
  console.log(`   Time: ${new Date().toISOString()}\n`);

  // Ping endpoints
  console.log('📡 Pinging endpoints...');
  const pings = await pingEndpoints();
  for (const p of pings) {
    const icon = p.ok ? '✅' : '❌';
    console.log(`  ${icon} ${p.name}: ${p.status} (${p.elapsed_ms}ms)`);
  }

  // Run planner validation
  const validation = runValidatePlanner();

  // Build health record
  const record = {
    timestamp: new Date().toISOString(),
    base_url: BASE,
    pings,
    validation,
    all_pings_ok: pings.every(p => p.ok),
    issues_within_threshold: (validation.total_issues != null ? validation.total_issues : 99) <= 9,
  };

  // Append to JSONL log
  appendFileSync(LOG_PATH, JSON.stringify(record) + '\n', 'utf-8');

  // Summary
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`🏥 HEALTH CHECK SUMMARY`);
  console.log(`${'═'.repeat(50)}`);
  console.log(`  Endpoints: ${pings.filter(p => p.ok).length}/${pings.length} OK`);
  console.log(`  Planner issues: ${validation.total_issues != null ? validation.total_issues : 'N/A'} (threshold: ≤ 9)`);
  console.log(`  Diversity overlap: ${validation.diversity_overlap != null ? validation.diversity_overlap : 'N/A'}%`);
  console.log(`  Status: ${record.all_pings_ok && record.issues_within_threshold ? '🟢 HEALTHY' : '🔴 DEGRADED'}`);
  console.log(`  Log: ${LOG_PATH}`);
  console.log(`${'═'.repeat(50)}\n`);

  // Exit code
  if (!record.all_pings_ok || !record.issues_within_threshold) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
