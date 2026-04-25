// TourStopList — TourDetailPage에서 stops 시간순 인터리브 렌더.
// Stop -> Transit -> Stop -> Transit -> ... PlanDetailPage 패턴 차용.
import { Footprints, Car, Train, MapPin, Clock, ExternalLink } from 'lucide-react';
import type { TourStop, TourTransit, I18nString } from '@/data/tours';
import type { Language } from '@/i18n';

function txt(field: I18nString | undefined, lang: Language): string {
  if (!field) return '';
  return field[lang] || field.en || field.ko || '';
}

function transitMethodIcon(method: TourTransit['method']) {
  if (method === 'walk') return Footprints;
  if (method === 'transit') return Train;
  return Car;
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
  const Icon = transitMethodIcon(transit.method);
  return (
    <div className="flex items-center gap-2 pl-5 py-2 text-[11px] text-white/35">
      <div className="w-px h-3 bg-white/15" />
      <Icon className="w-3.5 h-3.5" />
      <span>{transitLabel(transit, language)}</span>
      {transit.note && <span className="text-white/25">· {txt(transit.note, language)}</span>}
    </div>
  );
}

function TourStopCard({ stop, language }: { stop: TourStop; language: Language }) {
  const name = txt(stop.name, language);
  const description = txt(stop.description, language);
  const tip = txt(stop.tip, language);

  return (
    <div
      className="rounded-2xl p-4 flex gap-3"
      style={{
        background: 'rgba(255,255,255,0.025)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {stop.photo && (
        <div className="w-28 h-28 md:w-36 md:h-36 shrink-0 rounded-xl overflow-hidden bg-white/[0.04]">
          <img src={stop.photo} alt={name} className="w-full h-full object-cover" loading="lazy" />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-[11px] font-bold tabular-nums" style={{ color: '#B668FC' }}>
            {stop.time}
          </span>
          <h3 className="text-[14px] font-black text-white truncate">{name}</h3>
        </div>

        <div className="flex items-center gap-3 text-[10px] text-white/35 mb-1.5">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {stayLabel(stop.stay_min, language)}
          </span>
          <span className="flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            {entryFeeLabel(stop.entry_fee_krw, language)}
          </span>
        </div>

        <p className="text-[12px] text-white/55 leading-snug mb-1.5">{description}</p>

        {tip && (
          <p className="text-[11px] text-white/40 italic leading-snug">
            {language === 'ko' ? '팁: ' : language === 'ja' ? 'ヒント: ' : language === 'zh' ? '小贴士：' : 'Tip: '}
            {tip}
          </p>
        )}

        {stop.naver_map_url && (
          <a
            href={stop.naver_map_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-2 text-[10px] text-white/40 hover:text-white/70"
          >
            <ExternalLink className="w-3 h-3" />
            {language === 'ko' ? '네이버 지도' : language === 'ja' ? 'Naverマップ' : language === 'zh' ? 'Naver地图' : 'Naver Map'}
          </a>
        )}
      </div>
    </div>
  );
}
