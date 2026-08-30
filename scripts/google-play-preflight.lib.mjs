import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const PACKAGE_RE = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){1,}$/;
const SHA256_RE = /^(?:[0-9a-f]{2}:){31}[0-9a-f]{2}$/i;

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
  if (path.posix.isAbsolute(candidate) || path.win32.isAbsolute(candidate)
    || path.win32.parse(candidate).root) return false;
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

function normalizeFingerprint(value) {
  return String(value || '').trim().toUpperCase();
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

function extractApplicationId(gradle) {
  const match = String(gradle || '').match(/applicationId\s*(?:=\s*)?["']([^"']+)["']/);
  return match ? match[1] : '';
}

function extractTargetSdk(gradle) {
  const match = String(gradle || '').match(/targetSdk(?:Version)?\s*(?:=\s*)?(\d+)/);
  return match ? Number(match[1]) : null;
}

export function validateGooglePlayConfig(config, options = {}) {
  const findings = [];
  if (!isPlainObject(config)) return [finding('CONFIG_INVALID', 'config', '설정 JSON 최상위가 객체가 아닙니다.')];
  if (config.schemaVersion !== 1) findings.push(finding('CONFIG_SCHEMA_VERSION', 'config', 'schemaVersion은 1이어야 합니다.'));

  const policy = isPlainObject(config.policySnapshot) ? config.policySnapshot : {};
  if (!Number.isInteger(policy.minimumTargetSdk) || policy.minimumTargetSdk < 1) {
    findings.push(finding('POLICY_TARGET_SDK_INVALID', 'policy', '정책의 minimumTargetSdk가 올바른 정수가 아닙니다.'));
  }
  if (!isIsoDate(policy.checkedAt)) {
    findings.push(finding('POLICY_CHECK_DATE_REQUIRED', 'policy', '정책 확인일 checkedAt이 필요합니다.'));
  }
  const today = isIsoDate(options.today) ? options.today : new Date().toISOString().slice(0, 10);
  if (!Number.isInteger(policy.maximumAgeDays) || policy.maximumAgeDays < 1) {
    findings.push(finding('POLICY_MAXIMUM_AGE_INVALID', 'policy', '정책 유효기간 maximumAgeDays가 올바른 양의 정수가 아닙니다.'));
  } else if (isIsoDate(policy.checkedAt)) {
    const ageDays = daysBetween(policy.checkedAt, today);
    if (ageDays < 0 || ageDays > policy.maximumAgeDays) {
      findings.push(finding('POLICY_SNAPSHOT_STALE', 'policy', `Google Play 정책 확인 기록이 ${policy.maximumAgeDays}일 유효기간을 벗어났습니다.`));
    }
  }
  if (!isIsoDate(policy.effectiveDate)) findings.push(finding('POLICY_EFFECTIVE_DATE_INVALID', 'policy', 'target SDK 정책 시행일이 올바른 날짜가 아닙니다.'));
  if (!String(policy.source || '').startsWith('https://developer.android.com/')) {
    findings.push(finding('POLICY_SOURCE_INVALID', 'policy', 'target SDK 정책은 Android 공식 문서 URL을 사용해야 합니다.'));
  }
  if (!String(policy.twaSource || '').startsWith('https://developer.android.com/')) {
    findings.push(finding('TWA_POLICY_SOURCE_INVALID', 'policy', 'TWA 정책은 Android 공식 문서 URL을 사용해야 합니다.'));
  }
  if (!String(policy.accountDeletionSource || '').startsWith('https://support.google.com/googleplay/')) {
    findings.push(finding('DELETION_POLICY_SOURCE_INVALID', 'policy', '계정 삭제 정책은 Google Play 공식 문서 URL을 사용해야 합니다.'));
  }
  const testingPolicy = isPlainObject(policy.newPersonalAccountClosedTesting)
    ? policy.newPersonalAccountClosedTesting
    : {};
  if (!isIsoDate(testingPolicy.createdAfter) || !Number.isInteger(testingPolicy.minimumTesters)
    || testingPolicy.minimumTesters < 1 || !Number.isInteger(testingPolicy.minimumContinuousDays)
    || testingPolicy.minimumContinuousDays < 1
    || !String(testingPolicy.source || '').startsWith('https://support.google.com/googleplay/')) {
    findings.push(finding('CLOSED_TESTING_POLICY_INVALID', 'policy', '신규 개인 계정 비공개 테스트 정책 정본이 올바르지 않습니다.'));
  }

  const web = isPlainObject(config.web) ? config.web : {};
  if (web.origin !== 'https://cocotripkr.com') findings.push(finding('WEB_ORIGIN_INVALID', 'web', '웹 원본은 https://cocotripkr.com 이어야 합니다.'));
  if (web.startUrl !== '/') findings.push(finding('WEB_START_URL_INVALID', 'web', 'TWA 시작 경로는 현재 PWA 정체성과 같은 / 이어야 합니다.'));
  if (web.manifestUrl !== '/manifest.webmanifest') findings.push(finding('WEB_MANIFEST_URL_INVALID', 'web', 'manifest URL이 /manifest.webmanifest 와 다릅니다.'));
  if (web.privacyPolicyUrl !== '/privacy') findings.push(finding('PRIVACY_URL_INVALID', 'web', '개인정보처리방침 경로가 /privacy 와 다릅니다.'));
  if (web.accountDeletionUrl !== '/account-deletion') findings.push(finding('DELETION_URL_INVALID', 'web', '계정 삭제 요청 경로가 /account-deletion 과 다릅니다.'));

  const android = isPlainObject(config.android) ? config.android : {};
  if (android.wrapper !== 'twa') findings.push(finding('ANDROID_WRAPPER_INVALID', 'android', 'Android 래퍼는 TWA로 명시해야 합니다.'));
  if (!isSafeRelativePath(android.sourceDir)) findings.push(finding('ANDROID_SOURCE_DIR_INVALID', 'android', 'android.sourceDir는 레포 안 상대 경로여야 합니다.'));
  if (typeof android.packageName !== 'string' || !PACKAGE_RE.test(android.packageName)) {
    findings.push(finding('ANDROID_PACKAGE_NAME_REQUIRED', 'operator', '영구 Android package name을 운영자가 확정해야 합니다.'));
  }
  if (!Number.isInteger(android.targetSdk) || android.targetSdk < Number(policy.minimumTargetSdk || 0)) {
    findings.push(finding('ANDROID_TARGET_SDK_TOO_LOW', 'android', `targetSdk는 최소 ${policy.minimumTargetSdk || '정책값'}이어야 합니다.`));
  }
  if (!Number.isInteger(android.versionCode) || android.versionCode < 1) {
    findings.push(finding('ANDROID_VERSION_CODE_REQUIRED', 'android', '양의 정수 versionCode가 필요합니다.'));
  }
  if (typeof android.versionName !== 'string' || !android.versionName.trim()) {
    findings.push(finding('ANDROID_VERSION_NAME_REQUIRED', 'android', 'versionName이 필요합니다.'));
  }
  const fingerprints = Array.isArray(android.playSigningSha256CertificateFingerprints)
    ? android.playSigningSha256CertificateFingerprints.map(normalizeFingerprint)
    : [];
  if (fingerprints.length === 0 || fingerprints.some((value) => !SHA256_RE.test(value))) {
    findings.push(finding('PLAY_SIGNING_FINGERPRINT_REQUIRED', 'operator', 'Play App Signing의 SHA-256 인증서 지문이 필요합니다. 업로드 키 지문으로 대신할 수 없습니다.'));
  }
  if (!isSafeRelativePath(android.releaseBundlePath)) {
    findings.push(finding('RELEASE_BUNDLE_PATH_INVALID', 'android', 'releaseBundlePath는 레포 안 상대 경로여야 합니다.'));
  }

  const account = isPlainObject(config.playDeveloperAccount) ? config.playDeveloperAccount : {};
  if (!['personal', 'organization'].includes(account.type)) {
    findings.push(finding('PLAY_ACCOUNT_TYPE_REQUIRED', 'operator', 'Play 개발자 계정 유형(personal 또는 organization)을 확인해야 합니다.'));
  }
  if (!isIsoDate(account.createdAt)) {
    findings.push(finding('PLAY_ACCOUNT_CREATED_AT_REQUIRED', 'operator', 'Play 개발자 계정 생성일을 YYYY-MM-DD로 확인해야 합니다.'));
  } else if (account.type === 'personal' && isIsoDate(testingPolicy.createdAfter)
    && account.createdAt > testingPolicy.createdAfter) {
    const testing = isPlainObject(account.closedTesting) ? account.closedTesting : {};
    if (testing.completed !== true || !Number.isInteger(testing.testerCount)
      || testing.testerCount < testingPolicy.minimumTesters
      || !Number.isInteger(testing.continuousDays)
      || testing.continuousDays < testingPolicy.minimumContinuousDays) {
      findings.push(finding('CLOSED_TESTING_NOT_COMPLETE', 'play-console', `신규 개인 계정은 최소 ${testingPolicy.minimumTesters}명·연속 ${testingPolicy.minimumContinuousDays}일 비공개 테스트 완료 확인이 필요합니다.`));
    }
  }

  const listing = isPlainObject(config.storeListing) ? config.storeListing : {};
  if (!isSafeRelativePath(listing.appIcon512Path)) findings.push(finding('STORE_ICON_REQUIRED', 'store-listing', '전용 512x512 Play 아이콘 경로가 필요합니다.'));
  if (!isSafeRelativePath(listing.featureGraphic1024x500Path)) findings.push(finding('FEATURE_GRAPHIC_REQUIRED', 'store-listing', '1024x500 특성 그래픽 경로가 필요합니다.'));
  if (!Array.isArray(listing.phoneScreenshotPaths) || listing.phoneScreenshotPaths.length < 2
    || listing.phoneScreenshotPaths.some((item) => !isSafeRelativePath(item))) {
    findings.push(finding('PHONE_SCREENSHOTS_REQUIRED', 'store-listing', '유효한 휴대전화 스크린샷 경로가 최소 2개 필요합니다.'));
  }

  const declarations = isPlainObject(config.manualDeclarations) ? config.manualDeclarations : {};
  const declarationLabels = {
    accountDeletionProcessApproved: '계정 삭제 처리 절차 승인',
    dataSafetyCompleted: 'Data safety 신고',
    adsDeclarationCompleted: '광고 포함 여부 신고',
    contentRatingCompleted: '콘텐츠 등급 설문',
    targetAudienceCompleted: '대상 연령 신고',
    reviewAccessPrepared: '검토자 접근 안내',
  };
  for (const [key, label] of Object.entries(declarationLabels)) {
    if (declarations[key] !== true) {
      findings.push(finding(`MANUAL_${key.replace(/([A-Z])/g, '_$1').toUpperCase()}`, 'play-console', `${label}가 완료되지 않았습니다.`));
    }
  }
  return findings;
}

export function auditGooglePlayReadiness({ root = process.cwd(), config, today }) {
  const findings = [...validateGooglePlayConfig(config, { today })];
  if (!isPlainObject(config)) return { ok: false, findings };

  const vite = readText(root, 'vite.config.ts');
  const app = readText(root, 'src/App.tsx');
  const myPage = readText(root, 'src/pages/MyPage.tsx');
  const footer = readText(root, 'src/sections/Footer.tsx');
  if (!vite || !/VitePWA\s*\(/.test(vite) || !/strategies:\s*['"]injectManifest['"]/.test(vite)
    || !/filename:\s*['"]sw\.ts['"]/.test(vite) || !/display:\s*['"]standalone['"]/.test(vite)
    || !/id:\s*['"]\/['"]/.test(vite) || !/start_url:\s*['"]\/['"]/.test(vite)
    || !/scope:\s*['"]\/['"]/.test(vite)) {
    findings.push(finding('PWA_MANIFEST_CONTRACT_MISSING', 'web', '현재 PWA의 injectManifest·standalone·/, start_url·scope 계약을 확인할 수 없습니다.'));
  }
  for (const file of ['src/sw.ts', 'public/icons/icon-192.png', 'public/icons/icon-512.png']) {
    if (!fileExists(root, file)) findings.push(finding('PWA_ASSET_MISSING', 'web', `${file} 파일이 없습니다.`));
  }
  if (!app || !app.includes('path="/account-deletion"') || !fileExists(root, 'src/pages/AccountDeletion.tsx')) {
    findings.push(finding('ACCOUNT_DELETION_ROUTE_MISSING', 'web', '공개 /account-deletion 화면이 앱 라우트에 연결되지 않았습니다.'));
  }
  if (!myPage || !myPage.includes("to: '/account-deletion'")) {
    findings.push(finding('IN_APP_DELETION_PATH_MISSING', 'web', '마이페이지 계정 영역에서 삭제 요청 화면으로 가는 링크가 없습니다.'));
  }
  if (!footer || !footer.includes("to: '/account-deletion'")) {
    findings.push(finding('PUBLIC_DELETION_LINK_MISSING', 'web', '로그아웃 상태에서도 찾을 수 있는 하단 계정 삭제 요청 링크가 없습니다.'));
  }

  const android = isPlainObject(config.android) ? config.android : {};
  const sourceDir = isSafeRelativePath(android.sourceDir) ? android.sourceDir : 'android';
  const gradlePath = path.join(sourceDir, 'app', 'build.gradle');
  const gradleKtsPath = path.join(sourceDir, 'app', 'build.gradle.kts');
  const gradle = readText(root, gradlePath) || readText(root, gradleKtsPath);
  const manifest = readText(root, path.join(sourceDir, 'app', 'src', 'main', 'AndroidManifest.xml'));
  if (!gradle || !manifest) {
    findings.push(finding('ANDROID_WRAPPER_MISSING', 'android', 'TWA Android 프로젝트(build.gradle + AndroidManifest.xml)가 없습니다.'));
  } else {
    const applicationId = extractApplicationId(gradle);
    if (!applicationId || applicationId !== android.packageName) {
      findings.push(finding('ANDROID_PACKAGE_MISMATCH', 'android', 'Android applicationId가 설정 정본의 packageName과 다릅니다.'));
    }
    const targetSdk = extractTargetSdk(gradle);
    if (!targetSdk || targetSdk !== android.targetSdk) {
      findings.push(finding('ANDROID_TARGET_SDK_MISMATCH', 'android', 'Android build.gradle targetSdk가 설정 정본과 다릅니다.'));
    }
  }

  const fingerprints = Array.isArray(android.playSigningSha256CertificateFingerprints)
    ? android.playSigningSha256CertificateFingerprints.map(normalizeFingerprint)
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
        const certs = Array.isArray(target.sha256_cert_fingerprints)
          ? target.sha256_cert_fingerprints.map(normalizeFingerprint)
          : [];
        return relations.includes('delegate_permission/common.handle_all_urls')
          && target.namespace === 'android_app'
          && target.package_name === android.packageName
          && fingerprints.length > 0
          && fingerprints.every((fingerprint) => certs.includes(fingerprint));
      });
      if (!matched) findings.push(finding('ASSETLINKS_MISMATCH', 'web', 'assetlinks가 packageName과 Play App Signing SHA-256 지문을 함께 증명하지 못합니다.'));
    } catch {
      findings.push(finding('ASSETLINKS_INVALID_JSON', 'web', 'assetlinks.json이 유효한 JSON이 아닙니다.'));
    }
  }

  if (isSafeRelativePath(android.releaseBundlePath) && !fileExists(root, android.releaseBundlePath)) {
    findings.push(finding('RELEASE_BUNDLE_MISSING', 'android', '제출할 release AAB 산출물이 없습니다.'));
  }
  const listing = isPlainObject(config.storeListing) ? config.storeListing : {};
  for (const [code, value] of [
    ['STORE_ICON_FILE_MISSING', listing.appIcon512Path],
    ['FEATURE_GRAPHIC_FILE_MISSING', listing.featureGraphic1024x500Path],
  ]) {
    if (isSafeRelativePath(value) && !fileExists(root, value)) findings.push(finding(code, 'store-listing', `${value} 파일이 없습니다.`));
  }
  if (Array.isArray(listing.phoneScreenshotPaths)) {
    for (const value of listing.phoneScreenshotPaths) {
      if (isSafeRelativePath(value) && !fileExists(root, value)) findings.push(finding('PHONE_SCREENSHOT_FILE_MISSING', 'store-listing', `${value} 파일이 없습니다.`));
    }
  }

  return { ok: findings.length === 0, findings };
}

export function loadGooglePlayConfig(root = process.cwd(), relativePath = 'config/google-play-release.v1.json') {
  const raw = readText(root, relativePath);
  if (!raw) throw new Error(`${relativePath} 파일이 없습니다.`);
  return JSON.parse(raw);
}

export function formatGooglePlayPreflight(result) {
  if (result.ok) return '[google-play-preflight] PASS - 제출 전 점검 항목이 모두 충족됐습니다.';
  return [
    `[google-play-preflight] FAIL - ${result.findings.length}개 준비 항목이 남았습니다.`,
    ...result.findings.map((item) => `- [${item.area}] ${item.code}: ${item.message}`),
  ].join('\n');
}
