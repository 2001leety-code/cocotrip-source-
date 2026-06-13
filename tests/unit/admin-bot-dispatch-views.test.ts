/**
 * 어드민 텔레그램 봇 — 배차 운영 조회 3종 배선 + 읽기 전용 불변식 회귀 (2026-06-13).
 *
 * 추가 명령: 배차현황(/today_dispatch) · 대기배차(/pending_dispatch) · 미배차(/unassigned).
 *
 * 전부 읽기 전용(환불/캡처/상태변경 등 금융 자동실행 없음). 이 테스트는
 * 구현이 조용히 틀리는 함정들을 소스 가드로 박제:
 *   - 배차현황: todayKstDate()(문자열)를 Timestamp range 쿼리에 직접 쓰면 안 됨 →
 *               KST 자정의 실제 UTC 시각(Date.UTC 계산)으로 sentAt range 조회
 *   - 대기배차: status === 'sent' 만 조회 (응답 대기 중인 것)
 *   - 미배차: isUnassigned SSOT 재사용 (dispatch-reminder cron 동일 판정) +
 *            CONFIRMED + tourDate range (cron fetchUnassignedBookings 동일 쿼리)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(process.cwd(), 'api/telegram-webhook-admin.js'), 'utf8');
const reminderSrc = readFileSync(resolve(process.cwd(), 'api/_crons/dispatch-reminder.js'), 'utf8');

describe('admin bot 배차 운영 조회 — 배선', () => {
  const aliasCmds = ['/today_dispatch', '/pending_dispatch', '/unassigned'];

  it('KOREAN_ALIASES 에 3개 명령 한글 별칭 등록', () => {
    for (const cmd of aliasCmds) {
      expect(src).toMatch(new RegExp(`cmd:\\s*'${cmd}'`));
    }
    // 핵심 한글 트리거 단어
    for (const word of ['배차현황', '대기배차', '미배차']) {
      expect(src).toContain(word);
    }
  });

  it('routeCommand switch 에 3개 case + 핸들러 연결', () => {
    const handlers = [
      ['/today_dispatch', 'handleTodayDispatchCommand'],
      ['/pending_dispatch', 'handlePendingDispatchCommand'],
      ['/unassigned', 'handleUnassignedCommand'],
    ];
    for (const [cmd, fn] of handlers) {
      expect(src).toMatch(new RegExp(`case '${cmd}':[\\s\\S]{0,80}${fn}\\(`));
      expect(src).toMatch(new RegExp(`async function ${fn}\\(`));
    }
  });
});

describe('admin bot 배차 운영 조회 — 구현 불변식 (조용히 틀리는 함정 가드)', () => {
  it('배차현황: sentAt range 쿼리 (todayKstDate 문자열을 Timestamp 쿼리에 직접 안 씀)', () => {
    const body = src.slice(
      src.indexOf('function handleTodayDispatchCommand'),
      src.indexOf('function handlePendingDispatchCommand'),
    );
    // KST 자정의 실제 UTC 시각 계산 → Date 로 sentAt range 조회
    expect(body).toMatch(/Date\.UTC\(/);
    expect(body).toMatch(/where\('sentAt',\s*'>='/);
    // todayKstDate() 문자열을 where 쿼리 인자로 직접 넣지 않음
    expect(body).not.toMatch(/where\([^)]*todayKstDate\(\)/);
  });

  it('대기배차: status === sent 조회', () => {
    const body = src.slice(
      src.indexOf('function handlePendingDispatchCommand'),
      src.indexOf('function handleUnassignedCommand'),
    );
    expect(body).toMatch(/where\('status',\s*'==',\s*'sent'\)/);
    // 남은 시간 = expiresAt.toMillis - now (분 단위)
    expect(body).toMatch(/expiresAt[\s\S]{0,40}toMillis/);
  });

  it('미배차: isUnassigned import + CONFIRMED + tourDate range (cron SSOT 동일 쿼리)', () => {
    // dispatch-reminder.js 에서 isUnassigned import
    expect(src).toMatch(/import\s*\{[^}]*isUnassigned[^}]*\}\s*from\s*'\.\/_crons\/dispatch-reminder\.js'/);
    const body = src.slice(
      src.indexOf('function handleUnassignedCommand'),
      src.indexOf('// /sales'),
    );
    expect(body).toMatch(/where\('status',\s*'==',\s*'CONFIRMED'\)/);
    expect(body).toMatch(/where\('tourDate',\s*'>='/);
    expect(body).toMatch(/where\('tourDate',\s*'<='/);
    expect(body).toContain('isUnassigned(');
  });

  it('dispatch-reminder.js 가 isUnassigned 를 export', () => {
    expect(reminderSrc).toMatch(/export\s+function\s+isUnassigned\s*\(/);
  });

  it('전부 읽기 전용 — 3개 핸들러 블록에 금융/상태변경 호출 없음', () => {
    const block = src.slice(
      src.indexOf('function handleTodayDispatchCommand'),
      src.indexOf('// /sales'),
    );
    expect(block).not.toMatch(/refundPaypalCapture|capturePaypalOrder|confirmBookingAsPaid|\.update\(|\.set\(|runTransaction/);
  });
});
