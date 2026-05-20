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
    <section className="mb-8">
      <h2 className="text-[13px] font-black uppercase tracking-[0.08em] text-white/55 mb-3 flex items-center gap-2">
        <MapPin className="w-3.5 h-3.5" />
        {heading}
      </h2>

      <div
        className="rounded-2xl p-4"
        style={{
          background: 'rgba(182,104,252,0.04)',
          border: '1px solid rgba(182,104,252,0.20)',
        }}
      >
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
        <div className="rounded-xl overflow-hidden bg-white/[0.04]">
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
          <p className="text-[13px] font-bold text-white mb-1.5 leading-snug">{addrText}</p>
        )}
        {mp.lat !== undefined && mp.lng !== undefined && (
          <p className="text-[10px] text-white/40 tabular-nums mb-2">
            {mp.lat.toFixed(5)}, {mp.lng.toFixed(5)}
          </p>
        )}

        <div className="flex flex-wrap gap-2 mt-2">
          {naverUrl && (
            <a
              href={naverUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full"
              style={{
                background: 'rgba(0,200,81,0.08)',
                border: '1px solid rgba(0,200,81,0.25)',
                color: '#5DE1A1',
              }}
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
              className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full"
              style={{
                background: 'rgba(66,133,244,0.08)',
                border: '1px solid rgba(66,133,244,0.25)',
                color: '#8AB4F8',
              }}
            >
              {GMAPS[language] || GMAPS.en}
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>

        {instructionsText && (
          <div className="mt-3 flex gap-2 text-[12px] text-white/65 leading-relaxed">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#B668FC]" />
            <p className="whitespace-pre-line">{instructionsText}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function MultiZoneView({ mp, language }: { mp: MeetingPoint; language: Language }) {
  const zones = mp.zones ?? [];
  const heading = ZONES_HEADING[language] || ZONES_HEADING.en;
  const instructionsText = txt(mp.instructions, language);

  return (
    <div>
      <p className="text-[11px] font-black uppercase tracking-wider text-white/55 mb-2">
        {heading}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {zones.map((z) => (
          <ZoneCard key={z.id} zone={z} language={language} />
        ))}
      </div>
      {instructionsText && (
        <div className="mt-3 flex gap-2 text-[12px] text-white/65 leading-relaxed">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#B668FC]" />
          <p className="whitespace-pre-line">{instructionsText}</p>
        </div>
      )}
    </div>
  );
}

function ZoneCard({ zone, language }: { zone: PickupZone; language: Language }) {
  return (
    <div
      className="rounded-xl p-3"
      style={{
        background: 'rgba(255,255,255,0.025)',
        border: '1px solid rgba(255,255,255,0.07)',
      }}
    >
      <p className="text-[12px] font-bold text-white">{txt(zone.name, language)}</p>
      <p className="text-[10px] text-white/55 mt-0.5">{txt(zone.area_label, language)}</p>
      <div className="flex items-center gap-2 mt-1.5 text-[10px]">
        {zone.pickup_time && (
          <span className="text-white/65">
            🕐 {PICKUP_TIME[language] || PICKUP_TIME.en}: <span className="font-semibold">{zone.pickup_time}</span>
          </span>
        )}
        {zone.surcharge_krw !== undefined && zone.surcharge_krw > 0 && (
          <span style={{ color: '#FFD250' }}>
            +{SURCHARGE[language] || SURCHARGE.en} ₩{zone.surcharge_krw.toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
}
