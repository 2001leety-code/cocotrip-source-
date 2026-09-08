import { readOwnerNotificationConfig } from './owner-notification-policy.js';

/**
 * Configuration inspection only: no SDK, account/subscription read or dispatch.
 * Never spread the policy result: its configured branch contains private values.
 * OFF must remain OFF; do not inject an enabled flag to inspect missing settings.
 */
export function readOwnerDispatchReadiness(env = {}) {
  let state = 'unknown';
  try {
    const config = readOwnerNotificationConfig(env);
    if (config.ok === true && config.enabled === false && config.code === 'DISABLED') state = 'off';
    else if (config.ok === true && config.enabled === true && config.code === 'CONFIGURED') state = 'configured';
    else if (config.ok === false && config.enabled === false
      && ['CONFIGURATION_REQUIRED', 'PRODUCTION_REQUIRED'].includes(config.code)) state = 'configuration_required';
  } catch { /* Do not expose environment values or exception text. */ }
  return { state, deliveryVerified: false };
}
