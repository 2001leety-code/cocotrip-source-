// P6 (2026-04-24): NEW first step — reservation progress check.
//
// Why first: backend RouteAgent quality jumps when arrival_time + airport are
// known up front (recommends limousine vs AREX based on real arrival hour).
// Previously we only collected this in step 3, by which time Gemini already
// guessed during preview generation. Asking up front also lets us short-circuit
// users who already booked everything → free-plan flow (P4 FreeClaimForm).
//
// 4 quadrant cards:
//   nothing       — flight + hotel both not booked yet
//   flight        — flight booked, hotel not
//   flight_hotel  — both booked, AI plan still wanted
//   all_done      — both booked AND user wants free claim flow (handoff to P4)
//
// "flight" / "flight_hotel" reveal a mini-form (airport + arrival HH:MM) so
// real airport/time data is captured early. Hotel address still goes in step 3.
import { useRef, useState } from 'react';
import { Plane, Hotel, CheckCheck, X, ChevronRight } from 'lucide-react';
import type { WizardDict } from './types';
import { getAirportOptions } from './helpers';
import { WizardMissingSummary } from './WizardMissing';
import { revealFirstMissing, type MissingField } from './missingFields';

export type ReservationStatus = 'nothing' | 'flight' | 'flight_hotel' | 'all_done';

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
  // P2 dedup: 호텔도 예약된 경우 (flight_hotel) Step0에서 호텔 주소 같이 받음.
  hotelAddress: string;
  setHotelAddress: (v: string) => void;
  mainCityKey: string;  // for airport options narrowing (defaults to seoul)
  onNext: () => void;
}

const QUADS: { key: ReservationStatus; icon: React.ReactNode; titleKey: string; titleFb: string; subKey: string; subFb: string }[] = [
  { key: 'nothing',      icon: <X className="w-5 h-5" />,          titleKey: 'resNothingTitle',     titleFb: 'Nothing booked yet',           subKey: 'resNothingSub',     subFb: 'Just exploring options' },
  { key: 'flight',       icon: <Plane className="w-5 h-5" />,      titleKey: 'resFlightTitle',      titleFb: 'Flight booked',                subKey: 'resFlightSub',      subFb: 'Need hotel + plan' },
  { key: 'flight_hotel', icon: <Hotel className="w-5 h-5" />,      titleKey: 'resFlightHotelTitle', titleFb: 'Flight + hotel booked',        subKey: 'resFlightHotelSub', subFb: 'Just need the itinerary' },
  { key: 'all_done',     icon: <CheckCheck className="w-5 h-5" />, titleKey: 'resAllDoneTitle',     titleFb: 'All booked through CocoTrip',  subKey: 'resAllDoneSub',     subFb: 'Just need the day-by-day plan' },
];

