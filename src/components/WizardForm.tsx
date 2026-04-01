import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
import type { PlannerFormValues } from './PlannerForm';
import { CalendarPicker } from './PlannerForm';
import {
  Plane, MapPin, Pencil, Calendar, Users, Target, CreditCard, Gem, Coins,
  TrainFront, Car, Landmark, UtensilsCrossed, Leaf, Music, ShoppingBag,
  Zap, Heart, Camera, Check, Sparkles, ArrowRight, ArrowLeft, Bus
} from 'lucide-react';

// ── 상수 ──────────────────────────────────────────────────────────────
const WIZARD_REGIONS = [
  { id: 'seoul',     apiValue: '서울' },
  { id: 'busan',     apiValue: '부산' },
  { id: 'jeju',      apiValue: '제주' },
  { id: 'gyeongju',  apiValue: '경주' },
  { id: 'jeonju',    apiValue: '전주' },
  { id: 'gangneung', apiValue: '강릉' },
  { id: 'gapyeong',  apiValue: '가평' },
  { id: 'sokcho',    apiValue: '속초' },
];

const AIRPORTS = [
  { id: 'ICN', sub: 'Incheon' },
  { id: 'GMP', sub: 'Gimpo' },
  { id: 'PUS', sub: 'Busan' },
  { id: 'CJU', sub: 'Jeju' },
];

const INTERESTS = [
  { i18nKey: 'interest_culture',  icon: <Landmark className="w-4 h-4" />,         cats: ['K-culture', 'heritage'] },
  { i18nKey: 'interest_food',     icon: <UtensilsCrossed className="w-4 h-4" />,   cats: ['K-food'] },
  { i18nKey: 'interest_nature',   icon: <Leaf className="w-4 h-4" />,              cats: ['nature'] },
  { i18nKey: 'interest_kpop',     icon: <Music className="w-4 h-4" />,             cats: ['K-pop'] },
  { i18nKey: 'interest_shopping', icon: <ShoppingBag className="w-4 h-4" />,       cats: ['shopping', 'K-beauty'] },
  { i18nKey: 'interest_activity', icon: <Zap className="w-4 h-4" />,               cats: ['skiing'] },
  { i18nKey: 'interest_family',   icon: <Users className="w-4 h-4" />,             cats: ['nature', 'K-culture'] },
  { i18nKey: 'interest_couple',   icon: <Heart className="w-4 h-4" />,             cats: ['K-culture', 'K-beauty'] },
  { i18nKey: 'interest_photo',    icon: <Camera className="w-4 h-4" />,            cats: ['K-culture'] },
];

const BUDGET_OPTIONS = [
  { id: 'economy',  icon: <Coins className="w-5 h-5" />,      i18nKey: 'budget_economy' },
  { id: 'standard', icon: <CreditCard className="w-5 h-5" />,  i18nKey: 'budget_standard' },
  { id: 'premium',  icon: <Gem className="w-5 h-5" />,         i18nKey: 'budget_premium' },
];

const TRANSPORT_OPTIONS = [
  { id: 'public',  icon: <TrainFront className="w-5 h-5" />, i18nKey: 'transport_public',  badgeKey: '' },
  { id: 'mixed',   icon: <Car className="w-5 h-5" />,        i18nKey: 'transport_mixed',   badgeKey: '' },
  { id: 'charter', icon: <Bus className="w-5 h-5" />,        i18nKey: 'transport_charter', badgeKey: 'transport_recommended' },
];

// ── 타입 ──────────────────────────────────────────────────────────────
interface WizardState {
  airport: string;
  regionIds: string[];
  customCity: string;
  startDate: string;
  endDate: string;
  adults: number;
  children: number;
  interests: string[];
  budgetStyle: string;
  transportPref: string;
  freeText: string;
}

const INIT: WizardState = {
  airport: '', regionIds: [], customCity: '',
  startDate: '', endDate: '', adults: 2, children: 0,
  interests: [], budgetStyle: '', transportPref: '', freeText: '',
};

