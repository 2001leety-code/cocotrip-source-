// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  exposeBuildIdentifier,
  exposeNavigationDiagnostic,
  injectBuildIdentifierIntoHtml,
  normalizeNavigationType,
  normalizeBuildIdentifier,
  resolveBuildIdentifier,
} from '../../src/lib/buildIdentity';

describe('공개 빌드 식별자', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-cocotrip-build');
    document.documentElement.removeAttribute('data-cocotrip-navigation');
    document.head.querySelector('meta[name="cocotrip-build"]')?.remove();
  });

  it('Vercel SHA를 우선하고 GitHub SHA를 안전한 fallback으로 쓴다', () => {
    expect(resolveBuildIdentifier({
      VERCEL_GIT_COMMIT_SHA: 'ABCDEF1234567',
      GITHUB_SHA: '1111111111111',
    })).toBe('abcdef1234567');
    expect(resolveBuildIdentifier({ GITHUB_SHA: 'ABCDEF7654321' })).toBe('abcdef7654321');
  });

  it('누락되거나 SHA가 아닌 값은 local로 닫는다', () => {
    expect(normalizeBuildIdentifier(undefined)).toBe('local');
    expect(normalizeBuildIdentifier('build-<script>')).toBe('local');
    expect(normalizeBuildIdentifier('abc123')).toBe('local');
  });

  it('최종 HTML에도 앱 실행 전 읽을 수 있는 data 속성과 meta를 넣는다', () => {
    const first = injectBuildIdentifierIntoHtml(
      '<!doctype html><html lang="ko"><head><title>CocoTrip</title></head><body></body></html>',
      'ABCDEF1234567',
    );
    const second = injectBuildIdentifierIntoHtml(first, '2222222222222');

    expect(second).toContain('<html data-cocotrip-build="2222222222222" lang="ko">');
    expect(second).toContain('<meta name="cocotrip-build" content="2222222222222">');
    expect(second).toContain('document.documentElement.dataset.cocotripNavigation=value');
    expect(second.match(/name="cocotrip-build"/g)).toHaveLength(1);
    expect(second.match(/dataset\.cocotripNavigation=value/g)).toHaveLength(1);
  });

  it('navigation type은 허용된 공개 진단값으로만 정규화한다', () => {
    expect(normalizeNavigationType('navigate')).toBe('navigate');
    expect(normalizeNavigationType('reload')).toBe('reload');
    expect(normalizeNavigationType('back_forward')).toBe('back_forward');
    expect(normalizeNavigationType('prerender')).toBe('prerender');
    expect(normalizeNavigationType('restore')).toBe('unknown');
    expect(normalizeNavigationType(undefined)).toBe('unknown');
  });

  it('performance navigation 값을 html data 속성으로만 노출한다', () => {
    exposeNavigationDiagnostic(document, {
      getEntriesByType: () => [{ type: 'reload' }],
    });

    expect(document.documentElement.dataset.cocotripNavigation).toBe('reload');
    expect(document.body.textContent).toBe('');
  });

  it('navigation API가 실패하면 unknown으로 닫는다', () => {
    exposeNavigationDiagnostic(document, {
      getEntriesByType: () => { throw new Error('blocked'); },
    });
    expect(document.documentElement.dataset.cocotripNavigation).toBe('unknown');
  });

  it('화면 글자 없이 html data 속성과 meta에 같은 값을 노출한다', () => {
    exposeBuildIdentifier(document, 'ABCDEF1234567');

    expect(document.documentElement.dataset.cocotripBuild).toBe('abcdef1234567');
    expect(document.head.querySelector('meta[name="cocotrip-build"]')?.getAttribute('content'))
      .toBe('abcdef1234567');
    expect(document.body.textContent).toBe('');
  });

  it('기존 meta가 있으면 중복 없이 갱신한다', () => {
    exposeBuildIdentifier(document, '1111111111111');
    exposeBuildIdentifier(document, '2222222222222');

    expect(document.head.querySelectorAll('meta[name="cocotrip-build"]')).toHaveLength(1);
    expect(document.head.querySelector('meta[name="cocotrip-build"]')?.getAttribute('content'))
      .toBe('2222222222222');
  });
});
