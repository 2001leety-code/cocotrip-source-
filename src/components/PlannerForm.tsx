import { useState, useRef, useEffect } from 'react';
import { Pencil, LayoutGrid, MapPin, Users, Zap, Car, Bus, Train, Calendar, AlertTriangle } from 'lucide-react';
import type { Translations } from '@/i18n';

// ── 상수 ────────────────────────────────────────────────────────────
const CATEGORIES = [
  { id: 'K-pop',     subtextKey: 'kpopSubtext' },
  { id: 'K-food',    subtextKey: 'kfoodSubtext' },
  { id: 'K-culture', subtextKey: 'kcultureSubtext' },
  { id: 'K-beauty',  subtextKey: 'kbeautySubtext' },
  { id: 'nature',    subtextKey: 'natureSubtext' },
  { id: 'skiing',    subtextKey: 'skiSubtext' },
  { id: 'shopping',  subtextKey: 'shoppingSubtext' },
  { id: 'heritage',  subtextKey: 'heritageSubtext' },
];

const KPOP_DETAILS = [
  'BTS 성지', 'aespa·NewJeans', 'HYBE 인사이트', 'SM·YG·JYP 투어',
  '뮤직쇼 관람', '홍대 K-pop 클럽', '콘서트 셔틀',
  'K-드라마 촬영지', '아이돌 카페', '굿즈 쇼핑(덕후)',
];

const REGIONS_DATA = [
  { id: 'seoul',       apiValue: '서울'   },
  { id: 'busan',       apiValue: '부산'   },
  { id: 'gangwon',     apiValue: '강원도' },
  { id: 'gyeongju',    apiValue: '경주'   },
  { id: 'jeonju',      apiValue: '전주'   },
  { id: 'incheon',     apiValue: '인천'   },
  { id: 'gapyeong',    apiValue: '가평'   },
  { id: 'pyeongchang', apiValue: '평창'   },
] as const;

const COMPANIONS = [
  { id: 'solo',    labelKey: 'companionSolo' },
  { id: 'couple',  labelKey: 'companionCouple' },
  { id: 'family',  labelKey: 'companionFamily' },
  { id: 'friends', labelKey: 'companionFriends' },
];

const PACES = [
  { id: 'relaxed', labelKey: 'paceRelaxed', descKey: 'paceRelaxedDesc' },
  { id: 'action',  labelKey: 'paceAction',  descKey: 'paceActionDesc' },
];

const CAT_LABELS: Record<string, Record<string, string>> = {
  'K-pop':    { ko: 'K-pop',    en: 'K-pop',    ja: 'K-pop',       zh: 'K-pop' },
  'K-food':   { ko: 'K-food',   en: 'K-food',   ja: 'K-food',      zh: 'K-food' },
  'K-culture':{ ko: 'K-culture',en: 'K-culture',ja: 'K-culture',   zh: 'K-culture' },
  'K-beauty': { ko: 'K-beauty', en: 'K-beauty', ja: 'K-beauty',    zh: 'K-beauty' },
  'nature':   { ko: '자연·힐링', en: 'Nature',   ja: '自然·癒し',    zh: '自然·疗愈' },
  'skiing':   { ko: '스키·레포츠',en: 'Ski·Sports',ja: 'スキー·スポーツ',zh: '滑雪·运动' },
  'shopping': { ko: '쇼핑',     en: 'Shopping', ja: 'ショッピング', zh: '购物' },
  'heritage': { ko: '역사·유산', en: 'Heritage', ja: '歴史·遺産',    zh: '历史·遗产' },
};

// ── 타입 ─────────────────────────────────────────────────────────────
export interface PlannerFormValues {
  categories: string[];
  regions: string[];
  startDate: string;
  endDate: string;
  companion?: string;
  travelPace?: string;
  transport?: 'public' | 'staria' | 'sprinter' | 'bus';
  freeText?: string;
  kpopDetails?: string[];
  arrivalAirport?: string;
  pax?: number;
  durationDays?: number;
  dietPrefs?: string[];
  allergies?: string[];
  priceRange?: string;
  arrival_airport?: string;
  departure_airport?: string;
  hotel_address?: string;
  mobility?: string;
  uid?: string | null;
}

interface Props {
  onSubmit: (values: PlannerFormValues) => void;
  isLoading: boolean;
  t: Translations;
  lang?: string;
}

