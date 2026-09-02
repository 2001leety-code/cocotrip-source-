import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(file, 'utf8');

describe('Owner Controller Android 브랜드·빌드 소스', () => {
  it('공개 브랜드 아이콘 원본을 Android launcher 자산에 그대로 재사용한다', () => {
    const digest = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
    expect(digest('android-owner/app/src/main/res/drawable-nodpi/owner_brand_icon.png'))
      .toBe(digest('public/brand/icon-1024.png'));
    const manifest = read('android-owner/app/src/main/AndroidManifest.xml');
    expect(manifest).toContain('android:icon="@mipmap/ic_launcher"');
    expect(manifest).toContain('android:roundIcon="@mipmap/ic_launcher_round"');
    expect(manifest).toContain('android:theme="@style/Theme.CocoTripOwner"');
  });

  it('브랜드 색상·앱 테마와 adaptive launcher icon을 제공한다', () => {
    expect(read('android-owner/app/src/main/res/values/colors.xml')).toContain('#111318');
    expect(read('android-owner/app/src/main/res/values/themes.xml')).toContain('Theme.CocoTripOwner');
    expect(read('android-owner/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml')).toContain('<adaptive-icon');
    expect(read('android-owner/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml')).toContain('<adaptive-icon');
  });

  it('키 없는 verify 빌드와 서명 필수 release 빌드를 분리한다', () => {
    const gradle = read('android-owner/app/build.gradle');
    expect(gradle).toMatch(/verify\s*\{[\s\S]*?initWith release[\s\S]*?signingConfig null/);
    expect(gradle).toMatch(/release\s*\{[\s\S]*?signingConfig signingConfigs\.release/);
    expect(read('scripts/owner-controller-source-build.mjs')).toContain(':app:assembleVerify');
    expect(read('scripts/owner-controller-release.mjs')).toContain(':app:assembleRelease');
    expect(read('scripts/owner-controller-release.mjs')).toContain('owner-controller-preflight.mjs');
  });

  it('Google Maven에 실제 배포된 ABH 안정 좌표와 호환 minSdk를 사용한다', () => {
    const gradle = read('android-owner/app/build.gradle');
    expect(gradle).toContain("implementation 'com.google.androidbrowserhelper:androidbrowserhelper:2.7.3'");
    expect(gradle).toContain('minSdk 23');
    expect(gradle).not.toContain('android-browser-helper');
    expect(gradle).not.toContain("androidx.browser:browser:1.8.0");
  });

  it('wrapper는 공식 Gradle 8.11.1 URL과 배포 SHA-256에 고정된다', () => {
    const properties = read('android-owner/gradle/wrapper/gradle-wrapper.properties');
    expect(properties).toContain('gradle-8.11.1-bin.zip');
    expect(properties).toContain('distributionSha256Sum=f397b287023acdba1e9f6fc5ea72d22dd63669d59ed4a289a29b1a76eee151c6');
    const bootstrap = read('scripts/bootstrap-owner-gradle-wrapper.mjs');
    expect(bootstrap).toContain('https://services.gradle.org/distributions/');
    expect(bootstrap).toContain('createHash(\'sha256\')');
  });
});
