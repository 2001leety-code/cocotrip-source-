#!/usr/bin/env node
/**
 * Vercel cost audit — counts GitHub-tracked deployment events for this repo
 * over the last N days and breaks them down by environment / project name.
 *
 * Why this exists: Vercel charges by build minute, and duplicate Vercel
 * projects all build on the same git push. This script surfaces:
 *   1. Total deployment count (proxy for build minutes)
 *   2. Duplicate Vercel project deployments (every "Production – <name>"
 *      beyond the canonical project is wasted minutes)
 *   3. Top branches by preview deployment count
 *
 * Run via GitHub Actions (`.github/workflows/vercel-cost-audit.yml`) on a
 * weekly schedule. Requires `gh` CLI authenticated as the repo owner.
 *
 * Usage:
 *   node scripts/vercel-cost-audit.mjs                  # default 30-day window
 *   node scripts/vercel-cost-audit.mjs --days 7         # custom window
 *   node scripts/vercel-cost-audit.mjs --since 2026-04-05
 *
 * CI hook: writes summary to GITHUB_STEP_SUMMARY when present.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync, appendFileSync } from 'node:fs';

const REPO = process.env.GITHUB_REPOSITORY || '2001leety-code/cocotrip-source-';
const CANONICAL_PROJECT = 'cocotrip-source_2026';

// ---------- argv ----------
const args = process.argv.slice(2);
let sinceDate = null;
let days = 30;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--since') sinceDate = args[++i];
  else if (args[i] === '--days') days = parseInt(args[++i], 10);
}
if (!sinceDate) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  sinceDate = d.toISOString().slice(0, 10);
}

// ---------- fetch deployments via gh ----------
function ghPaginate(endpoint) {
  // gh api --paginate → returns concatenated JSON arrays
  const out = execFileSync(
    'gh',
    ['api', '--paginate', endpoint, '--jq', '.[] | {created_at, environment, ref, sha}'],
    { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 },
  );
  // Each line is a JSON object (jq stream). Parse line-by-line.
  return out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const all = ghPaginate(`repos/${REPO}/deployments?per_page=100`);
const recent = all.filter((d) => d.created_at >= sinceDate);

// ---------- aggregate ----------
const byEnv = new Map();
const byPreviewSha = new Map();
const duplicateProjects = new Map();

for (const d of recent) {
  const env = d.environment || '(unknown)';
  byEnv.set(env, (byEnv.get(env) || 0) + 1);

  // "Production – <project_name>" — duplicate Vercel project signature
  const m = env.match(/^Production\s+[–-]\s+(.+)$/);
  if (m) {
    const proj = m[1].trim();
    duplicateProjects.set(proj, (duplicateProjects.get(proj) || 0) + 1);
  }

  if (env === 'Preview') {
    const short = (d.sha || d.ref || '').slice(0, 7);
    byPreviewSha.set(short, (byPreviewSha.get(short) || 0) + 1);
  }
}

const total = recent.length;
const totalDuplicate = [...duplicateProjects.entries()]
  .filter(([name]) => name !== CANONICAL_PROJECT)
  .reduce((s, [, n]) => s + n, 0);

// ---------- output ----------
const lines = [];
lines.push(`# Vercel Cost Audit`);
lines.push('');
lines.push(`- Repo: \`${REPO}\``);
lines.push(`- Window: ${sinceDate} → today`);
lines.push(`- Total deployments: **${total}**`);
lines.push(`- Wasted on duplicate Vercel projects (non-canonical): **${totalDuplicate}**`);
lines.push('');
lines.push('## By environment');
lines.push('');
lines.push('| Environment | Count |');
lines.push('| --- | ---: |');
for (const [env, n] of [...byEnv.entries()].sort((a, b) => b[1] - a[1])) {
  lines.push(`| ${env} | ${n} |`);
}
lines.push('');

if (duplicateProjects.size > 0) {
  lines.push('## Vercel projects building production');
  lines.push('');
  lines.push('| Project | Builds | Status |');
  lines.push('| --- | ---: | --- |');
  for (const [name, n] of [...duplicateProjects.entries()].sort((a, b) => b[1] - a[1])) {
    const status = name === CANONICAL_PROJECT ? 'canonical (keep)' : '⚠ duplicate (delete)';
    lines.push(`| ${name} | ${n} | ${status} |`);
  }
  lines.push('');
}

if (totalDuplicate > 0) {
  lines.push('## Action items');
  lines.push('');
  lines.push(`- Delete the ${duplicateProjects.size - 1} duplicate Vercel project(s) (Vercel Dashboard → each duplicate project → Settings → Advanced → Delete).`);
  lines.push(`- Estimated savings: ~${totalDuplicate} builds × ~2.6 min ≈ ${Math.round(totalDuplicate * 2.6)} build-min in this window.`);
  lines.push('');
}

const previewCount = byEnv.get('Preview') || 0;
if (previewCount > 50) {
  lines.push('## Preview deployment volume');
  lines.push('');
  lines.push(`- Preview builds in window: ${previewCount}.`);
  lines.push(`- If preview deploys are not consumed (smoke / lighthouse), consider Vercel Settings → Git → restrict to main branch only.`);
  lines.push('');
}

const md = lines.join('\n');
console.log(md);

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
}

const reportPath = process.env.AUDIT_REPORT_PATH;
if (reportPath) {
  writeFileSync(reportPath, md);
}

// Exit code: non-zero only if duplicate projects detected (signal to fix)
process.exit(totalDuplicate > 0 ? 1 : 0);
