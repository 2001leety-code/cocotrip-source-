// TourStopList — TourDetailPage에서 stops 시간순 인터리브 렌더.
// Stop -> Transit -> Stop -> Transit -> ... PlanDetailPage 패턴 차용.
import { Footprints, Car, Train, MapPin, Clock, ExternalLink } from 'lucide-react';
import type { TourStop, TourTransit, I18nString } from '@/data/tours';
import type { Language } from '@/i18n';
import { resolvePhotoUrl } from '@/lib/tours-firestore';

function txt(field: I18nString | undefined, lang: Language): string {
  if (!field) return '';
  return field[lang] || field.en || field.ko || '';
}

function TransitIcon({ method }: { method: TourTransit['method'] }) {
  if (method === 'walk') return <Footprints className="h-3.5 w-3.5" />;
  if (method === 'transit') return <Train className="h-3.5 w-3.5" />;
  return <Car className="h-3.5 w-3.5" />;
}

function transitLabel(t: TourTransit, lang: Language): string {
  const map: Record<TourTransit['method'], Record<Language, string>> = {
    walk:    { ko: '도보',     en: 'Walk',    ja: '徒歩',     zh: '步行' },
    transit: { ko: '대중교통', en: 'Transit', ja: '公共交通', zh: '公共交通' },
    car:     { ko: '차량 이동', en: 'Drive',  ja: '車移動',   zh: '驾车' },
  };
  const minSuffix = lang === 'ko' ? '분' : lang === 'ja' ? '分' : lang === 'zh' ? '分钟' : 'min';
  const distLabel = t.distance_km ? ` · ${t.distance_km}km` : '';
  return `${map[t.method][lang]} ${t.minutes}${minSuffix}${distLabel}`;
}

function entryFeeLabel(krw: number | undefined, lang: Language): string {
  if (!krw || krw === 0) {
    return lang === 'ko' ? '무료' : lang === 'ja' ? '無料' : lang === 'zh' ? '免费' : 'Free';
  }
  return `₩${krw.toLocaleString()}`;
}

function stayLabel(min: number, lang: Language): string {
  if (lang === 'ko') return `${min}분`;
  if (lang === 'ja') return `${min}分`;
  if (lang === 'zh') return `${min}分钟`;
  return `${min}min`;
}

interface TourStopListProps {
  stops: TourStop[];
  language: Language;
}

export function TourStopList({ stops, language }: TourStopListProps) {
  return (
    <div className="space-y-2">
      {stops.map((stop, i) => (
        <div key={i}>
          {stop.transit_from_prev && i > 0 && (
            <TransitArrow transit={stop.transit_from_prev} language={language} />
          )}
          <TourStopCard stop={stop} language={language} />
        </div>
      ))}
    </div>
  );
}

function TransitArrow({ transit, language }: { transit: TourTransit; language: Language }) {
  return (
    <div className="flex items-center gap-2 py-3 pl-5 text-xs text-ec-ink-3">
      <div className="h-4 w-px bg-ec-line-2" />
      <TransitIcon method={transit.method} />
      <span>{transitLabel(transit, language)}</span>
      {transit.note && <span>· {txt(transit.note, language)}</span>}
    </div>
  );
}

function TourStopCard({ stop, language }: { stop: TourStop; language: Language }) {
  const name = txt(stop.name, language);
  const description = txt(stop.description, language);
  const tip = txt(stop.tip, language);

  return (
    <div className="tour-detail-stop-card flex flex-col gap-4 p-4 sm:flex-row">
      {stop.photo && (() => {
        // P117 (2026-05-20): TourStop.photo 가 string | TourPhoto 둘 다 허용 →
        // resolvePhotoUrl 통합. legacy_public_path 폴백 자동.
        const photoUrl = resolvePhotoUrl(stop.photo);
        if (!photoUrl) return null;
        return (
          <div className="h-44 w-full shrink-0 overflow-hidden rounded-ec-md bg-ec-sunken sm:h-32 sm:w-32 md:h-36 md:w-36">
            <img src={photoUrl} alt={name} className="w-full h-full object-cover" loading="lazy" />
          </div>
        );
      })()}

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-xs font-bold tabular-nums text-ec-brand">
            {stop.time}
          </span>
          <h3 className="min-w-0 text-base font-bold text-ec-ink">{name}</h3>
        </div>

        <div className="mb-2 flex items-center gap-3 text-xs text-ec-ink-3">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {stayLabel(stop.stay_min, language)}
          </span>
          <span className="flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            {entryFeeLabel(stop.entry_fee_krw, language)}
          </span>
        </div>

        <p className="mb-2 text-sm leading-relaxed text-ec-ink-2">{description}</p>

        {tip && (
          <p className="text-xs italic leading-relaxed text-ec-ink-3">
            {language === 'ko' ? '팁: ' : language === 'ja' ? 'ヒント: ' : language === 'zh' ? '小贴士：' : 'Tip: '}
            {tip}
          </p>
        )}

        {stop.naver_map_url && (
          <a
            href={stop.naver_map_url}
            target="_blank"
            rel="noopener noreferrer"
            className="tour-detail-map-link mt-2"
          >
            <ExternalLink className="w-3 h-3" />
            {language === 'ko' ? '네이버 지도' : language === 'ja' ? 'Naverマップ' : language === 'zh' ? 'Naver地图' : 'Naver Map'}
          </a>
        )}
      </div>
    </div>
  );
}
