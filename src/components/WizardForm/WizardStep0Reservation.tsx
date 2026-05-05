// P6 (2026-04-24): NEW first step — reservation progress check.
//
// Why first: backend RouteAgent quality jumps when arrival_time + airport are
// known up front (recommends limousine vs AREX based on real arrival hour).
// Previously we only collected this in step 3, by which time Gemini already
// guessed during preview generation.
//
// 2026-05-05: simplified from 4 quadrants → 2 options. The free-claim
// (`all_done`) and `flight_hotel` paths are removed since the free-claim
// funnel was retired. Hotel address is collected only in Step 2.
//
// 2 options:
//   nothing — flight (and hotel) not booked yet
//   flight  — flight booked, hotel may or may not be booked
//
// "flight" reveals a mini-form (airport + arrival HH:MM) so real airport/
// time data is captured early. Hotel address is collected in step 2.
import { Plane, X, ChevronRight } from 'lucide-react';
import type { WizardDict } from './types';
import { getAirportOptions } from './helpers';

export type ReservationStatus = 'nothing' | 'flight';

interface Step0ResProps {
  p: WizardDict;
  isMobile: boolean;
  status: ReservationStatus | null;
  setStatus: (v: ReservationStatus) => void;
  // Mini-form fields revealed when flight booked
  arrivalAirport: string;
  setArrivalAirport: (v: string) => void;
  arrivalTime: string;
  setArrivalTime: (v: string) => void;
  mainCityKey: string;  // for airport options narrowing (defaults to seoul)
  onNext: () => void;
}

const QUESTIONS: { key: ReservationStatus; icon: React.ReactNode; titleKey: string; titleFb: string; subKey: string; subFb: string }[] = [
  { key: 'nothing', icon: <X className="w-5 h-5" />,     titleKey: 'resNothingTitle', titleFb: 'Nothing booked yet', subKey: 'resNothingSub', subFb: 'Just exploring options' },
  { key: 'flight',  icon: <Plane className="w-5 h-5" />, titleKey: 'resFlightTitle',  titleFb: 'Flight booked',      subKey: 'resFlightSub',  subFb: 'Need plan + (optionally) hotel' },
];

export function WizardStep0Reservation({
  p, isMobile, status, setStatus,
  arrivalAirport, setArrivalAirport, arrivalTime, setArrivalTime,
  mainCityKey, onNext,
}: Step0ResProps) {
  const showAirportForm = status === 'flight';
  const canContinue = status !== null && (
    !showAirportForm || (!!arrivalAirport && !!arrivalTime)
  );
  const airportOptions = getAirportOptions(mainCityKey || 'seoul');

  return (
    <div className="space-y-5">
      <div>
        <h2 className={`text-[17px] sm:text-lg font-bold mb-1 ${isMobile ? 'm-shimmer-text' : 'text-white'}`}>
          {p.resTitle || 'Where are you in your trip planning?'}
        </h2>
        <p className="text-[13px] sm:text-sm text-white/55">
          {p.resSub || "We'll tailor the rest of the form based on what you've already booked"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {QUESTIONS.map(q => {
          const sel = status === q.key;
          const accent = isMobile ? '#B668FC' : '#7C5CFC';
          const title = (p[q.titleKey as keyof typeof p] as string) || q.titleFb;
          const sub = (p[q.subKey as keyof typeof p] as string) || q.subFb;
          return (
            <button key={q.key} type="button" onClick={() => setStatus(q.key)}
              className={`flex flex-col items-start gap-1 p-3 rounded-xl border text-left transition-all ${
                sel
                  ? 'border-transparent text-white shadow-lg'
                  : 'border-white/[0.1] bg-white/[0.04] text-white/65 hover:border-white/25'
              }`}
              style={sel ? {
                background: 'linear-gradient(135deg,rgba(124,92,252,.30),rgba(234,83,126,.20))',
                borderColor: `${accent}90`,
              } : {}}>
              <span className={sel ? 'text-white' : 'text-white/55'}>{q.icon}</span>
              <p className="text-[13px] font-bold leading-tight">{title}</p>
              <p className="text-[10px] text-white/55 leading-tight">{sub}</p>
            </button>
          );
        })}
      </div>

      {/* Mini-form revealed when user has flight info */}
      {showAirportForm && (
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-4 space-y-3 animate-fadeIn">
          <p className="text-[11px] uppercase tracking-wider text-white/55 font-semibold">
            {p.resFlightDetails || 'Flight details (helps us recommend the right airport transit)'}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-white/50 mb-1">{p.resAirport || 'Arrival airport'}</label>
              <select value={arrivalAirport} onChange={e => setArrivalAirport(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/15 text-white text-sm outline-none focus:border-[#7C5CFC]">
                <option value="">{p.resPickAirport || 'Pick…'}</option>
                {airportOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-white/50 mb-1">{p.resArrivalTime || 'Arrival time'}</label>
              <input type="time" value={arrivalTime} onChange={e => setArrivalTime(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/15 text-white text-sm outline-none focus:border-[#7C5CFC]" />
            </div>
          </div>
        </div>
      )}

      <button onClick={onNext} disabled={!canContinue}
        className="w-full py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-35 hover:scale-[1.03] transition-all"
        style={{ background: canContinue ? (isMobile ? 'linear-gradient(135deg,#B668FC,#FF6B9D)' : 'linear-gradient(135deg,#7C5CFC,#EA537E)') : 'rgba(255,255,255,.1)' }}>
        {p.resNext || 'Continue'} <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  );
}
