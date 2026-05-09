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
import { Sparkles, Check, ExternalLink } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { getZonesForCity, type Zone } from './zoneData';
import { buildZoneHotelLink } from '@/config/affiliateLinks';
import { trackAdImpression, trackAdClick } from '@/lib/analytics';
import { haptic } from '@/lib/haptic';

type Lang = 'ko' | 'en' | 'ja' | 'zh';

// 도시 cityKey → 표시용 도시명 (4-lang). i18n key 보다 inline 이 단순 — 도시명은
// language 별로 흔들리지 않고 zone group 헤더에만 쓰임 (zoneData 레벨).
const CITY_NAME_BY_KEY: Record<string, { ko: string; en: string; ja: string; zh: string; icon: string }> = {
  seoul:     { ko: '서울',   en: 'Seoul',     ja: 'ソウル',   zh: '首尔',   icon: '🏙️' },
  busan:     { ko: '부산',   en: 'Busan',     ja: '釜山',     zh: '釜山',   icon: '🌊' },
  jeju:      { ko: '제주',   en: 'Jeju',      ja: '済州',     zh: '济州',   icon: '🌴' },
  gyeongju:  { ko: '경주',   en: 'Gyeongju',  ja: '慶州',     zh: '庆州',   icon: '🏛️' },
  jeonju:    { ko: '전주',   en: 'Jeonju',    ja: '全州',     zh: '全州',   icon: '🍱' },
  gangneung: { ko: '강릉',   en: 'Gangneung', ja: '江陵',     zh: '江陵',   icon: '☕' },
  incheon:   { ko: '인천',   en: 'Incheon',   ja: '仁川',     zh: '仁川',   icon: '✈️' },
  suwon:     { ko: '수원',   en: 'Suwon',     ja: '水原',     zh: '水原',   icon: '🏯' },
  yeosu:     { ko: '여수',   en: 'Yeosu',     ja: '麗水',     zh: '丽水',   icon: '🌃' },
  daegu:     { ko: '대구',   en: 'Daegu',     ja: '大邱',     zh: '大邱',   icon: '🚄' },
};

interface Props {
  language: Lang;
  isMobile: boolean;
  // 2026-05-10: 다도시 plan 지원. mainCity 단일 → 모든 selected cities. 첫 도시
  // = 메인 거점. 단일 도시면 [mainCity] 만 넘기면 됨 (단도시 UI 그대로).
  cityKeys: string[];
  hotelAddress: string;
  recommendedZone: string;
  // onPickZone 은 zone 선택 시 zone key + 그 zone 이 속한 cityKey 같이 콜백.
  // 부모는 cityKey 가 mainCity 와 다르면 mainCity auto-swap 가능.
  onPickZone: (zoneKey: string, cityKey: string) => void;
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
  recommendedZone,
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

  const allZones = cityGroups.flatMap(g => g.zones);
  const selectedZone = allZones.find(z => z.key === recommendedZone);
  const selectedCityGroup = cityGroups.find(g => g.zones.some(z => z.key === recommendedZone));
  const selectedCityKey = selectedCityGroup?.cityKey || cityGroups[0]?.cityKey || '';

  // Fire ad_impression once per zone selection — placement names the surface
  // so PostHog can split CTR by ZoneRecommender vs PlanDetailPage HotelAd.
  const lastImpressionKey = useRef<string>('');
  useEffect(() => {
    if (!selectedZone || !selectedCityKey) return;
    const key = `${selectedCityKey}|${selectedZone.key}`;
    if (lastImpressionKey.current === key) return;
    lastImpressionKey.current = key;
    trackAdImpression('hotel', `wizard_zone:${selectedCityKey}:${selectedZone.key}`);
  }, [selectedZone, selectedCityKey]);

  // Hide entirely when (a) hotel typed, (b) no zones for any selected city.
  if (hotelAddress.trim().length > 0) return null;
  if (cityGroups.length === 0) return null;

  const accent = isMobile ? '#B668FC' : '#7C5CFC';
  const isMultiCity = cityGroups.length > 1;

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

      {/* 다도시 plan: 도시별 그룹 헤더 + zone grid 분리. 단도시: 헤더 없이 zone grid 만. */}
      {cityGroups.map(({ cityKey: ck, zones: cityZones }) => {
        const cityMeta = CITY_NAME_BY_KEY[ck];
        const cityName = cityMeta ? cityMeta[language] || cityMeta.en : ck;
        const cityIcon = cityMeta?.icon || '📍';
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
                const sel = recommendedZone === z.key;
                const name = z.name[language] || z.name.en;
                const desc = z.desc[language] || z.desc.en;
                const bestFor = z.bestFor[language] || z.bestFor.en;
                return (
                  <button
                    key={z.key}
                    type="button"
                    onClick={() => { haptic('select'); onPickZone(sel ? '' : z.key, ck); }}
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

      {recommendedZone && (
        <p className="text-[11px] text-white/65 mt-2.5 italic">
          {labelPick || 'AI will plan around this zone. You can still type a specific hotel above to override.'}
        </p>
      )}

      {/* Trip.com sponsored hotel CTA — shown only after zone is picked. */}
      {selectedZone && selectedCityKey && (
        <div className="mt-3 pt-3 border-t border-white/[0.08]">
          <a
            href={buildZoneHotelLink(selectedZone.name.ko, selectedCityKey)}
            target="_blank"
            rel="sponsored noopener noreferrer"
            onClick={() => {
              haptic('tap');
              trackAdClick(
                'hotel',
                `wizard_zone:${selectedCityKey}:${selectedZone.key}`,
                buildZoneHotelLink(selectedZone.name.ko, selectedCityKey),
              );
            }}
            className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-[#0073E6]/10 border border-[#0073E6]/30 hover:bg-[#0073E6]/15 hover:border-[#0073E6]/50 transition-all active:scale-[0.99]"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[14px]">🏨</span>
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-white leading-tight truncate">
                  {(labelHotelCta || 'Browse {zone} hotels on Trip.com').replace('{zone}', selectedZone.name[language] || selectedZone.name.en)}
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
