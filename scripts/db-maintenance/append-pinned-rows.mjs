#!/usr/bin/env node
/**
 * build-food-index.js 다음에 돌리는 후처리 (정식 순서: build → 이 스크립트).
 *
 *   FOOD_DATA_DIR=E:/ai에이젼시만들기/food_data node scripts/build-food-index.js
 *   FOOD_DATA_DIR=E:/ai에이젼시만들기/food_data node scripts/db-maintenance/append-pinned-rows.mjs [indexPath]
 *
 * <FOOD_DATA_DIR>/index_pinned_rows.json 의 행은 빌드 필터(평점·리뷰 수)·정렬·이름/주소 정리를 거치지 않는다
 * (#584 자갈치시장, promote_candidates.py 트렌드 승격분). 같은 키의 빌드 행을 빼고 파일 순서대로 원문 그대로 꼬리에 붙인다.
 * 키 = placeId → googleMapsUrl → name|address (빌드 dedup 와 같은 우선순위). 여러 번 돌려도 결과 같음.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = resolve(HERE, '..', '..', 'api', '_food_index.json');

export const rowKey = (r) => r.placeId || r.googleMapsUrl || `${r.name}|${r.address}`;

export function appendPinned(built, pinned) {
  const pk = new Set(pinned.map(rowKey));
  return [...built.filter((r) => !pk.has(rowKey(r))), ...pinned];
}

export function main(argv, { env = process.env } = {}) {
  const foodDir = env.FOOD_DATA_DIR;
  if (!foodDir) throw new Error('FOOD_DATA_DIR 가 필요하다 (예: E:/ai에이젼시만들기/food_data)');
  const indexPath = argv[0] ? resolve(argv[0]) : INDEX_PATH;
  const pinned = JSON.parse(readFileSync(join(foodDir, 'index_pinned_rows.json'), 'utf8'));
  const built = JSON.parse(readFileSync(indexPath, 'utf8'));
  const out = appendPinned(built, pinned);
  writeFileSync(indexPath, JSON.stringify(out), 'utf8'); // build 와 같은 minified 한 줄
  return { built: built.length, replaced: built.length + pinned.length - out.length, appended: pinned.length, total: out.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('pinned:', JSON.stringify(main(process.argv.slice(2))));
}
