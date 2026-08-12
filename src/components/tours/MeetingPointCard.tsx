// ─────────────────────────────────────────────────────────────────────────────
// MeetingPointCard — TourDetailPage 미팅 포인트 섹션 (Phase 1, 2026-05-19)
// ─────────────────────────────────────────────────────────────────────────────
import { MapPin, ExternalLink, Info } from 'lucide-react';
import type { MeetingPoint, I18nString, PickupZone } from '@/data/tours';
import type { Language } from '@/i18n';
import { resolvePhotoUrl } from '@/lib/tours-firestore';

function txt(field: I18nString | undefined, lang: Language): string {
  if (!field) return '';
  return field[lang] || field.en || field.ko || '';
}

const HEADING: Record<Language, string> = {
  ko: '미팅 포인트',
  en: 'Meeting Point',
  ja: 'ミーティングポイント',
  zh: '集合地点',
};

const ZONES_HEADING: Record<Language, string> = {
  ko: '픽업 가능 지역',
  en: 'Pickup Zones',
  ja: 'ピックアップ可能エリア',
  zh: '可接送地区',
};

const NAVER: Record<Language, string> = {
  ko: '네이버 지도',
  en: 'Naver Map',
  ja: 'Naverマップ',
  zh: 'Naver地图',
};

const GMAPS: Record<Language, string> = {
  ko: 'Google 지도',
  en: 'Google Maps',
  ja: 'Googleマップ',
  zh: 'Google地图',
};

const PICKUP_TIME: Record<Language, string> = {
  ko: '픽업 시각',
  en: 'Pickup time',
  ja: 'ピックアップ時刻',
  zh: '接送时间',
};

const SURCHARGE: Record<Language, string> = {
  ko: '추가요금',
  en: 'Surcharge',
  ja: '追加料金',
  zh: '附加费',
};

interface Props {
  meeting_point: MeetingPoint;
  language: Language;
}

export function MeetingPointCard({ meeting_point: mp, language }: Props) {
  const heading = HEADING[language] || HEADING.en;

  return (
    <section className="tour-detail-section">
      <h2 className="ec-h3 tour-detail-section-heading flex items-center gap-2">
        <MapPin className="h-5 w-5 text-ec-brand" />
        {heading}
      </h2>

      <div className="tour-detail-meeting-card p-5">
        {mp.kind === 'multi_zone' ? (
          <MultiZoneView mp={mp} language={language} />
        ) : (
          <SinglePointView mp={mp} language={language} />
        )}
      </div>
    </section>
  );
}

function SinglePointView({ mp, language }: { mp: MeetingPoint; language: Language }) {
  const addrText = txt(mp.address, language);
  const instructionsText = txt(mp.instructions, language);
  const photoUrl = mp.photo ? resolvePhotoUrl(mp.photo) : '';
  const photoAlt = mp.photo ? txt(mp.photo.alt, language) : '';

  const naverUrl = mp.naver_map_url
    || (addrText ? `https://map.naver.com/p/search/${encodeURIComponent(addrText)}` : null);
  const gmapsUrl = mp.google_maps_url
    || (mp.lat && mp.lng
      ? `https://www.google.com/maps?q=${mp.lat},${mp.lng}`
      : addrText ? `https://www.google.com/maps/search/${encodeURIComponent(addrText)}` : null);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {photoUrl && (
        <div className="overflow-hidden rounded-ec-md bg-ec-sunken">
          <img
            src={photoUrl}
            alt={photoAlt}
            loading="lazy"
            className="w-full h-48 object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
      )}

      <div className={photoUrl ? '' : 'sm:col-span-2'}>
        {addrText && (
          <p className="mb-2 text-sm font-bold leading-snug text-ec-ink">{addrText}</p>
        )}
        {mp.lat !== undefined && mp.lng !== undefined && (
          <p className="mb-2 text-xs tabular-nums text-ec-ink-3">
            {mp.lat.toFixed(5)}, {mp.lng.toFixed(5)}
          </p>
        )}

        <div className="flex flex-wrap gap-2 mt-2">
          {naverUrl && (
            <a
              href={naverUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="tour-detail-map-link"
            >
              {NAVER[language] || NAVER.en}
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
          {gmapsUrl && (
            <a
              href={gmapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="tour-detail-map-link"
            >
              {GMAPS[language] || GMAPS.en}
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>

        {instructionsText && (
          <div className="mt-4 flex gap-2 text-sm leading-relaxed text-ec-ink-2">
            <Info className="mt-1 h-4 w-4 shrink-0 text-ec-brand" />
            <p className="whitespace-pre-line">{instructionsText}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function MultiZoneView({ mp, language }: { mp: MeetingPoint; language: Language }) {
  const zones = mp.zones || [];
  const heading = ZONES_HEADING[language] || ZONES_HEADING.en;
  const instructionsText = txt(mp.instructions, language);

  return (
    <div>
      <p className="ec-eyebrow mb-3">
        {heading}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {zones.map((z) => (
          <ZoneCard key={z.id} zone={z} language={language} />
        ))}
      </div>
      {instructionsText && (
        <div className="mt-4 flex gap-2 text-sm leading-relaxed text-ec-ink-2">
          <Info className="mt-1 h-4 w-4 shrink-0 text-ec-brand" />
          <p className="whitespace-pre-line">{instructionsText}</p>
        </div>
      )}
    </div>
  );
}

function ZoneCard({ zone, language }: { zone: PickupZone; language: Language }) {
  return (
    <div className="rounded-ec-md border border-ec-line bg-ec-sunken p-4">
      <p className="text-sm font-bold text-ec-ink">{txt(zone.name, language)}</p>
      <p className="mt-1 text-xs text-ec-ink-3">{txt(zone.area_label, language)}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {zone.pickup_time && (
          <span className="text-ec-ink-2">
            🕐 {PICKUP_TIME[language] || PICKUP_TIME.en}: <span className="font-semibold">{zone.pickup_time}</span>
          </span>
        )}
        {zone.surcharge_krw !== undefined && zone.surcharge_krw > 0 && (
          <span className="text-ec-notice">
            +{SURCHARGE[language] || SURCHARGE.en} ₩{zone.surcharge_krw.toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
}
