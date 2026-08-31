import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const readWorkflow = (name: string) => readFileSync(resolve(ROOT, '.github/workflows', name), 'utf8');
const readScript = (name: string) => readFileSync(resolve(ROOT, 'scripts', name), 'utf8');

describe('운영 감시 워크플로 — 실패를 숨기지 않는다', () => {
  it('daily-health는 모든 핵심 단계 outcome을 합산해 최종 실패로 고정한다', () => {
    const yml = readWorkflow('daily-health.yml');

    expect(yml).toContain('id: health_verdict');
    for (const id of [
      'daily_health',
      'npm_install',
      'plan_smoke',
      'freshness',
      'nav_smoke',
      'mood_smoke',
      'regression',
    ]) {
      expect(yml).toContain(`steps.${id}.outcome`);
    }
    expect(yml).toContain('Enforce final core health verdict');
    expect(yml).toContain('if [ "$HEALTH_RESULT" != "pass" ]');
    expect(yml.match(/if: always\(\) && steps\.health_verdict\.outputs\.result != 'pass'/g) || []).toHaveLength(2);
  });

  it('daily-health 즉시 운영 알림은 Telegram 한 곳이고 HTTP 오류를 실패로 처리한다', () => {
    const yml = readWorkflow('daily-health.yml');

    expect(yml).toContain('Telegram alert on core health failure');
    expect(yml).toContain('curl --fail-with-body --silent --show-error');
    expect(yml).not.toContain('DISCORD_WEBHOOK_URL');
  });

  it('uptime smoke는 probe 실패 시 exit 1이며 후속 기록과 알림은 always로 실행한다', () => {
    const yml = readWorkflow('prod-uptime-smoke.yml');
    const runStep = yml.split('- name: Run uptime smoke')[1].split('- name: Open or update uptime issue')[0];

    expect(runStep).toContain('echo "result=fail"');
    expect(runStep).toContain('exit 1');
    expect(yml.match(/if: always\(\) && steps\.smoke\.outcome != 'success'/g) || []).toHaveLength(2);
    expect(yml).toContain('curl --fail-with-body --silent --show-error');
    expect(yml).toContain('<!-- uptime-telegram-alert -->');
    expect(yml).toContain('21600');
    expect(yml).toContain('Close recovered uptime issue');
    expect(yml).not.toContain('DISCORD_WEBHOOK_URL');
  });

  it('실제 저장소에 없던 issue 라벨 이름에 의존하지 않는다', () => {
    const combined = [
      readWorkflow('daily-health.yml'),
      readWorkflow('api-health-issue-on-fail.yml'),
      readWorkflow('scenario-matrix.yml'),
      readWorkflow('quality-alert.yml'),
    ].join('\n');

    expect(combined).not.toMatch(/auto-health|priority:high|--label "regression,scenario-matrix"|severity:\$\{severity\}/);
  });

  it('품질 장애도 Discord 중복 없이 Issue와 Telegram에 남고 전송 실패를 숨기지 않는다', () => {
    const yml = readWorkflow('quality-alert.yml');

    expect(yml).toContain('Open or update tracking issue');
    expect(yml).toContain('Send Telegram alert');
    expect(yml).toContain('curl --fail-with-body --silent --show-error');
    expect(yml).not.toContain('DISCORD_WEBHOOK_URL');
  });

  it('API health는 현재 runner를 checkout하고 실패를 숨기지 않는다', () => {
    const yml = readWorkflow('api-health.yml');

    expect(yml).toContain('actions/checkout@v7');
    expect(yml).toContain('actions/setup-node@v7');
    expect(yml).toContain('node scripts/api-health-check.mjs');
    expect(yml).not.toContain('continue-on-error');
  });

  it('API health는 현재 인증 계약만 검사하고 폐기된 주소와 PII query를 쓰지 않는다', () => {
    const yml = readWorkflow('api-health.yml');
    const script = readScript('api-health-check.mjs');

    for (const secret of ['FIREBASE_WEB_API_KEY', 'HEALTH_CHECK_EMAIL', 'HEALTH_CHECK_PASSWORD']) {
      expect(yml).toContain(`secrets.${secret}`);
      expect(script).toContain(`'${secret}'`);
    }
    expect(script).toContain('accounts:signInWithPassword');
    expect(script).toContain('Authorization: `Bearer ${token}`');
    expect(script).toContain('/api/admin-ai-ops-center?limit=1');
    expect(script).toContain("expectedStatus: 401");
    expect(script).toContain("'AUTH_REQUIRED'");
    expect(script).toContain("expectedStatus: 404");
    expect(script).toContain("'NOT_FOUND'");
    expect(script).not.toContain('/api/check-availability');
    expect(script).not.toContain('/api/my-bookings?userEmail=');
    expect(script).not.toMatch(/console\.(?:log|error)\([^\n]*(?:payload|password|email|token)/i);
  });
});
