// Step 3: summary review + generate button.
import { MapPin, Users, Calendar, ChevronLeft, Plane, Sparkles, Check, Wallet, Shield } from 'lucide-react';
import { AIRPORT_DISPLAY } from './data';
import { SummaryCard, formatDateShort } from './helpers';
import type { WizardDict } from './types';

interface Step3Props {
  p: WizardDict;
  allCities: string[];
  startDate: string;
  endDate: string;
  arrivalTerminal: string;
  pax: number;
  selectedActivities: string[];
  hotelAddress: string;
  isLoading: boolean;
  errorMsg: string;
  onEditStep: (step: number) => void;
  onGenerate: () => void;
}

export function WizardStep3Review(props: Step3Props) {
  const {
    p, allCities, startDate, endDate, arrivalTerminal, pax, selectedActivities, hotelAddress,
    isLoading, errorMsg, onEditStep, onGenerate,
  } = props;

  const airportLabel = AIRPORT_DISPLAY[arrivalTerminal] || arrivalTerminal || '-';

  return (
    <div className="space-y-5">
      <h2 className="text-[17px] sm:text-lg font-bold text-white">{p.wizardReviewTitle || 'Review Your Trip'}</h2>

      {/* Summary cards */}
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-3.5 sm:p-5 space-y-3 sm:space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button onClick={() => onEditStep(0)} className="text-left hover:ring-1 hover:ring-[#7C5CFC]/40 rounded-xl transition-all">
            <SummaryCard icon={<MapPin className="w-4 h-4" />} label={p.wizardDestination || 'Destination'} value={allCities[0] || '-'} />
          </button>
          <button onClick={() => onEditStep(2)} className="text-left hover:ring-1 hover:ring-[#7C5CFC]/40 rounded-xl transition-all">
            <SummaryCard icon={<Calendar className="w-4 h-4" />} label={p.wizardDates || 'Dates'} value={startDate && endDate ? `${formatDateShort(startDate)} - ${formatDateShort(endDate)}` : 'TBD'} />
          </button>
          <button onClick={() => onEditStep(2)} className="text-left hover:ring-1 hover:ring-[#7C5CFC]/40 rounded-xl transition-all">
            <SummaryCard icon={<Plane className="w-4 h-4" />} label={p.wizardAirport || 'Airport'} value={airportLabel} />
          </button>
          <button onClick={() => onEditStep(2)} className="text-left hover:ring-1 hover:ring-[#7C5CFC]/40 rounded-xl transition-all">
            <SummaryCard icon={<Users className="w-4 h-4" />} label={p.wizardTravelers || 'Travelers'} value={`${pax} ${p.wizardPaxUnit || 'pax'}`} />
          </button>
        </div>

        <div className="text-xs text-white/40 space-y-1 border-t border-white/[0.06] pt-3">
          <p><span className="text-white/25">{p.wizardActivitiesLabel || 'Activities'}:</span> <span className="text-white/60">{selectedActivities.map(a => p[`act${a}`] || a).join(', ') || '-'}</span></p>
          {hotelAddress && <p><span className="text-white/25">{p.wizardHotelLabel || 'Hotel'}:</span> <span className="text-white/60">{hotelAddress}</span></p>}
        </div>

        <p className="text-[10px] text-white/20 text-center">{p.wizardTapToEdit || 'Tap any card to edit'}</p>
      </div>

      {/* What You'll Get */}
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-4 sm:p-5">
        <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2"><Sparkles className="w-4 h-4 text-[#7C5CFC]" /> {p.wizardWhatYouGet || "What You'll Get"}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {([p.wizardGetItem1, p.wizardGetItem2, p.wizardGetItem3, p.wizardGetItem4, p.wizardGetItem5, p.wizardGetItem6, p.wizardGetItem7, p.wizardGetItem8].filter(Boolean) as string[]).map((item: string, i: number) => (
            <div key={i} className="flex items-start gap-2 text-xs text-white/50">
              <Check className="w-3.5 h-3.5 text-green-400/70 shrink-0 mt-0.5" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Price + Generate */}
      <div className="bg-gradient-to-br from-[#7C5CFC]/10 to-[#EA537E]/10 border border-[#7C5CFC]/20 rounded-2xl p-5 text-center space-y-4">
        <div>
          <p className="text-sm text-white/50 mb-1">{p.wizardAiPlan || 'AI Travel Plan'}</p>
          <div className="flex items-center justify-center gap-2">
            <span className="text-3xl font-bold text-white">$9.90</span>
            <span className="text-sm text-white/30">/ &#8361;13,300</span>
          </div>
        </div>

        {errorMsg && (
          <div className="bg-red-500/15 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-300">
            {errorMsg}
          </div>
        )}

        <button onClick={onGenerate} disabled={isLoading}
          className="w-full py-4 rounded-2xl text-base font-bold text-white flex items-center justify-center gap-2 transition-all hover:scale-[1.01] disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)', boxShadow: '0 4px 28px rgba(124,92,252,.4)' }}>
          <Shield className="w-5 h-5" />
          {isLoading ? (p.generating || 'Creating your itinerary...') : (p.wizardGenerateBtn || 'Generate AI Itinerary')}
        </button>

        <p className="text-[10px] text-white/30 flex items-center justify-center gap-1">
          <Wallet className="w-3 h-3" /> {p.wizardPaymentNote || 'Takes about 15 seconds after payment'}
        </p>
      </div>

      {/* Back */}
      <button onClick={() => onEditStep(2)}
        className="w-full py-3 rounded-2xl border border-white/[0.1] text-white/40 hover:text-white text-sm font-semibold flex items-center justify-center gap-1 transition-all">
        <ChevronLeft className="w-4 h-4" /> {p.planner_step2_date || 'Back to Details'}
      </button>
    </div>
  );
}