export function WizardStep0Reservation({
  // Editorial Concierge conversion (2026-08-10): the light system has one accent
  // and no mobile-only shimmer text, so mobile/desktop no longer branch on style.
  // isMobile stays in Step0ResProps for caller compatibility but isn't destructured
  // here (avoids a noUnusedParameters build error) — same pattern as WizardNav.tsx.
  p, status, setStatus,
  arrivalAirport, setArrivalAirport, arrivalTime, setArrivalTime,
  hotelAddress, setHotelAddress,
  mainCityKey, onNext,
}: Step0ResProps) {
  const showAirportForm = status === 'flight' || status === 'flight_hotel';
  const showHotelForm = status === 'flight_hotel';
  const canContinue = status !== null && (
    !showAirportForm || (!!arrivalAirport && !!arrivalTime)
  );
  const airportOptions = getAirportOptions(mainCityKey || 'seoul');

  // 2026-08-18: 이 스텝만 CTA 를 `disabled` 로 잠가 두고 있었다. 회색 버튼은 왜 못 누르는지
  // 말해주지 않는다 — 항공편을 골랐는데 도착 시각을 안 넣으면 그냥 안 눌렸다.
  // 나머지 스텝과 같은 방식으로 바꾼다: 누를 수는 있고, 못 넘어가면 이유를 보여주고
  // 그 칸으로 데려간다.
  const [showErrors, setShowErrors] = useState(false);
  const statusRef = useRef<HTMLDivElement | null>(null);
  const airportRef = useRef<HTMLDivElement | null>(null);
  const timeRef = useRef<HTMLDivElement | null>(null);
  const d = p as Record<string, string>;
  const missing: MissingField[] = [
    ...(status !== null ? [] : [{ key: 'status', label: d.wizardMissingStatus || "Tell us what you've booked so far", ref: statusRef }]),
    ...(showAirportForm && !arrivalAirport
      ? [{ key: 'arrivalAirport', label: d.wizardMissingAirport || 'Select your arrival airport', ref: airportRef }]
      : []),
    ...(showAirportForm && !arrivalTime
      ? [{ key: 'arrivalTime', label: d.wizardMissingArrivalTime || 'Enter your arrival time', ref: timeRef }]
      : []),
  ];

  function handleNext() {
    if (!canContinue) {
      setShowErrors(true);
      revealFirstMissing(missing);
      return;
    }
    onNext();
  }

  return (
    <div className="space-y-3.5 sm:space-y-5">
      <div>
        <h2 className="text-[16px] sm:text-lg font-bold mb-1 text-ec-ink">
          {p.resTitle || 'Where are you in your trip planning?'}
        </h2>
        <p className="text-[12px] sm:text-sm text-ec-ink-3 leading-relaxed">
          {p.resSub || "We'll tailor the rest of the form based on what you've already booked"}
        </p>
      </div>

      {showErrors && (
        <WizardMissingSummary title={d.wizardMissingTitle || 'Still needed before you continue'} missing={missing} />
      )}

      {/* tabIndex={-1}: 프로그램에서 포커스를 주려면 필요하다(탭 순서엔 안 들어간다). */}
      <div ref={statusRef} tabIndex={-1} className="grid grid-cols-2 gap-2 scroll-mt-4 outline-none">
        {QUADS.map(q => {
          const sel = status === q.key;
          const title = (p[q.titleKey as keyof typeof p] as string) || q.titleFb;
          const sub = (p[q.subKey as keyof typeof p] as string) || q.subFb;
          return (
            // 2026-05-03 fix: 사용자가 'flight_hotel' 선택 후 호텔 입력했다가 다른 상태로 바꿀 때
            // hotelAddress 잔존 → Step2에서 "수정" 버튼만 노출되어 입력 불가 버그 방지.
            // status가 flight_hotel이 아닌 값으로 변경되면 hotelAddress 즉시 클리어.
            <button key={q.key} type="button" aria-pressed={sel} onClick={() => {
              setStatus(q.key);
              if (q.key !== 'flight_hotel' && hotelAddress) {
                setHotelAddress('');
              }
              // 2026-05-21 (분기 #2 fix, R-P133 c): nothing/all_done 전환 시 항공편 stale 잔류 차단.
              // 이전엔 flight → nothing 가도 arrivalAirport/arrivalTime 잔존 → backend payload 에
              // 의미 없는 값 forward.
              if ((q.key === 'nothing' || q.key === 'all_done') && (arrivalTime || arrivalAirport)) {
                setArrivalTime('');
                setArrivalAirport('');
              }
            }}
              className={`ec-option min-h-[64px] sm:min-h-[78px] ${sel ? 'is-selected' : ''}`}>
              <span className="flex items-center gap-2.5">
                <span
                  className={`w-8 h-8 rounded-ec-md flex items-center justify-center shrink-0 border border-ec-line ${sel ? 'bg-ec-brand-wash text-ec-brand' : 'bg-ec-sunken text-ec-ink-3'}`}
                >
                  {q.icon}
                </span>
                <span className="min-w-0">
                  <p className="text-[12px] sm:text-[13px] font-bold leading-tight line-clamp-2">{title}</p>
                  <p className="text-[9.5px] sm:text-[10px] text-ec-ink-3 leading-tight mt-0.5 line-clamp-1">{sub}</p>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Mini-form revealed when user has flight info */}
      {showAirportForm && (
        <div className="ec-panel-quiet space-y-3 animate-fadeIn">
          <p className="ec-eyebrow">
            {p.resFlightDetails || 'Flight details (helps us recommend the right airport transit)'}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div ref={airportRef} tabIndex={-1} className="scroll-mt-4 outline-none">
              <label className="block text-[11px] text-ec-ink-3 mb-1">{p.resAirport || 'Arrival airport'}</label>
              <select value={arrivalAirport} onChange={e => setArrivalAirport(e.target.value)}
                className={`ec-field ${showErrors && !arrivalAirport ? 'border-ec-critical' : ''}`}>
                <option value="">{p.resPickAirport || 'Pick…'}</option>
                {airportOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {showErrors && !arrivalAirport && (
                <p className="ec-error-note mt-1.5" role="alert">{d.wizardMissingAirport || 'Select your arrival airport'}</p>
              )}
            </div>
            <div ref={timeRef} tabIndex={-1} className="scroll-mt-4 outline-none">
              <label className="block text-[11px] text-ec-ink-3 mb-1">{p.resArrivalTime || 'Arrival time'}</label>
              <input type="time" value={arrivalTime} onChange={e => setArrivalTime(e.target.value)}
                className={`ec-field ${showErrors && !arrivalTime ? 'border-ec-critical' : ''}`} />
              {showErrors && !arrivalTime && (
                <p className="ec-error-note mt-1.5" role="alert">{d.wizardMissingArrivalTime || 'Enter your arrival time'}</p>
              )}
            </div>
          </div>
          {/* P2 dedup: 호텔도 예약된 경우 (flight_hotel) 호텔 주소도 함께 받음.
              여기서 받으면 Step3에서 칩으로 보여 두 번 안 묻게 됨. */}
          {showHotelForm && (
            <div>
              <label className="block text-[11px] text-ec-ink-3 mb-1">
                {p.resHotelAddress || 'Hotel address'}
                <span className="text-ec-ink-3 ml-1">({p.wizardOptional || 'optional'})</span>
              </label>
              <input type="text" value={hotelAddress} onChange={e => setHotelAddress(e.target.value)}
                placeholder={p.hotel_placeholder || 'e.g. Lotte Hotel Myeongdong...'}
                className="ec-field" />
            </div>
          )}
        </div>
      )}

      {/* P133 (2026-05-21): all_done 안내 박스 — free-claim funnel 제거(2026-05-05) 이후
          CTA 가 step 1 로 그대로 진행하므로 구 funnel 언급 제거.
          2026-08-11: 안내 문구도 "다음 단계에서 무엇을 묻고, 그 답으로 무엇이 나오는지"만
          말한다 — 누가 쓰는지가 아니라. */}
      {status === 'all_done' && (
        <div className="ec-panel-quiet text-sm text-ec-success leading-relaxed">
          {p.resAllDoneNote || "You're all set. The next steps ask for your dates, cities, pace and dietary needs, and your Korea itinerary is written from those."}
        </div>
      )}

      {/* 2026-08-18: `disabled` 를 걷었다. 못 넘어가는 이유를 말해 주는 쪽이 회색 버튼보다 낫다.
          되돌리려면 위 handleNext 주석부터 읽을 것 — 잠금 테스트가 이 자리를 지킨다. */}
      <button onClick={handleNext} type="button"
        className="ec-btn ec-btn-primary w-full">
        {/* P133: all_done 분기도 동일 CTA — 구 funnel 오해 소지 제거. resNext 재사용. */}
        {p.resNext || 'Continue'} <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  );
}
