import { describe, expect, it, vi } from 'vitest';
import { main, verifyOwnerApkManifest, verifyOwnerManifestDump } from '../../scripts/owner-controller-manifest-verifier.mjs';

// aapt2 36.0.0 dump xmltree <APK> --file AndroidManifest.xml structure.
const ANDROID = 'http://schemas.android.com/apk/res/android:';
const ACTIVITY = 'com.google.androidbrowserhelper.trusted.ManageDataLauncherActivity';
const KEY = 'android.support.customtabs.trusted.MANAGE_SPACE_URL';
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
      E: application (line=27)
        A: ${ANDROID}allowBackup(0x01010280)=false
          E: activity (line=37)
            A: ${ANDROID}name(0x01010003)="com.cocotrip.owner.OwnerLauncherActivity" (Raw: "com.cocotrip.owner.OwnerLauncherActivity")
            A: ${ANDROID}exported(0x01010010)=true
${MANAGE}
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
