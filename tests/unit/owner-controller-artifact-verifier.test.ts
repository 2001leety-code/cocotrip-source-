import { describe, expect, it, vi } from 'vitest';
import { createOwnerArtifactVerifier } from '../../scripts/owner-controller-artifact-verifier.mjs';
import { main } from '../../scripts/owner-controller-preflight.mjs';

const FINGERPRINT = Array.from({ length: 32 }, (_, index) => (index + 1).toString(16).padStart(2, '0').toUpperCase()).join(':');
const HEX_FINGERPRINT = FINGERPRINT.replaceAll(':', '').toLowerCase();
const MANIFEST = `  E: manifest (line=2)
    A: package="com.cocotrip.owner" (Raw: "com.cocotrip.owner")
      E: application (line=27)
          E: activity (line=43)
            A: http://schemas.android.com/apk/res/android:name(0x01010003)="com.google.androidbrowserhelper.trusted.ManageDataLauncherActivity"
            A: http://schemas.android.com/apk/res/android:exported(0x01010010)=false
              E: meta-data (line=46)
                A: http://schemas.android.com/apk/res/android:name(0x01010003)="android.support.customtabs.trusted.MANAGE_SPACE_URL"
                A: http://schemas.android.com/apk/res/android:value(0x01010024)="https://cocotripkr.com"
`;

describe('Owner Controller 실제 서명 검증기', () => {
  it('도구나 비밀번호 환경 변수가 없으면 fail-closed다', () => {
    const verifier = createOwnerArtifactVerifier({
      env: {},
      spawn: vi.fn(() => ({ error: { code: 'ENOENT' }, status: null, stdout: '', stderr: '' })),
    });
    expect(verifier({ keystorePath: 'x', apkPath: 'y', packageName: 'com.cocotrip.owner', fingerprints: [FINGERPRINT], keyAlias: 'owner' }))
      .toEqual({ toolsAvailable: false, keystoreVerified: false, apkVerified: false });
  });

  it('키 지문·APK 지문·packageName·병합 Manifest가 모두 일치해야 통과한다', () => {
    const spawn = vi.fn((tool: string, args: string[]) => {
      if (tool.includes('keytool')) return { status: 0, stdout: `SHA256: ${FINGERPRINT}`, stderr: '' };
      if (args.includes('-jar')) return { status: 0, stdout: `Signer #1 certificate SHA-256 digest: ${HEX_FINGERPRINT}`, stderr: '' };
      if (args.includes('xmltree')) return { status: 0, stdout: MANIFEST, stderr: '' };
      return { status: 0, stdout: "package: name='com.cocotrip.owner'", stderr: '' };
    });
    const tools = {
      java: 'C:\\Program Files\\Java & Safe\\java.exe',
      keytool: 'C:\\Program Files\\Java & Safe\\keytool.exe',
      apksignerJar: 'C:\\Android SDK\\build-tools\\36.0.0\\lib\\apksigner.jar',
      aapt2: 'C:\\Android SDK\\build-tools\\36.0.0\\aapt2.exe',
    };
    const verifier = createOwnerArtifactVerifier({ env: { OWNER_KEYSTORE_PASSWORD: 'secret' }, spawn, tools });
    const result = verifier({ keystorePath: 'C:\\Owner & Keys\\owner(1).jks', apkPath: 'C:\\Owner & APK\\owner|verify.apk', packageName: 'com.cocotrip.owner', fingerprints: [FINGERPRINT], keyAlias: 'owner^key' });
    expect(result).toEqual({ toolsAvailable: true, keystoreVerified: true, apkVerified: true });
    expect(spawn.mock.calls.flatMap((call) => call[1])).not.toContain('secret');
    expect(spawn.mock.calls.every((call) => call[2].shell === false)).toBe(true);
    expect(spawn.mock.calls[1][0]).toBe(tools.java);
    expect(spawn.mock.calls[1][1]).toContain(tools.apksignerJar);
    expect(spawn.mock.calls[1][1]).toContain('C:\\Owner & APK\\owner|verify.apk');
    expect(spawn.mock.calls[3][1]).toEqual(['dump', 'xmltree', 'C:\\Owner & APK\\owner|verify.apk', '--file', 'AndroidManifest.xml']);
  });

  it.each(['missing-manifest', 'dump-failure', 'wrong-package', 'wrong-signature', 'signer-failure', 'badging-failure'])('APK guard rejects %s even if the other evidence passes', (failure) => {
    const spawn = vi.fn((tool: string, args: string[]) => {
      if (tool === 'keytool') return { status: 0, stdout: `SHA256: ${FINGERPRINT}`, stderr: '' };
      if (args.includes('-jar')) return { status: failure === 'signer-failure' ? 1 : 0, stdout: `Signer #1 certificate SHA-256 digest: ${failure === 'wrong-signature' ? '00'.repeat(32) : HEX_FINGERPRINT}`, stderr: '' };
      if (args.includes('xmltree')) return { status: failure === 'dump-failure' ? 1 : 0, stdout: failure === 'missing-manifest' ? '' : MANIFEST, stderr: '' };
      return { status: failure === 'badging-failure' ? 1 : 0, stdout: `package: name='${failure === 'wrong-package' ? 'com.other' : 'com.cocotrip.owner'}'`, stderr: '' };
    });
    const verifier = createOwnerArtifactVerifier({
      env: { OWNER_KEYSTORE_PASSWORD: 'secret' }, spawn,
      tools: { java: 'java', keytool: 'keytool', apksignerJar: 'apksigner.jar', aapt2: 'aapt2' },
    });
    expect(verifier({ keystorePath: 'owner.jks', apkPath: 'owner.apk', packageName: 'com.cocotrip.owner', fingerprints: [FINGERPRINT], keyAlias: 'owner' }))
      .toEqual({ toolsAvailable: true, keystoreVerified: true, apkVerified: false });
  });

  it('CLI가 생성된 artifactVerifier를 감사 함수에 전달한다', () => {
    const artifactVerifier = vi.fn();
    const audit = vi.fn(({ artifactVerifier: received }) => {
      expect(received).toBe(artifactVerifier);
      return { ok: true, findings: [] };
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(main(['node', 'preflight'], { root: 'repo', loadConfig: () => ({}), audit, artifactVerifier })).toBe(0);
    expect(audit).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});
