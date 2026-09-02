import { describe, expect, it, vi } from 'vitest';
import { main, spawnExitCode } from '../../scripts/owner-controller-release.mjs';
import { main as sourceMain } from '../../scripts/owner-controller-source-build.mjs';

const env = {
  JAVA_HOME: 'jdk', ANDROID_HOME: 'sdk',
  OWNER_KEYSTORE_PASSWORD: 'store-secret', OWNER_KEY_PASSWORD: 'key-secret',
};

describe('Owner Controller release fail-closed 종료 처리', () => {
  it('빌드와 preflight가 모두 정상 종료할 때만 성공한다', () => {
    const spawn = vi.fn()
      .mockReturnValueOnce({ status: 0, signal: null, error: undefined })
      .mockReturnValueOnce({ status: 0, signal: null, error: undefined });
    expect(main({ root: 'repo', env, exists: () => true, spawn })).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls[0][0]).toContain('java');
    expect(spawn.mock.calls[0][1]).toContain('org.gradle.wrapper.GradleWrapperMain');
    expect(spawn.mock.calls[0][2].shell).toBe(false);
  });

  it('공백·셸 메타문자가 있는 경로도 Java 인수 배열로 그대로 전달한다', () => {
    const spawn = vi.fn(() => ({ status: 0, signal: null, error: undefined }));
    const specialEnv = { ...env, JAVA_HOME: 'C:\\JDK & Tools (17)', ANDROID_HOME: 'C:\\Android SDK|36' };
    expect(sourceMain({ root: 'C:\\Owner App (Safe)^', env: specialEnv, exists: () => true, spawn })).toBe(0);
    expect(spawn.mock.calls[0][0]).toContain('C:\\JDK & Tools (17)');
    expect(spawn.mock.calls[0][1].join(' ')).toContain('C:\\Owner App (Safe)^');
    expect(spawn.mock.calls[0][2].shell).toBe(false);
  });

  it('preflight가 신호로 비정상 종료하면 status=null이어도 실패한다', () => {
    const spawn = vi.fn()
      .mockReturnValueOnce({ status: 0, signal: null, error: undefined })
      .mockReturnValueOnce({ status: null, signal: 'SIGTERM', error: undefined });
    expect(main({ root: 'repo', env, exists: () => true, spawn })).toBe(1);
  });

  it('preflight spawn 오류를 성공으로 바꾸지 않는다', () => {
    const spawn = vi.fn()
      .mockReturnValueOnce({ status: 0, signal: null, error: undefined })
      .mockReturnValueOnce({ status: null, signal: null, error: new Error('spawn failed') });
    expect(main({ root: 'repo', env, exists: () => true, spawn })).toBe(1);
    expect(spawnExitCode({ status: 7, signal: null, error: undefined })).toBe(7);
  });
});
