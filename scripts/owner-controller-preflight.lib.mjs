import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const PACKAGE_RE = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){1,}$/;
const SHA256_RE = /^(?:[0-9a-f]{2}:){31}[0-9a-f]{2}$/i;

const OWNER_PACKAGE = 'com.cocotrip.owner';
const OWNER_ORIGIN = 'https://cocotripkr.com';
const OWNER_START_URL = '/admin/ai-center';
const OWNER_SCOPE = '/admin/';
const OWNER_MANIFEST = '/manifest-owner-controller.webmanifest';
const OWNER_SOURCE_DIR = 'android-owner';
const OWNER_RELEASE_APK = 'android-owner/app/build/outputs/apk/release/app-release.apk';

function finding(code, area, message) {
  return { code, area, message };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSafeRelativePath(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const candidate = value.trim();
  if (candidate.includes('\0')) return false;
  if (path.posix.isAbsolute(candidate) || path.win32.isAbsolute(candidate) || path.win32.parse(candidate).root) return false;
  const normalized = path.posix.normalize(candidate.replaceAll('\\', '/'));
  return normalized !== '..' && !normalized.startsWith('../');
}

function readText(root, relativePath) {
  if (!isSafeRelativePath(relativePath)) return null;
  const file = path.resolve(root, relativePath);
  const rootWithSeparator = `${path.resolve(root)}${path.sep}`;
  if (!file.startsWith(rootWithSeparator) || !existsSync(file) || !statSync(file).isFile()) return null;
  return readFileSync(file, 'utf8');
}

function fileExists(root, relativePath) {
  if (!isSafeRelativePath(relativePath)) return false;
  const file = path.resolve(root, relativePath);
  const rootWithSeparator = `${path.resolve(root)}${path.sep}`;
  return file.startsWith(rootWithSeparator) && existsSync(file) && statSync(file).isFile();
}

function hasApkZipMagic(root, relativePath) {
  if (!fileExists(root, relativePath)) return false;
  const file = path.resolve(root, relativePath);
  const content = readFileSync(file);
  return content.length >= 4 && content[0] === 0x50 && content[1] === 0x4b;
}

function normalizeFingerprint(value) {
  return String(value || '').trim().toUpperCase();
}

function isPlaceholderFingerprint(value) {
  if (!SHA256_RE.test(value)) return true;
  const bytes = value.split(':');
  return bytes.every((byte) => byte === bytes[0]) || bytes.every((byte) => byte === '00' || byte === 'AA');
}

function isIsoDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

function daysBetween(from, to) {
  return Math.floor((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86400000);
}

function extractPackageFromGradle(text) {
  const match = String(text || '').match(/applicationId\s*(?:=\s*)?["']([^"']+)["']/);
  return match ? match[1] : '';
}

function extractTargetSdkFromGradle(text) {
  const match = String(text || '').match(/targetSdk(?:Version)?\s*(?:=\s*)?(\d+)/);
  return match ? Number(match[1]) : null;
}

function parseProperties(content) {
  const out = {};
  for (const rawLine of String(content || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    out[key] = value;
  }
  return out;
}

export function validateOwnerControllerConfig(config, options = {}) {
  const findings = [];
  if (!isPlainObject(config)) {
    findings.push(finding('CONFIG_INVALID', 'config', '설정 JSON 최상위가 객체가 아닙니다.'));
    return findings;
  }

  if (config.schemaVersion !== 1) {
    findings.push(finding('CONFIG_SCHEMA_VERSION', 'config', 'schemaVersion은 1이어야 합니다.'));
  }

  const policy = isPlainObject(config.toolchainCompatibilitySnapshot) ? config.toolchainCompatibilitySnapshot : {};
  if (!isIsoDate(policy.checkedAt)) {
    findings.push(finding('TOOLCHAIN_CHECK_DATE_REQUIRED', 'toolchain', '도구 호환표 확인일 checkedAt이 필요합니다.'));
  }

  if (!Number.isInteger(policy.minimumTargetSdk) || policy.minimumTargetSdk < 1) {
    findings.push(finding('TOOLCHAIN_TARGET_SDK_INVALID', 'toolchain', 'minimumTargetSdk가 유효하지 않습니다.'));
  } else if (isIsoDate(policy.checkedAt)) {
    const now = isIsoDate(options.today) ? options.today : new Date().toISOString().slice(0, 10);
    const maxAge = Number(policy.maximumAgeDays);
    const age = daysBetween(policy.checkedAt, now);
    if (!Number.isInteger(maxAge) || maxAge <= 0 || age < 0 || age > maxAge) {
      findings.push(finding('TOOLCHAIN_SNAPSHOT_STALE', 'toolchain', 'Android 도구 호환 스냅샷이 갱신 주기를 벗어났습니다.'));
    }
  }
  if (policy.minimumAgpVersion !== '8.9.1' || policy.minimumGradleVersion !== '8.11.1') {
    findings.push(finding('TOOLCHAIN_VERSION_INVALID', 'toolchain', 'API 36 호환 기준은 AGP 8.9.1과 Gradle 8.11.1이어야 합니다.'));
  }

  const web = isPlainObject(config.web) ? config.web : {};
  if (web.origin !== OWNER_ORIGIN) {
    findings.push(finding('WEB_ORIGIN_INVALID', 'web', '오너 TWA의 웹 원본은 https://cocotripkr.com 이어야 합니다.'));
  }
  if (web.startUrl !== OWNER_START_URL) {
    findings.push(finding('WEB_START_URL_INVALID', 'web', '오너 TWA 시작 경로는 /admin/ai-center로 고정되어야 합니다.'));
  }
  if (web.scope !== OWNER_SCOPE) {
    findings.push(finding('WEB_SCOPE_INVALID', 'web', '오너 TWA scope는 /admin/로 설정해야 관리자 링크가 앱 안에서 열립니다.'));
  }
  if (web.manifestUrl !== OWNER_MANIFEST) {
    findings.push(finding('WEB_MANIFEST_URL_INVALID', 'web', '오너 web manifest 경로가 /manifest-owner-controller.webmanifest여야 합니다.'));
  }

  const android = isPlainObject(config.android) ? config.android : {};
  if (android.wrapper !== 'twa') {
    findings.push(finding('ANDROID_WRAPPER_INVALID', 'android', 'Android 래퍼는 TWA로 명시해야 합니다.'));
  }
  if (android.sourceDir !== OWNER_SOURCE_DIR) {
    findings.push(finding('ANDROID_SOURCE_DIR_MISMATCH', 'android', 'android-source는 android-owner로 고정되어야 합니다.'));
  } else if (!isSafeRelativePath(android.sourceDir)) {
    findings.push(finding('ANDROID_SOURCE_DIR_INVALID', 'android', 'android-source 경로가 유효하지 않습니다.'));
  }

  if (android.packageName !== OWNER_PACKAGE) {
    findings.push(finding('ANDROID_PACKAGE_NAME_INVALID', 'android', 'packageName은 com.cocotrip.owner 여야 합니다.'));
  } else if (!PACKAGE_RE.test(android.packageName)) {
    findings.push(finding('ANDROID_PACKAGE_NAME_INVALID', 'android', 'packageName 형식이 Android 규칙과 맞지 않습니다.'));
  }

  if (!Number.isInteger(android.targetSdk) || android.targetSdk < Number(policy.minimumTargetSdk || 0)) {
    findings.push(finding('ANDROID_TARGET_SDK_TOO_LOW', 'android', 'targetSdk가 정책 최소값보다 작습니다.'));
  }
  if (!Number.isInteger(android.versionCode) || android.versionCode < 1) {
    findings.push(finding('ANDROID_VERSION_CODE_REQUIRED', 'android', 'versionCode는 1 이상 정수여야 합니다.'));
  }
  if (typeof android.versionName !== 'string' || !android.versionName.trim()) {
    findings.push(finding('ANDROID_VERSION_NAME_REQUIRED', 'android', 'versionName이 비어 있습니다.'));
  }

  const fingerprints = Array.isArray(android.signingSha256CertificateFingerprints)
    ? android.signingSha256CertificateFingerprints.map(normalizeFingerprint)
    : [];
  if (fingerprints.length === 0) {
    findings.push(finding('ANDROID_SIGNING_FINGERPRINT_REQUIRED', 'android', '실제 sideload 서명 인증서의 SHA-256 지문이 필요합니다.'));
  } else if (fingerprints.some(isPlaceholderFingerprint)) {
    findings.push(finding('ANDROID_SIGNING_FINGERPRINT_PLACEHOLDER', 'android', '00/AA 반복값 또는 동일 바이트 반복값은 실제 서명 지문으로 인정하지 않습니다.'));
  }

  if (!isSafeRelativePath(android.releaseApkPath || '')) {
    findings.push(finding('RELEASE_APK_PATH_INVALID', 'android', 'releaseApkPath가 유효한 상대 경로여야 합니다.'));
  }
  if (!isSafeRelativePath(android.twaSigningKeyStore || '')) {
    findings.push(finding('ANDROID_KEYSTORE_PATH_INVALID', 'android', 'twaSigningKeyStore가 유효한 상대 경로여야 합니다.'));
  }

  return findings;
}

export function auditOwnerControllerReadiness({ root = process.cwd(), config, today, artifactVerifier }) {
  const findings = [...validateOwnerControllerConfig(config, { today })];
  if (!isPlainObject(config)) return { ok: false, findings };

  const ownerManifest = readText(root, 'public/manifest-owner-controller.webmanifest');
  if (!ownerManifest) {
    findings.push(finding('OWNER_MANIFEST_MISSING', 'web', 'manifest-owner-controller.webmanifest 파일이 없습니다.'));
  } else {
    try {
      const parsed = JSON.parse(ownerManifest);
      if (parsed.start_url !== OWNER_START_URL || parsed.scope !== OWNER_SCOPE) {
        findings.push(finding('OWNER_MANIFEST_MISMATCH', 'web', '오너 web manifest의 start_url/scope가 TWA 계약과 다릅니다.'));
      }
      if (typeof parsed.id !== 'string' || !parsed.id) {
        findings.push(finding('OWNER_MANIFEST_CONTRACT_MISSING', 'web', 'manifest.id 계약이 없습니다.'));
      }
    } catch {
      findings.push(finding('OWNER_MANIFEST_INVALID_JSON', 'web', 'manifest-owner-controller.webmanifest 형식이 JSON이 아닙니다.'));
    }
  }

  const android = isPlainObject(config.android) ? config.android : {};
  const sourceDir = isSafeRelativePath(android.sourceDir) ? android.sourceDir : OWNER_SOURCE_DIR;
  const rootGradlePath = path.join(sourceDir, 'build.gradle');
  const wrapperPropertiesPath = path.join(sourceDir, 'gradle', 'wrapper', 'gradle-wrapper.properties');
  const gradlePath = path.join(sourceDir, 'app', 'build.gradle');
  const manifestPath = path.join(sourceDir, 'app', 'src', 'main', 'AndroidManifest.xml');
  const launcherPath = path.join(sourceDir, 'app', 'src', 'main', 'java', 'com', 'cocotrip', 'owner', 'OwnerLauncherActivity.java');
  const stringsPath = path.join(sourceDir, 'app', 'src', 'main', 'res', 'values', 'strings.xml');
  const rootGradle = readText(root, rootGradlePath);
  const wrapperProperties = readText(root, wrapperPropertiesPath);
  const gradle = readText(root, gradlePath);
  const manifest = readText(root, manifestPath);
  const launcher = readText(root, launcherPath);
  const strings = readText(root, stringsPath);
  if (!rootGradle || !gradle || !manifest || !launcher || !strings) {
    findings.push(finding('ANDROID_WRAPPER_MISSING', 'android', 'TWA Android 핵심 소스(Gradle, Manifest, Launcher, strings)가 없습니다.'));
  } else {
    if (!/com\.android\.application['"]?\s+version\s+['"]8\.9\.1['"]/.test(rootGradle)) {
      findings.push(finding('ANDROID_AGP_VERSION_INVALID', 'android', 'API 36 오너 앱은 Android Gradle Plugin 8.9.1을 사용해야 합니다.'));
    }
    if (!wrapperProperties || !wrapperProperties.includes('gradle-8.11.1-bin.zip')) {
      findings.push(finding('ANDROID_GRADLE_WRAPPER_INVALID', 'android', 'Gradle wrapper 설정은 8.11.1이어야 합니다.'));
    }
    const kotlinDslInGroovy = /\bid\s*\(|\bval\s+|\bisMinifyEnabled\b|\bgetByName\s*\(/;
    if (kotlinDslInGroovy.test(rootGradle) || kotlinDslInGroovy.test(gradle)) {
      findings.push(finding('ANDROID_GRADLE_DSL_INVALID', 'android', '.gradle 파일에 Kotlin DSL 문법이 섞여 있습니다.'));
    }
    const applicationId = extractPackageFromGradle(gradle);
    if (applicationId !== android.packageName) {
      findings.push(finding('ANDROID_PACKAGE_MISMATCH', 'android', 'build.gradle의 applicationId가 설정 정본과 다릅니다.'));
    }
    const targetSdk = extractTargetSdkFromGradle(gradle);
    if (targetSdk !== android.targetSdk) {
      findings.push(finding('ANDROID_TARGET_SDK_MISMATCH', 'android', 'build.gradle의 targetSdk가 설정 정본과 다릅니다.'));
    }
    if (!/com\.google\.androidbrowserhelper:androidbrowserhelper:2\.7\.3/.test(gradle)) {
      findings.push(finding('ANDROID_BROWSER_HELPER_MISSING', 'android', 'android-browser-helper 의존성이 build.gradle에 없습니다.'));
    }
    if (!manifest.includes('android.support.customtabs.trusted.DEFAULT_URL')
      || !manifest.includes(`https://cocotripkr.com${OWNER_START_URL}`)) {
      findings.push(finding('ANDROID_DEFAULT_URL_MISSING', 'android', 'LauncherActivity 메타데이터 DEFAULT_URL가 고정 URL로 설정되지 않았습니다.'));
    }
    if (!manifest.includes('.OwnerLauncherActivity')
      || !launcher.includes('class OwnerLauncherActivity')
      || !launcher.includes('extends com.google.androidbrowserhelper.trusted.LauncherActivity')) {
      findings.push(finding('ANDROID_LAUNCHER_ACTIVITY_MISSING', 'android', 'Manifest와 OwnerLauncherActivity 상속 계약이 일치하지 않습니다.'));
    }
    if (!/android:allowBackup=["']false["']/.test(manifest)) {
      findings.push(finding('ANDROID_BACKUP_NOT_DISABLED', 'android', '오너 앱은 allowBackup=false여야 합니다.'));
    }
    const dataTags = manifest.match(/<data\b[^>]*>/g) || [];
    const dataTag = dataTags[0] || '';
    if (dataTags.length !== 1 || !/android:scheme=["']https["']/.test(dataTag)
      || !/android:host=["']cocotripkr\.com["']/.test(dataTag)
      || !/android:pathPrefix=["']\/admin["']/.test(dataTag)) {
      findings.push(finding('ANDROID_HTTPS_INTENT_FILTER_INVALID', 'android', 'VIEW intent-filter에는 https+cocotripkr.com+/admin 단일 data만 허용됩니다.'));
    }
    if (!/<application[\s\S]*?<meta-data[\s\S]*?android:name=["']asset_statements["'][\s\S]*?android:resource=["']@string\/asset_statements["']/.test(manifest)
      || !strings.includes('name="app_name"')
      || !strings.includes('name="asset_statements"')
      || !strings.includes('&quot;namespace&quot;:&quot;web&quot;')
      || !strings.includes('&quot;site&quot;:&quot;https://cocotripkr.com&quot;')) {
      findings.push(finding('ANDROID_ASSET_STATEMENTS_INVALID', 'android', 'application의 asset_statements 또는 web origin strings 리소스가 올바르지 않습니다.'));
    }
  }

  const localPropertiesPath = path.join(sourceDir, 'local.properties');
  const localProperties = readText(root, localPropertiesPath);
  let signingStorePath = '';
  let signingKeyAlias = '';
  if (!localProperties) {
    findings.push(finding('ANDROID_LOCAL_PROPERTIES_MISSING', 'android', 'android-owner/local.properties가 없습니다.'));
  } else {
    const props = parseProperties(localProperties);
    if (!props.storeFile) {
      findings.push(finding('ANDROID_SIGNING_STOREFILE_MISSING', 'android', 'android-owner/local.properties에 storeFile이 없습니다.'));
    } else if (!isSafeRelativePath(props.storeFile)) {
      findings.push(finding('ANDROID_SIGNING_STOREFILE_PATH_INVALID', 'android', 'storeFile은 android-owner 기준의 안전한 상대 경로여야 합니다.'));
    } else {
      signingStorePath = path.join(sourceDir, props.storeFile);
      if (!fileExists(root, signingStorePath)) {
        findings.push(finding('ANDROID_SIGNING_STOREFILE_NOT_FOUND', 'android', 'local.properties가 가리키는 실제 서명키 파일이 없습니다.'));
      }
    }
    if (!props.keyAlias) {
      findings.push(finding('ANDROID_SIGNING_KEY_ALIAS_MISSING', 'android', 'android-owner/local.properties에 keyAlias가 없습니다.'));
    } else {
      signingKeyAlias = props.keyAlias;
    }
    if (props.storePassword || props.keyPassword) {
      findings.push(finding('ANDROID_SIGNING_SECRET_IN_PROPERTIES', 'android', '서명 비밀번호는 local.properties가 아닌 OWNER_KEYSTORE_PASSWORD/OWNER_KEY_PASSWORD 환경 변수에만 둬야 합니다.'));
    }
  }

  const fingerprintSet = Array.isArray(android.signingSha256CertificateFingerprints)
    ? android.signingSha256CertificateFingerprints.map(normalizeFingerprint).filter((value) => !isPlaceholderFingerprint(value))
    : [];
  const assetlinks = readText(root, 'public/.well-known/assetlinks.json');
  if (!assetlinks) {
    findings.push(finding('ASSETLINKS_MISSING', 'web', 'public/.well-known/assetlinks.json이 없습니다.'));
  } else {
    try {
      const statements = JSON.parse(assetlinks);
      const matched = Array.isArray(statements) && statements.some((statement) => {
        const target = isPlainObject(statement) && isPlainObject(statement.target) ? statement.target : {};
        const relations = Array.isArray(statement.relation) ? statement.relation : [];
        const certs = Array.isArray(target.sha256_cert_fingerprints) ? target.sha256_cert_fingerprints.map(normalizeFingerprint) : [];
        return (
          relations.includes('delegate_permission/common.handle_all_urls')
          && target.namespace === 'android_app'
          && target.package_name === android.packageName
          && fingerprintSet.length > 0
          && fingerprintSet.every((fingerprint) => certs.includes(fingerprint))
        );
      });
      if (!matched) findings.push(finding('ASSETLINKS_MISMATCH', 'web', 'assetlinks가 packageName·SHA-256을 동시에 증명하지 못합니다.'));
    } catch {
      findings.push(finding('ASSETLINKS_INVALID_JSON', 'web', 'assetlinks.json이 유효한 JSON이 아닙니다.'));
    }
  }

  const releaseApkPath = isSafeRelativePath(android.releaseApkPath || '')
    ? android.releaseApkPath
    : OWNER_RELEASE_APK;
  if (!fileExists(root, releaseApkPath)) {
    findings.push(finding('RELEASE_APK_MISSING', 'android', 'release APK가 없습니다.'));
  } else if (!hasApkZipMagic(root, releaseApkPath)) {
    findings.push(finding('RELEASE_APK_INVALID_FORMAT', 'android', 'release APK가 ZIP/APK 형식이 아니거나 비어 있습니다.'));
  }

  const artifactsExist = signingStorePath && fileExists(root, signingStorePath) && hasApkZipMagic(root, releaseApkPath);
  if (artifactsExist) {
    if (typeof artifactVerifier !== 'function') {
      findings.push(finding('ANDROID_SIGNING_TOOLS_UNAVAILABLE', 'android', 'keytool/apksigner 검증기가 없어 키 alias·인증서 지문·APK 서명을 확인하지 못했습니다.'));
    } else {
      const verification = artifactVerifier({
        root: path.resolve(root),
        keystorePath: path.resolve(root, signingStorePath),
        apkPath: path.resolve(root, releaseApkPath),
        packageName: android.packageName,
        fingerprints: fingerprintSet,
        keyAlias: signingKeyAlias,
      });
      if (!verification || verification.toolsAvailable === false) {
        findings.push(finding('ANDROID_SIGNING_TOOLS_UNAVAILABLE', 'android', 'keytool/apksigner/aapt2 또는 서명 비밀번호 환경 변수가 없어 검증하지 못했습니다.'));
      } else if (verification.keystoreVerified !== true) {
        findings.push(finding('ANDROID_KEYSTORE_VERIFICATION_FAILED', 'android', '키 alias와 인증서 SHA-256 검증에 실패했습니다.'));
      }
      if (verification && verification.toolsAvailable !== false && verification.apkVerified !== true) {
        findings.push(finding('ANDROID_APK_VERIFICATION_FAILED', 'android', 'APK 서명과 packageName 검증에 실패했습니다.'));
      }
    }
  }

  return { ok: findings.length === 0, findings };
}

export function loadOwnerControllerConfig(root = process.cwd(), relativePath = 'config/owner-controller-release.v1.json') {
  const raw = readText(root, relativePath);
  if (!raw) throw new Error(`${relativePath} 파일이 없습니다.`);
  return JSON.parse(raw);
}

export function formatOwnerControllerPreflight(result) {
  if (result.ok) return '[owner-controller-preflight] PASS - 오너 TWA sideload 점검 PASS';
  return [
    `[owner-controller-preflight] FAIL - ${result.findings.length}개 항목이 남았습니다.`,
    ...result.findings.map((item) => `- [${item.area}] ${item.code}: ${item.message}`),
  ].join('\n');
}
