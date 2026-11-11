// Pure response validation only. Never calls an endpoint or reads credentials.
// B-ADM4 requests at most one candidate; legacy write-mode responses must fail.
export function isSafeOnboardingDryRunResponse(status, body) {
  if (status !== 200 || !body || body.ok !== true) return false;
  const result = body.results;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
  return result.dryRun === true
    && result.issued === 0
    && result.alreadyIssued === 0
    && result.errors === 0
    && Number.isInteger(result.candidates)
    && result.candidates >= 0
    && result.candidates <= 1;
}
