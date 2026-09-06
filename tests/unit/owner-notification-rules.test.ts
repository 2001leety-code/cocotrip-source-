import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OWNER_GET_CLAUSE, addOwnerGetClause, assertOwnerRuleContract,
  ownerRuleCases, pushBlock, removeOwnerGetClause,
} from '../../scripts/verify-owner-notification-rules.mjs';

const rawSource = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');
const source = rawSource.replace(/\r\n/g, '\n');

describe('오너 기기 알림 규칙의 오프라인 소스 계약 (실제 Firebase 판정은 opt-in 모의 검사)', () => {
  it('승인된 GET 조건을 정확히 한 번 추가하고 기존 read/write/delete를 보존한다', () => {
    expect(assertOwnerRuleContract(source)).toBe(true);
    expect(pushBlock(removeOwnerGetClause(source)).text).not.toMatch(/allow\s+get\s*:/);
    expect(addOwnerGetClause(removeOwnerGetClause(source)).replace(/\r\n/g, '\n'))
      .toBe(source.replace(/\r\n/g, '\n'));
  });

  it('운영 원문 후보 생성은 줄바꿈을 포함해 GET 추가 외 모든 바이트를 보존한다', () => {
    for (const text of [source, source.replace(/\n/g, '\r\n'), rawSource]) {
      const baseline = removeOwnerGetClause(text);
      expect(removeOwnerGetClause(addOwnerGetClause(baseline))).toBe(baseline);
    }
  });

  it('목록 열기·저장된 소유자 검사 제거·UID 정규식 회귀를 계약 위반으로 잡는다', () => {
    expect(() => assertOwnerRuleContract(source.replace('allow get:', 'allow read:'))).toThrow();
    expect(() => assertOwnerRuleContract(source.replace(OWNER_GET_CLAUSE,
      OWNER_GET_CLAUSE.replace("resource.data.uid == request.auth.uid", 'true')))).toThrow();
    expect(() => assertOwnerRuleContract(source.replace(OWNER_GET_CLAUSE,
      OWNER_GET_CLAUSE.replace("docId[0:request.auth.uid.size() + 1] == request.auth.uid + '_'",
        "docId.matches(request.auth.uid + '_.*')")))).toThrow();
  });

  it('기존 쓰기·삭제 조건 변경과 중복 GET 추가를 거부한다', () => {
    expect(() => assertOwnerRuleContract(source.replace('allow read, write, delete:', 'allow read, write:'))).toThrow();
    expect(() => addOwnerGetClause(source)).toThrow();
  });

  it('가상 요청은 전부 별도 dry UID와 구독 경로만 사용하며 최소 40개 비교를 구성한다', () => {
    const baseline = ownerRuleCases(true);
    const proposed = ownerRuleCases();
    expect(baseline.length + proposed.length).toBeGreaterThanOrEqual(40);
    expect(new Set(proposed.map((item) => item.id)).size).toBe(proposed.length);
    for (const { test } of proposed) {
      expect(test.request.path).toMatch(/^\/databases\/\(default\)\/documents\/push_subscriptions\/(dry|Dry|different-owner)/);
      expect(test.request.auth?.uid || 'dry-signed-out').toMatch(/^(dry|Dry)/);
      expect(test).not.toHaveProperty('functionMocks');
    }
  });

  it('본인 GET만 달라지고 목록·삭제·생성·수정의 기대 결과는 기존과 같다', () => {
    const baseline = ownerRuleCases(true);
    const proposed = ownerRuleCases();
    const byId = new Map(proposed.map((item) => [item.id, item.test]));
    expect(byId.get('own-existing')?.expectation).toBe('ALLOW');
    expect(byId.get('own-absent')?.expectation).toBe('ALLOW');
    for (const { id, test } of baseline) {
      if (test.request.method !== 'get') expect(byId.get(id)?.expectation).toBe(test.expectation);
    }
    for (const id of ['custom-uid-prefix-existing', 'custom-uid-prefix-absent',
      'custom-uid-regex-crossover', 'stored-owner-mismatch', 'stored-owner-missing', 'signed-out', 'own-list']) {
      expect(byId.get(id)?.expectation).toBe('DENY');
    }
  });
});