// ── 헬퍼 ─────────────────────────────────────────────────────────────
function isoDate(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function nightsBetween(s: string, e: string) {
  return Math.round((new Date(e).getTime() - new Date(s).getTime()) / 86400000);
}
function nightsLabel(p: Record<string, unknown>, n: number) {
  if (n === 0) return p.calDayTrip as string;
  return (p.calNightsTravel as string).replace('{n}', String(n)).replace('{m}', String(n + 1));
}
function confirmLabel(p: Record<string, unknown>, n: number) {
  if (n === 0) return p.calDaySelected as string;
  return (p.calConfirmN as string).replace('{n}', String(n)).replace('{m}', String(n + 1));
}

// ── SectionLabel ──────────────────────────────────────────────────────
function SectionLabel({ icon, text }: { icon?: React.ReactNode; text: string }) {
  return (
    <p className="text-[11px] uppercase tracking-[.06em] text-white/40 font-semibold mb-3 flex items-center gap-1.5">
      {icon}{text}
    </p>
  );
}

// ── CalendarPicker ───────────────────────────────────────────────────
export function CalendarPicker({ startDate, endDate, onDateChange, p, lang: _lang = 'en' }: {
  startDate: string; endDate: string;
  onDateChange: (s: string, e: string) => void;
  p: Record<string, unknown>; lang?: string;
}) {
  const now = new Date();
  const todayStr = isoDate(now.getFullYear(), now.getMonth(), now.getDate());

  const [open, setOpen]           = useState(false);
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const [viewYear, setViewYear]   = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [picking, setPicking]     = useState<'start' | 'end'>('start');
  const [tmpS, setTmpS]           = useState(startDate);
  const [tmpE, setTmpE]           = useState(endDate);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setTmpS(startDate); setTmpE(endDate); }, [startDate, endDate]);

  useEffect(() => {
    if (!open) return;
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [open]);

  const nights = tmpS && tmpE ? nightsBetween(tmpS, tmpE) : 0;

  function applyQuick(n: number) {
    const s = todayStr;
    const d = new Date(); d.setDate(d.getDate() + n);
    const e = isoDate(d.getFullYear(), d.getMonth(), d.getDate());
    setTmpS(s); setTmpE(e); setPicking('start');
  }

  function handleDay(d: string) {
    if (d < todayStr) return;
    if (picking === 'start') { setTmpS(d); setTmpE(''); setPicking('end'); }
    else {
      if (d < tmpS) { setTmpE(tmpS); setTmpS(d); } else setTmpE(d);
      setPicking('start');
    }
  }

  function confirm() {
    if (tmpS && tmpE) { onDateChange(tmpS, tmpE); setOpen(false); }
  }

  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => isoDate(viewYear, viewMonth, i + 1)),
  ];

  function cellState(d: string | null) {
    if (!d) return 'blank';
    if (d < todayStr) return 'past';
    const eff = tmpE || (picking === 'end' && hoverDate && hoverDate >= tmpS ? hoverDate : '');
    if (d === tmpS) return 'start';
    if (d === eff) return 'end';
    if (tmpS && eff && d > tmpS && d < eff) return 'range';
    if (d === todayStr) return 'today';
    return 'normal';
  }

  const wds: string[] = Array.isArray(p.calWeekdays) ? p.calWeekdays : ['S','M','T','W','T','F','S'];
  const mons: string[] = Array.isArray(p.calMonths) ? p.calMonths : [];
  const hdr = (p.calYearMonth as string ?? '{month} {year}')
    .replace('{year}', String(viewYear))
    .replace('{month}', mons[viewMonth] ?? String(viewMonth + 1));

  const hasSelection = startDate && endDate;

  return (
    <div ref={ref} className="relative">
      <div className="grid grid-cols-2 gap-2">
        {[{ lk: 'calCheckIn', val: startDate }, { lk: 'calCheckOut', val: endDate }].map((btn, i) => (
          <button key={i} type="button"
            onClick={() => { setOpen(true); setPicking(i === 0 ? 'start' : 'end'); }}
            className={`flex flex-col items-start px-4 py-3 rounded-xl border text-left transition-all duration-200 ${
              open ? 'border-[rgba(124,92,252,.5)] bg-[rgba(124,92,252,.06)]' : 'border-white/15 bg-white/[0.04] hover:border-white/30'
            }`}>
            <span className="text-[10px] text-white/35 uppercase tracking-wider mb-0.5">{String(p[btn.lk] ?? '')}</span>
            {btn.val
              ? <span className="text-sm font-semibold text-white">{btn.val}</span>
              : <span className="text-sm text-white/25">{String(p.calSelectDate ?? '')}</span>}
          </button>
        ))}
      </div>

      {hasSelection && !open && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-white/45">{nightsLabel(p, nights)}</span>
          <button type="button" onClick={() => setOpen(true)}
            className="text-xs text-[#7C5CFC] underline underline-offset-2">{String(p.calChange ?? '')}</button>
        </div>
      )}

      {open && (
        <div className="mt-2 rounded-2xl border border-white/15 overflow-hidden shadow-2xl"
          style={{ background: '#0d1526' }}>
          {/* info bar */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 bg-white/[0.025]">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-white/35 uppercase tracking-wider">{String(p.calDepart ?? '')}</p>
              <p className="text-sm font-semibold text-white truncate">{tmpS || '—'}</p>
            </div>
            <div className="w-px h-8 bg-white/10 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-white/35 uppercase tracking-wider">{String(p.calReturn ?? '')}</p>
              <p className="text-sm font-semibold text-white truncate">{tmpE || '—'}</p>
            </div>
            {tmpS && tmpE && (
              <span className="shrink-0 text-xs bg-[rgba(124,92,252,.2)] border border-[rgba(124,92,252,.4)] text-[#b09eff] px-2.5 py-1 rounded-full font-medium">
                {nightsLabel(p, nights)}
              </span>
            )}
          </div>

          {/* quick chips */}
          <div className="flex gap-2 px-4 py-3 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            {[
              { l: p.calQuick1, n: 0 }, { l: p.calQuick2, n: 1 },
              { l: p.calQuick3, n: 2 }, { l: p.calQuick5, n: 4 },
              { l: p.calQuick8, n: 7 },
            ].map(q => (
              <button key={q.n} type="button" onClick={() => applyQuick(q.n)}
                className="shrink-0 px-3 py-1.5 rounded-full text-xs border border-white/12 bg-white/[0.04] text-white/55 hover:border-[rgba(124,92,252,.4)] hover:text-[#9d7ffe] hover:bg-[rgba(124,92,252,.08)] transition-all duration-200">
                {String(q.l ?? '')}
              </button>
            ))}
          </div>

          {/* month nav */}
          <div className="flex items-center justify-between px-4 pb-1">
            <button type="button" onClick={() => viewMonth === 0 ? (setViewYear(y => y-1), setViewMonth(11)) : setViewMonth(m => m-1)}
              className="w-8 h-8 rounded-full border border-white/12 text-white/45 hover:text-white hover:border-white/30 flex items-center justify-center transition-all">‹</button>
            <p className="text-sm font-semibold text-white">{hdr}</p>
            <button type="button" onClick={() => viewMonth === 11 ? (setViewYear(y => y+1), setViewMonth(0)) : setViewMonth(m => m+1)}
              className="w-8 h-8 rounded-full border border-white/12 text-white/45 hover:text-white hover:border-white/30 flex items-center justify-center transition-all">›</button>
          </div>

          {/* weekday headers */}
          <div className="grid grid-cols-7 px-3 pb-1">
            {wds.map((wd, i) => (
              <div key={i} className={`text-center text-[10px] font-semibold py-1 ${i===0?'text-[#E24B4A]/65':i===6?'text-[#378ADD]/65':'text-white/28'}`}>{wd}</div>
            ))}
          </div>

          {/* day grid */}
          <div className="grid grid-cols-7 px-3 pb-3 gap-y-0.5">
            {cells.map((d, idx) => {
              if (!d) return <div key={idx} />;
              const st = cellState(d);
              const dow = idx % 7;
              const isPast = st === 'past';
              const isStart = st === 'start';
              const isEnd = st === 'end';
              const isRange = st === 'range';
              const isToday = st === 'today';
              return (
                <div key={d} className="relative flex items-center justify-center h-9"
                  onMouseEnter={() => setHoverDate(d)} onMouseLeave={() => setHoverDate(null)}>
                  {isRange && <div className="absolute inset-y-1 inset-x-0 bg-[rgba(124,92,252,.1)]" />}
                  {isStart && tmpE && <div className="absolute inset-y-1 left-1/2 right-0 bg-[rgba(124,92,252,.1)]" />}
                  {isEnd && tmpS && <div className="absolute inset-y-1 left-0 right-1/2 bg-[rgba(124,92,252,.1)]" />}
                  <button type="button" disabled={isPast} onClick={() => handleDay(d)}
                    className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center text-sm transition-all duration-150 ${
                      isPast    ? 'text-white/18 cursor-not-allowed' :
                      isStart||isEnd ? 'bg-[#7C5CFC] text-white font-bold shadow-[0_0_10px_rgba(124,92,252,.45)]' :
                      isRange   ? 'text-white/75 hover:bg-white/10' :
                      isToday   ? 'border border-[#7C5CFC] text-[#9d7ffe] font-semibold' :
                      `hover:bg-white/10 ${dow===0?'text-[#E24B4A]/75':dow===6?'text-[#378ADD]/75':'text-white/65'}`
                    }`}>
                    {parseInt(d.split('-')[2])}
                  </button>
                </div>
              );
            })}
          </div>

          {/* actions */}
          <div className="flex gap-2 px-4 pb-4">
            <button type="button" onClick={() => { setTmpS(''); setTmpE(''); setPicking('start'); }}
              className="flex-1 py-2.5 rounded-xl border border-white/12 text-sm text-white/45 hover:border-white/25 hover:text-white/65 transition-all">
              {String(p.calClear ?? '')}
            </button>
            <button type="button" onClick={confirm} disabled={!tmpS || !tmpE}
              className="flex-[2] py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-35 disabled:cursor-not-allowed"
              style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)' }}>
              {tmpS && tmpE ? confirmLabel(p, nights) : String(p.calSelectStart ?? '')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Form ────────────────────────────────────────────────────────
export function PlannerForm({ onSubmit, isLoading, t, lang = 'en' }: Props) {
  const p = t.planner as Record<string, any>;

  const [categories,        setCategories]        = useState<string[]>([]);
  const [kpopDetails,       setKpopDetails]       = useState<string[]>([]);
  const [selectedRegionIds, setSelectedRegionIds] = useState<string[]>([]);
  const [companion,         setCompanion]         = useState('');
  const [travelPace,        setTravelPace]        = useState('');
  const [transport,         setTransport]         = useState<'public'|'staria'|'sprinter'|'bus'|''>('');
  const [startDate,         setStartDate]         = useState('');
  const [endDate,           setEndDate]           = useState('');
  const [freeText,          setFreeText]          = useState('');
  const [error,             setError]             = useState<string | null>(null);

  const kpopSelected = categories.includes('K-pop');

  function toggleCat(id: string) {
    setCategories(p => p.includes(id) ? p.filter(c => c !== id) : [...p, id]);
    if (id === 'K-pop') setKpopDetails([]);
  }
  function toggleKpop(d: string) {
    setKpopDetails(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d]);
  }
  function toggleRegion(id: string) {
    setSelectedRegionIds(p => p.includes(id) ? p.filter(r => r !== id) : [...p, id]);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (categories.length === 0)    return setError(p.errCategory);
    if (selectedRegionIds.length === 0) return setError(p.errRegion);
    if (!startDate || !endDate)     return setError(p.errDate);
    if (startDate > endDate)        return setError(p.errDateOrder);
    const diff = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1;
    if (diff > 7) return setError(p.errDateRange);
    const regions = selectedRegionIds.map(id => REGIONS_DATA.find(r => r.id === id)!.apiValue);
    onSubmit({
      categories, regions, startDate, endDate,
      companion:   companion   || undefined,
      travelPace:  travelPace  || undefined,
      transport:  (transport as 'public'|'staria'|'sprinter'|'bus') || undefined,
      freeText:    freeText.trim() || undefined,
      kpopDetails: kpopDetails.length > 0 ? kpopDetails : undefined,
    });
  }

  const canSubmit = categories.length > 0 && selectedRegionIds.length > 0 && !!startDate && !!endDate && !isLoading;

  const div = 'border-t border-white/[0.07] pt-6 mt-6';
  const chipSel  = 'bg-[rgba(124,92,252,.12)] border-[rgba(124,92,252,.5)] text-[#9d7ffe]';
  const chipBase = 'border-white/12 bg-white/[0.04] text-white/55 hover:border-white/25 hover:text-white/75';
  const subSel   = 'bg-[rgba(234,83,126,.10)] border-[rgba(234,83,126,.4)] text-[#EA537E]';
  const subBase  = 'border-white/10 bg-white/[0.03] text-white/45 hover:border-white/20 hover:text-white/65';
  const btnSel   = 'bg-[rgba(124,92,252,.10)] border-[rgba(124,92,252,.45)] text-[#9d7ffe]';
  const btnBase  = 'border-white/10 bg-white/[0.04] text-white/50 hover:border-white/22 hover:text-white/70';

  return (
    <form onSubmit={handleSubmit}>

      {/* ── 00 자유 요청 */}
      <div>
        <SectionLabel icon={<Pencil className="w-3 h-3" />} text={p.freeTextLabel} />
        <textarea
          value={freeText} onChange={e => setFreeText(e.target.value)}
          placeholder={p.freeTextPlaceholder} rows={3}
          className="w-full px-4 py-3 rounded-xl border border-white/12 bg-white/[0.04] text-white/80 text-sm placeholder:text-white/22 outline-none focus:border-[rgba(124,92,252,.4)] transition-all duration-200 resize-none leading-relaxed"
        />
      </div>

      {/* ── 01 관심사 */}
      <div className={div}>
        <SectionLabel icon={<LayoutGrid className="w-3 h-3" />} text={p.categoryLabel} />
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map(cat => {
            const active = categories.includes(cat.id);
            return (
              <button key={cat.id} type="button" onClick={() => toggleCat(cat.id)}
                className={`px-3.5 py-2 rounded-full border text-sm font-medium transition-all duration-200 ${active ? chipSel : chipBase}`}>
                {CAT_LABELS[cat.id]?.[lang] ?? cat.id}
              </button>
            );
          })}
        </div>

        {kpopSelected && (
          <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.025] p-3">
            <p className="text-[10px] text-white/30 uppercase tracking-widest mb-2.5 font-semibold">{p.kpopDetailsLabel}</p>
            <div className="flex flex-wrap gap-1.5">
              {KPOP_DETAILS.map(d => {
                const active = kpopDetails.includes(d);
                return (
                  <button key={d} type="button" onClick={() => toggleKpop(d)}
                    className={`px-2.5 py-1 rounded-full border text-xs font-medium transition-all duration-200 ${active ? subSel : subBase}`}>
                    {d}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── 02 지역 */}
      <div className={div}>
        <SectionLabel icon={<MapPin className="w-3 h-3" />} text={p.regionLabel} />
        <div className="grid grid-cols-4 gap-2">
          {REGIONS_DATA.map(r => {
            const active = selectedRegionIds.includes(r.id);
            const name = p.regionNames?.[r.id] ?? r.apiValue;
            const vibeKey = 'vibe' + r.id.charAt(0).toUpperCase() + r.id.slice(1);
            const vibe = p[vibeKey] ?? '';
            return (
              <button key={r.id} type="button" onClick={() => toggleRegion(r.id)}
                className={`flex flex-col items-center gap-1 py-3 px-1 rounded-xl border transition-all duration-200 ${
                  active ? 'bg-[rgba(124,92,252,.10)] border-[rgba(124,92,252,.45)]' : 'border-white/10 bg-white/[0.04] hover:border-white/22'
                }`}>
                <span className={`text-[12px] font-bold leading-snug text-center ${active ? 'text-[#9d7ffe]' : 'text-white/70'}`}>{name}</span>
                {vibe && <span className="text-[9px] text-white/28 leading-tight text-center px-1">{vibe}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 03 동행자 + 속도 */}
      <div className={div}>
        <div className="grid grid-cols-2 gap-5">
          <div>
            <SectionLabel icon={<Users className="w-3 h-3" />} text={p.companionLabel} />
            <div className="grid grid-cols-2 gap-1.5">
              {COMPANIONS.map(c => {
                const active = companion === c.id;
                return (
                  <button key={c.id} type="button" onClick={() => setCompanion(active ? '' : c.id)}
                    className={`flex items-center gap-1.5 px-2 py-2.5 rounded-xl border text-sm font-medium transition-all duration-200 ${active ? btnSel : btnBase}`}>
                    <span className="truncate text-xs">{p[c.labelKey]}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <SectionLabel icon={<Zap className="w-3 h-3" />} text={p.paceLabel} />
            <div className="grid grid-cols-1 gap-1.5">
              {PACES.map(pace => {
                const active = travelPace === pace.id;
                return (
                  <button key={pace.id} type="button" onClick={() => setTravelPace(active ? '' : pace.id)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all duration-200 ${active ? btnSel : btnBase}`}>
                    <div className="text-left min-w-0">
                      <p className="text-xs font-semibold leading-tight">{p[pace.labelKey]}</p>
                      <p className="text-[10px] text-white/30 leading-tight">{p[pace.descKey]}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── 04 이동 수단 */}
      <div className={div}>
        <SectionLabel icon={<Car className="w-3 h-3" />} text={p.transportLabel} />
        <div className="flex flex-col gap-2">
          {/* 대중교통 */}
          <button type="button" onClick={() => setTransport(transport === 'public' ? '' : 'public')}
            className={`flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-medium transition-all duration-200 ${transport === 'public' ? btnSel : btnBase}`}>
            <Train className="w-4 h-4" />
            <span>{p.transportPublic}</span>
          </button>
          {/* 차량 선택 헤더 */}
          <p className="text-[10px] uppercase tracking-[.06em] text-white/35 font-semibold mt-1 mb-0.5 px-1">{p.vehicleSelectType}</p>
          {/* 스타리아 */}
          <button type="button" onClick={() => setTransport(transport === 'staria' ? '' : 'staria')}
            className={`flex items-start gap-3 px-4 py-3 rounded-xl border text-sm font-medium transition-all duration-200 ${transport === 'staria' ? btnSel : btnBase}`}>
            <Car className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="text-left">
              <p className="font-semibold">{p.vehicleStaria}</p>
              <p className="text-[11px] text-white/45 font-normal mt-0.5">{p.transportCharter}</p>
            </div>
          </button>
          {/* 스프린터 */}
          <button type="button" onClick={() => setTransport(transport === 'sprinter' ? '' : 'sprinter')}
            className={`flex items-start gap-3 px-4 py-3 rounded-xl border text-sm font-medium transition-all duration-200 ${transport === 'sprinter' ? btnSel : btnBase}`}>
            <Bus className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="text-left">
              <p className="font-semibold">{p.vehicleSprinter}</p>
              <p className="text-[11px] text-amber-400/70 font-normal mt-0.5">{p.vehicleGuideRequired}</p>
            </div>
          </button>
          {/* 대형버스 */}
          <button type="button" onClick={() => setTransport(transport === 'bus' ? '' : 'bus')}
            className={`flex items-start gap-3 px-4 py-3 rounded-xl border text-sm font-medium transition-all duration-200 ${transport === 'bus' ? btnSel : btnBase}`}>
            <Bus className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="text-left">
              <p className="font-semibold">{p.vehicleBus}</p>
              <p className="text-[11px] text-amber-400/70 font-normal mt-0.5">{p.vehicleCustomQuote} · {p.vehicleGuideRequired}</p>
            </div>
          </button>
        </div>
        {/* 가이드 안내 박스 */}
        {(transport === 'sprinter' || transport === 'bus') && (
          <div className="mt-3 flex items-start gap-2 bg-amber-500/10 border border-amber-500/25 rounded-xl px-4 py-3">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-200/80 leading-relaxed">{p.vehicleGuideNote}</p>
          </div>
        )}
      </div>

      {/* ── 05 날짜 */}
      <div className={div}>
        <SectionLabel icon={<Calendar className="w-3 h-3" />} text={p.dateLabel} />
        <CalendarPicker startDate={startDate} endDate={endDate}
          onDateChange={(s, e) => { setStartDate(s); setEndDate(e); }} p={p} lang={lang} />
      </div>

      {/* 에러 */}
      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mt-5">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {/* 제출 */}
      <div className="mt-7">
        <button type="submit" disabled={!canSubmit}
          style={canSubmit ? { background: 'linear-gradient(135deg,#7C5CFC,#EA537E)' } : {}}
          className="w-full py-3.5 rounded-xl text-white text-[15px] font-medium transition-all duration-300 disabled:bg-white/10 disabled:text-white/30 disabled:cursor-not-allowed hover:opacity-88 flex items-center justify-center gap-2">
          {isLoading
            ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{p.generating}</>
            : p.generateBtn}
        </button>
      </div>
    </form>
  );
}
