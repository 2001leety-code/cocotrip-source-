import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  createPaidRequestGate,
  parsePaidGooglePlacesConsent,
} from '../../scripts/_paid-google-places-guard.mjs';

describe('수동 Google Places 보강 스크립트 비용 동의', () => {
  it('명시 동의나 호출 상한이 빠지면 실행을 거부한다', () => {
    expect(() => parsePaidGooglePlacesConsent([])).toThrow('기본 차단');
    expect(() => parsePaidGooglePlacesConsent(['--allow-paid-google-places'])).toThrow('기본 차단');
    expect(() => parsePaidGooglePlacesConsent([
      '--allow-paid-google-places',
      '--max-paid-requests=101',
    ])).toThrow('기본 차단');
  });

  it('승인된 상한의 다음 호출을 동기적으로 차단한다', () => {
    const consent = parsePaidGooglePlacesConsent([
      '--allow-paid-google-places',
      '--max-paid-requests=2',
    ]);
    const gate = createPaidRequestGate(consent.maxRequests);

    expect(gate.reserve()).toBe(1);
    expect(gate.reserve()).toBe(2);
    expect(() => gate.reserve()).toThrow('PAID_REQUEST_CAP_REACHED:2');
    expect(gate.used()).toBe(2);
  });

  for (const script of ['enrich-busan.mjs', 'enrich-city-restaurants.mjs']) {
    it(`${script}는 승인 없이 .env를 읽거나 본 작업을 시작하지 않는다`, () => {
      const result = spawnSync(process.execPath, [resolve(process.cwd(), 'scripts', script)], {
        encoding: 'utf8',
        env: { ...process.env, GOOGLE_PLACES_API_KEY: 'must-not-be-used' },
      });

      expect(result.status).toBe(2);
      expect(`${result.stdout}${result.stderr}`).toContain('유료 Google Places 호출은 기본 차단');
    });
  }
});
