import { pathToFileURL } from 'node:url';
import {
  auditOwnerControllerReadiness,
  formatOwnerControllerPreflight,
  loadOwnerControllerConfig,
} from './owner-controller-preflight.lib.mjs';
import { createOwnerArtifactVerifier } from './owner-controller-artifact-verifier.mjs';

export function main(argv = process.argv, dependencies = {}) {
  const root = dependencies.root || process.cwd();
  const configPath = argv[2] || 'config/owner-controller-release.v1.json';
  try {
    const loadConfig = dependencies.loadConfig || loadOwnerControllerConfig;
    const audit = dependencies.audit || auditOwnerControllerReadiness;
    const config = loadConfig(root, configPath);
    const artifactVerifier = dependencies.artifactVerifier || createOwnerArtifactVerifier();
    const result = audit({ root, config, today: new Date().toISOString().slice(0, 10), artifactVerifier });
    const report = formatOwnerControllerPreflight(result);
    if (result.ok) console.log(report);
    else console.error(report);
    return result.ok ? 0 : 1;
  } catch (error) {
    console.error(`[owner-controller-preflight] FAIL - ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  process.exit(main());
}
