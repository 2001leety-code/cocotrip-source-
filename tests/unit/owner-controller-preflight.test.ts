import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  auditOwnerControllerReadiness,
  formatOwnerControllerPreflight,
  validateOwnerControllerConfig,
} from '../../scripts/owner-controller-preflight.lib.mjs';

const roots: string[] = [];
const FINGERPRINT = Array.from({ length: 32 }, (_, index) => (index + 1).toString(16).padStart(2, '0').toUpperCase()).join(':');
const RELEASE_FINGERPRINT = 'BC:BA:58:77:80:DD:01:3A:BD:EE:C4:66:C5:19:43:F0:44:DB:9B:00:0B:7E:4E:D6:5B:39:74:6E:F4:C1:07:FE';
const START_URL = '/admin/ai-center';

function write(root: string, relativePath: string, content: string | Uint8Array = '') {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function readyConfig() {
  return {
    schemaVersion: 1,
    toolchainCompatibilitySnapshot: {
      checkedAt: '2026-09-01',
      maximumAgeDays: 30,
      minimumTargetSdk: 36,
      minimumAgpVersion: '8.9.1',
      minimumGradleVersion: '8.11.1',
    },
    web: {
      origin: 'https://cocotripkr.com',
      startUrl: START_URL,
      scope: '/admin/',
      manifestUrl: '/manifest-owner-controller.webmanifest',
    },
    android: {
      wrapper: 'twa',
      sourceDir: 'android-owner',
      packageName: 'com.cocotrip.owner',
      targetSdk: 36,
      versionCode: 1,
      versionName: '1.0.0',
      signingSha256CertificateFingerprints: [FINGERPRINT],
      releaseApkPath: 'android-owner/app/build/outputs/apk/release/app-release.apk',
      twaSigningKeyStore: 'android-owner/local.properties',
    },
  };
}

function readyRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'cocotrip-owner-controller-preflight-'));
  roots.push(root);

  write(root, 'public/manifest-owner-controller.webmanifest', JSON.stringify({
    id: START_URL,
    start_url: START_URL,
    scope: '/admin/',
  }));
  write(root, 'android-owner/build.gradle', `
    plugins {
      id 'com.android.application' version '8.9.1' apply false
    }
  `);
  write(root, 'android-owner/gradle/wrapper/gradle-wrapper.properties', 'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.11.1-bin.zip');
  write(root, 'android-owner/app/build.gradle', `
    plugins { id 'com.android.application' }
    android {
      namespace 'com.cocotrip.owner'
      compileSdk 36
      defaultConfig {
        applicationId 'com.cocotrip.owner'
        minSdk 23
        targetSdk 36
        versionCode 1
        versionName '1.0.0'
      }
    }
    dependencies {
      implementation 'com.google.androidbrowserhelper:androidbrowserhelper:2.7.3'
    }
  `);
  write(root, 'android-owner/app/src/main/AndroidManifest.xml', `
    <manifest>
      <application android:allowBackup="false">
        <activity android:name=".OwnerLauncherActivity">
          <intent-filter>
            <action android:name="android.intent.action.VIEW" />
            <data android:scheme="https" android:host="cocotripkr.com" android:pathPrefix="/admin" />
          </intent-filter>
          <meta-data android:name="android.support.customtabs.trusted.DEFAULT_URL" android:value="https://cocotripkr.com${START_URL}" />
        </activity>
        <meta-data android:name="asset_statements" android:resource="@string/asset_statements" />
      </application>
    </manifest>
  `);
  write(root, 'android-owner/app/src/main/res/values/strings.xml',
    '<resources><string name="app_name">CocoTrip Control</string><string name="asset_statements">[{&quot;target&quot;:{&quot;namespace&quot;:&quot;web&quot;,&quot;site&quot;:&quot;https://cocotripkr.com&quot;}}]</string></resources>');
  write(root, 'android-owner/app/src/main/java/com/cocotrip/owner/OwnerLauncherActivity.java',
    'package com.cocotrip.owner;\npublic final class OwnerLauncherActivity extends com.google.androidbrowserhelper.trusted.LauncherActivity {}');
  write(root, 'android-owner/app/build/outputs/apk/release/app-release.apk', Uint8Array.from([0x50, 0x4b, 0x03, 0x04]));
  write(root, 'android-owner/local.properties', 'storeFile=upload.jks\nkeyAlias=test');
  write(root, 'android-owner/upload.jks', Uint8Array.from([0xfe, 0xed, 0xfe, 0xed]));
  write(root, 'public/.well-known/assetlinks.json', JSON.stringify([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: 'com.cocotrip.owner',
      sha256_cert_fingerprints: [FINGERPRINT],
    },
  }]));
  return root;
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root && root.startsWith(tmpdir())) rmSync(root, { recursive: true, force: true });
  }
});

