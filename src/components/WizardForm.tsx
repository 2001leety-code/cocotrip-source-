import { useState, useRef, useEffect } from 'react';
import {
  Send, MapPin, Users, Calendar, Sparkles, Wand2,
  ArrowRight, Mail, Shield, Star, ChevronDown, X
} from 'lucide-react';
import type { PlannerFormValues } from './PlannerForm';
import { PICKUP_PRICES } from '@/config/affiliateLinks';

/* ═══════════════════════════════════════════════════════════
   DATA
   ═══════════════════════════════════════════════════════════ */
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
  if (pickup) cards.push({
    icon: '🚐', text: `${code} 공항 픽업 · ${pickup.price}`,
    cta: '예약', url: 'https://cocotripkr.com/charter',
  });
  cards.push({
    icon: '🏨', text: `${city} 호텔 최저가`,
    cta: '비교', url: `https://www.booking.com/searchresults.html?ss=${q}&no_rooms=1&group_adults=2`,
  });
  if (['ICN', 'GMP'].includes(code) && cities.length > 1)
    cards.push({
      icon: '🚄', text: `서울 → ${cities[cities.length - 1]} KTX`,
      cta: '예매', url: 'https://www.letskorail.com/ebizbf/EbizBfKrbs020a.do',
    });
  else if (cities.length > 0)
    cards.push({
      icon: '🚗', text: `${city} 렌터카`,
      cta: '검색', url: `https://www.rentalcars.com/en/search/Korea/${q}/`,
    });
  return cards;
}

