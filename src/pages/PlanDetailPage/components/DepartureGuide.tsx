// Departure guide — Klook/Trip.com pattern.
//   - Hero "How to get to the airport" card with ODsay step-by-step (reuses TransitArrow).
//   - Tax refund / luggage storage / last-minute shopping shown as compact tip cards.
//   - Pink accent (vs Arrival's purple) so users instantly tell them apart.
//   - 2026-05-05: 호텔→공항 경로 무조건 표시 정책. ODsay 실패하거나 호텔 좌표
//     없을 때도 graceful 메시지 + Gemini fallback instruction을 보여준다.
//   - B9-33 (2026-05-09): 호텔 주소에서 hub (명동/강남/홍대/종로/잠실/동대문/가평) 추출
//     → 헤더에 "🏨 명동에서 출발" + 직행 공항버스 카드 (6015/6005/6020) 추가.
//     ODsay 는 지하철 환승 위주로 추천하지만 짐 많을 때 직행 버스가 더 편함.
import { useState } from 'react';
import { Plane, ChevronDown, Wallet, ShoppingBag, Briefcase, AlertTriangle, Bus } from 'lucide-react';
import { formatKRW } from '../constants';
import type { DepartureGuideBlock, PlanDocument } from '../types';
import { getPlanDetailUI } from '../types';
import { useLanguage } from '@/hooks/useLanguage';
import { TransitArrow } from './TransitArrow';
import type { TransitFromPrev } from '@/types/plan';
import {
  AIRPORT_BUS_BY_HUB,
  HUB_LABELS,
  detectHubFromAddress,
  type AirportBusHubKey,
} from '@/data/airportBusHubs';

// Route 객체 shape — RouteAgent 가 셋하는 모든 변형 포함.
// TransitArrow 가 `TransitFromPrev & Record<string, unknown>` 을 받으므로 동일하게 맞춰준다.
type DepartureRoute = (TransitFromPrev & Record<string, unknown> & {
  _failed?: boolean;
  fallbackReason?: string;
  fallback_origin?: 'arrival_guide' | 'zone_anchor' | 'city_center' | 'hotel';
  fallback_label?: string | null;
}) | undefined;

interface DepartureGuideProps {
  guide: DepartureGuideBlock;
  /** B9-33: 호텔 주소에서 hub 추출하기 위해 plan.input 접근 필요. */
  plan?: PlanDocument;
}

