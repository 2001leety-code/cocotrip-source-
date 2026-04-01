import { useState, useRef, useEffect } from 'react';
import {
  Send, MapPin, Users, Calendar, Sparkles, Wand2,
  Check, ArrowRight, Mail, Shield, Star, ChevronDown, X
} from 'lucide-react';
import type { PlannerFormValues } from './PlannerForm';
import { PICKUP_PRICES } from '@/config/affiliateLinks';

// ─────────────────────────────────────────────────────────
// 데이터
// ─────────────────────────────────────────────────────────
const ALL_AIRPORTS = [
  { code: 'ICN', name: '인천국제공항', region: '수도권' },
  { code: 'GMP', name: '김포공항',    region: '수도권' },
  { code: 'PUS', name: '김해국제공항', region: '경상'   },
  { code: 'TAE', name: '대구국제공항', region: '경상'   },
  { code: 'KWJ', name: '광주공항',    region: '전라'   },
  { code: 'MWX', name: '무안국제공항', region: '전라'   },
  { code: 'YNY', name: '양양국제공항', region: '강원'   },
  { code: 'CJU', name: '제주국제공항', region: '제주'   },
  { code: '__custom__', name: '직접 입력', region: '' },
];

const CITIES = [
  { id: 'seoul',     name: '서울',   sub: 'K-pop · 궁궐 · 쇼핑'   },
  { id: 'busan',     name: '부산',   sub: '해운대 · 야경'           },
  { id: 'gyeongju', name: '경주',   sub: '천년고도 · 불국사'        },
  { id: 'jeonju',   name: '전주',   sub: '한옥마을 · 비빔밥'        },
  { id: 'jeju',     name: '제주',   sub: '자연 · 오름'             },
  { id: 'gangneung',name: '강릉',   sub: '커피 · 경포대'            },
  { id: 'incheon',  name: '인천',   sub: '차이나타운'               },
  { id: 'yeosu',    name: '여수',   sub: '오동도 · 밤바다'          },
];

const DURATIONS = [2, 3, 4, 5, 7];
const PAX_OPTIONS = [1, 2, 3, 4, 6, 8];

// 슬림 광고 카드 데이터 생성
function buildSlimCards(code: string, cities: string[]) {
  const city = cities[0] || '서울';
  const cityQ = encodeURIComponent(city);
  const pickup = (PICKUP_PRICES[code] || [])[0];
  const cards = [];
  if (pickup) cards.push({
    icon: '🚐', label: `${code} 픽업 · ${pickup.price}`,
    url: 'https://cocotripkr.com/charter',
    color: '#7C5CFC',
  });
  cards.push({
    icon: '🏨', label: `${city} 호텔 최저가 비교`,
    url: `https://www.booking.com/searchresults.html?ss=${cityQ}&no_rooms=1&group_adults=2`,
    color: '#003580',
  });
  if (['ICN','GMP'].includes(code) && cities.length > 1) {
    cards.push({
      icon: '🚄', label: `서울→${cities[cities.length-1]} KTX`,
      url: 'https://www.letskorail.com/ebizbf/EbizBfKrbs020a.do',
      color: '#00498A',
    });
  }
  return cards;
}

