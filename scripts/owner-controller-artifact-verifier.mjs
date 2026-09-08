import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyOwnerApkManifest } from './owner-controller-manifest-verifier.mjs';

function discoverTools(env) {
  const javaHome = String(env.JAVA_HOME || '');
  const sdkRoot = String(env.ANDROID_HOME || env.ANDROID_SDK_ROOT || '');
  const java = path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  const keytool = path.join(javaHome, 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool');
  const buildTools = path.join(sdkRoot, 'build-tools');
  if (!javaHome || !sdkRoot || !existsSync(java) || !existsSync(keytool) || !existsSync(buildTools)) return null;
  const versions = readdirSync(buildTools, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const version of versions) {
    const directory = path.join(buildTools, version);
    const apksignerJar = path.join(directory, 'lib', 'apksigner.jar');
    const aapt2 = path.join(directory, process.platform === 'win32' ? 'aapt2.exe' : 'aapt2');
    if (existsSync(apksignerJar) && existsSync(aapt2)) return { java, keytool, apksignerJar, aapt2 };
  }
  return null;
}

function run(command, args, env, spawn) {
  return spawn(command, args, {
    encoding: 'utf8', env: { ...env, LC_ALL: 'C', LANG: 'C' }, windowsHide: true, shell: false,
  });
}

function normalizeFingerprint(value) {
  const hex = String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  return hex.length === 64 ? hex.match(/.{2}/g).join(':') : '';
}

/** Compare actual compiled APK metadata, not only the checked-out Gradle sources. */
export function matchesOwnerApkVersion(output, { versionCode, versionName } = {}) {
  if (!Number.isSafeInteger(versionCode) || versionCode < 1 || typeof versionName !== 'string' || !versionName.trim()) return false;
  const packages = String(output || '').split(/\r?\n/).filter(line => /^package:\s/.test(line));
  if (packages.length !== 1) return false;
  const codes = [...packages[0].matchAll(/(?:^|\s)versionCode='([^']*)'/g)];
  const names = [...packages[0].matchAll(/(?:^|\s)versionName='([^']*)'/g)];
  return codes.length === 1 && names.length === 1
    && /^\d+$/.test(codes[0][1]) && Number(codes[0][1]) === versionCode
    && names[0][1] === versionName;
}

export function createOwnerArtifactVerifier({ env = process.env, spawn = spawnSync, tools } = {}) {
  return ({ keystorePath, apkPath, packageName, fingerprints, keyAlias, versionCode, versionName }) => {
    const resolved = tools || discoverTools(env);
    if (!resolved || !env.OWNER_KEYSTORE_PASSWORD || !keyAlias) {
      return { toolsAvailable: false, keystoreVerified: false, apkVerified: false };
    }

    const keyResult = run(resolved.keytool, [
      '-list', '-v', '-keystore', keystorePath, '-alias', keyAlias,
      '-storepass:env', 'OWNER_KEYSTORE_PASSWORD',
    ], env, spawn);
    const keyOutput = `${keyResult.stdout || ''}\n${keyResult.stderr || ''}`;
    const keyFingerprint = normalizeFingerprint(keyOutput.match(/SHA-?256\s*:\s*([0-9A-F:]+)/i)?.[1]);

    const signerResult = run(resolved.java, ['-jar', resolved.apksignerJar, 'verify', '--print-certs', apkPath], env, spawn);
    const signerOutput = `${signerResult.stdout || ''}\n${signerResult.stderr || ''}`;
    const apkFingerprint = normalizeFingerprint(signerOutput.match(/certificate SHA-256 digest:\s*([0-9a-f]+)/i)?.[1]);

    const packageResult = run(resolved.aapt2, ['dump', 'badging', apkPath], env, spawn);
    const packageOutput = `${packageResult.stdout || ''}\n${packageResult.stderr || ''}`;
    const apkPackage = packageOutput.match(/package:\s+name='([^']+)'/)?.[1] || '';
    const manifestResult = verifyOwnerApkManifest({ aapt2: resolved.aapt2, apkPath, env, spawn });
    const expected = new Set(fingerprints || []);
    return {
      toolsAvailable: true,
      keystoreVerified: keyResult.status === 0 && expected.has(keyFingerprint),
      apkVerified: signerResult.status === 0 && packageResult.status === 0
        && expected.has(apkFingerprint) && apkPackage === packageName && manifestResult.ok
        && matchesOwnerApkVersion(packageOutput, { versionCode, versionName }),
    };
  };
}
