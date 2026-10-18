/**
 * DB 유지보수 오프라인 부품 잠금 — 네트워크 없이 fixture 응답으로만 검증.
 * closure-check(매칭·드라이런), review-queue(큐 구성), apply-review(거부 규칙).
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
// @ts-expect-error — JS module
import { nameSimilarity, districtOf, provinceOf, matchRow, detectColumns, runClosureCheck } from '../../scripts/db-maintenance/closure-check.mjs';
// @ts-expect-error — JS module
import { buildQueues } from '../../scripts/db-maintenance/review-queue.mjs';
// @ts-expect-error — JS module
import { planReview } from '../../scripts/db-maintenance/apply-review.mjs';
// @ts-expect-error — JS module
import { toCsv, parseCsv } from '../../scripts/db-maintenance/_csv.mjs';

const row = { name: '홍대 맛집 깃뜰', city: 'seoul', address: '서울특별시 마포구 서교동 395-20' };
const cand = (name: string, road: string, closed: boolean) => ({ name, road, lot: '', closed, statusName: closed ? '폐업' : '영업' });

describe('closure-check matching', () => {
  it('similarity / district / province', () => {
    expect(nameSimilarity('홍대 맛집 깃뜰', '홍대맛집깃뜰')).toBe(1);
    expect(nameSimilarity('깃뜰', '완전히다름')).toBeLessThan(0.8);
    expect(districtOf('경기도 고양시 덕양구 화정동')).toBe('덕양구');
    expect(districtOf('서울특별시 마포구 서교동')).toBe('마포구');
    expect(provinceOf('전북특별자치도 전주시 완산구')).toBe(provinceOf('전라북도 전주시'));
  });
  it('closed only when name>=0.8 AND same district (other-district open row ignored)', () => {
    const c = [cand('홍대맛집깃뜰', '서울특별시 마포구 와우산로 1', true), cand('홍대 맛집 깃뜰', '서울특별시 강남구 테헤란로 1', false), cand('전혀다른집', '서울특별시 마포구 x', false)];
    expect(matchRow(row, c).result).toBe('closed');
  });
  it('open wins; no match = unmatched', () => {
    expect(matchRow(row, [cand('홍대맛집깃뜰', '서울특별시 마포구 x', false)]).result).toBe('open');
    expect(matchRow(row, []).result).toBe('unmatched');
  });
  it('header detection is by name, not position', () => {
    const c = detectColumns(['개방서비스명', '상세영업상태명', '사업장명', '폐업일자', '소재지전체주소', '도로명전체주소', '영업상태명', '좌표정보(x)', '좌표정보(y)']);
    expect(c).toMatchObject({ name: 2, status: 6, detail: 1, closeDate: 3, lot: 4, road: 5, x: 7, y: 8 });
    expect(() => detectColumns(['a', 'b'])).toThrow(/필수 컬럼/);
  });
});

// 열 순서를 일부러 섞은 합성 CSV. 대구 중구 '남포국밥'(폐업)은 부산 필터에서 걸러져야 한다.
const CSV_UTF8 = [
  '개방서비스명,상세영업상태명,사업장명,폐업일자,소재지전체주소,도로명전체주소,영업상태명,좌표정보(x),좌표정보(y)',
  '일반음식점,폐업,홍대맛집깃뜰,2025-03-01,서울특별시 마포구 서교동 395-20,서울특별시 마포구 와우산로 1,폐업,1,2',
  '일반음식점,폐업,남포국밥,2024-01-01,대구광역시 중구 동인동 1,대구광역시 중구 중앙대로 1,폐업,1,2',
  '일반음식점,영업,영도식당,,부산광역시 영도구 동삼동 1,"부산광역시 영도구 태종로, 1",영업/정상,1,2',
].join('\r\n') + '\r\n';
// 같은 내용의 CP949(EUC-KR) 바이트 — python str.encode('cp949') 로 생성해 박제.
const CSV_CP949_HEX = 'b0b3b9e6bcadbaf1bdbab8ed2cbbf3bcbcbfb5bef7bbf3c5c2b8ed2cbbe7bef7c0e5b8ed2cc6f3bef7c0cfc0da2cbcd2c0e7c1f6c0fcc3bcc1d6bcd22cb5b5b7ceb8edc0fcc3bcc1d6bcd22cbfb5bef7bbf3c5c2b8ed2cc1c2c7a5c1a4bab82878292cc1c2c7a5c1a4bab82879290d0ac0cfb9ddc0bdbdc4c1a12cc6f3bef72cc8abb4ebb8c0c1fdb1eab6e32c323032352d30332d30312cbcadbfefc6afbab0bdc320b8b6c6f7b1b820bcadb1b3b5bf203339352d32302cbcadbfefc6afbab0bdc320b8b6c6f7b1b820bfcdbfecbbeab7ce20312cc6f3bef72c312c320d0ac0cfb9ddc0bdbdc4c1a12cc6f3bef72cb3b2c6f7b1b9b9e42c323032342d30312d30312cb4ebb1b8b1a4bfaabdc320c1dfb1b820b5bfc0ceb5bf20312cb4ebb1b8b1a4bfaabdc320c1dfb1b820c1dfbed3b4ebb7ce20312cc6f3bef72c312c320d0ac0cfb9ddc0bdbdc4c1a12cbfb5bef72cbfb5b5b5bdc4b4e72c2cbacebbeab1a4bfaabdc320bfb5b5b5b1b820b5bfbbefb5bf20312c22bacebbeab1a4bfaabdc320bfb5b5b5b1b820c5c2c1beb7ce2c2031222cbfb5bef72fc1a4bbf32c312c320d0a';
const idxRows = [
  row,
  { name: '남포국밥', city: 'busan', address: '부산광역시 중구 남포동 1' },
  { name: '영도식당', city: 'busan', address: '부산광역시 영도구 동삼동 1' },
  { name: '없는집', city: 'busan', address: '부산광역시 영도구 동삼동 9' },
  { name: '남포국밥', city: 'daegu', address: '대구광역시 중구 동인동 1' },
];

describe('closure-check run (CSV, no network)', () => {
  const mk = () => mkdtempSync(join(tmpdir(), 'maint-'));
  it('dry path: no --csv -> writes closure-dry.json only', async () => {
    const dir = mk();
    try {
      const r = await runClosureCheck({ rows: idxRows, outDir: dir, city: 'busan' });
      expect(r.message).toBe('DRY: --csv missing — 3 rows would be checked');
      expect(JSON.parse(readFileSync(join(dir, 'closure-dry.json'), 'utf-8')).count).toBe(3);
      expect(existsSync(join(dir, 'closure-diff.json'))).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  for (const [label, bytes] of [['UTF-8', Buffer.from(CSV_UTF8, 'utf-8')], ['CP949', Buffer.from(CSV_CP949_HEX, 'hex')]] as const) {
    it(`${label}: city filter + closed/open/unmatched (tiny chunks)`, async () => {
      const dir = mk();
      try {
        const csv = join(dir, 'in.csv');
        writeFileSync(csv, bytes);
        const r = await runClosureCheck({ rows: idxRows, csvPath: csv, outDir: dir, city: 'busan', highWaterMark: 7 });
        expect(r.stats.encoding).toBe(label === 'UTF-8' ? 'utf-8' : 'euc-kr');
        expect(r.tally).toEqual({ open: 1, closed: 0, unmatched: 2 }); // 남포국밥: 대구 행은 시/도 필터로 제외
        expect(r.stats.csvRowsKept).toBe(1);
        const all = await runClosureCheck({ rows: idxRows, csvPath: csv, outDir: dir, highWaterMark: 7 });
        expect(all.tally).toEqual({ open: 1, closed: 2, unmatched: 2 }); // 필터 없으면 서울 홍대 + 대구 남포국밥 closed, 부산 남포국밥은 시/도가 달라 unmatched
        const diff = JSON.parse(readFileSync(join(dir, 'closure-diff.json'), 'utf-8'));
        expect(diff.rows.find((d: { name: string }) => d.name === '홍대 맛집 깃뜰').closeDate).toBe('2025-03-01');
        expect(existsSync(join(dir, 'closure-diff.md'))).toBe(true);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  }
});

const idx = [
  { name: 'V1', city: 'busan', address: 'a1', tag: 'vegan', dietary_claim: 'vegan', verification_status: 'unverified', source: 'naver_local' },
  { name: 'V2', city: 'andong', address: 'a2', tag: 'halal', dietary_claim: 'halal', verification_status: 'unverified', source: 'ai_curated_2026_05_21' },
  { name: '한국이슬람교 서울중앙성원', city: 'seoul', address: 'a3', tag: 'halal', dietary_claim: 'halal', verification_status: 'muslim_friendly' },
  { name: 'Plain', city: 'seoul', address: 'a4', tag: 'general', naverLink: 'https://n' },
];

describe('review-queue', () => {
  it('mosque first, ai_curated next, then city->tag; no-link list', () => {
    const { q, nolink } = buildQueues(idx);
    expect(q.map((r: { name: string }) => r.name)).toEqual(['한국이슬람교 서울중앙성원', 'V2', 'V1']);
    expect(q[0].flag).toBe('not_a_restaurant?');
    expect(q[1].flag).toBe('ai_curated');
    expect(nolink.length).toBe(3);
  });
  it('csv round trip keeps commas/quotes', () => {
    const t = toCsv(['a', 'b'], [{ a: 'x,"y"', b: 'z' }]);
    expect(parseCsv(t)).toEqual([{ a: 'x,"y"', b: 'z' }]);
  });
});

describe('apply-review refusal rules', () => {
  const id = (r: Record<string, string>) => `${r.city}|${r.name}|${r.address}`;
  const base = { row_id: id(idx[0]), name: 'V1', reviewer: 'op', date: '2026-10-11' };
  it('refuses raise without evidence_url', () => {
    const p = planReview(idx, [{ ...base, suggested_grade: 'vegan_options', evidence_url: '' }]);
    expect(p.changes).toHaveLength(0);
    expect(p.refused[0].reason).toMatch(/evidence/);
  });
  it('refuses non-http evidence, wrong family, unknown id, missing reviewer', () => {
    expect(planReview(idx, [{ ...base, suggested_grade: 'vegan_options', evidence_url: 'ftp://x' }]).refused).toHaveLength(1);
    expect(planReview(idx, [{ ...base, suggested_grade: 'halal_certified', evidence_url: 'https://x' }]).refused[0].reason).toMatch(/not allowed/);
    expect(planReview(idx, [{ ...base, row_id: 'nope', suggested_grade: 'vegan_options', evidence_url: 'https://x' }]).refused[0].reason).toMatch(/unknown/);
    expect(planReview(idx, [{ ...base, reviewer: '', suggested_grade: 'vegan_options', evidence_url: 'https://x' }]).refused[0].reason).toMatch(/reviewer/);
  });
  it('accepts evidenced raise and touches only the 4 allowed fields; blank grade skipped', () => {
    const p = planReview(idx, [{ ...base, suggested_grade: 'vegan_options', evidence_url: 'https://shop/notice' }, { ...base, row_id: id(idx[1]), suggested_grade: '' }]);
    expect(p.refused).toHaveLength(0);
    expect(Object.keys(p.changes[0].after).sort()).toEqual(['source_url', 'verification_status', 'verified_at', 'verified_by']);
  });
});