// ─────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────
export function WizardForm({ onSubmit, isLoading }: any) {
  // 선택 상태
  const [airportCode, setAirportCode]       = useState('');
  const [customAirport, setCustomAirport]   = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [cityDropOpen, setCityDropOpen]     = useState(false);
  const [duration, setDuration]             = useState(3);
  const [pax, setPax]                       = useState(2);
  const [email, setEmail]                   = useState('');
  const [emailSent, setEmailSent]           = useState(false);

  // 채팅 상태 (가이드 전용 — 고정 높이)
  const [chatInput, setChatInput]   = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [extracted, setExtracted]   = useState<any>({ destination: null, durationDays: null, pax: null, preferences: [] });
  const [messages, setMessages]     = useState<{role:'ai'|'user', text:string}[]>([
    { role: 'ai', text: '안녕하세요! 오른쪽에서 조건을 선택하시면 맞춤 VVIP 일정을 즉시 만들어 드립니다.\n공항 선택부터 시작해 보세요.' }
  ]);

  const chatBottomRef = useRef<HTMLDivElement>(null);
  const cityDropRef   = useRef<HTMLDivElement>(null);

  const effectiveAirport = airportCode || (showCustomInput ? customAirport : '');
  const readyToGenerate  = effectiveAirport && selectedCities.length > 0;
  const slimCards = effectiveAirport ? buildSlimCards(airportCode, selectedCities) : [];

  // 공항 선택 시 AI 가이드 메시지 추가
  useEffect(() => {
    if (effectiveAirport) {
      setMessages(prev => {
        const already = prev.some(m => m.text.includes('공항 확인'));
        if (already) return prev;
        return [...prev, { role: 'ai', text: `${effectiveAirport} 공항 확인! 다음으로 방문할 도시를 선택해 주세요.` }];
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveAirport]);

  useEffect(() => {
    if (selectedCities.length > 0) {
      setMessages(prev => {
        const already = prev.some(m => m.text.includes('동선 확정'));
        if (already) return prev;
        return [...prev, { role: 'ai', text: `${selectedCities.join(' → ')} 동선 확정! 이메일을 입력하시면 VVIP 리포트를 보내 드릴게요.` }];
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCities.length]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 도시 드롭다운 외부 클릭 닫기
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (cityDropRef.current && !cityDropRef.current.contains(e.target as Node)) {
        setCityDropOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function handleAirportChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    if (val === '__custom__') {
      setShowCustomInput(true);
      setAirportCode('');
    } else {
      setShowCustomInput(false);
      setAirportCode(val);
      setCustomAirport('');
    }
  }

  function toggleCity(name: string) {
    setSelectedCities(prev =>
      prev.includes(name) ? prev.filter(c => c !== name) : [...prev, name]
    );
  }

  // AI 채팅
  async function handleChatSend(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = chatInput.trim();
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setChatInput('');
    setChatLoading(true);
    try {
      const history = messages.map(m => m.text).join('\n---\n');
      const res = await fetch('/.netlify/functions/ai-chat-extractor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, history, currentExtracted: extracted }),
      });
      const data = await res.json();
      if (data.extracted) setExtracted(data.extracted);
      setMessages(prev => [...prev, { role: 'ai', text: data.reply || '알겠습니다! 더 궁금한 점 있으신가요?' }]);
    } catch {
      setMessages(prev => [...prev, { role: 'ai', text: '오류가 발생했습니다. 다시 시도해 주세요.' }]);
    }
    setChatLoading(false);
  }

  // 1단계: 즉시 미리보기
  function handleGeneratePlan() {
    const start = new Date();
    const end   = new Date();
    end.setDate(start.getDate() + duration);
    const formValues: PlannerFormValues = {
      startDate: start.toISOString().split('T')[0],
      endDate:   end.toISOString().split('T')[0],
      regions:   selectedCities.length > 0 ? selectedCities : ['Seoul'],
      categories: extracted.preferences || [],
      transport: 'staria',
      pax,
      durationDays: duration,
      freeText: messages.map(m => m.text).join('\n'),
    };
    onSubmit(formValues);
  }

  // 2단계: 이메일 발송
  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setEmailSent(true);
    const prefsRaw = extracted.preferences || [];
    const prefs = Array.isArray(prefsRaw) ? prefsRaw.join(', ') : (prefsRaw || 'K-food, culture');
    fetch('/.netlify/functions/ai-planner-full', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        destination: selectedCities[0] || 'Seoul',
        regions: selectedCities,
        durationDays: duration,
        duration,
        pax,
        preferences: prefs,
        language: 'en',
        vehicleType: 'staria',
        email: email.trim(),
      }),
    }).catch(err => console.warn('Full plan error (bg):', err));
  }

  // ─────────────────────────────────────────────────────────
  // 렌더
  // ─────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col lg:flex-row gap-4 items-start w-full">

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          왼쪽: AI 가이드 채팅 (고정 높이)
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="w-full lg:w-[300px] shrink-0 flex flex-col rounded-2xl overflow-hidden border border-white/[0.08]"
        style={{ height: 480, background: 'linear-gradient(160deg,#0c1220 0%,#14082a 100%)' }}>

        {/* 헤더 */}
        <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center gap-2.5 shrink-0">
          <div className="w-7 h-7 rounded-full flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)', boxShadow:'0 0 10px rgba(124,92,252,0.5)' }}>
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
          <div>
            <p className="text-xs font-bold text-white leading-none">AI 가이드</p>
            <p className="text-[10px] text-[#7C5CFC] mt-0.5">무엇이든 물어보세요</p>
          </div>
          <span className="ml-auto flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] text-white/35">Online</span>
          </span>
        </div>

        {/* 채팅 스크롤 — flex-1 + overflow-y-auto */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5" style={{ scrollbarWidth: 'thin' }}>
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[90%] px-3 py-2 text-xs leading-relaxed rounded-2xl ${
                m.role === 'user'
                  ? 'text-white rounded-br-sm'
                  : 'border border-white/[0.08] bg-white/[0.04] text-white/80 rounded-bl-sm'
              }`}
                style={m.role === 'user' ? { background: 'linear-gradient(135deg,#7C5CFC,#EA537E)' } : {}}>
                {m.text.split('\n').map((ln, l) => <p key={l}>{ln}</p>)}
              </div>
            </div>
          ))}
          {chatLoading && (
            <div className="flex">
              <div className="border border-white/[0.08] bg-white/[0.04] rounded-2xl rounded-bl-sm px-3 py-2 flex gap-1">
                {[0,0.15,0.3].map((d,i) => (
                  <div key={i} className="w-1.5 h-1.5 rounded-full animate-bounce"
                    style={{ background: i%2===0?'#7C5CFC':'#EA537E', animationDelay:`${d}s` }} />
                ))}
              </div>
            </div>
          )}
          <div ref={chatBottomRef} />
        </div>

        {/* 입력 */}
        <div className="px-3 py-2.5 border-t border-white/[0.06] shrink-0">
          <form onSubmit={handleChatSend} className="flex gap-2">
            <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)}
              placeholder="공항, 도시, 여행 스타일 질문..." disabled={chatLoading}
              className="flex-1 bg-white/[0.05] border border-white/[0.09] text-white placeholder-white/25 rounded-full px-4 py-2 text-xs focus:outline-none focus:border-[#7C5CFC]/50 transition-colors"
            />
            <button type="submit" disabled={!chatInput.trim() || chatLoading}
              className="w-8 h-8 rounded-full flex items-center justify-center text-white shrink-0 disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)' }}>
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          오른쪽: 입력 위젯 (콤팩트)
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="flex-1 flex flex-col gap-3">

        {/* ① 공항 선택 — 드롭다운 */}
        <SectionCard title="입국 공항" icon="✈">
          <div className="relative">
            <select
              value={showCustomInput ? '__custom__' : airportCode}
              onChange={handleAirportChange}
              className="w-full appearance-none bg-white/[0.06] border border-white/[0.1] text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#7C5CFC]/60 cursor-pointer transition-colors"
              style={{ backgroundImage: 'none' }}
            >
              <option value="" disabled className="bg-[#0f111a]">공항을 선택하세요</option>
              {ALL_AIRPORTS.map(ap => (
                <option key={ap.code} value={ap.code} className="bg-[#0f111a]">
                  {ap.code === '__custom__' ? '✏  직접 입력' : `${ap.code}  ${ap.name}${ap.region ? ` (${ap.region})` : ''}`}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
          </div>

          {/* 직접 입력 — 선택 시만 노출 */}
          {showCustomInput && (
            <input type="text" value={customAirport}
              onChange={e => setCustomAirport(e.target.value)}
              placeholder="공항명 / 항구명 입력 (예: 청주공항, 군산항)"
              className="mt-2 w-full bg-white/[0.06] border border-white/[0.1] text-white placeholder-white/30 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#7C5CFC]/60"
            />
          )}

          {/* 픽업 슬림 카드 — 즉시 노출 */}
          {effectiveAirport && (PICKUP_PRICES[airportCode]||[]).length > 0 && (
            <a href="https://cocotripkr.com/charter" target="_blank" rel="noopener noreferrer"
              className="mt-2 flex items-center gap-3 px-3 py-2.5 rounded-xl border border-[#7C5CFC]/25 hover:border-[#7C5CFC]/50 transition-colors"
              style={{ background: 'rgba(124,92,252,0.1)' }}>
              <span className="text-base">🚐</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-white">{effectiveAirport} 공항 픽업 · 스타리아 프라이빗</p>
                <p className="text-[10px] text-[#7C5CFC]">{(PICKUP_PRICES[airportCode]||[])[0]?.price ?? '₩124,800~'} · No Hidden Fee</p>
              </div>
              <span className="text-[10px] font-bold text-white/60 shrink-0">예약 →</span>
            </a>
          )}
        </SectionCard>

        {/* ② 방문 도시 복수 선택 — 드롭다운 + 선택 태그 */}
        <SectionCard title="방문 도시" icon="📍">
          <div ref={cityDropRef} className="relative">
            <button type="button" onClick={() => setCityDropOpen(o => !o)}
              className="w-full flex items-center justify-between bg-white/[0.06] border border-white/[0.1] text-sm rounded-xl px-4 py-2.5 transition-colors hover:border-white/20"
              style={{ color: selectedCities.length > 0 ? '#fff' : 'rgba(255,255,255,0.3)' }}>
              {selectedCities.length > 0
                ? <span className="flex items-center gap-1.5 flex-wrap">
                    {selectedCities.map((c,i) => (
                      <span key={c} className="flex items-center gap-1">
                        <span className="w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center text-white"
                          style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)' }}>{i+1}</span>
                        <span className="text-xs">{c}</span>
                        {i < selectedCities.length - 1 && <ArrowRight className="w-3 h-3 text-white/30" />}
                      </span>
                    ))}
                  </span>
                : '도시를 선택하세요 (복수 가능)'}
              <ChevronDown className={`w-4 h-4 text-white/40 shrink-0 transition-transform ${cityDropOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* 드롭다운 목록 */}
            {cityDropOpen && (
              <div className="absolute z-20 top-full left-0 right-0 mt-1 rounded-xl border border-white/[0.1] overflow-hidden shadow-2xl"
                style={{ background: '#0f111a' }}>
                {CITIES.map(city => {
                  const order = selectedCities.indexOf(city.name);
                  const sel   = order >= 0;
                  return (
                    <button key={city.id} type="button" onClick={() => toggleCity(city.name)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors hover:bg-white/[0.05] ${sel ? 'bg-[#7C5CFC]/10' : ''}`}>
                      {sel
                        ? <span className="w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center text-white shrink-0"
                            style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)' }}>{order+1}</span>
                        : <span className="w-5 h-5 rounded-full border border-white/15 shrink-0" />}
                      <span className="font-semibold text-white">{city.name}</span>
                      <span className="text-[11px] text-white/35">{city.sub}</span>
                      {sel && <X className="w-3 h-3 text-white/30 ml-auto" />}
                    </button>
                  );
                })}
                <div className="px-4 py-2 border-t border-white/[0.06] text-[11px] text-white/30">
                  ↑ 클릭 순서대로 동선 번호가 붙습니다
                </div>
              </div>
            )}
          </div>

          {/* 호텔/KTX 슬림 카드 — 도시 선택 후 */}
          {selectedCities.length > 0 && slimCards.filter(c=>c.icon!=='🚐').map((card, i) => (
            <a key={i} href={card.url} target="_blank" rel="noopener noreferrer"
              className="mt-1.5 flex items-center gap-2.5 px-3 py-2 rounded-xl border border-white/[0.07] hover:border-white/20 transition-colors"
              style={{ background: 'rgba(255,255,255,0.03)' }}>
              <span className="text-sm">{card.icon}</span>
              <span className="text-xs text-white/65 flex-1">{card.label}</span>
              <span className="text-[10px] text-white/35">보기 →</span>
            </a>
          ))}
        </SectionCard>

        {/* ③ 기간 & 인원 — 한 줄 */}
        <SectionCard title="기간 & 인원" icon="📅">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] text-white/35 mb-2 flex items-center gap-1">
                <Calendar className="w-3 h-3" /> 여행 기간
              </p>
              <div className="flex flex-wrap gap-1.5">
                {DURATIONS.map(d => (
                  <button key={d} onClick={() => setDuration(d)}
                    className="px-2.5 py-1 rounded-lg text-xs font-bold transition-all"
                    style={duration===d
                      ? { background:'linear-gradient(135deg,#7C5CFC,#EA537E)', color:'#fff' }
                      : { background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.5)' }}>
                    {d}일
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] text-white/35 mb-2 flex items-center gap-1">
                <Users className="w-3 h-3" /> 인원
              </p>
              <div className="flex flex-wrap gap-1.5">
                {PAX_OPTIONS.map(n => (
                  <button key={n} onClick={() => setPax(n)}
                    className="px-2.5 py-1 rounded-lg text-xs font-bold transition-all"
                    style={pax===n
                      ? { background:'linear-gradient(135deg,#7C5CFC,#EA537E)', color:'#fff' }
                      : { background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.5)' }}>
                    {n}명
                  </button>
                ))}
              </div>
            </div>
          </div>
        </SectionCard>

        {/* ④ CTA 패널 — 가이드 완성 시 */}
        {readyToGenerate && (
          <div className="rounded-2xl border border-[#7C5CFC]/30 p-4 space-y-3"
            style={{ background:'linear-gradient(160deg,rgba(124,92,252,0.1),rgba(234,83,126,0.08))', boxShadow:'0 0 24px rgba(124,92,252,0.15)' }}>

            {/* 현황 요약 */}
            <div className="flex flex-wrap gap-2 text-[11px] text-white/50">
              <span className="flex items-center gap-1"><MapPin className="w-3 h-3 text-[#7C5CFC]" />{effectiveAirport}</span>
              <span className="text-white/20">·</span>
              <span>{selectedCities.join(' → ')}</span>
              <span className="text-white/20">·</span>
              <span>{duration}일 {pax}명</span>
            </div>

            {/* 1단계: 즉시 미리보기 */}
            <button onClick={handleGeneratePlan} disabled={isLoading}
              className="w-full py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all hover:scale-[1.02] disabled:opacity-50"
              style={{ background:'linear-gradient(135deg,#7C5CFC,#EA537E)', boxShadow:'0 4px 20px rgba(124,92,252,0.35)' }}>
              <Wand2 className="w-4 h-4" />
              {isLoading ? 'AI 플랜 생성 중...' : '1페이지 미리보기 즉시 생성'}
            </button>

            {/* 2단계: 이메일 */}
            {!emailSent ? (
              <form onSubmit={handleEmailSubmit}>
                <p className="text-[10px] text-white/40 mb-1.5 flex items-center gap-1">
                  <Star className="w-3 h-3 text-[#EA537E]" /> 이메일로 3페이지 VVIP 전체 리포트 무료 발송
                </p>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/25" />
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                      placeholder="이메일 주소 입력"
                      className="w-full bg-white/[0.06] border border-white/[0.1] text-white placeholder-white/30 rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#7C5CFC]/60 transition-colors"
                    />
                  </div>
                  <button type="submit" disabled={!email.trim()}
                    className="px-4 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-40 transition-all hover:opacity-90"
                    style={{ background:'linear-gradient(135deg,#EA537E,#7C5CFC)' }}>
                    발송
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-emerald-500/25"
                style={{ background:'rgba(16,185,129,0.08)' }}>
                <Shield className="w-4 h-4 text-emerald-400 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-emerald-300">분석 및 검증 예약 완료!</p>
                  <p className="text-[11px] text-white/45 mt-0.5">5분 뒤 VVIP 리포트 발송 · 창을 닫으셔도 안전합니다</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>{/* end 오른쪽 */}
    </div>
  );
}

// ── 공통 섹션 카드 ──
function SectionCard({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] p-4"
      style={{ background: 'linear-gradient(160deg,rgba(12,18,32,0.97),rgba(20,10,40,0.97))' }}>
      <p className="text-[10px] font-bold text-white/35 uppercase tracking-widest mb-3">
        {icon}  {title}
      </p>
      {children}
    </div>
  );
}
