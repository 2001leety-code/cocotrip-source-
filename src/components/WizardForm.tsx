import { useState, useRef, useEffect } from 'react';
import {
  Send, MapPin, Users, Calendar, Sparkles, Wand2,
  ArrowRight, Mail, Shield, Star, ChevronDown, X,
  MessageCircle, ChevronRight, ChevronLeft, Check
} from 'lucide-react';
import type { PlannerFormValues } from './PlannerForm';
import { PICKUP_PRICES } from '@/config/affiliateLinks';

/* ═══════════════════════════════════════════════════════
   DATA
   ═══════════════════════════════════════════════════════ */
const AIRPORT_GROUPS = [
  { label: '수도권', airports: [
    { code: 'ICN', name: '인천국제공항 (Incheon Intl)' },
    { code: 'GMP', name: '김포공항 (Gimpo Intl)' },
  ]},
  { label: '경상', airports: [
    { code: 'PUS', name: '김해국제공항 (Gimhae Intl)' },
    { code: 'TAE', name: '대구국제공항 (Daegu Intl)' },
  ]},
  { label: '전라', airports: [
    { code: 'KWJ', name: '광주공항 (Gwangju)' },
    { code: 'MWX', name: '무안국제공항 (Muan Intl)' },
  ]},
  { label: '강원', airports: [
    { code: 'YNY', name: '양양국제공항 (Yangyang Intl)' },
  ]},
  { label: '제주', airports: [
    { code: 'CJU', name: '제주국제공항 (Jeju Intl)' },
  ]},
];

const CITIES = [
  { id: 'seoul',     name: '서울',  sub: 'K-pop · 궁궐 · 쇼핑' },
  { id: 'busan',     name: '부산',  sub: '해운대 · 야경' },
  { id: 'gyeongju', name: '경주',  sub: '천년고도 · 불국사' },
  { id: 'jeonju',   name: '전주',  sub: '한옥마을 · 비빔밥' },
  { id: 'jeju',     name: '제주',  sub: '자연 · 오름 · 해녀' },
  { id: 'gangneung',name: '강릉',  sub: '커피 · 경포대' },
  { id: 'incheon',  name: '인천',  sub: '차이나타운' },
  { id: 'yeosu',    name: '여수',  sub: '밤바다 · 오동도' },
  { id: 'suwon',    name: '수원',  sub: '화성 · 통닭' },
  { id: 'daegu',    name: '대구',  sub: '근대골목' },
];

const DURATIONS = [2, 3, 4, 5, 7, 10];
const PAX_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10];

function buildSlimCards(code: string, cities: string[]) {
  const city = cities[0] || '서울';
  const q = encodeURIComponent(city);
  const cards: { icon: string; text: string; cta: string; url: string }[] = [];
  const pickup = (PICKUP_PRICES[code] || [])[0];
  if (pickup) cards.push({ icon: '🚐', text: `${code} 공항 픽업 · ${pickup.price}`, cta: '예약', url: 'https://cocotripkr.com/charter' });
  cards.push({ icon: '🏨', text: `${city} 호텔 최저가`, cta: '비교', url: `https://www.booking.com/searchresults.html?ss=${q}&no_rooms=1&group_adults=2` });
  if (['ICN', 'GMP'].includes(code) && cities.length > 1)
    cards.push({ icon: '🚄', text: `서울 → ${cities[cities.length - 1]} KTX`, cta: '예매', url: 'https://www.letskorail.com/ebizbf/EbizBfKrbs020a.do' });
  else if (cities.length > 0)
    cards.push({ icon: '🚗', text: `${city} 렌터카`, cta: '검색', url: `https://www.rentalcars.com/en/search/Korea/${q}/` });
  return cards;
}

