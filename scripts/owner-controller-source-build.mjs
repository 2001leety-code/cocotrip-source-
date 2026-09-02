import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { spawnExitCode } from './owner-controller-release.mjs';

export function main(dependencies = {}) {
  const root = dependencies.root || process.cwd();
  const env = dependencies.env || process.env;
  const exists = dependencies.exists || existsSync;
  const spawn = dependencies.spawn || spawnSync;
  const ownerRoot = path.join(root, 'android-owner');
  const wrapperJar = path.join(ownerRoot, 'gradle', 'wrapper', 'gradle-wrapper.jar');
  const javaCommand = path.join(String(env.JAVA_HOME || ''), 'bin', process.platform === 'win32' ? 'java.exe' : 'java');

  if (!env.JAVA_HOME || (!env.ANDROID_HOME && !env.ANDROID_SDK_ROOT)) return 1;
  if (!exists(wrapperJar) || !exists(javaCommand)) return 1;
  const result = spawn(javaCommand, ['-classpath', wrapperJar, 'org.gradle.wrapper.GradleWrapperMain', ':app:assembleVerify', '--no-daemon'], {
    cwd: ownerRoot, env, stdio: 'inherit', windowsHide: true, shell: false,
  });
  return spawnExitCode(result);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exit(main());
