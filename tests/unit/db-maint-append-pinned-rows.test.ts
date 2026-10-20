/**
 * DB 유지보수 — 고정 행(index_pinned_rows.json) 후처리: 한 번만 붙고, 다시 돌려도 같다.
 * (2026-10-10 source-sync: 빌드 필터를 못 넘는 수동/승격 행을 원천화한 파일의 후처리 계약)
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error — .mjs 스크립트(타입 선언 없음)
import { main } from '../../scripts/db-maintenance/append-pinned-rows.mjs';

describe('append-pinned-rows', () => {
  it('빌드 2행 + 고정 1행 → 꼬리에 한 번, 두 번째 실행은 동일', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pinned-'));
    const indexPath = join(dir, '_food_index.json');
    const built = [{ name: 'A', placeId: 'p1' }, { name: 'B (빌드 정리본)', placeId: 'p2' }];
    const pinned = [{ name: 'B 원문', placeId: 'p2' }];
    writeFileSync(join(dir, 'index_pinned_rows.json'), JSON.stringify(pinned));
    writeFileSync(indexPath, JSON.stringify(built));

    expect(main([indexPath], { env: { FOOD_DATA_DIR: dir } })).toMatchObject({ replaced: 1, appended: 1, total: 2 });
    const first = readFileSync(indexPath, 'utf8');
    expect(JSON.parse(first)).toEqual([{ name: 'A', placeId: 'p1' }, { name: 'B 원문', placeId: 'p2' }]);

    main([indexPath], { env: { FOOD_DATA_DIR: dir } });
    expect(readFileSync(indexPath, 'utf8')).toBe(first);
  });

  it('FOOD_DATA_DIR 없으면 중단', () => {
    expect(() => main([], { env: {} })).toThrow(/FOOD_DATA_DIR/);
  });
});