/* ═══════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════ */
export function WizardForm({ onSubmit, isLoading }: any) {
  const [step, setStep] = useState(0); // 0:공항 1:도시 2:기간인원 3:생성

  // data
  const [airportCode, setAirportCode]         = useState('');
  const [showCustom, setShowCustom]           = useState(false);
  const [customAirport, setCustomAirport]     = useState('');
  const [selectedCities, setSelectedCities]   = useState<string[]>([]);
  const [duration, setDuration]               = useState(3);
  const [pax, setPax]                         = useState(2);
  const [email, setEmail]                     = useState('');
  const [emailSent, setEmailSent]             = useState(false);

  // floating chat
  const [chatOpen, setChatOpen]       = useState(false);
  const [chatInput, setChatInput]     = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [extracted, setExtracted]     = useState<any>({ destination: null, durationDays: null, pax: null, preferences: [] });
  const [messages, setMessages]       = useState<{ role: 'ai' | 'user'; text: string }[]>([
    { role: 'ai', text: '안녕하세요! CocoTrip AI 가이드입니다.\n궁금한 점이나 특별 요청사항을 자유롭게 물어보세요!' },
  ]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const effectiveAirport = airportCode || (showCustom && customAirport ? customAirport : '');
  const slimCards = effectiveAirport ? buildSlimCards(airportCode || customAirport, selectedCities) : [];

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // handlers
  function handleAirportChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value;
    if (v === '__custom__') { setShowCustom(true); setAirportCode(''); }
    else { setShowCustom(false); setAirportCode(v); setCustomAirport(''); }
  }

  function toggleCity(name: string) {
    setSelectedCities(p => p.includes(name) ? p.filter(c => c !== name) : [...p, name]);
  }

  async function handleChatSend(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!chatInput.trim() || chatLoading) return;
    const msg = chatInput.trim();
    setMessages(p => [...p, { role: 'user', text: msg }]);
    setChatInput('');
    setChatLoading(true);
    try {
      const res = await fetch('/.netlify/functions/ai-chat-extractor', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, history: messages.map(m => m.text).join('\n---\n'), currentExtracted: extracted }),
      });
      const data = await res.json();
      if (data.extracted) setExtracted(data.extracted);
      setMessages(p => [...p, { role: 'ai', text: data.reply || '알겠습니다!' }]);
    } catch {
      setMessages(p => [...p, { role: 'ai', text: '오류가 발생했습니다. 다시 시도해 주세요.' }]);
    }
    setChatLoading(false);
  }

  function handleGenerate() {
    const s = new Date(), en = new Date();
    en.setDate(s.getDate() + duration);
    onSubmit({
      startDate: s.toISOString().split('T')[0], endDate: en.toISOString().split('T')[0],
      regions: selectedCities.length > 0 ? selectedCities : ['Seoul'],
      categories: extracted.preferences || [], transport: 'staria', pax, durationDays: duration,
      freeText: messages.map(m => m.text).join('\n'),
    } as PlannerFormValues);
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setEmailSent(true);
    const prefs = Array.isArray(extracted.preferences) ? extracted.preferences.join(', ') : (extracted.preferences || 'K-food, culture');
    fetch('/.netlify/functions/ai-planner-full', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destination: selectedCities[0] || 'Seoul', regions: selectedCities, durationDays: duration, duration, pax, preferences: prefs, language: 'en', vehicleType: 'staria', email: email.trim() }),
    }).catch(err => console.warn('bg:', err));
  }

  const STEP_TITLES = ['입국 공항', '방문 도시', '기간 & 인원', '플랜 생성'];

  /* ═══════════════════════════════════════════════════════
     STEP CONTENT
  ═══════════════════════════════════════════════════════ */

  // ── STEP 0: 입국 공항 ──
  const StepAirport = () => (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-white">어느 공항으로 입국하시나요?</h2>
      <p className="text-sm text-white/40">도착 공항을 선택하면 맞춤 픽업 서비스를 안내해 드립니다.</p>

      <div className="relative">
        <select value={showCustom ? '__custom__' : airportCode} onChange={handleAirportChange}
          className="w-full appearance-none bg-white/[0.06] border border-white/[0.12] text-white rounded-2xl pl-5 pr-12 py-4 text-base cursor-pointer focus:outline-none focus:border-[#7C5CFC]/70 transition-colors">
          <option value="" disabled className="bg-[#0f111a]">공항을 선택하세요</option>
          {AIRPORT_GROUPS.map(g => (
            <optgroup key={g.label} label={`── ${g.label} ──`} className="bg-[#0f111a]">
              {g.airports.map(a => <option key={a.code} value={a.code} className="bg-[#0f111a]">{a.code}  {a.name}</option>)}
            </optgroup>
          ))}
          <optgroup label="── 기타 ──" className="bg-[#0f111a]">
            <option value="__custom__" className="bg-[#0f111a]">직접 입력 (기타 공항/항구)</option>
          </optgroup>
        </select>
        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/30 pointer-events-none" />
      </div>

      {showCustom && (
        <input type="text" value={customAirport} onChange={e => setCustomAirport(e.target.value)}
          placeholder="공항 또는 항구명 입력 (예: 청주공항, 군산항)" autoFocus
          className="w-full bg-white/[0.06] border border-[#7C5CFC]/40 text-white placeholder-white/30 rounded-2xl px-5 py-4 text-base focus:outline-none focus:border-[#7C5CFC]/70 transition-colors" />
      )}

      {/* 픽업 광고 */}
      {effectiveAirport && (PICKUP_PRICES[airportCode] || []).length > 0 && (
        <a href="https://cocotripkr.com/charter" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-4 px-5 py-4 rounded-2xl border border-[#7C5CFC]/25 hover:border-[#7C5CFC]/50 transition-all group"
          style={{ background: 'rgba(124,92,252,.08)' }}>
          <span className="text-2xl">🚐</span>
          <div className="flex-1">
            <p className="text-sm font-bold text-white">{effectiveAirport} 공항 픽업 — 스타리아 프라이빗</p>
            <p className="text-xs text-[#7C5CFC] mt-0.5">{(PICKUP_PRICES[airportCode] || [])[0]?.price ?? '₩124,800~'} · No Hidden Fee</p>
          </div>
          <span className="text-xs font-bold text-white/50 group-hover:text-[#7C5CFC] transition-colors shrink-0">예약 →</span>
        </a>
      )}

      <button onClick={() => setStep(1)} disabled={!effectiveAirport}
        className="w-full py-4 rounded-2xl text-base font-bold text-white flex items-center justify-center gap-2 disabled:opacity-35 hover:scale-[1.01] active:scale-100 transition-all"
        style={{ background: effectiveAirport ? 'linear-gradient(135deg,#7C5CFC,#EA537E)' : 'rgba(255,255,255,.1)' }}>
        다음: 방문 도시 선택 <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  );

  // ── STEP 1: 방문 도시 ──
  const StepCities = () => (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-white">어디를 방문하고 싶으신가요?</h2>
      <p className="text-sm text-white/40">클릭 순서대로 동선 번호가 붙습니다. 다시 클릭하면 해제.</p>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {CITIES.map(c => {
          const idx = selectedCities.indexOf(c.name);
          const sel = idx >= 0;
          return (
            <button key={c.id} onClick={() => toggleCity(c.name)}
              className={`relative flex flex-col items-start gap-1 px-4 py-3.5 rounded-2xl border text-left transition-all hover:scale-[1.02] active:scale-100 ${
                sel
                  ? 'border-[#EA537E]/60 bg-[#EA537E]/12 text-white shadow-[0_0_16px_rgba(234,83,126,.2)]'
                  : 'border-white/[0.1] bg-white/[0.04] text-white/55 hover:border-white/25 hover:text-white'
              }`}>
              {sel && (
                <span className="absolute -top-2 -right-2 w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center text-white shadow-lg"
                  style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)' }}>{idx + 1}</span>
              )}
              <span className="text-base font-bold">{c.name}</span>
              <span className="text-[11px] text-white/30">{c.sub}</span>
            </button>
          );
        })}
      </div>

      {/* 동선 표시 */}
      {selectedCities.length > 0 && (
        <div className="flex items-center gap-2 text-sm flex-wrap bg-white/[0.04] border border-white/[0.08] rounded-2xl px-4 py-3">
          <MapPin className="w-4 h-4 text-[#7C5CFC] shrink-0" />
          {selectedCities.map((c, i) => (
            <span key={c} className="flex items-center gap-1.5">
              <span className="font-bold text-white">{c}</span>
              {i < selectedCities.length - 1 && <ArrowRight className="w-3.5 h-3.5 text-white/25" />}
            </span>
          ))}
          <button onClick={() => setSelectedCities([])} className="ml-auto text-white/25 hover:text-white/60 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={() => setStep(0)}
          className="px-5 py-3.5 rounded-2xl border border-white/[0.12] text-white/50 hover:text-white text-sm font-semibold flex items-center gap-1 transition-all">
          <ChevronLeft className="w-4 h-4" /> 이전
        </button>
        <button onClick={() => setStep(2)} disabled={selectedCities.length === 0}
          className="flex-1 py-3.5 rounded-2xl text-base font-bold text-white flex items-center justify-center gap-2 disabled:opacity-35 hover:scale-[1.01] active:scale-100 transition-all"
          style={{ background: selectedCities.length > 0 ? 'linear-gradient(135deg,#7C5CFC,#EA537E)' : 'rgba(255,255,255,.1)' }}>
          다음: 기간 & 인원 <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );

  // ── STEP 2: 기간 & 인원 ──
  const StepDetails = () => (
    <div className="space-y-5">
      <h2 className="text-lg font-bold text-white">여행 기간과 인원을 알려주세요</h2>

      <div>
        <p className="text-sm text-white/40 mb-3 flex items-center gap-1.5"><Calendar className="w-4 h-4" /> 여행 기간</p>
        <div className="flex flex-wrap gap-2">
          {DURATIONS.map(d => (
            <button key={d} onClick={() => setDuration(d)}
              className="px-5 py-3 rounded-xl text-sm font-bold transition-all hover:scale-[1.03] active:scale-100"
              style={duration === d
                ? { background: 'linear-gradient(135deg,#7C5CFC,#EA537E)', color: '#fff', boxShadow: '0 0 16px rgba(124,92,252,.4)' }
                : { background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.12)', color: 'rgba(255,255,255,.5)' }}>
              {d}일
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-sm text-white/40 mb-3 flex items-center gap-1.5"><Users className="w-4 h-4" /> 인원</p>
        <div className="flex flex-wrap gap-2">
          {PAX_OPTIONS.map(n => (
            <button key={n} onClick={() => setPax(n)}
              className="px-5 py-3 rounded-xl text-sm font-bold transition-all hover:scale-[1.03] active:scale-100"
              style={pax === n
                ? { background: 'linear-gradient(135deg,#7C5CFC,#EA537E)', color: '#fff', boxShadow: '0 0 16px rgba(124,92,252,.4)' }
                : { background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.12)', color: 'rgba(255,255,255,.5)' }}>
              {n}명
            </button>
          ))}
        </div>
      </div>

      {/* 슬림 광고 카드 */}
      {slimCards.length > 0 && (
        <div className="space-y-2 pt-2">
          {slimCards.map((c, i) => (
            <a key={i} href={c.url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-white/[0.08] hover:border-white/20 transition-all group"
              style={{ background: 'rgba(255,255,255,.03)' }}>
              <span className="text-sm">{c.icon}</span>
              <span className="text-xs text-white/55 flex-1 group-hover:text-white/80 transition-colors">{c.text}</span>
              <span className="text-[11px] font-bold text-[#7C5CFC] shrink-0 group-hover:text-white transition-colors">{c.cta} →</span>
            </a>
          ))}
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={() => setStep(1)}
          className="px-5 py-3.5 rounded-2xl border border-white/[0.12] text-white/50 hover:text-white text-sm font-semibold flex items-center gap-1 transition-all">
          <ChevronLeft className="w-4 h-4" /> 이전
        </button>
        <button onClick={() => setStep(3)}
          className="flex-1 py-3.5 rounded-2xl text-base font-bold text-white flex items-center justify-center gap-2 hover:scale-[1.01] active:scale-100 transition-all"
          style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)' }}>
          다음: 플랜 생성 <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );

  // ── STEP 3: 생성 & 이메일 ──
  const StepGenerate = () => (
    <div className="space-y-5">
      <h2 className="text-lg font-bold text-white">맞춤 플랜을 생성합니다</h2>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryItem icon={<MapPin className="w-4 h-4" />} label="공항" value={effectiveAirport} />
        <SummaryItem icon={<ArrowRight className="w-4 h-4" />} label="동선" value={selectedCities.join(' → ')} />
        <SummaryItem icon={<Calendar className="w-4 h-4" />} label="기간" value={`${duration}일`} />
        <SummaryItem icon={<Users className="w-4 h-4" />} label="인원" value={`${pax}명`} />
      </div>

      {/* 1단계: 즉시 생성 */}
      <button onClick={handleGenerate} disabled={isLoading}
        className="w-full py-4 rounded-2xl text-base font-bold text-white flex items-center justify-center gap-2 transition-all hover:scale-[1.01] active:scale-100 disabled:opacity-50"
        style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)', boxShadow: '0 4px 28px rgba(124,92,252,.4)' }}>
        <Wand2 className="w-5 h-5" />
        {isLoading ? 'AI 6개 팀 가동 중...' : '1페이지 미리보기 즉시 생성'}
      </button>

      {/* 2단계: 이메일 리포트 */}
      {!emailSent ? (
        <form onSubmit={handleEmailSubmit} className="space-y-2">
          <p className="text-xs text-white/40 flex items-center gap-1.5">
            <Star className="w-3.5 h-3.5 text-[#EA537E]" /> 이메일로 3페이지 VVIP 전체 리포트 무료 발송
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/25" />
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="이메일 주소 입력"
                className="w-full bg-white/[0.06] border border-white/[0.12] text-white placeholder-white/30 rounded-2xl pl-11 pr-4 py-3.5 text-sm focus:outline-none focus:border-[#7C5CFC]/60 transition-colors" />
            </div>
            <button type="submit" disabled={!email.trim()}
              className="px-6 py-3.5 rounded-2xl text-sm font-bold text-white shrink-0 disabled:opacity-35 hover:opacity-90 transition-all"
              style={{ background: 'linear-gradient(135deg,#EA537E,#7C5CFC)' }}>
              발송
            </button>
          </div>
        </form>
      ) : (
        <div className="flex items-center gap-3 px-5 py-4 rounded-2xl border border-emerald-500/30" style={{ background: 'rgba(16,185,129,.08)' }}>
          <Shield className="w-5 h-5 text-emerald-400 shrink-0" />
          <div>
            <p className="text-sm font-bold text-emerald-300">분석 및 검증 예약 완료!</p>
            <p className="text-xs text-white/45 mt-0.5">5분 뒤 VVIP 리포트 발송 · 창을 닫으셔도 안전합니다</p>
          </div>
        </div>
      )}

      <button onClick={() => setStep(2)}
        className="w-full py-3 rounded-2xl border border-white/[0.1] text-white/40 hover:text-white text-sm font-semibold flex items-center justify-center gap-1 transition-all">
        <ChevronLeft className="w-4 h-4" /> 이전 단계로
      </button>
    </div>
  );

  /* ═══════════════════════════════════════════════════════
     RENDER
  ═══════════════════════════════════════════════════════ */
  return (
    <>
      {/* ── STEP WIZARD (전체 너비 사용) ── */}
      <div className="w-full">
        {/* 스텝 인디케이터 */}
        <div className="flex items-center justify-center gap-1 mb-8">
          {STEP_TITLES.map((title, i) => (
            <div key={i} className="flex items-center">
              <button
                onClick={() => {
                  if (i === 0) setStep(0);
                  else if (i === 1 && effectiveAirport) setStep(1);
                  else if (i === 2 && selectedCities.length > 0) setStep(2);
                  else if (i === 3 && effectiveAirport && selectedCities.length > 0) setStep(3);
                }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  i === step ? 'text-white' : i < step ? 'text-[#7C5CFC] cursor-pointer hover:text-white' : 'text-white/20 cursor-default'
                }`}>
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold transition-all ${
                  i === step ? 'text-white shadow-lg' : i < step ? 'bg-[#7C5CFC]/25 text-[#7C5CFC]' : 'bg-white/[0.06] text-white/20'
                }`} style={i === step ? { background: 'linear-gradient(135deg,#7C5CFC,#EA537E)', boxShadow: '0 0 12px rgba(124,92,252,.5)' } : {}}>
                  {i < step ? <Check className="w-3 h-3" /> : i + 1}
                </span>
                <span className="hidden sm:inline">{title}</span>
              </button>
              {i < STEP_TITLES.length - 1 && (
                <div className={`w-8 sm:w-12 h-0.5 rounded-full mx-1 ${i < step ? 'bg-[#7C5CFC]/50' : 'bg-white/[0.06]'}`} />
              )}
            </div>
          ))}
        </div>

        {/* 스텝 콘텐츠 — 최대 너비 제한으로 가독성 유지 */}
        <div className="max-w-2xl mx-auto">
          {step === 0 && <StepAirport />}
          {step === 1 && <StepCities />}
          {step === 2 && <StepDetails />}
          {step === 3 && <StepGenerate />}
        </div>
      </div>

      {/* ── FLOATING CHAT WIDGET (우하단) ── */}
      {chatOpen ? (
        <div className="fixed bottom-4 right-4 z-50 w-[340px] sm:w-[380px] flex flex-col rounded-2xl overflow-hidden border border-white/[0.1] shadow-2xl"
          style={{ height: 420, background: 'linear-gradient(160deg,#0b0f1e,#150a2e)', boxShadow: '0 8px 40px rgba(0,0,0,.6),0 0 20px rgba(124,92,252,.15)' }}>

          {/* header */}
          <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-white/[0.06] shrink-0">
            <div className="w-7 h-7 rounded-full flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)' }}>
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </div>
            <div className="flex-1">
              <p className="text-xs font-bold text-white">AI 가이드</p>
              <p className="text-[10px] text-[#7C5CFC]">무엇이든 물어보세요</p>
            </div>
            <button onClick={() => setChatOpen(false)} className="text-white/30 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2" style={{ scrollbarWidth: 'thin' }}>
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-3.5 py-2 text-xs leading-relaxed ${
                  m.role === 'user'
                    ? 'rounded-[16px_16px_4px_16px] text-white'
                    : 'rounded-[16px_16px_16px_4px] text-white/85 border border-white/[0.07] bg-white/[0.03]'
                }`} style={m.role === 'user' ? { background: 'linear-gradient(135deg,#7C5CFC,#EA537E)' } : {}}>
                  {m.text.split('\n').map((l, j) => <p key={j}>{l}</p>)}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="flex"><div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl px-3 py-2 flex gap-1.5">
                {[0,.15,.3].map((d,i) => <div key={i} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: i%2===0?'#7C5CFC':'#EA537E', animationDelay:`${d}s` }} />)}
              </div></div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* input */}
          <div className="px-3 py-2.5 border-t border-white/[0.06] shrink-0">
            <form onSubmit={handleChatSend} className="flex gap-2">
              <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)}
                placeholder="질문, 요청사항 입력..."
                disabled={chatLoading}
                className="flex-1 bg-white/[0.05] border border-white/[0.08] text-white placeholder-white/25 rounded-full px-4 py-2 text-xs focus:outline-none focus:border-[#7C5CFC]/50 transition-colors" />
              <button type="submit" disabled={!chatInput.trim() || chatLoading}
                className="w-8 h-8 rounded-full flex items-center justify-center text-white shrink-0 disabled:opacity-35"
                style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)' }}>
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        </div>
      ) : (
        /* 채팅 버블 버튼 */
        <button onClick={() => setChatOpen(true)}
          className="fixed bottom-5 right-5 z-50 w-14 h-14 rounded-full flex items-center justify-center text-white transition-all hover:scale-110 active:scale-100 shadow-2xl"
          style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)', boxShadow: '0 4px 24px rgba(124,92,252,.5)' }}>
          <MessageCircle className="w-6 h-6" />
        </button>
      )}
    </>
  );
}

/* ── Summary Item ── */
function SummaryItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2.5">
      <span className="flex items-center gap-1 text-[10px] text-white/35 mb-1">{icon} {label}</span>
      <p className="text-sm font-bold text-white truncate">{value}</p>
    </div>
  );
}
