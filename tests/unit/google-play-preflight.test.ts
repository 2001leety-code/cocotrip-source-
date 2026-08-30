import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  auditGooglePlayReadiness,
  formatGooglePlayPreflight,
  validateGooglePlayConfig,
} from '../../scripts/google-play-preflight.lib.mjs';

const roots: string[] = [];
const FINGERPRINT = Array.from({ length: 32 }, () => 'AA').join(':');

function write(root: string, relativePath: string, content = '') {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function readyConfig() {
  return {
    schemaVersion: 1,
    policySnapshot: {
      checkedAt: '2026-08-30',
      maximumAgeDays: 30,
      minimumTargetSdk: 36,
      effectiveDate: '2026-08-31',
      source: 'https://developer.android.com/google/play/requirements/target-sdk',
      twaSource: 'https://developer.android.com/develop/ui/views/layout/webapps/trusted-web-activities',
      accountDeletionSource: 'https://support.google.com/googleplay/android-developer/answer/13327111?hl=en',
      newPersonalAccountClosedTesting: {
        createdAfter: '2023-11-13',
        minimumTesters: 12,
        minimumContinuousDays: 14,
        source: 'https://support.google.com/googleplay/android-developer/answer/14151465?hl=en',
      },
    },
    web: {
      origin: 'https://cocotripkr.com',
      startUrl: '/',
      manifestUrl: '/manifest.webmanifest',
      privacyPolicyUrl: '/privacy',
      accountDeletionUrl: '/account-deletion',
    },
    android: {
      wrapper: 'twa',
      sourceDir: 'android',
      packageName: 'com.cocotrip.app',
      targetSdk: 36,
      versionCode: 1,
      versionName: '1.0.0',
      playSigningSha256CertificateFingerprints: [FINGERPRINT],
      releaseBundlePath: 'android/app/build/outputs/bundle/release/app-release.aab',
    },
    playDeveloperAccount: {
      type: 'organization',
      createdAt: '2026-08-01',
      closedTesting: { completed: null, testerCount: null, continuousDays: null },
    },
    storeListing: {
      appIcon512Path: 'public/play/icon-512.png',
      featureGraphic1024x500Path: 'public/play/feature-1024x500.png',
      phoneScreenshotPaths: ['public/play/phone-1.png', 'public/play/phone-2.png'],
    },
    manualDeclarations: {
      accountDeletionProcessApproved: true,
      dataSafetyCompleted: true,
      adsDeclarationCompleted: true,
      contentRatingCompleted: true,
      targetAudienceCompleted: true,
      reviewAccessPrepared: true,
    },
  };
}

function readyRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'cocotrip-play-preflight-'));
  roots.push(root);
  write(root, 'vite.config.ts', `
    VitePWA({
      strategies: 'injectManifest', filename: 'sw.ts',
      manifest: { id: '/', start_url: '/', display: 'standalone', scope: '/' }
    })
  `);
  write(root, 'src/sw.ts', 'self.addEventListener("install", () => {});');
  write(root, 'public/icons/icon-192.png');
  write(root, 'public/icons/icon-512.png');
  write(root, 'src/App.tsx', '<Route path="/account-deletion" element={<AccountDeletion />} />');
  write(root, 'src/pages/AccountDeletion.tsx', 'export default function AccountDeletion() { return null; }');
  write(root, 'src/pages/MyPage.tsx', "const item = { to: '/account-deletion' };");
  write(root, 'src/sections/Footer.tsx', "const item = { to: '/account-deletion' };");
  write(root, 'android/app/build.gradle', `android { defaultConfig { applicationId "com.cocotrip.app" targetSdk 36 } }`);
  write(root, 'android/app/src/main/AndroidManifest.xml', '<manifest package="com.cocotrip.app" />');
  write(root, 'android/app/build/outputs/bundle/release/app-release.aab');
  write(root, 'public/.well-known/assetlinks.json', JSON.stringify([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: 'com.cocotrip.app',
      sha256_cert_fingerprints: [FINGERPRINT],
    },
  }]));
  for (const file of ['public/play/icon-512.png', 'public/play/feature-1024x500.png', 'public/play/phone-1.png', 'public/play/phone-2.png']) write(root, file);
  return root;
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root && root.startsWith(tmpdir())) rmSync(root, { recursive: true, force: true });
  }
});

describe('Google Play 설정 정본', () => {
  it('현재 레포 설정은 운영자 입력이 비어 있어 fail-closed다', () => {
    const config = JSON.parse(readFileSync(path.join(process.cwd(), 'config/google-play-release.v1.json'), 'utf8'));
    const codes = validateGooglePlayConfig(config).map((item) => item.code);
    expect(codes).toContain('ANDROID_PACKAGE_NAME_REQUIRED');
    expect(codes).toContain('PLAY_SIGNING_FINGERPRINT_REQUIRED');
    expect(codes).toContain('PLAY_ACCOUNT_TYPE_REQUIRED');
    expect(codes).toContain('STORE_ICON_REQUIRED');
    expect(codes).toContain('MANUAL_DATA_SAFETY_COMPLETED');
  });

  it('레포 밖 sourceDir와 AAB 경로를 거부한다', () => {
    const config = readyConfig();
    config.android.sourceDir = '../android';
    config.android.releaseBundlePath = 'C:\\release\\app.aab';
    const codes = validateGooglePlayConfig(config).map((item) => item.code);
    expect(codes).toContain('ANDROID_SOURCE_DIR_INVALID');
    expect(codes).toContain('RELEASE_BUNDLE_PATH_INVALID');
  });

  it('TWA·PWA·assetlinks·AAB·스토어 파일이 모두 맞을 때만 통과한다', () => {
    const result = auditGooglePlayReadiness({ root: readyRoot(), config: readyConfig(), today: '2026-08-30' });
    expect(result).toEqual({ ok: true, findings: [] });
    expect(formatGooglePlayPreflight(result)).toContain('PASS');
  });

  it('assetlinks의 package 또는 Play Signing 지문이 다르면 실패한다', () => {
    const root = readyRoot();
    write(root, 'public/.well-known/assetlinks.json', JSON.stringify([{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: 'com.other.app', sha256_cert_fingerprints: [FINGERPRINT] },
    }]));
    const result = auditGooglePlayReadiness({ root, config: readyConfig(), today: '2026-08-30' });
    expect(result.findings.map((item) => item.code)).toContain('ASSETLINKS_MISMATCH');
  });

  it('2023-11-13 이후 개인 계정은 12명·14일 완료가 아니면 막는다', () => {
    const config = readyConfig();
    config.playDeveloperAccount.type = 'personal';
    config.playDeveloperAccount.createdAt = '2023-11-14';
    config.playDeveloperAccount.closedTesting = { completed: true, testerCount: 11, continuousDays: 14 };
    expect(validateGooglePlayConfig(config, { today: '2026-08-30' }).map((item) => item.code)).toContain('CLOSED_TESTING_NOT_COMPLETE');

    config.playDeveloperAccount.closedTesting = { completed: true, testerCount: 12, continuousDays: 14 };
    expect(validateGooglePlayConfig(config, { today: '2026-08-30' }).map((item) => item.code)).not.toContain('CLOSED_TESTING_NOT_COMPLETE');
  });

  it('정책 확인 기록이 30일을 넘으면 다시 공식 문서를 확인할 때까지 막는다', () => {
    const config = readyConfig();
    expect(validateGooglePlayConfig(config, { today: '2026-09-30' }).map((item) => item.code))
      .toContain('POLICY_SNAPSHOT_STALE');
  });
});