export function DepartureGuide({ guide, plan }: DepartureGuideProps) {
  const { t, language } = useLanguage();
  const ui = getPlanDetailUI(t);
  const [open, setOpen] = useState(false);

  // B9-33: 호텔 주소 또는 추천 zone 에서 hub 키 추출 → 헤더 라벨 + 직행 버스 카드 결정.
  const hotelAddress = plan?.input?.hotel_address as string | undefined;
  const recommendedZone = plan?.input?.recommended_zone as string | undefined;
  const hubKey: AirportBusHubKey | null =
    detectHubFromAddress(hotelAddress) || detectHubFromAddress(recommendedZone);
  const lang = (['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as 'ko' | 'en' | 'ja' | 'zh';
  const hubLabel = hubKey ? HUB_LABELS[hubKey][lang] : null;
  const busInfo = hubKey ? AIRPORT_BUS_BY_HUB[hubKey] : null;
  // 헤더용 "{hub}에서 출발" 보간 — useLanguage 는 raw dict 만 반환하므로 직접 치환.
  const hubHeaderLabel =
    hubLabel && ui.departureFromHub
      ? String(ui.departureFromHub).replace('{{hub}}', hubLabel)
      : null;

  const route = guide.route_to_airport as DepartureRoute;
  // _failed=true → ODsay 데이터 누락. 그 외에는 정상 ODsay 데이터.
  const odsayFailed = route?._failed === true;
  const hasOdsayData = !!route && !odsayFailed && Array.isArray(route.step_by_step) && (route.step_by_step?.length ?? 0) > 0;
  // Gemini high-level fallback (백엔드가 덮어쓰지 못했을 때 남는 원본).
  const geminiInstruction = guide.to_airport?.instruction || '';
  const geminiMethod = guide.to_airport?.method || '';
  const geminiDuration = guide.to_airport?.duration_min;
  const geminiCost = guide.to_airport?.cost_krw;

  const routeMin = (route?.est_min as number | undefined) || geminiDuration;

  return (
    <section className="mb-6">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between rounded-2xl px-5 py-4 transition-all hover:scale-[1.005]"
        style={{
          background: 'linear-gradient(135deg, rgba(234,83,126,0.15), rgba(251,146,60,0.08))',
          border: '1px solid rgba(234,83,126,0.30)',
        }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg,#EA537E,#FB923C)' }}>
            <Plane className="w-5 h-5 text-white rotate-45" />
          </div>
          <div className="text-left">
            <p className="text-[15px] font-bold text-white">{ui.departureGuide || ui.departureGuideTitle || 'Departure Guide'}</p>
            <p className="text-[13px] text-white/65 mt-0.5">
              {guide.airport}{routeMin ? ` · ${routeMin}${ui.minUnit || 'min'}` : ''}
            </p>
            {/* B9-33: hub 추출 성공 시 "🏨 {hub}에서 출발" 라벨 — 사용자가 출발지 즉시 인지 */}
            {hubHeaderLabel && (
              <p className="text-[12px] text-pink-200/85 mt-1 font-medium">
                🏨 {hubHeaderLabel}
              </p>
            )}
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-white/55 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>

      <div className={`overflow-hidden transition-all duration-300 ease-out ${open ? 'max-h-[3000px] opacity-100 mt-4' : 'max-h-0 opacity-0'}`}>
        {/* HERO 1: ODsay 정상 데이터 → 항상 우선 표시 */}
        {hasOdsayData && route && (
          <div className="mb-4 rounded-2xl overflow-hidden"
            style={{ background: 'linear-gradient(135deg, rgba(234,83,126,0.10), rgba(251,146,60,0.06))', border: '1px solid rgba(234,83,126,0.25)' }}>
            <div className="px-4 pt-4 pb-2">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-pink-400/25">
                  <Plane className="w-5 h-5 text-pink-300 rotate-45" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-bold text-white">{ui.toAirport || 'To Airport'}</p>
                  <p className="text-[13px] text-white/60">
                    {route.est_min as number}{ui.minUnit || 'min'}
                    {((route.est_fare_krw as number) || 0) > 0 ? ` · ${formatKRW((route.est_fare_krw as number) || 0)}` : ''}
                  </p>
                  {/* Fallback origin 안내 — 호텔 좌표 없어서 zone/city center 기준일 때 */}
                  {route.fallback_origin && route.fallback_origin !== 'hotel' && (
                    <p className="text-[12px] text-amber-300/85 mt-1">
                      {ui.departureRouteApproximate || 'Estimated route from'}
                      {route.fallback_label ? ` · ${route.fallback_label}` : ''}
                    </p>
                  )}
                </div>
              </div>
            </div>
            <div className="px-2 pb-3">
              <TransitArrow transit={route} />
            </div>
          </div>
        )}

        {/* HERO 2: ODsay 실패 → graceful 메시지 + Gemini fallback instruction */}
        {odsayFailed && (
          <div className="mb-4 rounded-2xl overflow-hidden"
            style={{ background: 'linear-gradient(135deg, rgba(234,83,126,0.10), rgba(251,146,60,0.06))', border: '1px solid rgba(251,146,60,0.30)' }}>
            <div className="px-4 pt-4 pb-3">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-amber-400/25">
                  <AlertTriangle className="w-5 h-5 text-amber-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-bold text-white">{ui.toAirport || 'To Airport'}</p>
                  <p className="text-[14px] text-amber-200/90 mt-0.5 font-medium">
                    {ui.departureRouteFailed || 'Departure route data temporarily unavailable'}
                  </p>
                  <p className="text-[13px] text-white/65 mt-1.5">
                    {ui.departureRouteFallback || 'Operations team is checking — fallback guidance below.'}
                  </p>
                  {(geminiMethod || geminiInstruction) && (
                    <div className="mt-3 p-3 rounded-lg bg-white/[0.04] border border-white/[0.07]">
                      {geminiMethod && (
                        <p className="text-[14px] font-semibold text-white">{geminiMethod}</p>
                      )}
                      {geminiInstruction && (
                        <p className="text-[13px] text-white/70 mt-1 leading-relaxed">{geminiInstruction}</p>
                      )}
                      <div className="flex gap-3 mt-2 text-[13px]">
                        {typeof geminiDuration === 'number' && geminiDuration > 0 && (
                          <span className="text-white/65">{geminiDuration} {ui.minUnit || 'min'}</span>
                        )}
                        {typeof geminiCost === 'number' && geminiCost > 0 && (
                          <span className="text-pink-300 font-bold">{formatKRW(geminiCost)}</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* HERO 3: route 객체 자체 없음 (구 plan / Gemini만) → Gemini text 또는 안내 */}
        {!route && (
          <div className="mb-4 rounded-2xl overflow-hidden"
            style={{ background: 'linear-gradient(135deg, rgba(234,83,126,0.10), rgba(251,146,60,0.06))', border: '1px solid rgba(234,83,126,0.25)' }}>
            <div className="px-4 pt-4 pb-3">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-pink-400/25">
                  <Plane className="w-5 h-5 text-pink-300 rotate-45" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-bold text-white">{ui.toAirport || 'To Airport'}</p>
                  {(geminiMethod || geminiInstruction) ? (
                    <>
                      {geminiMethod && (
                        <p className="text-[14px] text-white/80 mt-1 font-medium">{geminiMethod}</p>
                      )}
                      {geminiInstruction && (
                        <p className="text-[13px] text-white/65 mt-1 leading-relaxed">{geminiInstruction}</p>
                      )}
                      <div className="flex gap-3 mt-2 text-[13px]">
                        {typeof geminiDuration === 'number' && geminiDuration > 0 && (
                          <span className="text-white/65">{geminiDuration} {ui.minUnit || 'min'}</span>
                        )}
                        {typeof geminiCost === 'number' && geminiCost > 0 && (
                          <span className="text-pink-300 font-bold">{formatKRW(geminiCost)}</span>
                        )}
                      </div>
                      <p className="text-[12px] text-amber-300/80 mt-2">
                        {ui.departureRouteFallback || 'Operations team is checking — detailed route to follow.'}
                      </p>
                    </>
                  ) : (
                    <p className="text-[13px] text-white/65 mt-1 leading-relaxed">
                      {ui.departureRouteFallback || 'Operations team is checking — detailed route to follow.'}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* B9-33: 직행 공항버스 카드 — hub 매칭 시에만 노출.
            ODsay 결과는 지하철 환승 위주라 짐 많을 때 6015/6005 직행이 더 편함.
            수동 추가 옵션이라 디자인은 알록달록한 hero 와 별개의 emerald 톤으로 차별. */}
        {hubKey && busInfo && hubLabel && (
          <div className="mb-4 rounded-2xl overflow-hidden"
            style={{ background: 'linear-gradient(135deg, rgba(52,211,153,0.10), rgba(96,165,250,0.06))', border: '1px solid rgba(52,211,153,0.30)' }}>
            <div className="px-4 pt-4 pb-3">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-emerald-400/25">
                  <Bus className="w-5 h-5 text-emerald-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-[15px] font-bold text-white">
                      {ui.directBusTitle || 'Airport Bus (Direct)'} {busInfo.busNo}
                    </p>
                    <span className="px-2 py-0.5 rounded text-[12px] font-bold text-black"
                      style={{ background: '#34d399' }}>
                      ★ {ui.directBusBadge || 'No transfer'}
                    </span>
                  </div>
                  <p className="text-[13px] text-white/70 mt-1.5 leading-relaxed">
                    {ui.directBusSubtitle || 'Easiest option with heavy luggage — direct to the airport, zero transfers'}
                  </p>
                  <div className="flex items-baseline gap-3 mt-2">
                    <span className="text-[14px] font-bold text-white">
                      {formatKRW(busInfo.priceKRW)}
                    </span>
                    <span className="text-[13px] text-white/65">
                      · {busInfo.durationMin}{ui.minUnit || 'min'}
                    </span>
                  </div>
                  <p className="text-[13px] text-emerald-200/90 mt-1.5">
                    {ui.directBusStop || 'Stop'}: {lang === 'ko' ? busInfo.stopKo : busInfo.stopEn}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tip cards row */}
        <div className="space-y-2.5 pl-2">
          {guide.luggage_storage?.available && (
            <div className="bg-white/[0.04] border border-white/[0.07] rounded-xl p-3.5">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-400/20 flex items-center justify-center shrink-0">
                  <Briefcase className="w-4 h-4 text-blue-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold text-white">{ui.luggageStorage || 'Luggage Storage'}</p>
                  <p className="text-[13px] text-white/65 mt-0.5">{guide.luggage_storage.location}</p>
                </div>
              </div>
            </div>
          )}
          {guide.tax_refund && (
            <div className="bg-white/[0.04] border border-white/[0.07] rounded-xl p-3.5">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-400/20 flex items-center justify-center shrink-0">
                  <Wallet className="w-4 h-4 text-emerald-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold text-white">{ui.taxRefund || 'Tax Refund'}</p>
                  <p className="text-[13px] text-white/65 mt-0.5">{guide.tax_refund.location}</p>
                  <p className="text-[12px] text-emerald-300 mt-1 font-semibold">{ui.minPurchase || 'Min. purchase:'} {formatKRW(guide.tax_refund.threshold_krw ?? 0)}</p>
                </div>
              </div>
            </div>
          )}
          {guide.last_minute_shopping && (
            <div className="bg-white/[0.04] border border-white/[0.07] rounded-xl p-3.5">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-400/20 flex items-center justify-center shrink-0">
                  <ShoppingBag className="w-4 h-4 text-amber-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold text-white">{ui.lastMinuteShopping || 'Last-Minute Shopping'}</p>
                  <p className="text-[13px] text-white/65 mt-0.5 leading-relaxed">{guide.last_minute_shopping}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
