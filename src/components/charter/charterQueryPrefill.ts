// CharterNewPage 의 query-string → wizard prefill 변환 (순수 함수, 테스트 가능 SSOT).
//
// ⚠️ CharterWizard 는 `Object.keys(initialState).length > 0` 으로 "caller 가 명시
//    prefill 했는가"를 판단해 24h resume(이어서하기) modal 을 억제한다. 그래서 이 함수는
//    값이 실제로 있는 키만 채워야 한다. 예전 구현은 항상 4 키(undefined 포함)를 반환 →
//    length 가 항상 4 → 빈 /charter 진입에서도 resume modal 이 영구 억제되는 버그였다.
//    => query prefill 이 실제로 있을 때만 키를 채워서 hasContent 판단이 살아있게 한다.
import type { WizardState, OriginCode, ServiceMode } from './types';

export const VALID_ORIGINS: OriginCode[] = ['ICN','GMP','PUS','CJU','TAE','CJJ','MWX','KWJ','RSU','USN','SEL_METRO','BUS_METRO','CUSTOM'];
export const VALID_SERVICES: ServiceMode[] = ['airport_transfer','day_tour','multi_day','kpop_shuttle','transfer'];

// URLSearchParams 또는 { get(key) } 형태면 무엇이든 받는다 (테스트 용이성).
type ParamSource = { get(key: string): string | null };

export function buildCharterPrefill(params: ParamSource): Partial<WizardState> {
  const origin = params.get('origin');
  const serviceParam = params.get('service');
  const tourLegacy = params.get('tour');
  const destParam = params.get('destination') || params.get('destinationKey');
  const pax = params.get('pax');

  // service 결정: 명시적 service → 그대로 / tour 값이 서비스가 아니고 패키지면 day_tour / 그 외 undefined
  let service: ServiceMode | undefined;
  if (serviceParam && VALID_SERVICES.includes(serviceParam as ServiceMode)) {
    service = serviceParam as ServiceMode;
  } else if (tourLegacy) {
    // tourLegacy가 'day_tour' 같은 서비스 키가 아니라면 패키지 key로 간주
    service = VALID_SERVICES.includes(tourLegacy as ServiceMode)
      ? (tourLegacy as ServiceMode)
      : 'day_tour';
  }

  // destinationKey: 명시적 파라미터 → 그 값. 없고 tour가 패키지 key면 그걸로 대체
  const destinationKey = destParam
    || (tourLegacy && !VALID_SERVICES.includes(tourLegacy as ServiceMode) ? tourLegacy : undefined);

  const validOrigin = origin && VALID_ORIGINS.includes(origin as OriginCode)
    ? (origin as OriginCode)
    : undefined;
  const paxNum = pax ? parseInt(pax, 10) : undefined;

  // 값이 있는 키만 채운다 (위 주석 참고 — resume modal 억제 판단을 살리기 위함).
  const prefill: Partial<WizardState> = {};
  if (validOrigin) prefill.origin = validOrigin;
  if (service) prefill.service = service;
  if (destinationKey) prefill.destinationKey = destinationKey;
  if (paxNum !== undefined && !Number.isNaN(paxNum)) prefill.paxCount = paxNum;
  return prefill;
}
