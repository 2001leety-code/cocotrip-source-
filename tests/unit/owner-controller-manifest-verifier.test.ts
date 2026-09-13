import { describe, expect, it, vi } from 'vitest';
import { main, verifyOwnerApkManifest, verifyOwnerManifestDump } from '../../scripts/owner-controller-manifest-verifier.mjs';

// aapt2 36.0.0 dump xmltree <APK> --file AndroidManifest.xml structure.
const ANDROID = 'http://schemas.android.com/apk/res/android:';
const ACTIVITY = 'com.google.androidbrowserhelper.trusted.ManageDataLauncherActivity';
const KEY = 'android.support.customtabs.trusted.MANAGE_SPACE_URL';
const POST_NOTIFICATIONS = 'android.permission.POST_NOTIFICATIONS';
const NOTIFICATION_ACTIVITY = 'com.google.androidbrowserhelper.trusted.NotificationPermissionRequestActivity';
const DELEGATION_SERVICE = 'com.google.androidbrowserhelper.trusted.DelegationService';
const DELEGATION_ACTION = 'android.support.customtabs.trusted.TRUSTED_WEB_ACTIVITY_SERVICE';
const LAUNCHER = 'com.cocotrip.owner.OwnerLauncherActivity';
const LAUNCHING_BROWSER = 'android.support.customtabs.trusted.LAUNCHING_BROWSER';
const LAUNCHING_BROWSER_NAME = 'android.support.customtabs.trusted.LAUNCHING_BROWSER_NAME';
const LAUNCHER_METADATA = `              E: meta-data (line=40)
                A: ${ANDROID}name(0x01010003)="${LAUNCHING_BROWSER}" (Raw: "${LAUNCHING_BROWSER}")
                A: ${ANDROID}value(0x01010024)="com.android.chrome" (Raw: "com.android.chrome")
              E: meta-data (line=41)
                A: ${ANDROID}name(0x01010003)="${LAUNCHING_BROWSER_NAME}" (Raw: "${LAUNCHING_BROWSER_NAME}")
                A: ${ANDROID}value(0x01010024)="Chrome" (Raw: "Chrome")`;
const PERMISSION = `      E: uses-permission (line=4)
        A: ${ANDROID}name(0x01010003)="${POST_NOTIFICATIONS}" (Raw: "${POST_NOTIFICATIONS}")`;
const NOTIFICATION = `          E: activity (line=63)
            A: ${ANDROID}name(0x01010003)="${NOTIFICATION_ACTIVITY}" (Raw: "${NOTIFICATION_ACTIVITY}")
            A: ${ANDROID}exported(0x01010010)=false`;
const SERVICE = `          E: service (line=50)
            A: ${ANDROID}name(0x01010003)="${DELEGATION_SERVICE}" (Raw: "${DELEGATION_SERVICE}")
            A: ${ANDROID}exported(0x01010010)=true
              E: intent-filter (line=53)
                E: action (line=54)
                  A: ${ANDROID}name(0x01010003)="${DELEGATION_ACTION}" (Raw: "${DELEGATION_ACTION}")
                E: category (line=56)
                  A: ${ANDROID}name(0x01010003)="android.intent.category.DEFAULT" (Raw: "android.intent.category.DEFAULT")`;
const META = `              E: meta-data (line=46)
                A: ${ANDROID}name(0x01010003)="${KEY}" (Raw: "${KEY}")
                A: ${ANDROID}value(0x01010024)="https://cocotripkr.com" (Raw: "https://cocotripkr.com")`;