// ── 스타일 상수 (보라/핑크 테마) ─────────────────────────────────────
// ── 스타일 상수 & 대화형 UI 컴포넌트 ─────────────────────────────────────
const SEL   = 'border-[rgba(232,75,138,0.5)] bg-[rgba(232,75,138,0.15)] text-[#E84B8A]';
const UNSEL = 'border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] text-white/55 hover:border-[rgba(255,255,255,0.18)] hover:text-white/75 hover:bg-[rgba(255,255,255,0.06)]';

function ChatBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3 mb-4 items-end" style={{ animation: 'fade-slide-up 0.4s ease forwards' }}>
      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#E84B8A] to-[#C62368] flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(232,75,138,.4)]">
        <Sparkles className="w-4 h-4 text-white" />
      </div>
      <div className="bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.08)] text-white/90 px-4 py-3 text-sm leading-relaxed" 
        style={{ borderRadius: '18px 18px 18px 4px' }}>
        <div className="flex items-center gap-1.5 font-medium">{children}</div>
      </div>
    </div>
  );
}

function ChatTypingIndicator() {
  return (
    <div className="flex gap-3 mb-4 items-end" style={{ animation: 'fade-slide-up 0.2s ease forwards' }}>
      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#E84B8A] to-[#C62368] flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(232,75,138,.4)]">
        <Sparkles className="w-4 h-4 text-white" />
      </div>
      <div className="bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.08)] px-5 py-3.5 flex gap-1.5 items-center justify-center h-[46px]"
        style={{ borderRadius: '18px 18px 18px 4px' }}>
        <div className="w-1.5 h-1.5 bg-white/40 rounded-full animate-bounce" />
        <div className="w-1.5 h-1.5 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '0.15s' }} />
        <div className="w-1.5 h-1.5 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '0.3s' }} />
      </div>
    </div>
  );
}

