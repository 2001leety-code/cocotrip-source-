// Sprint 2 #5 — inline zone-pick UI shown below the hotel-address input when
// the user hasn't entered an address yet. Lets undecided users pick a Seoul
// district as a "soft" anchor so the AI plan hubs stops near that zone instead
// of guessing. The picked zone is sent to the backend as `recommended_zone` and
// injected into the Gemini prompt.
//
// Why inline (not a separate wizard step):
//   - lower step-count churn — current 5-step flow stays the same length
//   - hotel-address input + zone picker live next to each other (one decision)
//   - mirror current UX of WizardStep0Reservation's progressive disclosure
//
// Skip when:
//   - user already typed a hotel address (collision avoidance)
//   - none of the selected cities has zone data
//
// 2026-05-10 (다도시 plan UX fix): cityKey: string → cityKeys: string[].
// 다도시 plan (서울 + 부산 등) 에서는 도시별 그룹 헤더 + zone grid 분리 렌더.
// 부모는 onPickZone(zoneKey, cityKey) 받아 mainCity auto-swap 가능.
//
// 2026-05-11 (B-2 fix): recommendedZone: string → recommendedZones: Record<city,zone>.
// 5/10 prod 검증 결과 — 서울+부산 다도시 wizard 에서 "명동" 클릭 후 "해운대" 클릭하면
// 단일 선택만 유지 (이전 도시 선택 사라짐) → AI 가 도시별 숙소 못 정함. 결정적 결함.
// 도시별로 각각 1개씩 zone 보유 가능. 다른 도시 zone 클릭은 그 도시 슬롯만 교체.
import { Sparkles, Check, ExternalLink } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { getZonesForCity, type Zone } from './zoneData';
import { CITY_NAME_BY_KEY } from './zoneHelpers';
import { buildZoneHotelLink } from '@/config/affiliateLinks';
import { trackAffiliateImpression, trackAffiliateClick } from '@/lib/affiliateTracking';
import { haptic } from '@/lib/haptic';

type Lang = 'ko' | 'en' | 'ja' | 'zh';

interface Props {
  language: Lang;
  isMobile: boolean;
  // 2026-05-10: 다도시 plan 지원. mainCity 단일 → 모든 selected cities. 첫 도시
  // = 메인 거점. 단일 도시면 [mainCity] 만 넘기면 됨 (단도시 UI 그대로).
  cityKeys: string[];
  hotelAddress: string;
  // 2026-05-11 (B-2): 도시별 zone Record. e.g. { seoul: 'myeongdong', busan: 'haeundae' }.
  // 단일 도시 plan 은 부모가 { [mainCityKey]: zoneKey } 형태로 변환해 넘김 (호환).
  recommendedZones: Record<string, string>;
  // 2026-05-11 (B-2): onPickZone (cityKey, zoneKey) — 도시 단위 토글. 같은 도시 같은
  // zone 다시 클릭 시 zoneKey='' 로 deselect. 부모는 cityKey 가 mainCity 와 다르면
  // mainCity auto-swap 가능.
  onPickZone: (cityKey: string, zoneKey: string) => void;
  // i18n labels — fall back to English defaults if dict misses keys.
  labelTitle?: string;
  labelSubtitle?: string;
  labelPick?: string;
  labelHotelCta?: string;
  labelHotelSponsored?: string;
  // 다도시 그룹 헤더 — "{city} 지역 추천" 패턴. {city} placeholder 자동 교체.
  labelGroupHeader?: string;
}

