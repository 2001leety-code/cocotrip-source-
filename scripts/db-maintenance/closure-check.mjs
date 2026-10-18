// 폐업 교차 확인 — api/_food_index.json 을 읽기만 한다(산출물은 절대 쓰지 않음). 네트워크 호출 0.
//
// 데이터 출처(공식): 전국일반음식점표준데이터(LocalData) 일일 CSV
//   https://file.localdata.go.kr/file/general_restaurants/info  (약 213만 행, 키 불필요)
//   ⚠️ 이 스크립트는 내려받지 않는다. 운영자가 파일을 받아(별도 승인) 로컬 경로를 --csv 로 넘긴다.
//
// 사용: node scripts/db-maintenance/closure-check.mjs --csv <path> [--city KEY] [--limit N] [--out DIR]
//   --csv 없음 → "DRY: --csv missing — N rows would be checked", exit 0, <out>/closure-dry.json 만 기록.
//   --csv 있음 → <out>/closure-diff.json + closure-diff.md 기록.
//
// CSV 처리: 수백 MB 가능 → 스트림 + readline(줄 단위). UTF-8 이 아니면(첫 64KB 검사) CP949/EUC-KR 로 디코딩.
//   컬럼은 헤더 "이름" 으로 찾는다(위치 의존 금지): 사업장명 · 영업상태명(없으면 영업상태) · 상세영업상태명 ·
//   폐업일자 · 도로명전체주소 · 소재지전체주소 · 좌표정보(x)/(y)(있으면 후보에 싣기만 함).
//   --city/--limit 로 고른 인덱스 행의 시/도 + 구/시/군 에 속한 CSV 행만 메모리에 올린다.
//
// 매칭 규칙: 상호 유사도 ≥ 0.8 AND 시/도 일치 AND 도로명 또는 지번 주소의 구/시/군 일치 → 같은 업소.
//   유사도 = 공백·괄호·기호 제거 후 글자 bigram Dice 계수.
//   분류: 매칭 중 폐업 아닌 행이 있으면 open / 전부 폐업이면 closed(영업상태명에 '폐업' 또는 폐업일자 존재) / 매칭 없음 unmatched.
//   unmatched 는 "폐업" 이 아니다(신규·상호변경·표준데이터 누락) — 사람이 본다.

import { readFileSync, writeFileSync, mkdirSync, createReadStream, openSync, readSync, closeSync } from 'fs';
import { createInterface } from 'readline';
import { Transform } from 'stream';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const THRESHOLD = 0.8;
const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = join(__dirname, '..', '..', 'api', '_food_index.json');

export function normalizeName(s) {
  return String(s || '').replace(/[(（][^)）]*[)）]/g, '').replace(/[\s\-_.,·'"/&]/g, '').toLowerCase();
}

export function nameSimilarity(a, b) {
  const x = normalizeName(a), y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const grams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const gx = grams(x), gy = grams(y);
  let hit = 0;
  for (const [g, n] of gx) hit += Math.min(n, gy.get(g) || 0);
  return (2 * hit) / (x.length - 1 + y.length - 1);
}

/** 주소 앞 4토큰 안의 마지막 시/군/구 토큰 (예: "서울특별시 마포구 …" → 마포구, "경기도 고양시 덕양구 …" → 덕양구). */
export function districtOf(address) {
  const toks = String(address || '').trim().split(/\s+/).slice(0, 4).filter((t) => /[시군구]$/.test(t) && t.length > 1);
  return toks.length ? toks[toks.length - 1] : '';
}

// 시/도 정규화 — 구·신 행정명(전라북도/전북특별자치도, 강원도/강원특별자치도)을 같은 값으로.
const PROVINCES = [['서울', '서울'], ['부산', '부산'], ['대구', '대구'], ['인천', '인천'], ['광주', '광주'], ['대전', '대전'], ['울산', '울산'], ['세종', '세종'], ['경기', '경기'], ['강원', '강원'], ['충청북', '충북'], ['충북', '충북'], ['충청남', '충남'], ['충남', '충남'], ['전라북', '전북'], ['전북', '전북'], ['전라남', '전남'], ['전남', '전남'], ['경상북', '경북'], ['경북', '경북'], ['경상남', '경남'], ['경남', '경남'], ['제주', '제주']];
export function provinceOf(address) {
  const t = String(address || '').trim().split(/\s+/)[0] || '';
  const hit = PROVINCES.find(([k]) => t.startsWith(k));
  return hit ? hit[1] : '';
}

/** 한 행 vs 후보들 → {result:'open'|'closed'|'unmatched', best}. 후보 = {name, road, lot, closed, statusName}. */
export function matchRow(row, candidates) {
  const dist = districtOf(row.address);
  const matches = candidates
    .map((c) => ({ ...c, score: nameSimilarity(row.name, c.name) }))
    .filter((c) => c.score >= THRESHOLD && dist && provinceOf(c.road || c.lot) === provinceOf(row.address) && (districtOf(c.road) === dist || districtOf(c.lot) === dist))
    .sort((a, b) => b.score - a.score);
  if (!matches.length) return { result: 'unmatched', best: null };
  const open = matches.find((m) => !m.closed);
  return open ? { result: 'open', best: open } : { result: 'closed', best: matches[0] };
}

export function selectRows(rows, { limit, city } = {}) {
  let r = rows.filter((x) => x && x.name && x.address);
  if (city) r = r.filter((x) => x.city === city);
  return limit > 0 ? r.slice(0, limit) : r;
}

// ---------- CSV (스트림) ----------

export function detectEncoding(path) {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(65536);
    const n = readSync(fd, buf, 0, buf.length, 0);
    new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, n), { stream: true }); // 끝이 잘린 멀티바이트는 허용
    return 'utf-8';
  } catch {
    return 'euc-kr'; // CP949 상위호환
  } finally { closeSync(fd); }
}