// ── Step Progress (보라/핑크 그라디언트) ───────────────────────────────
function StepProgress({ step }: { step: number }) {
  return (
    <div className="mb-8">
      <div className="flex items-center">
        {[1, 2, 3, 4].map((s) => (
          <div key={s} className="flex-1 flex items-center">
            <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
              s < step  ? 'text-white' :
              s === step ? 'text-white shadow-[0_0_18px_rgba(232,75,138,.5)]' :
                           'bg-[rgba(255,255,255,0.06)] text-white/20 border border-[rgba(255,255,255,0.08)]'
            }`}
              style={s <= step ? { background: 'linear-gradient(135deg, #E84B8A, #C62368)' } : {}}
            >
              {s < step ? <Check className="w-3.5 h-3.5" /> : s}
            </div>
            {s < 4 && (
              <div className={`flex-1 h-px mx-2 transition-all duration-500 ${s < step ? 'bg-gradient-to-r from-[#E84B8A] to-[#C62368]' : 'bg-[rgba(255,255,255,0.08)]'}`}
                style={s < step ? { height: '2px' } : {}} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Step 1: 목적지 ─────────────────────────────────────────────────────
function Step1({ data, upd, p }: { data: WizardState; upd: (x: Partial<WizardState>) => void; p: any }) {
  return (
    <div className="space-y-7">
      <div>
        <ChatBubble><Plane className="w-4 h-4" /> {p.planner_step1_airport}</ChatBubble>
        <div className="grid grid-cols-4 gap-2.5 ml-12" style={{ width: 'calc(100% - 48px)' }}>
          {AIRPORTS.map(a => (
            <button key={a.id} type="button" onClick={() => upd({ airport: a.id })}
              className={`py-4 rounded-xl border text-center transition-all duration-200 ${data.airport === a.id ? SEL : UNSEL}`}>
              <p className="text-lg font-extrabold tracking-wide leading-tight">{a.id}</p>
              <p className="text-[10px] opacity-50 mt-1 font-medium">{a.sub}</p>
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="flex items-center gap-1.5 ml-12 mb-3 text-[11px] uppercase tracking-[.07em] text-white/40 font-semibold"><MapPin className="w-4 h-4" /> {p.planner_step1_cities}</p>
        <div className="grid grid-cols-4 gap-2.5 ml-12" style={{ width: 'calc(100% - 48px)' }}>
          {WIZARD_REGIONS.map(r => {
            const sel = data.regionIds.includes(r.id);
            return (
              <button key={r.id} type="button"
                onClick={() => upd({ regionIds: sel ? data.regionIds.filter(x => x !== r.id) : [...data.regionIds, r.id] })}
                className={`relative flex flex-col items-center justify-center py-4 px-1 rounded-xl border transition-all duration-200 overflow-hidden ${sel ? SEL : UNSEL}`}>
                {sel && (
                  <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full flex items-center justify-center"
                    style={{ background: 'linear-gradient(135deg, #E84B8A, #C62368)' }}>
                    <Check className="w-2.5 h-2.5 text-white" />
                  </div>
                )}
                <span className="text-sm font-bold leading-tight">{p[`city_${r.id}`] ?? r.apiValue}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-8">
        <ChatBubble><Pencil className="w-4 h-4" /> {p.planner_step1_custom}</ChatBubble>
        <input type="text" value={data.customCity} onChange={e => upd({ customCity: e.target.value })}
          placeholder={p.planner_step1_custom_ph}
          className="w-full px-4 py-3 ml-12 rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] text-white/80 text-sm placeholder:text-white/20 outline-none focus:border-[rgba(232,75,138,.5)] transition-all duration-200" style={{ width: 'calc(100% - 48px)' }} />
      </div>
    </div>
  );
}

// ── Step 2: 날짜/인원 ──────────────────────────────────────────────────
function Step2({ data, upd, p, lang }: { data: WizardState; upd: (x: Partial<WizardState>) => void; p: any; lang: string }) {
  return (
    <div className="space-y-7">
      <div>
        <ChatBubble><Calendar className="w-4 h-4" /> {p.planner_step2_date}</ChatBubble>
        <div className="ml-12" style={{ width: 'calc(100% - 48px)' }}>
          <CalendarPicker
          startDate={data.startDate}
          endDate={data.endDate}
          onDateChange={(s, e) => upd({ startDate: s, endDate: e })}
          p={p}
          lang={lang}
        />
        </div>
      </div>

      <div className="mt-8">
        <ChatBubble><Users className="w-4 h-4" /> {p.planner_step2_adults} / {p.planner_step2_children}</ChatBubble>
        <div className="space-y-2.5 ml-12" style={{ width: 'calc(100% - 48px)' }}>
          {[
            { key: 'adults' as const, labelKey: 'planner_step2_adults', min: 1, max: 20 },
            { key: 'children' as const, labelKey: 'planner_step2_children', min: 0, max: 10 },
          ].map(({ key, labelKey, min, max }) => (
            <div key={key} className="flex items-center justify-between bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-xl px-4 py-3">
              <span className="text-sm text-white/65">{p[labelKey]}</span>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => upd({ [key]: Math.max(min, data[key] - 1) })}
                  className="w-8 h-8 rounded-full border border-[rgba(255,255,255,0.15)] flex items-center justify-center text-white/55 hover:border-[rgba(232,75,138,.4)] hover:text-[#E84B8A] transition-all text-lg leading-none">−</button>
                <span className="text-base font-bold text-white w-6 text-center">{data[key]}</span>
                <button type="button" onClick={() => upd({ [key]: Math.min(max, data[key] + 1) })}
                  className="w-8 h-8 rounded-full border border-[rgba(255,255,255,0.15)] flex items-center justify-center text-white/55 hover:border-[rgba(232,75,138,.4)] hover:text-[#E84B8A] transition-all text-lg leading-none">+</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Step 3: 관심사/예산/이동수단 ────────────────────────────────────────
function Step3({ data, upd, p }: { data: WizardState; upd: (x: Partial<WizardState>) => void; p: any }) {
  return (
    <div className="space-y-7">
      <div>
        <ChatBubble><Target className="w-4 h-4" /> {p.planner_step3_interests}</ChatBubble>
        <div className="flex flex-wrap gap-2 ml-12" style={{ width: 'calc(100% - 48px)' }}>
          {INTERESTS.map(int => {
            const label = p[int.i18nKey] ?? int.i18nKey;
            const sel = data.interests.includes(int.i18nKey);
            return (
              <button key={int.i18nKey} type="button"
                onClick={() => upd({ interests: sel ? data.interests.filter(x => x !== int.i18nKey) : [...data.interests, int.i18nKey] })}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full border text-sm font-medium transition-all duration-200 ${sel ? SEL : UNSEL}`}>
                {int.icon}
                <span>{label}</span>
                {sel && <Check className="w-3 h-3 opacity-80" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-8">
        <ChatBubble><CreditCard className="w-4 h-4" /> {p.planner_step3_budget}</ChatBubble>
        <div className="grid grid-cols-3 gap-2.5 ml-12" style={{ width: 'calc(100% - 48px)' }}>
          {BUDGET_OPTIONS.map(b => (
            <button key={b.id} type="button" onClick={() => upd({ budgetStyle: b.id })}
              className={`flex flex-col items-center py-4 px-2 rounded-xl border text-sm font-semibold transition-all duration-200 ${data.budgetStyle === b.id ? SEL : UNSEL}`}>
              <span className="mb-2">{b.icon}</span>
              <span className="text-xs">{p[b.i18nKey] ?? b.id}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8">
        <ChatBubble><Car className="w-4 h-4" /> {p.planner_step3_transport}</ChatBubble>
        <div className="space-y-2 ml-12" style={{ width: 'calc(100% - 48px)' }}>
          {TRANSPORT_OPTIONS.map(tr => (
            <button key={tr.id} type="button" onClick={() => upd({ transportPref: tr.id })}
              className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border text-sm font-medium transition-all duration-200 ${data.transportPref === tr.id ? SEL : UNSEL}`}>
              <span className="shrink-0">{tr.icon}</span>
              <span className="flex-1 text-left">{p[tr.i18nKey] ?? tr.id}</span>
              {tr.badgeKey && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[rgba(232,75,138,.15)] border border-[rgba(232,75,138,.35)] text-[#E84B8A] font-semibold shrink-0">
                  {p[tr.badgeKey]}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Step 4: 요청 + 최종 확인 ────────────────────────────────────────────
function Step4({ data, upd, goToStep, p }: {
  data: WizardState;
  upd: (x: Partial<WizardState>) => void;
  goToStep: (s: 1 | 2 | 3 | 4) => void;
  p: any;
}) {
  const regionLabels = data.regionIds.map(id => WIZARD_REGIONS.find(r => r.id === id)?.apiValue ?? id);
  if (data.customCity.trim()) regionLabels.push(data.customCity.trim());
  const budgetLabel    = BUDGET_OPTIONS.find(b => b.id === data.budgetStyle)?.i18nKey ?? '';
  const transportLabel = TRANSPORT_OPTIONS.find(tr => tr.id === data.transportPref)?.i18nKey ?? '';

  const SummaryRow = ({ icon, text, step }: { icon: React.ReactNode; text: string; step: 1 | 2 | 3 | 4 }) => (
    <div className="flex items-center gap-2.5 py-2.5 border-b border-[rgba(255,255,255,0.06)] last:border-0 cursor-pointer group"
      onClick={() => goToStep(step)}>
      <span className="shrink-0 text-[#E84B8A]">{icon}</span>
      <span className="flex-1 text-sm text-white/60 leading-snug">{text || '—'}</span>
      <ArrowRight className="w-3 h-3 text-white/15 group-hover:text-[#E84B8A] transition-colors" />
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <ChatBubble><Pencil className="w-4 h-4" /> {p.planner_step4_extra}</ChatBubble>
        <textarea value={data.freeText} onChange={e => upd({ freeText: e.target.value })}
          rows={3} placeholder={p.planner_step4_extra_ph}
          className="w-full px-4 py-3 ml-12 rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] text-white/80 text-sm placeholder:text-white/20 outline-none focus:border-[rgba(232,75,138,.5)] transition-all resize-none leading-relaxed" style={{ width: 'calc(100% - 48px)' }} />
      </div>

      <div className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-2xl px-4 py-2">
        <p className="text-[10px] uppercase tracking-widest text-white/25 font-semibold py-2 border-b border-[rgba(255,255,255,0.06)]">{p.planner_step4_summary}</p>
        <SummaryRow icon={<MapPin className="w-4 h-4" />} text={`${regionLabels.join(', ')}  ·  ${data.airport || '—'}`} step={1} />
        <SummaryRow icon={<Calendar className="w-4 h-4" />} text={`${data.startDate || '—'} → ${data.endDate || '—'}  ·  ${p.planner_step2_adults} ${data.adults}${data.children > 0 ? `  ·  ${p.planner_step2_children} ${data.children}` : ''}`} step={2} />
        <SummaryRow icon={<Target className="w-4 h-4" />} text={data.interests.map(k => p[k] ?? k).join(', ') || '—'} step={3} />
        <SummaryRow icon={<CreditCard className="w-4 h-4" />} text={`${p[budgetLabel] || '—'} · ${p[transportLabel] || '—'}`} step={3} />
      </div>
    </div>
  );
}

// ── Preset → initial interests mapping ─────────────────────────────────
const PRESET_INTERESTS: Record<string, string[]> = {
  spring_blossoms: ['interest_nature', 'interest_photo'],
};

// ── Main WizardForm ────────────────────────────────────────────────────
export function WizardForm({
  onSubmit, isLoading, t, lang = 'en', preset,
}: {
  onSubmit: (v: PlannerFormValues) => void;
  isLoading: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
  lang?: string;
  preset?: string;
}) {
  const p = t.planner;
  const STORAGE_KEY = 'cocotripWizardData';
  const TWO_HOURS = 2 * 60 * 60 * 1000;

  function loadSaved(): { step: 1|2|3|4; data: WizardState } | null {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Date.now() - (parsed.timestamp ?? 0) > TWO_HOURS) return null;
      return { step: parsed.step ?? 1, data: { ...INIT, ...parsed.data } };
    } catch { return null; }
  }

  const saved = loadSaved();
  const presetInterests = preset ? (PRESET_INTERESTS[preset] ?? []) : [];
  const initData: WizardState = presetInterests.length > 0
    ? { ...(saved?.data ?? INIT), interests: presetInterests }
    : (saved?.data ?? INIT);

  const [step, setStep] = useState<1 | 2 | 3 | 4>(saved?.step ?? 1);
  const [slideDir, setSlideDir] = useState<'in' | 'out-l' | 'out-r'>('in');
  const [data, setData] = useState<WizardState>(initData);
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ step, data, timestamp: Date.now() }));
    } catch { /* ignore quota errors */ }
  }, [step, data]);

  function upd(partial: Partial<WizardState>) {
    setData(prev => ({ ...prev, ...partial }));
  }

  function animTo(next: 1 | 2 | 3 | 4, dir: 'forward' | 'back') {
    setSlideDir(dir === 'forward' ? 'out-l' : 'out-r');
    setTimeout(() => { 
      setStep(next); 
      if (dir === 'forward') {
        setIsTyping(true);
        setSlideDir('in');
        setTimeout(() => setIsTyping(false), 800);
      } else {
        setSlideDir('in'); 
      }
    }, 180);
  }

  function goNext()                { animTo((step + 1) as 1 | 2 | 3 | 4, 'forward'); }
  function goBack()                { animTo((step - 1) as 1 | 2 | 3 | 4, 'back'); }
  function goToStep(s: 1|2|3|4)   { animTo(s, s < step ? 'back' : 'forward'); }

  const canNext =
    step === 1 ? data.airport !== '' && data.regionIds.length > 0 :
    step === 2 ? data.startDate !== '' && data.endDate !== '' :
    step === 3 ? data.interests.length > 0 && data.budgetStyle !== '' && data.transportPref !== '' :
    true;

  function handleSubmit() {
    const regions = [
      ...data.regionIds.map(id => WIZARD_REGIONS.find(r => r.id === id)!.apiValue),
      ...(data.customCity.trim() ? [data.customCity.trim()] : []),
    ];
    const categories = [...new Set(
      data.interests.flatMap(key => INTERESTS.find(x => x.i18nKey === key)?.cats ?? [])
    )];
    if (categories.length === 0) categories.push('K-culture');

    const companion = data.children > 0 ? 'family' : data.adults === 1 ? 'solo' : data.adults === 2 ? 'couple' : 'friends';
    const transport = data.transportPref === 'charter' ? 'staria' : 'public';

    const extras: string[] = [];
    if (data.airport)                     extras.push(`Arrival: ${data.airport} airport`);
    if (data.transportPref === 'mixed')   extras.push('Prefers mix of public transport and taxis');
    if (data.budgetStyle === 'economy')   extras.push('Budget-conscious, prefer economical options');
    if (data.budgetStyle === 'premium')   extras.push('Premium experience preferred');
    if (data.children > 0)               extras.push(`${data.adults} adults and ${data.children} children`);

    const freeText = [data.freeText.trim(), ...extras].filter(Boolean).join('. ');

    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    onSubmit({
      categories, regions,
      startDate:      data.startDate,
      endDate:        data.endDate,
      companion,
      transport:      transport as 'public' | 'staria' | 'sprinter' | 'bus',
      freeText:       freeText || undefined,
      arrivalAirport: data.airport || undefined,
    });
  }

  const slideStyle: CSSProperties = {
    opacity:    slideDir === 'in' ? 1 : 0,
    transform:  slideDir === 'out-l' ? 'translateX(-22px)' : slideDir === 'out-r' ? 'translateX(22px)' : 'translateX(0)',
    transition: 'opacity 0.18s ease, transform 0.18s ease',
  };

  return (
    <div>
      <StepProgress step={step} />

      <div style={slideStyle} className="min-h-[220px]">
        {isTyping ? (
          <ChatTypingIndicator />
        ) : (
          <>
            {step === 1 && <Step1 data={data} upd={upd} p={p} />}
            {step === 2 && <Step2 data={data} upd={upd} p={p} lang={lang} />}
            {step === 3 && <Step3 data={data} upd={upd} p={p} />}
            {step === 4 && <Step4 data={data} upd={upd} goToStep={goToStep} p={p} />}
          </>
        )}
      </div>

      <div className="flex gap-3 mt-8">
        {step > 1 && (
          <button type="button" onClick={goBack} disabled={isTyping}
            className="flex-1 py-3.5 rounded-xl border border-[rgba(255,255,255,0.1)] text-sm font-medium text-white/50 hover:border-[rgba(255,255,255,0.25)] hover:text-white/75 transition-all duration-200 min-h-[44px] flex items-center justify-center gap-1.5 disabled:opacity-30 disabled:cursor-not-allowed">
            <ArrowLeft className="w-3.5 h-3.5" /> {p.planner_prev}
          </button>
        )}
        {step < 4 ? (
          <button type="button" onClick={goNext} disabled={!canNext || isTyping}
            className="flex-[2] py-3.5 rounded-xl text-sm font-bold transition-all duration-200 min-h-[44px] disabled:opacity-30 disabled:cursor-not-allowed text-white flex items-center justify-center gap-1.5"
            style={canNext ? { background: 'linear-gradient(135deg, #E84B8A, #C62368)', boxShadow: '0 4px 24px rgba(232,75,138,.35)' } : { background: 'rgba(255,255,255,0.06)' }}>
            {p.planner_next} <ArrowRight className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button type="button" onClick={handleSubmit} disabled={isLoading}
            className="flex-[2] py-3.5 rounded-xl text-sm font-bold text-white transition-all duration-200 min-h-[44px] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            style={{ background: 'linear-gradient(135deg, #E84B8A, #C62368)', boxShadow: '0 4px 28px rgba(232,75,138,.45)' }}>
            {isLoading ? '...' : <><Sparkles className="w-4 h-4" /> {p.planner_generate_cta}</>}
          </button>
        )}
      </div>
    </div>
  );
}