export function ZoneRecommender({
  language,
  isMobile,
  cityKeys,
  hotelAddress,
  recommendedZones,
  onPickZone,
  labelTitle,
  labelSubtitle,
  labelPick,
  labelHotelCta,
  labelHotelSponsored,
  labelGroupHeader,
}: Props) {
  // 도시별 zone 묶음. 빈 도시 (zone 데이터 없는 도시) 는 자동으로 빠짐.
  const cityGroups = cityKeys
    .map(ck => ({ cityKey: ck, zones: getZonesForCity(ck) }))
    .filter(g => g.zones.length > 0);

  // 2026-05-11: 선택된 도시 1개 — Trip.com CTA 노출용 (다도시 시 첫 번째 선택 도시).
  // 단일 도시 plan 에서는 그 도시 / 다도시 plan 에서는 cityKeys 순서 기반 첫 선택.
  const selectedEntries = cityGroups
    .map(g => {
      const zoneKey = recommendedZones[g.cityKey];
      if (!zoneKey) return null;
      const zone = g.zones.find(z => z.key === zoneKey);
      return zone ? { cityKey: g.cityKey, zone } : null;
    })
    .filter((e): e is { cityKey: string; zone: Zone } => !!e);
  const primarySelection = selectedEntries[0];

  // Fire ad_impression once per zone selection — placement names the surface
  // so PostHog can split CTR by ZoneRecommender vs PlanDetailPage HotelAd.
  // 다도시 시 첫 선택 도시 기준 노출 — 사용자가 CTA 누를 도시이기 때문.
  const lastImpressionKey = useRef<string>('');
  useEffect(() => {
    if (!primarySelection) return;
    const key = `${primarySelection.cityKey}|${primarySelection.zone.key}`;
    if (lastImpressionKey.current === key) return;
    lastImpressionKey.current = key;
    trackAffiliateImpression({
      product: 'hotel', placement: 'wizard_zone', language,
      city: primarySelection.cityKey, linkKey: primarySelection.zone.key,
    });
  }, [primarySelection, language]);

  // Hide entirely when (a) hotel typed, (b) no zones for any selected city.
  if (hotelAddress.trim().length > 0) return null;
  if (cityGroups.length === 0) return null;

  const accent = isMobile ? '#B668FC' : '#7C5CFC';
  const isMultiCity = cityGroups.length > 1;
  const hasAnySelection = selectedEntries.length > 0;

  return (
    <div className="mt-3 rounded-xl border border-[#7C5CFC]/20 bg-[#7C5CFC]/[0.04] p-3">
      <div className="flex items-start gap-2 mb-2.5">
        <Sparkles className="w-4 h-4 mt-0.5 shrink-0" style={{ color: accent }} />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-white leading-snug">
            {labelTitle || 'Need a zone recommendation?'}
          </p>
          <p className="text-[11px] text-white/55 leading-snug mt-0.5">
            {labelSubtitle || 'Pick a district and the AI will hub stops near it.'}
          </p>
        </div>
      </div>

      {/* 다도시 plan: 도시별 그룹 헤더 + zone grid 분리. 단도시: 헤더 없이 zone grid 만.
          2026-05-11 (B-2): 각 도시 zone grid 는 자기 도시의 recommendedZones[city] 와만
          비교. 한 도시 zone 클릭은 다른 도시 zone 선택을 건드리지 않음. */}
      {cityGroups.map(({ cityKey: ck, zones: cityZones }) => {
        const cityMeta = CITY_NAME_BY_KEY[ck];
        const cityName = cityMeta ? cityMeta[language] || cityMeta.en : ck;
        const cityIcon = cityMeta?.icon || '📍';
        const cityZoneSelected = recommendedZones[ck] || '';
        return (
          <div key={ck} className={isMultiCity ? 'mt-2' : ''}>
            {isMultiCity && (
              <p className="text-[11px] font-semibold text-white/75 mb-2 flex items-center gap-1.5">
                <span>{cityIcon}</span>
                <span>
                  {(labelGroupHeader || '{city} zones').replace('{city}', cityName)}
                </span>
              </p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {cityZones.map((z: Zone) => {
                const sel = cityZoneSelected === z.key;
                const name = z.name[language] || z.name.en;
                const desc = z.desc[language] || z.desc.en;
                const bestFor = z.bestFor[language] || z.bestFor.en;
                return (
                  <button
                    key={z.key}
                    type="button"
                    onClick={() => { haptic('select'); onPickZone(ck, sel ? '' : z.key); }}
                    aria-pressed={sel}
                    className={`text-left rounded-lg border p-2.5 transition-all active:scale-[0.98] ${
                      sel
                        ? 'bg-[#7C5CFC]/15 border-[#7C5CFC]/60'
                        : 'bg-white/[0.04] border-white/[0.08] hover:bg-white/[0.07]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[15px]">{z.icon}</span>
                      {sel && <Check className="w-3.5 h-3.5" style={{ color: accent }} />}
                    </div>
                    <p className="text-[12px] font-bold text-white leading-tight">{name}</p>
                    <p className="text-[10px] text-white/55 leading-tight mt-0.5 line-clamp-2">{desc}</p>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-[9px] text-white/45">{z.nightlyKRW}</span>
                      <span className="text-[9px] font-semibold" style={{ color: accent }}>
                        {bestFor}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {hasAnySelection && (
        <p className="text-[11px] text-white/65 mt-2.5 italic">
          {labelPick || 'AI will plan around this zone. You can still type a specific hotel above to override.'}
        </p>
      )}

      {/* Trip.com sponsored hotel CTA — shown only after zone is picked.
          2026-05-11 (B-2): 다도시 시 사용자가 첫 선택한 도시 zone 기준 CTA 노출. */}
      {primarySelection && (
        <div className="mt-3 pt-3 border-t border-white/[0.08]">
          <a
            href={buildZoneHotelLink(primarySelection.zone.name.ko, primarySelection.cityKey)}
            target="_blank"
            rel="sponsored noopener noreferrer"
            onClick={() => {
              haptic('tap');
              trackAffiliateClick({
                product: 'hotel', placement: 'wizard_zone', language,
                city: primarySelection.cityKey, linkKey: primarySelection.zone.key,
              });
            }}
            className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-[#0073E6]/10 border border-[#0073E6]/30 hover:bg-[#0073E6]/15 hover:border-[#0073E6]/50 transition-all active:scale-[0.99]"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[14px]">🏨</span>
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-white leading-tight truncate">
                  {(labelHotelCta || 'Browse {zone} hotels on Trip.com').replace('{zone}', primarySelection.zone.name[language] || primarySelection.zone.name.en)}
                </p>
                <p className="text-[10px] text-white/45 leading-tight mt-0.5">
                  {labelHotelSponsored || 'Sponsored · Trip.com'}
                </p>
              </div>
            </div>
            <ExternalLink className="w-3.5 h-3.5 text-[#4DA8FF] shrink-0" />
          </a>
        </div>
      )}
    </div>
  );
}