describe('Owner Controller 설정 정본', () => {
  const verifiedArtifacts = () => ({ keystoreVerified: true, apkVerified: true });

  it('android-owner 모든 깊이의 키와 로컬 서명 설정을 Git에서 제외한다', () => {
    for (const candidate of [
      'android-owner/app/upload.jks',
      'android-owner/app/keys/release.keystore',
      'android-owner/deep/signing/release.p12',
      'android-owner/app/release.pfx',
      'android-owner/app/local.properties',
      'android-owner/app/keystore.properties',
    ]) {
      expect(() => execFileSync('git', ['check-ignore', '-q', candidate], { cwd: process.cwd() })).not.toThrow();
    }
  });
  it('기본 오너 설정은 P1 기준 필수값 누락이 있으면 fail-closed다', () => {
    const config = readyConfig();
    expect(validateOwnerControllerConfig(config).length).toBe(0);
  });

  it('실제 공개 설정과 assetlinks는 같은 오너 패키지와 인증서 지문을 사용한다', () => {
    const config = JSON.parse(readFileSync(path.join(process.cwd(), 'config/owner-controller-release.v1.json'), 'utf8'));
    const assetlinks = JSON.parse(readFileSync(path.join(process.cwd(), 'public/.well-known/assetlinks.json'), 'utf8'));
    const target = assetlinks[0].target;

    expect(config.android.packageName).toBe('com.cocotrip.owner');
    expect(config.android.signingSha256CertificateFingerprints).toEqual([RELEASE_FINGERPRINT]);
    expect(assetlinks[0].relation).toContain('delegate_permission/common.handle_all_urls');
    expect(target).toEqual({
      namespace: 'android_app',
      package_name: config.android.packageName,
      sha256_cert_fingerprints: config.android.signingSha256CertificateFingerprints,
    });
  });

  it('sourceDir이 android-owner가 아니면 거부한다', () => {
    const config = readyConfig();
    config.android.sourceDir = 'android';
    const codes = validateOwnerControllerConfig(config).map((item) => item.code);
    expect(codes).toContain('ANDROID_SOURCE_DIR_MISMATCH');
  });

  it('비어 있거나 동일 바이트 반복인 가짜 서명 지문을 거부한다', () => {
    const missing = readyConfig();
    missing.android.signingSha256CertificateFingerprints = [];
    expect(validateOwnerControllerConfig(missing).map((item) => item.code))
      .toContain('ANDROID_SIGNING_FINGERPRINT_REQUIRED');

    const placeholder = readyConfig();
    placeholder.android.signingSha256CertificateFingerprints = [Array.from({ length: 32 }, () => 'AA').join(':')];
    expect(validateOwnerControllerConfig(placeholder).map((item) => item.code))
      .toContain('ANDROID_SIGNING_FINGERPRINT_PLACEHOLDER');
  });

  it('Groovy 파일에 Kotlin DSL 문법이 섞이면 FAIL 한다', () => {
    const root = readyRoot();
    write(root, 'android-owner/app/build.gradle', 'plugins { id("com.android.application") } val bad = 1');
    const result = auditOwnerControllerReadiness({ root, config: readyConfig(), today: '2026-09-01' });
    expect(result.findings.map((item) => item.code)).toContain('ANDROID_GRADLE_DSL_INVALID');
  });

  it('releaseApkPath가 절대경로면 거부한다', () => {
    const config = readyConfig();
    config.android.releaseApkPath = 'C:\\release\\app-release.apk';
    const codes = validateOwnerControllerConfig(config).map((item) => item.code);
    expect(codes).toContain('RELEASE_APK_PATH_INVALID');
  });

  it('TWA·manifest·assetlinks·APK가 모두 맞을 때만 통과한다', () => {
    const root = readyRoot();
    const config = readyConfig();
    const result = auditOwnerControllerReadiness({ root, config, today: '2026-09-01', artifactVerifier: verifiedArtifacts });
    expect(result).toEqual({ ok: true, findings: [] });
    expect(formatOwnerControllerPreflight(result)).toContain('PASS');
  });

  it('manifest scope 변경 시 FAIL 한다', () => {
    const root = readyRoot();
    write(root, 'public/manifest-owner-controller.webmanifest', JSON.stringify({
      id: START_URL,
      start_url: START_URL,
      scope: '/',
    }));
    const result = auditOwnerControllerReadiness({ root, config: readyConfig(), today: '2026-09-01' });
    expect(result.findings.map((item) => item.code)).toContain('OWNER_MANIFEST_MISMATCH');
  });

  it('존재하지 않는 storeFile과 텍스트 APK를 통과시키지 않는다', () => {
    const root = readyRoot();
    write(root, 'android-owner/local.properties', 'storeFile=missing.jks\nkeyAlias=test');
    write(root, 'android-owner/app/build/outputs/apk/release/app-release.apk', 'dummy');
    const result = auditOwnerControllerReadiness({ root, config: readyConfig(), today: '2026-09-01', artifactVerifier: verifiedArtifacts });
    const codes = result.findings.map((item) => item.code);
    expect(codes).toContain('ANDROID_SIGNING_STOREFILE_NOT_FOUND');
    expect(codes).toContain('RELEASE_APK_INVALID_FORMAT');
  });

  it('키와 APK가 있어도 외부 서명 검증기가 없으면 fail-closed다', () => {
    const result = auditOwnerControllerReadiness({ root: readyRoot(), config: readyConfig(), today: '2026-09-01' });
    expect(result.findings.map((item) => item.code)).toContain('ANDROID_SIGNING_TOOLS_UNAVAILABLE');
  });

  it('package/지문 미일치 assetlinks는 FAIL 한다', () => {
    const root = readyRoot();
    write(root, 'public/.well-known/assetlinks.json', JSON.stringify([{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'com.other.app',
        sha256_cert_fingerprints: [FINGERPRINT],
      },
    }]));
    const result = auditOwnerControllerReadiness({ root, config: readyConfig(), today: '2026-09-01' });
    expect(result.findings.map((item) => item.code)).toContain('ASSETLINKS_MISMATCH');
  });
});