export function splitCsvLine(line) {
  const out = [];
  let f = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(f); f = ''; }
    else f += c;
  }
  out.push(f);
  return out;
}

/** 헤더 이름으로 컬럼 위치를 찾는다. 필수(사업장명·상태/폐업일자·주소)가 없으면 헤더를 보여주며 실패. */
export function detectColumns(header) {
  const h = header.map((x) => x.replace(/^﻿/, '').trim());
  const find = (pred) => h.findIndex(pred);
  const plainStatus = find((x) => x.includes('영업상태') && !x.includes('상세') && !x.includes('코드')); // 영업상태명 / 영업상태
  const cols = {
    name: find((x) => x.includes('사업장명')),
    status: plainStatus,
    detail: find((x) => x.includes('상세영업상태명')),
    closeDate: find((x) => x.includes('폐업일자')),
    road: find((x) => x.includes('도로명전체주소') || x.includes('도로명주소')),
    lot: find((x) => x.includes('소재지전체주소') || x.includes('소재지주소') || x.includes('지번주소')),
    x: find((x) => x.includes('좌표정보') && /\(x\)/i.test(x)),
    y: find((x) => x.includes('좌표정보') && /\(y\)/i.test(x)),
  };
  if (cols.name < 0 || (cols.status < 0 && cols.closeDate < 0) || (cols.road < 0 && cols.lot < 0)) {
    throw new Error(`CSV 헤더에서 필수 컬럼(사업장명·영업상태/폐업일자·주소)을 못 찾음. 헤더: ${h.join('|')}`);
  }
  return cols;
}

function lineStream(path, encoding, highWaterMark) {
  const dec = new TextDecoder(encoding);
  const t = new Transform({
    transform(chunk, _e, cb) { cb(null, dec.decode(chunk, { stream: true })); },
    flush(cb) { cb(null, dec.decode()); },
  });
  return createInterface({ input: createReadStream(path, highWaterMark ? { highWaterMark } : undefined).pipe(t), crlfDelay: Infinity });
}

