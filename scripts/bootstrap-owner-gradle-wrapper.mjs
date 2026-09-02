import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const VERSION = '8.11.1';
const DISTRIBUTION_URL = `https://services.gradle.org/distributions/gradle-${VERSION}-bin.zip`;
const DISTRIBUTION_SHA256 = 'f397b287023acdba1e9f6fc5ea72d22dd63669d59ed4a289a29b1a76eee151c6';

if (!process.env.JAVA_HOME) {
  console.error('[owner-wrapper] FAIL - JAVA_HOME이 필요합니다. JDK를 자동 설치하지 않습니다.');
  process.exit(1);
}
if (process.platform !== 'win32') {
  console.error('[owner-wrapper] FAIL - 이 안전 부트스트랩은 현재 Windows PowerShell만 지원합니다.');
  process.exit(1);
}

const ownerRoot = path.resolve('android-owner');
const tempRoot = mkdtempSync(path.join(tmpdir(), 'cocotrip-gradle-wrapper-'));
const zipPath = path.join(tempRoot, `gradle-${VERSION}-bin.zip`);
const extractPath = path.join(tempRoot, 'distribution');
const response = await fetch(DISTRIBUTION_URL, { redirect: 'follow' });
if (!response.ok) throw new Error(`공식 Gradle 배포물 다운로드 실패: HTTP ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
const digest = createHash('sha256').update(bytes).digest('hex');
if (digest !== DISTRIBUTION_SHA256) throw new Error('공식 Gradle 배포물 SHA-256이 일치하지 않습니다.');
writeFileSync(zipPath, bytes);

const expand = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:OWNER_GRADLE_ZIP -DestinationPath $env:OWNER_GRADLE_EXTRACT'], {
  env: { ...process.env, OWNER_GRADLE_ZIP: zipPath, OWNER_GRADLE_EXTRACT: extractPath },
  stdio: 'inherit', windowsHide: true,
});
if (expand.status !== 0) process.exit(expand.status || 1);

const javaCommand = path.join(process.env.JAVA_HOME, 'bin', 'java.exe');
const gradleLauncher = path.join(extractPath, `gradle-${VERSION}`, 'lib', `gradle-launcher-${VERSION}.jar`);
if (!existsSync(javaCommand) || !existsSync(gradleLauncher)) throw new Error('JAVA_HOME/bin/java.exe 또는 검증된 Gradle launcher JAR가 없습니다.');
const wrapper = spawnSync(javaCommand, ['-classpath', gradleLauncher, 'org.gradle.launcher.GradleMain', 'wrapper', '--gradle-version', VERSION, '--distribution-type', 'bin'], {
  cwd: ownerRoot, env: process.env, stdio: 'inherit', windowsHide: true, shell: false,
});
if (wrapper.status !== 0 || wrapper.error || wrapper.signal) process.exit(wrapper.status || 1);
const propertiesPath = path.join(ownerRoot, 'gradle', 'wrapper', 'gradle-wrapper.properties');
const properties = readFileSync(propertiesPath, 'utf8');
const pinned = properties.includes('distributionSha256Sum=')
  ? properties.replace(/^distributionSha256Sum=.*$/m, `distributionSha256Sum=${DISTRIBUTION_SHA256}`)
  : `${properties.trimEnd()}\ndistributionSha256Sum=${DISTRIBUTION_SHA256}\n`;
writeFileSync(propertiesPath, pinned);
process.exit(0);
