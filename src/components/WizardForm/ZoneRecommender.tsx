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
//   - mainCity has no zone data (Seoul-only for now — Busan/Jeju to come)
import { Sparkles, Check, ExternalLink } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { getZonesForCity, type Zone } from './zoneData';
import { buildZoneHotelLink } from '@/config/affiliateLinks';
import { trackAdImpression, trackAdClick } from '@/lib/analytics';
import { haptic } from '@/lib/haptic';

type Lang = 'ko' | 'en' | 'ja' | 'zh';

interface Props {
  language: Lang;
  isMobile: boolean;
  cityKey: string;
  hotelAddress: string;
  recommendedZone: string;
  setRecommendedZone: (key: string) => void;
  // i18n labels — fall back to English defaults if dict misses keys.
  labelTitle?: string;
  labelSubtitle?: string;
  labelPick?: string;
  labelHotelCta?: string;
  labelHotelSponsored?: string;
}

export function ZoneRecommender({
  language,
  isMobile,
  cityKey,
  hotelAddress,
  recommendedZone,
  setRecommendedZone,
  labelTitle,
  labelSubtitle,
  labelPick,
  labelHotelCta,
  labelHotelSponsored,
}: Props) {
  const zones = getZonesForCity(cityKey);
  const selectedZone = zones.find(z => z.key === recommendedZone);

  // Fire ad_impression once per zone selection — placement names the surface
  // so PostHog can split CTR by ZoneRecommender vs PlanDetailPage HotelAd.
  const lastImpressionKey = useRef<string>('');
  useEffect(() => {
    if (!selectedZone) return;
    const key = `${cityKey}|${selectedZone.key}`;
    if (lastImpressionKey.current === key) return;
    lastImpressionKey.current = key;
    trackAdImpression('hotel', `wizard_zone:${cityKey}:${selectedZone.key}`);
  }, [selectedZone, cityKey]);

  // Hide entirely when (a) hotel typed, (b) no zones for this city.
  if (hotelAddress.trim().length > 0) return null;
  if (zones.length === 0) return null;

  const accent = isMobile ? '#B668FC' : '#7C5CFC';

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

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {zones.map((z: Zone) => {
          const sel = recommendedZone === z.key;
          const name = z.name[language] || z.name.en;
          const desc = z.desc[language] || z.desc.en;
          const bestFor = z.bestFor[language] || z.bestFor.en;
          return (
            <button
              key={z.key}
              type="button"
              onClick={() => { haptic('select'); setRecommendedZone(sel ? '' : z.key); }}
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

      {recommendedZone && (
        <p className="text-[11px] text-white/65 mt-2.5 italic">
          {labelPick || 'AI will plan around this zone. You can still type a specific hotel above to override.'}
        </p>
      )}

      {/* Trip.com sponsored hotel CTA — shown only after zone is picked, so the
          keyword is meaningful and the user has signaled intent. The Korean
          district name (z.name.ko) goes to Trip.com regardless of UI language
          since Trip.com matches Korean keywords better on Korean cities. */}
      {selectedZone && (
        <div className="mt-3 pt-3 border-t border-white/[0.08]">
          <a
            href={buildZoneHotelLink(selectedZone.name.ko, cityKey)}
            target="_blank"
            rel="sponsored noopener noreferrer"
            onClick={() => {
              haptic('tap');
              trackAdClick(
                'hotel',
                `wizard_zone:${cityKey}:${selectedZone.key}`,
                buildZoneHotelLink(selectedZone.name.ko, cityKey),
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
