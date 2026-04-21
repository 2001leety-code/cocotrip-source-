// Timeline place card -- extracted verbatim from legacy PlannerPage.tsx L305-382.
import { MapPin, Clock, Ban, Phone, Banknote, Map, Ticket } from 'lucide-react';
import { CAT_BADGE, CAT_ICON } from '../constants';
import type { Place } from '../types';

export function TimelineCard({ place, index, p }: { place: Place; index: number; p: PlannerDict }) {
  const badgeClass = CAT_BADGE[place.category] ?? 'bg-white/10 text-white/60 border-white/20';
  const catIcon    = CAT_ICON[place.category] ?? <MapPin className="w-3.5 h-3.5" />;
  const mapQuery = place.address || place.name || '';
  const mapUrl = `https://map.naver.com/v5/search/${encodeURIComponent(mapQuery)}`;

  return (
    <div className="flex items-start gap-3">
      {/* Timeline line + number */}
      <div className="flex flex-col items-center shrink-0">
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
          style={{ background: 'linear-gradient(135deg, #C4956A, #B8804A)', boxShadow: '0 0 10px rgba(196,149,106,.35)' }}>
          {index + 1}
        </div>
      </div>

      {/* Card */}
      <div className="flex-1 min-w-0 bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4 mb-1 hover:border-white/20 transition-all duration-200">
        <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-white text-base leading-snug">{place.name}</h3>
            <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium border inline-flex items-center gap-1 ${badgeClass}`}>
              {catIcon} {place.category}
            </span>
          </div>
          {(place.duration || place.admissionFee) && (
            <div className="flex gap-2 shrink-0">
              {place.duration    && <span className="text-[11px] text-white/35 inline-flex items-center gap-0.5"><Clock className="w-3 h-3" /> {place.duration}</span>}
              {place.admissionFee && <span className="text-[11px] text-white/35 inline-flex items-center gap-0.5"><Ticket className="w-3 h-3" /> {place.admissionFee}</span>}
            </div>
          )}
        </div>

        <p className="text-xs text-white/30 mb-1">{place.nameEn}</p>
        <p className="text-xs text-white/45 mb-3 flex items-start gap-1">
          <MapPin className="w-3 h-3 shrink-0 mt-0.5" />{place.address}
        </p>

        {/* Operating info */}
        {(place.openingHours || (place.closedDays && place.closedDays !== 'None' && place.closedDays !== 'none')) && (
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 mb-3">
            {place.openingHours && <span className="text-[11px] text-white/35 inline-flex items-center gap-0.5"><Clock className="w-3 h-3" /> {place.openingHours}</span>}
            {place.closedDays && place.closedDays !== 'None' && place.closedDays !== 'none' &&
              <span className="text-[11px] text-white/35 inline-flex items-center gap-0.5"><Ban className="w-3 h-3" /> {p.placeClosed}: {place.closedDays}</span>}
          </div>
        )}

        {/* Tag pills */}
        {(place.reservationRequired === 'yes' || place.reservationRequired === 'recommended' || place.cashOnly === 'yes') && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {place.reservationRequired === 'yes' && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/12 border border-red-500/25 text-red-300/80 font-medium inline-flex items-center gap-0.5"><Phone className="w-2.5 h-2.5" /> {p.placeReservationRequired}</span>
            )}
            {place.reservationRequired === 'recommended' && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-500/12 border border-yellow-500/25 text-yellow-300/80 font-medium inline-flex items-center gap-0.5"><Phone className="w-2.5 h-2.5" /> {p.placeReservationRecommended}</span>
            )}
            {place.cashOnly === 'yes' && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/8 border border-white/15 text-white/50 font-medium inline-flex items-center gap-0.5"><Banknote className="w-2.5 h-2.5" /> {p.placeCashOnly}</span>
            )}
          </div>
        )}

        {/* Tips */}
        {place.tips && (
          <div className="border-l-2 border-[rgba(196,149,106,.5)] bg-[rgba(196,149,106,.06)] rounded-r-xl px-3 py-2 mb-3">
            <p className="text-xs text-white/65 leading-relaxed">{place.tips}</p>
          </div>
        )}

        {/* Naver Map link */}
        <a href={mapUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#03C75A]/30 bg-[#03C75A]/8 text-[#03C75A] text-xs font-medium hover:bg-[#03C75A]/18 transition-colors">
          <Map className="w-3 h-3" /> {p.placeNaverMap}
        </a>
      </div>
    </div>
  );
}