/* ═══════════════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════════════ */
export function WizardForm({ onSubmit, isLoading }: any) {

  /* ── state ── */
  const [airportCode, setAirportCode]           = useState('');
  const [showCustomInput, setShowCustomInput]   = useState(false);
  const [customAirport, setCustomAirport]       = useState('');
  const [selectedCities, setSelectedCities]     = useState<string[]>([]);
  const [duration, setDuration]                 = useState(3);
  const [pax, setPax]                           = useState(2);
  const [email, setEmail]                       = useState('');
  const [emailSent, setEmailSent]               = useState(false);

  // chat
  const [chatInput, setChatInput]     = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [extracted, setExtracted]     = useState<any>({ destination: null, durationDays: null, pax: null, preferences: [] });
  const [messages, setMessages]       = useState<{ role: 'ai' | 'user'; text: string }[]>([
    { role: 'ai', text: '안녕하세요! CocoTrip AI 가이드입니다.\n오른쪽 패널에서 조건을 선택하시면 맞춤 플랜을 만들어 드립니다.\n무엇이든 궁금한 점은 여기서 질문해 주세요!' },
  ]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const effectiveAirport = airportCode || (showCustomInput && customAirport ? customAirport : '');
  const ready = Boolean(effectiveAirport) && selectedCities.length > 0;
  const slimCards = effectiveAirport ? buildSlimCards(airportCode || customAirport, selectedCities) : [];

  /* ── auto-guide messages ── */
  useEffect(() => {
    if (effectiveAirport) {
      setMessages(p => {
        if (p.some(m => m.text.includes('공항 선택 완료'))) return p;
        return [...p, { role: 'ai', text: `${effectiveAirport} 공항 선택 완료! 이제 방문 도시를 골라 보세요.` }];
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveAirport]);

  useEffect(() => {
    if (selectedCities.length > 0) {
      setMessages(p => {
        if (p.some(m => m.text.includes('동선이 설정'))) return p;
        return [...p, { role: 'ai', text: `${selectedCities.join(' → ')} 동선이 설정되었습니다!\n기간과 인원을 확인한 뒤 플랜 생성 버튼을 눌러 주세요.` }];
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCities.length]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  /* ── handlers ── */
  function handleAirportChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value;
    if (v === '__custom__') { setShowCustomInput(true); setAirportCode(''); }
    else { setShowCustomInput(false); setAirportCode(v); setCustomAirport(''); }
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

  /* ═══════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════ */
  return (
    <div className="flex flex-col lg:flex-row gap-5 w-full items-stretch">

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          LEFT COLUMN — AI Chat (sticky on desktop)
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="w-full lg:w-[310px] shrink-0 lg:sticky lg:top-4 lg:self-start">
        <div className="flex flex-col rounded-2xl border border-white/[0.07] overflow-hidden"
          style={{ height: 520, background: 'linear-gradient(160deg,#0b0f1e,#150a2e)' }}>

          {/* header */}
          <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-white/[0.06] shrink-0">
            <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
              style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)', boxShadow: '0 0 12px rgba(124,92,252,.5)' }}>
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-white leading-tight truncate">CocoTrip AI 가이드</p>
              <p className="text-[10px] text-[#7C5CFC]">무엇이든 물어보세요</p>
            </div>
            <span className="ml-auto flex items-center gap-1 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] text-white/30">Online</span>
            </span>
          </div>

          {/* messages (internal scroll) */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2" style={{ scrollbarWidth: 'thin', scrollbarColor: '#7C5CFC33 transparent' }}>
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[88%] px-3.5 py-2 text-xs leading-relaxed ${
                  m.role === 'user'
                    ? 'rounded-[16px_16px_4px_16px] text-white'
                    : 'rounded-[16px_16px_16px_4px] text-white/85 border border-white/[0.07] bg-white/[0.03]'
                }`} style={m.role === 'user' ? { background: 'linear-gradient(135deg,#7C5CFC,#EA537E)' } : {}}>
                  {m.text.split('\n').map((l, j) => <p key={j}>{l}</p>)}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="flex justify-start">
                <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl rounded-bl-sm px-3 py-2 flex gap-1.5">
                  {[0, .15, .3].map((d, i) => <div key={i} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: i % 2 === 0 ? '#7C5CFC' : '#EA537E', animationDelay: `${d}s` }} />)}
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* input */}
          <div className="px-3 py-2 border-t border-white/[0.06] shrink-0">
            <form onSubmit={handleChatSend} className="flex gap-1.5">
              <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="질문, 요청사항 입력..."
                disabled={chatLoading}
                className="flex-1 bg-white/[0.05] border border-white/[0.08] text-white placeholder-white/25 rounded-full px-4 py-2 text-xs focus:outline-none focus:border-[#7C5CFC]/50 transition-colors" />
              <button type="submit" disabled={!chatInput.trim() || chatLoading}
                className="w-8 h-8 rounded-full flex items-center justify-center text-white shrink-0 disabled:opacity-35 transition-all"
                style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)' }}>
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          RIGHT COLUMN — Input Widgets
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="flex-1 flex flex-col gap-3 min-w-0">

        {/* ─── 1. 공항 선택 ─── */}
        <Card label="입국 공항">
          <div className="relative">
            <select value={showCustomInput ? '__custom__' : airportCode} onChange={handleAirportChange}
              className="w-full appearance-none bg-white/[0.05] border border-white/[0.1] text-white rounded-xl pl-4 pr-10 py-2.5 text-sm cursor-pointer focus:outline-none focus:border-[#7C5CFC]/60 transition-colors">
              <option value="" disabled className="bg-[#0f111a] text-white/50">공항을 선택하세요</option>
              {AIRPORT_GROUPS.map(g => (
                <optgroup key={g.label} label={`── ${g.label} ──`} className="bg-[#0f111a]">
                  {g.airports.map(a => (
                    <option key={a.code} value={a.code} className="bg-[#0f111a]">{a.code}  {a.name}</option>
                  ))}
                </optgroup>
              ))}
              <optgroup label="── 기타 ──" className="bg-[#0f111a]">
                <option value="__custom__" className="bg-[#0f111a]">직접 입력 (기타 공항/항구)</option>
              </optgroup>
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/35 pointer-events-none" />
          </div>

          {showCustomInput && (
            <div className="mt-2 overflow-hidden transition-all" style={{ animation: 'slideDown .2s ease-out' }}>
              <input type="text" value={customAirport} onChange={e => setCustomAirport(e.target.value)}
                placeholder="공항 또는 항구명 입력 (예: 청주공항, 군산항)"
                autoFocus
                className="w-full bg-white/[0.05] border border-[#7C5CFC]/40 text-white placeholder-white/30 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#7C5CFC]/60 transition-colors" />
            </div>
          )}

          {/* 공항 픽업 슬림 카드 — 즉시 */}
          {effectiveAirport && (PICKUP_PRICES[airportCode] || []).length > 0 && (
            <a href="https://cocotripkr.com/charter" target="_blank" rel="noopener noreferrer"
              className="mt-2.5 flex items-center gap-3 px-3 py-2 rounded-xl border border-[#7C5CFC]/25 hover:border-[#7C5CFC]/50 transition-all group"
              style={{ background: 'rgba(124,92,252,.08)' }}>
              <span className="text-sm">🚐</span>
              <span className="text-xs text-white/70 flex-1 group-hover:text-white transition-colors">
                {effectiveAirport} 공항 픽업 · {(PICKUP_PRICES[airportCode] || [])[0]?.price ?? '₩124,800~'} · No Hidden Fee
              </span>
              <span className="text-[10px] font-bold text-[#7C5CFC] shrink-0 group-hover:text-white transition-colors">예약 →</span>
            </a>
          )}
        </Card>

        {/* ─── 2. 방문 도시 ─── */}
        <Card label="방문 도시">
          <p className="text-[10px] text-white/30 mb-2">클릭 순서 = 동선 번호. 다시 클릭하면 해제.</p>
          <div className="flex flex-wrap gap-2">
            {CITIES.map(c => {
              const idx = selectedCities.indexOf(c.name);
              const sel = idx >= 0;
              return (
                <button key={c.id} onClick={() => toggleCity(c.name)}
                  className={`relative flex items-center gap-1.5 pl-3 pr-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                    sel
                      ? 'border-[#EA537E]/60 bg-[#EA537E]/15 text-white pr-7'
                      : 'border-white/10 bg-white/[0.04] text-white/50 hover:border-white/25 hover:text-white'
                  }`}>
                  {sel && (
                    <span className="absolute -top-1 -right-1 w-4.5 h-4.5 rounded-full text-[9px] font-bold flex items-center justify-center text-white"
                      style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)', width: 18, height: 18 }}>
                      {idx + 1}
                    </span>
                  )}
                  <span>{c.name}</span>
                  <span className="text-[10px] text-white/30 font-normal hidden sm:inline">{c.sub}</span>
                </button>
              );
            })}
          </div>

          {/* 동선 텍스트 */}
          {selectedCities.length > 0 && (
            <div className="mt-3 flex items-center gap-1.5 text-sm flex-wrap bg-white/[0.03] border border-white/[0.06] rounded-xl px-3 py-2">
              <MapPin className="w-3.5 h-3.5 text-[#7C5CFC] shrink-0" />
              {selectedCities.map((c, i) => (
                <span key={c} className="flex items-center gap-1">
                  <span className="font-bold text-white">{c}</span>
                  {i < selectedCities.length - 1 && <ArrowRight className="w-3 h-3 text-white/25" />}
                </span>
              ))}
              <button onClick={() => setSelectedCities([])} className="ml-auto text-white/25 hover:text-white/60 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </Card>

        {/* ─── 3. 기간 & 인원 ─── */}
        <Card label="기간 & 인원">
          <div className="grid grid-cols-2 gap-5">
            <div>
              <p className="text-[10px] text-white/30 mb-2 flex items-center gap-1"><Calendar className="w-3 h-3" /> 여행 기간</p>
              <div className="flex flex-wrap gap-1.5">
                {DURATIONS.map(d => (
                  <Chip key={d} selected={duration === d} onClick={() => setDuration(d)}>{d}일</Chip>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] text-white/30 mb-2 flex items-center gap-1"><Users className="w-3 h-3" /> 인원</p>
              <div className="flex flex-wrap gap-1.5">
                {PAX_OPTIONS.map(n => (
                  <Chip key={n} selected={pax === n} onClick={() => setPax(n)}>{n}명</Chip>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* ─── 4. 슬림 광고 카드 ─── */}
        {selectedCities.length > 0 && slimCards.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {slimCards.map((c, i) => (
              <a key={i} href={c.url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-3 px-3.5 py-2 rounded-xl border border-white/[0.07] hover:border-white/15 transition-all group"
                style={{ background: 'rgba(255,255,255,.02)' }}>
                <span className="text-sm shrink-0">{c.icon}</span>
                <span className="text-xs text-white/55 flex-1 group-hover:text-white/80 transition-colors truncate">{c.text}</span>
                <span className="text-[10px] font-bold text-[#7C5CFC] shrink-0 whitespace-nowrap group-hover:text-white transition-colors">{c.cta} →</span>
              </a>
            ))}
          </div>
        )}

        {/* ─── 5. 바텀 액션바 ─── */}
        {ready && (
          <div className="rounded-2xl border border-[#7C5CFC]/30 overflow-hidden"
            style={{ background: 'linear-gradient(160deg,rgba(124,92,252,.1),rgba(234,83,126,.07))', boxShadow: '0 0 28px rgba(124,92,252,.12)' }}>

            {/* 요약 */}
            <div className="px-4 py-2.5 border-b border-white/[0.05] flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-white/45">
              <span className="flex items-center gap-1"><MapPin className="w-3 h-3 text-[#7C5CFC]" />{effectiveAirport}</span>
              <span className="text-white/15">|</span>
              <span>{selectedCities.join(' → ')}</span>
              <span className="text-white/15">|</span>
              <span>{duration}일 · {pax}명</span>
            </div>

            <div className="p-4 space-y-3">
              {/* 생성 버튼 */}
              <button onClick={handleGenerate} disabled={isLoading}
                className="w-full py-3.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all hover:scale-[1.015] active:scale-100 disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)', boxShadow: '0 4px 24px rgba(124,92,252,.4)' }}>
                <Wand2 className="w-4 h-4" />
                {isLoading ? 'AI 플랜 생성 중...' : '1페이지 미리보기 즉시 생성'}
              </button>

              {/* 이메일 */}
              {!emailSent ? (
                <form onSubmit={handleEmailSubmit} className="flex gap-2 items-center">
                  <div className="relative flex-1">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/25" />
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="이메일로 3p VVIP 리포트 무료 발송"
                      className="w-full bg-white/[0.05] border border-white/[0.1] text-white placeholder-white/25 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#7C5CFC]/50 transition-colors" />
                  </div>
                  <button type="submit" disabled={!email.trim()}
                    className="px-4 py-2.5 rounded-xl text-sm font-bold text-white shrink-0 disabled:opacity-35 hover:opacity-90 transition-all"
                    style={{ background: 'linear-gradient(135deg,#EA537E,#7C5CFC)' }}>
                    발송
                  </button>
                </form>
              ) : (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-emerald-500/25" style={{ background: 'rgba(16,185,129,.07)' }}>
                  <Shield className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div>
                    <p className="text-xs font-bold text-emerald-300">분석 및 검증 예약 완료!</p>
                    <p className="text-[10px] text-white/40 mt-0.5">5분 뒤 VVIP 리포트 발송 · 창을 닫으셔도 안전합니다</p>
                  </div>
                </div>
              )}

              <p className="text-[9px] text-white/20 text-center leading-relaxed">
                <Star className="w-2.5 h-2.5 inline text-[#EA537E]/40" /> 제휴 링크를 통한 구매 시 CocoTrip에 소정의 수수료가 지급됩니다. 고객 가격에는 영향 없음.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Sub-components
   ═══════════════════════════════════════════════════════════ */
function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] p-4" style={{ background: 'linear-gradient(160deg,rgba(11,15,30,.97),rgba(21,10,46,.97))' }}>
      <p className="text-[10px] font-bold text-white/30 uppercase tracking-[.15em] mb-3">{label}</p>
      {children}
    </div>
  );
}

function Chip({ children, selected, onClick }: { children: React.ReactNode; selected: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all"
      style={selected
        ? { background: 'linear-gradient(135deg,#7C5CFC,#EA537E)', color: '#fff' }
        : { background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', color: 'rgba(255,255,255,.45)' }}>
      {children}
    </button>
  );
}