/** CSV 를 한 번 훑어 districts/provinces 에 속한 행만 구/시/군별로 모은다. */
export async function loadCandidates(csvPath, { districts, provinces, highWaterMark } = {}) {
  const encoding = detectEncoding(csvPath);
  const byDistrict = new Map();
  let cols = null, scanned = 0, kept = 0, pending = '';
  for await (const raw of lineStream(csvPath, encoding, highWaterMark)) {
    const line = pending ? `${pending}\n${raw}` : raw;
    if ((line.match(/"/g) || []).length % 2) { pending = line; continue; } // 따옴표 안 줄바꿈
    pending = '';
    if (!line.trim()) continue;
    const f = splitCsvLine(line);
    if (!cols) { cols = detectColumns(f); continue; }
    scanned++;
    const road = cols.road >= 0 ? f[cols.road] || '' : '';
    const lot = cols.lot >= 0 ? f[cols.lot] || '' : '';
    if (!provinces.has(provinceOf(road || lot))) continue;
    const dists = new Set([districtOf(road), districtOf(lot)].filter((d) => d && districts.has(d)));
    if (!dists.size) continue;
    const statusName = [cols.status, cols.detail].filter((i) => i >= 0).map((i) => f[i] || '').join('/');
    const closeDate = cols.closeDate >= 0 ? (f[cols.closeDate] || '').trim() : '';
    const cand = { name: f[cols.name] || '', road, lot, closed: statusName.includes('폐업') || closeDate !== '', statusName, closeDate, x: cols.x >= 0 ? f[cols.x] : undefined, y: cols.y >= 0 ? f[cols.y] : undefined };
    kept++;
    for (const d of dists) { if (!byDistrict.has(d)) byDistrict.set(d, []); byDistrict.get(d).push(cand); }
  }
  if (!cols) throw new Error('CSV 가 비어 있음');
  return { byDistrict, scanned, kept, encoding };
}

export async function runClosureCheck({ rows, csvPath, outDir, limit, city, highWaterMark }) {
  const sel = selectRows(rows, { limit, city });
  mkdirSync(outDir, { recursive: true });
  if (!csvPath) {
    const items = sel.map((r) => ({ name: r.name, city: r.city, province: provinceOf(r.address), district: districtOf(r.address) }));
    writeFileSync(join(outDir, 'closure-dry.json'), JSON.stringify({ count: items.length, rows: items }, null, 2));
    return { dry: true, message: `DRY: --csv missing — ${sel.length} rows would be checked`, count: sel.length };
  }
  const districts = new Set(sel.map((r) => districtOf(r.address)).filter(Boolean));
  const provinces = new Set(sel.map((r) => provinceOf(r.address)).filter(Boolean));
  const { byDistrict, scanned, kept, encoding } = await loadCandidates(csvPath, { districts, provinces, highWaterMark });
  const diff = [];
  const tally = { open: 0, closed: 0, unmatched: 0 };
  for (const r of sel) {
    const out = matchRow(r, byDistrict.get(districtOf(r.address)) || []);
    tally[out.result]++;
    diff.push({ name: r.name, city: r.city, address: r.address, result: out.result, matchedName: out.best?.name, score: out.best ? +out.best.score.toFixed(2) : undefined, status: out.best?.statusName, closeDate: out.best?.closeDate || undefined });
  }
  const stats = { encoding, csvRowsScanned: scanned, csvRowsKept: kept };
  const flagged = diff.filter((d) => d.result !== 'open');
  writeFileSync(join(outDir, 'closure-diff.json'), JSON.stringify({ tally, stats, total: diff.length, rows: diff }, null, 2));
  const md = [`# 폐업 교차 확인 (${new Date().toISOString().slice(0, 10)})`, '', `총 ${diff.length}행 — open ${tally.open} / closed ${tally.closed} / unmatched ${tally.unmatched}`, `CSV: ${encoding}, ${scanned}행 훑음, ${kept}행 비교 대상`, '', '| 결과 | 이름 | 도시 | 주소 | 매칭명 | 점수 | 상태 | 폐업일 |', '|---|---|---|---|---|---|---|---|', ...flagged.map((d) => `| ${d.result} | ${d.name} | ${d.city} | ${d.address} | ${d.matchedName || ''} | ${d.score ?? ''} | ${d.status || ''} | ${d.closeDate || ''} |`), '', '인덱스는 수정하지 않았음. closed 는 원천(food_data) 수정 후 build-food-index 로 반영. unmatched 는 폐업이 아님.'];
  writeFileSync(join(outDir, 'closure-diff.md'), md.join('\n'));
  return { dry: false, tally, stats, count: diff.length };
}

function arg(name) { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; }

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  const rows = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
  const r = await runClosureCheck({ rows, csvPath: arg('--csv'), outDir: arg('--out') || 'maint', limit: Number(arg('--limit')) || 0, city: arg('--city') });
  console.log(r.dry ? r.message : `완료: ${JSON.stringify(r.tally)} ${JSON.stringify(r.stats)}`);
}
