import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/pr-owner-android.yml', 'utf8');
const gradleProperties = readFileSync('android-owner/gradle.properties', 'utf8');

describe('PR Owner Android unsigned compile workflow', () => {
  it('pull_request android-owner 변경에만 최소 읽기 권한으로 실행한다', () => {
    expect(workflow).toMatch(/pull_request:\s*\n\s+paths:/);
    expect(workflow).toContain("- 'android-owner/**'");
    expect(workflow).toMatch(/permissions:\s*\n\s+contents: read/);
    expect(workflow).toContain('timeout-minutes: 20');
    expect(workflow).toContain('cancel-in-progress: true');
  });

  it('요청한 공식 action과 JDK17·basic cache·wrapper validation을 고정한다', () => {
    expect(workflow).toContain('actions/checkout@v4');
    expect(workflow).toContain('actions/setup-java@v6');
    expect(workflow).toContain("java-version: '17'");
    expect(workflow).toContain('gradle/actions/setup-gradle@v6');
    expect(workflow).toContain('cache-provider: basic');
    expect(workflow).toContain('validate-wrappers: true');
  });

  it('Android 36 사전 설치를 확인할 뿐 SDK 설치·라이선스 동의를 하지 않는다', () => {
    expect(workflow).toContain('platforms/android-36');
    expect(workflow).toContain('build-tools/36.0.0/apksigner');
    expect(workflow).not.toContain('sdkmanager');
    expect(workflow).not.toMatch(/\byes\s*\|/);
    expect(workflow).not.toContain('licenses');
  });

  it('assembleVerify 산출물이 존재하고 unsigned인지 확인하며 업로드하지 않는다', () => {
    expect(workflow).toContain('./gradlew :app:assembleVerify --no-daemon');
    expect(workflow).toContain("find \"$APK_DIR\" -maxdepth 1 -type f -name '*.apk' -print");
    expect(workflow).toContain('test "${#APKS[@]}" -eq 1');
    expect(workflow).toContain('APK="${APKS[0]}"');
    expect(workflow).not.toContain('app-verify.apk');
    expect(workflow).toContain('test -s "$APK"');
    expect(workflow).toContain('unzip -tqq "$APK"');
    expect(workflow).toContain("grep -Fq \"package: name='com.cocotrip.owner'\"");
    expect(workflow).toContain('SIGN_STATUS=$?');
    expect(workflow).toContain('if [ "$SIGN_STATUS" -eq 0 ]; then');
    expect(workflow).toContain('test "$SIGN_STATUS" -eq 1');
    expect(workflow).toContain("grep -Fq 'DOES NOT VERIFY'");
    expect(workflow).not.toContain('upload-artifact');
    expect(workflow).not.toMatch(/secrets\./);
  });

  it('AndroidX 의존성 해석에 필요한 단일 Gradle 옵션만 둔다', () => {
    expect(gradleProperties.trim()).toBe('android.useAndroidX=true');
  });

  it('POSIX gradlew는 Git 실행 비트가 잠겨 있다', () => {
    const stage = execFileSync('git', ['ls-files', '--stage', 'android-owner/gradlew'], { encoding: 'utf8' });
    expect(stage).toMatch(/^100755\s/);
    expect(readFileSync('.gitattributes', 'utf8').trim()).toBe('android-owner/gradlew text eol=lf');
  });
});