const MANAGE = `          E: activity (line=43)
            A: ${ANDROID}name(0x01010003)="${ACTIVITY}" (Raw: "${ACTIVITY}")
            A: ${ANDROID}exported(0x01010010)=false
${META}`;
const DUMP = `N: android=http://schemas.android.com/apk/res/android (line=2)
  E: manifest (line=2)
    A: ${ANDROID}versionCode(0x0101021b)=2
    A: package="com.cocotrip.owner" (Raw: "com.cocotrip.owner")
${PERMISSION}
      E: application (line=27)
        A: ${ANDROID}allowBackup(0x01010280)=false
          E: activity (line=37)
            A: ${ANDROID}name(0x01010003)="${LAUNCHER}" (Raw: "${LAUNCHER}")
            A: ${ANDROID}exported(0x01010010)=true
${LAUNCHER_METADATA}
${MANAGE}
${SERVICE}
${NOTIFICATION}
          E: provider (line=60)
            A: ${ANDROID}name(0x01010003)="androidx.core.content.FileProvider" (Raw: "androidx.core.content.FileProvider")
            A: ${ANDROID}exported(0x01010010)=false
`;

describe('Owner APK compiled Manifest guard', () => {
  it.each([DUMP, DUMP.replaceAll('\n', '\r\n')])('accepts the actual aapt2 hierarchy with LF or CRLF', (dump) => {
    expect(verifyOwnerManifestDump(dump).ok).toBe(true);
  });

  it.each([
    ['old APK without ManageData activity', DUMP.replace(MANAGE, '')],
    ['duplicated activity', DUMP.replace(MANAGE, `${MANAGE}\n${MANAGE}`)],
    ['public activity', DUMP.replace(`${ANDROID}exported(0x01010010)=false\n${META}`, `${ANDROID}exported(0x01010010)=true\n${META}`)],
    ['omitted exported flag', DUMP.replace(`            A: ${ANDROID}exported(0x01010010)=false\n`, '')],
    ['disabled activity', DUMP.replace(META, `            A: ${ANDROID}enabled(0x0101000e)=false\n${META}`)],
    ['intent filter on the private activity', DUMP.replace(META, `${META}\n              E: intent-filter (line=49)\n                  E: action (line=50)\n                    A: ${ANDROID}name(0x01010003)="android.intent.action.VIEW"`)],
    ['other package', DUMP.replaceAll('com.cocotrip.owner', 'com.example.owner')],
    ['missing origin metadata', DUMP.replace(META, '')],
    ['duplicate origin metadata', DUMP.replace(META, `${META}\n${META}`)],
    ['wrong origin', DUMP.replaceAll('https://cocotripkr.com', 'https://example.com')],
    ['path instead of origin', DUMP.replaceAll('https://cocotripkr.com', 'https://cocotripkr.com/admin')],
    ['origin with trailing slash', DUMP.replaceAll('https://cocotripkr.com', 'https://cocotripkr.com/')],
    ['unresolved origin resource', DUMP.replace(`"https://cocotripkr.com" (Raw: "https://cocotripkr.com")`, '@0x7f0d001e')],
    ['resource metadata overriding value', DUMP.replace(META, `${META}\n                A: ${ANDROID}resource(0x01010025)=@0x7f0d001e`)],
    ['metadata on application only', DUMP.replace(META, META.split('\n').map((line) => line.slice(4)).join('\n'))],
    ['metadata on sibling activity only', DUMP.replace(META, `          E: activity (line=48)\n            A: ${ANDROID}name(0x01010003)="other.Activity" (Raw: "other.Activity")\n${META}`)],
    ['activity outside application', DUMP.replace(MANAGE, MANAGE.split('\n').map((line) => line.slice(4)).join('\n'))],
    ['duplicate application', `${DUMP}      E: application (line=90)\n`],
    ['alias instead of real activity', DUMP.replace(MANAGE, MANAGE.replace('E: activity ', 'E: activity-alias '))],
    ['wrong namespace for private flag', DUMP.replace(`${ANDROID}exported(0x01010010)=false\n${META}`, `exported=false\n${META}`)],
    ['duplicate attribute', DUMP.replace(META, `            A: ${ANDROID}exported(0x01010010)=false\n${META}`)],
    ['empty output', ''],
    ['source XML is not compiled APK proof', '<manifest package="com.cocotrip.owner"><application /></manifest>'],
  ])('rejects %s', (_reason, dump) => {
    expect(verifyOwnerManifestDump(dump).ok).toBe(false);
  });

  it.each([
    ['missing POST_NOTIFICATIONS', DUMP.replace(`${PERMISSION}\n`, '')],
    ['duplicate POST_NOTIFICATIONS', DUMP.replace(PERMISSION, `${PERMISSION}\n${PERMISSION}`)],
    ['POST_NOTIFICATIONS under application', DUMP.replace(PERMISSION, '').replace(
      `        A: ${ANDROID}allowBackup(0x01010280)=false`,
      `        A: ${ANDROID}allowBackup(0x01010280)=false\n${PERMISSION.split('\n').map((line) => `    ${line}`).join('\n')}`,
    )],
    ['POST_NOTIFICATIONS max SDK cap', DUMP.replace(PERMISSION, `${PERMISSION}\n        A: ${ANDROID}maxSdkVersion(0x01010271)=32`)],
    ['missing notification permission activity', DUMP.replace(`${NOTIFICATION}\n`, '')],
    ['duplicate notification permission activity', DUMP.replace(NOTIFICATION, `${NOTIFICATION}\n${NOTIFICATION}`)],
    ['notification permission activity outside application', DUMP.replace(NOTIFICATION, NOTIFICATION.split('\n').map((line) => line.slice(4)).join('\n'))],
    ['public notification permission activity', DUMP.replace(NOTIFICATION, NOTIFICATION.replace(')=false', ')=true'))],
    ['disabled notification permission activity', DUMP.replace(NOTIFICATION, `${NOTIFICATION}\n            A: ${ANDROID}enabled(0x0101000e)=false`)],
    ['notification permission activity intent filter', DUMP.replace(NOTIFICATION, `${NOTIFICATION}\n              E: intent-filter (line=66)\n                E: action (line=67)\n                  A: ${ANDROID}name(0x01010003)="android.intent.action.VIEW"`)],
    ['notification permission activity alias', DUMP.replace(NOTIFICATION, `          E: activity-alias (line=63)\n            A: ${ANDROID}name(0x01010003)="${NOTIFICATION_ACTIVITY}" (Raw: "${NOTIFICATION_ACTIVITY}")\n            A: ${ANDROID}targetActivity(0x01010202)="other.Activity" (Raw: "other.Activity")`)],
    ['missing delegation service', DUMP.replace(`${SERVICE}\n`, '')],
    ['duplicate delegation service', DUMP.replace(SERVICE, `${SERVICE}\n${SERVICE}`)],
    ['delegation service outside application', DUMP.replace(SERVICE, SERVICE.split('\n').map((line) => line.slice(4)).join('\n'))],
    ['disabled delegation service', DUMP.replace(SERVICE, `${SERVICE}\n            A: ${ANDROID}enabled(0x0101000e)=false`)],
    ['delegation service permission', DUMP.replace(SERVICE, `${SERVICE}\n            A: ${ANDROID}permission(0x01010006)="android.permission.BIND_JOB_SERVICE"`)],
    ['wrong delegation action', DUMP.replace(DELEGATION_ACTION, 'android.intent.action.VIEW')],
    ['extra delegation filter node', DUMP.replace('                E: category', '                E: data (line=55)\n                E: category')],
  ])('rejects notification integration fault: %s', (_reason, dump) => {
    expect(verifyOwnerManifestDump(dump).ok).toBe(false);
  });

  it.each([
    ['missing Chrome package metadata', DUMP.replace(`              E: meta-data (line=40)\n                A: ${ANDROID}name(0x01010003)="${LAUNCHING_BROWSER}" (Raw: "${LAUNCHING_BROWSER}")\n                A: ${ANDROID}value(0x01010024)="com.android.chrome" (Raw: "com.android.chrome")\n`, '')],
    ['missing Chrome name metadata', DUMP.replace(`              E: meta-data (line=41)\n                A: ${ANDROID}name(0x01010003)="${LAUNCHING_BROWSER_NAME}" (Raw: "${LAUNCHING_BROWSER_NAME}")\n                A: ${ANDROID}value(0x01010024)="Chrome" (Raw: "Chrome")`, '')],
    ['duplicated launcher metadata', DUMP.replace(LAUNCHER_METADATA, `${LAUNCHER_METADATA}\n${LAUNCHER_METADATA}`)],
    ['Samsung Internet replacement', DUMP.replace('com.android.chrome', 'com.sec.android.app.sbrowser')],
    ['other Chrome replacement', DUMP.replace('com.android.chrome', 'com.android.chrome.beta')],
    ['metadata on another activity', DUMP.replace(LAUNCHER_METADATA, `          E: activity (line=42)\n            A: ${ANDROID}name(0x01010003)="other.Activity" (Raw: "other.Activity")\n${LAUNCHER_METADATA}`)],
    ['resource launcher metadata', DUMP.replace(LAUNCHER_METADATA, `${LAUNCHER_METADATA}\n                A: ${ANDROID}resource(0x01010025)=@0x7f0d001e`)],
  ])('rejects launcher Chrome metadata fault: %s', (_reason, dump) => {
    expect(verifyOwnerManifestDump(dump).ok).toBe(false);
  });

  it('uses aapt2 xmltree with a literal APK argument and never a shell', () => {
    const spawn = vi.fn(() => ({ status: 0, stdout: DUMP, stderr: '' }));
    expect(verifyOwnerApkManifest({ aapt2: 'C:\\SDK & Tools\\aapt2.exe', apkPath: 'C:\\Owner & App\\owner(2).apk', env: {}, spawn }).ok).toBe(true);
    expect(spawn).toHaveBeenCalledWith('C:\\SDK & Tools\\aapt2.exe', [
      'dump', 'xmltree', 'C:\\Owner & App\\owner(2).apk', '--file', 'AndroidManifest.xml',
    ], expect.objectContaining({ shell: false, windowsHide: true, encoding: 'utf8' }));
  });

  it.each([
    { status: 1, stdout: DUMP, stderr: 'failed' },
    { status: null, error: { code: 'ENOENT' }, stdout: DUMP },
    { status: 0, stdout: '', stderr: DUMP },
  ])('fails closed on dump failures and does not parse stderr as evidence', (result) => {
    expect(verifyOwnerApkManifest({ aapt2: 'aapt2', apkPath: 'owner.apk', spawn: () => result }).ok).toBe(false);
  });

  it('fails closed on thrown errors without leaking tool output', () => {
    const result = verifyOwnerApkManifest({ aapt2: 'aapt2', apkPath: 'owner.apk', spawn: () => { throw new Error('private path'); } });
    expect(result.ok).toBe(false);
    expect(result.reason).not.toContain('private path');
  });

  it('requires both paths before running the tool', () => {
    const spawn = vi.fn();
    expect(verifyOwnerApkManifest({ apkPath: 'owner.apk', spawn }).ok).toBe(false);
    expect(verifyOwnerApkManifest({ aapt2: 'aapt2', spawn }).ok).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([true, false])('CLI exit status follows the APK result (%s)', (ok) => {
    const verify = vi.fn(() => ({ ok, reason: 'compiled manifest result' }));
    const log = vi.fn();
    expect(main(['node', 'script', '--aapt2', '/sdk/aapt2', '--apk', '/build/owner.apk'], { verify, log })).toBe(ok ? 0 : 1);
    expect(verify).toHaveBeenCalledWith({ aapt2: '/sdk/aapt2', apkPath: '/build/owner.apk' });
    expect(log).toHaveBeenCalledWith(`${ok ? 'PASS' : 'FAIL'}: compiled manifest result`);
  });

  it('CLI rejects missing, swapped or extra arguments', () => {
    const verify = vi.fn();
    for (const args of [[], ['--apk', 'owner.apk', '--aapt2', 'aapt2'], ['--aapt2', 'aapt2', '--apk', 'owner.apk', '--ignore']]) {
      expect(main(['node', 'script', ...args], { verify, log: vi.fn() })).toBe(1);
    }
    expect(verify).not.toHaveBeenCalled();
  });
});
