const ACK_FLAG = '--allow-paid-google-places';
const MAX_FLAG = '--max-paid-requests=';
const ABSOLUTE_MAX_REQUESTS = 100;

export function parsePaidGooglePlacesConsent(args = []) {
  const acknowledged = args.includes(ACK_FLAG);
  const maxRaw = (args.find((arg) => arg.startsWith(MAX_FLAG)) || '').slice(MAX_FLAG.length);
  const maxRequests = Number(maxRaw) || 0;

  if (!acknowledged || !Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > ABSOLUTE_MAX_REQUESTS) {
    throw new Error(
      `유료 Google Places 호출은 기본 차단입니다. 실행하려면 ${ACK_FLAG}와 ` +
      `${MAX_FLAG}1..${ABSOLUTE_MAX_REQUESTS}를 함께 지정하세요.`,
    );
  }

  return { maxRequests };
}

export function createPaidRequestGate(maxRequests) {
  let usedRequests = 0;

  return {
    reserve() {
      if (usedRequests >= maxRequests) {
        throw new Error(`PAID_REQUEST_CAP_REACHED:${maxRequests}`);
      }
      usedRequests += 1;
      return usedRequests;
    },
    used() {
      return usedRequests;
    },
  };
}

export const PAID_GOOGLE_PLACES_GUARD = {
  acknowledgementFlag: ACK_FLAG,
  maxFlag: MAX_FLAG,
  absoluteMaxRequests: ABSOLUTE_MAX_REQUESTS,
};
