/**
 * 어드민 텔레그램 봇 — 사무실 연동 2종 배선 + 안전 가드 회귀 (2026-06-13).
 *
 * 추가 기능:
 *   브리핑(/briefing)   — 온디맨드 모닝 브리핑 (cron 안 기다리고 "어제 회사 한 장" 즉시).
 *   결정(/decisions)    — 의사결정 큐 pending 목록 + 인라인 [승인/거절] 버튼.
 *   dec: 콜백           — 버튼 클릭 시 resolveDecision(status flip) 만.
 *
 * 핵심 안전선: 금융/발행/배포 자동실행 절대 금지. 승인 콜백은 status 만 바꾼다.
 * 이 테스트는 소스 가드로 그 불변식을 박제 (admin-bot-query-commands.test.ts 스타일).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(process.cwd(), 'api/telegram-webhook-admin.js'), 'utf8');
const briefingSrc = readFileSync(resolve(process.cwd(), 'api/_crons/morning-briefing.js'), 'utf8');

describe('admin bot 사무실 연동 — 배선', () => {
  it('KOREAN_ALIASES 에 브리핑·결정 별칭 2개 등록', () => {
    expect(src).toMatch(/cmd:\s*'\/briefing'/);
    expect(src).toMatch(/cmd:\s*'\/decisions'/);
    // 핵심 한글 트리거 단어
    for (const word of ['브리핑', '결정', '승인대기']) {
      expect(src).toContain(word);
    }
  });

  it('routeCommand switch 에 case 2개 + 핸들러 연결', () => {
    const handlers: Array<[string, string]> = [
      ['/briefing', 'handleBriefingCommand'],
      ['/decisions', 'handleDecisionsCommand'],
    ];
    for (const [cmd, fn] of handlers) {
      expect(src).toMatch(new RegExp(`case '${cmd}':[\\s\\S]{0,80}${fn}\\(`));
      expect(src).toMatch(new RegExp(`function ${fn}\\(`));
    }
  });

  it('콜백 분기(isCallback)에 dec: prefix 처리 + 기존 claim_/qb_ 라우팅 유지', () => {
    // dec: 네임스페이스 추가
    expect(src).toMatch(/data\.startsWith\('dec:'\)/);
    expect(src).toMatch(/function handleDecisionCallback\(/);
    // 기존 콜백 prefix 가 그대로 살아있어야 함 (회귀 방지)
    expect(src).toMatch(/data\.startsWith\('claim_approve:'\)/);
    expect(src).toMatch(/data\.startsWith\('qb_confirm:'\)/);
    expect(src).toMatch(/data\.startsWith\('qb_dispatch:'\)/);
  });

  it('HELP_TEXT 에 사무실 연동 안내 (브리핑·결정)', () => {
    expect(src).toContain('사무실 연동');
    expect(src).toMatch(/<code>브리핑<\/code>/);
    expect(src).toMatch(/<code>결정<\/code>/);
  });
});

describe('admin bot 사무실 연동 — 안전 가드 (자동실행 금지)', () => {
  // dec: 콜백 핸들러 본문만 슬라이스 (다음 함수 handleClaimCallback 직전까지).
  const cbStart = src.indexOf('async function handleDecisionCallback(');
  const cbEnd = src.indexOf('async function handleClaimCallback(', cbStart);
  const callbackBody = src.slice(cbStart, cbEnd);

  it('승인 콜백은 resolveDecision(status flip)만 — 발행/환불/배포/이메일 자동실행 없음', () => {
    expect(cbStart).toBeGreaterThan(0);
    expect(cbEnd).toBeGreaterThan(cbStart);
    // resolveDecision 호출 존재 (status flip)
    expect(callbackBody).toMatch(/resolveDecision\(/);
    // 다운스트림 부작용 함수 미사용 (출처 불문 자동 실행 금지)
    expect(callbackBody).not.toMatch(
      /sendEmail|refundPaypalCapture|capturePaypalOrder|sendDispatchToDriver|publish|deploy|firebase_deploy/i,
    );
  });

  it('멱등: 이미 pending 아니면 no-op (중복 클릭 보호)', () => {
    expect(callbackBody).toMatch(/decision\.status\s*&&\s*decision\.status\s*!==\s*'pending'/);
  });

  it('resolveDecision/DECISION_COLLECTION 을 decisionQueue.js 에서 import', () => {
    expect(src).toMatch(
      /import\s*\{[^}]*resolveDecision[^}]*DECISION_COLLECTION[^}]*\}\s*from\s*'\.\/_shared\/decisionQueue\.js'/,
    );
  });

  it('nullish coalescing 미사용 — pre-commit mojibake 오탐 회피 (|| / 삼항만)', () => {
    // 추가된 사무실 연동 핸들러 영역에서 nullish coalescing 금지.
    // (토큰 자체를 소스에 직접 쓰면 pre-commit mojibake 스캐너가 이 테스트 파일을
    //  오탐하므로 char code 로 조립한다 — 2개의 물음표 문자.)
    const nullishToken = String.fromCharCode(63, 63);
    const officeBlock = src.slice(
      src.indexOf('async function handleBriefingCommand('),
      src.indexOf('async function handleClaimCallback('),
    );
    expect(officeBlock).not.toContain(nullishToken);
  });
});

describe('admin bot 사무실 연동 — 온디맨드 브리핑 (스로틀)', () => {
  it('morning-briefing.js 가 morningBriefingTask 를 export (default vercelHandler 유지)', () => {
    expect(briefingSrc).toMatch(/export\s+async\s+function\s+morningBriefingTask\s*\(/);
    expect(briefingSrc).toMatch(/export\s+default\s+async\s+function\s+vercelHandler\s*\(/);
  });

  it('webhook 이 morningBriefingTask 를 import 후 호출', () => {
    expect(src).toMatch(
      /import\s*\{[^}]*morningBriefingTask[^}]*\}\s*from\s*'\.\/_crons\/morning-briefing\.js'/,
    );
    const body = src.slice(
      src.indexOf('async function handleBriefingCommand('),
      src.indexOf('async function handleDecisionsCommand('),
    );
    expect(body).toMatch(/morningBriefingTask\(/);
  });

  it('스로틀: lastBriefingMs 모듈 변수 + 60초 가드', () => {
    expect(src).toMatch(/let\s+lastBriefingMs\s*=\s*0/);
    expect(src).toMatch(/BRIEFING_THROTTLE_MS/);
    const body = src.slice(
      src.indexOf('async function handleBriefingCommand('),
      src.indexOf('async function handleDecisionsCommand('),
    );
    // 60초 이내 재호출 시 task 미실행 (방금 생성됨 안내)
    expect(body).toMatch(/lastBriefingMs/);
    expect(body).toMatch(/방금 생성됨/);
  });

  it('브리핑 핸들러는 task 호출만 — 본문 별도 재전송(notifyOperatorLong) 금지', () => {
    const body = src.slice(
      src.indexOf('async function handleBriefingCommand('),
      src.indexOf('async function handleDecisionsCommand('),
    );
    // task 가 내부에서 발송(send-type) → 여기서 직접 notifyOperatorLong 재전송 안 함
    expect(body).not.toContain('notifyOperatorLong');
  });
});
