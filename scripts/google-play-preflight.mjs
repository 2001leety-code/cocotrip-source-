import { pathToFileURL } from 'node:url';
import {
  auditGooglePlayReadiness,
  formatGooglePlayPreflight,
  loadGooglePlayConfig,
} from './google-play-preflight.lib.mjs';

export function main(argv = process.argv) {
  const root = process.cwd();
  const configPath = argv[2] || 'config/google-play-release.v1.json';
  try {
    const config = loadGooglePlayConfig(root, configPath);
    const result = auditGooglePlayReadiness({ root, config });
    const report = formatGooglePlayPreflight(result);
    if (result.ok) console.log(report);
    else console.error(report);
    return result.ok ? 0 : 1;
  } catch (error) {
    console.error(`[google-play-preflight] FAIL - ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  process.exit(main());
}
