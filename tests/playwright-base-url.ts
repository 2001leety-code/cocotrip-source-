const LOCAL_DEFAULT_BASE_URL = 'http://127.0.0.1:5173';

/** CI 오설정이 운영 사이트 자동 방문으로 바뀌지 않게 BASE_URL을 fail-closed로 푼다. */
export function resolvePlaywrightBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = String(env.BASE_URL || '').trim();
  if (configured) return configured;

  if (String(env.CI || '').trim()) {
    throw new Error('CI Playwright 실행에는 BASE_URL이 반드시 필요합니다. 운영 URL로 자동 대체하지 않습니다.');
  }

  return LOCAL_DEFAULT_BASE_URL;
}
