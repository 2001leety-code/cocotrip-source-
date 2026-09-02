import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function spawnExitCode(result) {
  if (!result || result.error || result.signal || !Number.isInteger(result.status)) return 1;
  return result.status === 0 ? 0 : result.status;
}

export function main(dependencies = {}) {
  const root = dependencies.root || process.cwd();
  const env = dependencies.env || process.env;
  const spawn = dependencies.spawn || spawnSync;
  const exists = dependencies.exists || existsSync;
  const ownerRoot = path.join(root, 'android-owner');
  const wrapperJar = path.join(ownerRoot, 'gradle', 'wrapper', 'gradle-wrapper.jar');
  const javaCommand = path.join(String(env.JAVA_HOME || ''), 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  const fail = (message) => {
    console.error(`[verify-owner-release] FAIL - ${message}`);
    return 1;
  };

  if (!env.JAVA_HOME) return fail('JAVA_HOME이 없습니다. JDK 17을 먼저 준비하세요.');
  if (!env.ANDROID_HOME && !env.ANDROID_SDK_ROOT) return fail('ANDROID_HOME 또는 ANDROID_SDK_ROOT가 없습니다.');
  if (!env.OWNER_KEYSTORE_PASSWORD || !env.OWNER_KEY_PASSWORD) {
    return fail('OWNER_KEYSTORE_PASSWORD와 OWNER_KEY_PASSWORD 환경 변수가 필요합니다.');
  }
  if (!exists(wrapperJar) || !exists(javaCommand)) {
    return fail('Gradle wrapper JAR 또는 JAVA_HOME/bin/java가 없습니다.');
  }

  const build = spawn(javaCommand, ['-classpath', wrapperJar, 'org.gradle.wrapper.GradleWrapperMain', ':app:assembleRelease', '--no-daemon'], {
    cwd: ownerRoot, env, stdio: 'inherit', windowsHide: true, shell: false,
  });
  const buildExit = spawnExitCode(build);
  if (buildExit !== 0) return buildExit;

  const preflight = spawn(process.execPath, ['scripts/owner-controller-preflight.mjs'], {
    cwd: root, env, stdio: 'inherit', windowsHide: true,
  });
  return spawnExitCode(preflight);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exit(main());
