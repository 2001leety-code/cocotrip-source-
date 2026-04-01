import { useState, useRef, useEffect } from 'react';
import {
  Send, MapPin, Users, Calendar, Sparkles, Wand2,
  ChevronRight, ChevronLeft, Plane,
  Check, ExternalLink, ArrowRight
} from 'lucide-react';
import type { PlannerFormValues } from './PlannerForm';
import { PICKUP_PRICES } from '@/config/affiliateLinks';

// ─────────────────────────────────────────────
// 데이터 상수
// ─────────────────────────────────────────────
const AIRPORT_TABS = [
  { id: 'capital',  label: '수도권',  airports: [
    { code: 'ICN', name: '인천국제공항', nameEn: 'Incheon Intl', emoji: '✈️' },
    { code: 'GMP', name: '김포공항',    nameEn: 'Gimpo Intl',   emoji: '🛫' },
  ]},
  { id: 'gyeongnam', label: '경상',   airports: [
    { code: 'PUS', name: '김해국제공항', nameEn: 'Gimhae Intl',  emoji: '✈️' },
    { code: 'TAE', name: '대구국제공항', nameEn: 'Daegu Intl',   emoji: '🛬' },
  ]},
  { id: 'jeolla',  label: '전라',    airports: [
    { code: 'KWJ', name: '광주공항',    nameEn: 'Gwangju',       emoji: '✈️' },
    { code: 'MWX', name: '무안국제공항', nameEn: 'Muan Intl',    emoji: '🛫' },
  ]},
  { id: 'gangwon', label: '강원',    airports: [
    { code: 'YNY', name: '양양국제공항', nameEn: 'Yangyang Intl', emoji: '✈️' },
  ]},
  { id: 'jeju',   label: '제주',    airports: [
    { code: 'CJU', name: '제주국제공항', nameEn: 'Jeju Intl',    emoji: '🌊' },
  ]},
];

const CITIES = [
  { id: 'seoul',    name: '서울',   nameEn: 'Seoul',    tag: '궁궐·쇼핑·K-pop' },
  { id: 'busan',    name: '부산',   nameEn: 'Busan',    tag: '해운대·감천·야경' },
  { id: 'gyeongju',name: '경주',   nameEn: 'Gyeongju', tag: '천년고도·불국사' },
  { id: 'jeonju',  name: '전주',   nameEn: 'Jeonju',   tag: '한옥마을·비빔밥' },
  { id: 'jeju',    name: '제주',   nameEn: 'Jeju',     tag: '자연·오름·해녀' },
  { id: 'gangneung',name:'강릉',   nameEn: 'Gangneung',tag: '커피·경포대·해돋이' },
  { id: 'incheon', name: '인천',   nameEn: 'Incheon',  tag: '차이나타운·을왕리' },
  { id: 'daegu',   name: '대구',   nameEn: 'Daegu',    tag: '근대골목·동성로' },
  { id: 'suwon',   name: '수원',   nameEn: 'Suwon',    tag: '화성·통닭' },
  { id: 'yeosu',   name: '여수',   nameEn: 'Yeosu',    tag: '오동도·밤바다' },
];

const DURATIONS = [2, 3, 4, 5, 7];
const PAX_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10];

// 공항/도시 조합에 따른 제휴 광고 카드 생성기
function getAffiliateCards(airportCode: string, cities: string[]) {
  const pickups = PICKUP_PRICES[airportCode] || [];
  const firstCity = cities[0] || '서울';
  const cityQuery = encodeURIComponent(firstCity);
  const pickupLink = 'https://cocotripkr.com/charter';

  const cards = [];

  // 픽업 카드
  if (pickups.length > 0) {
    cards.push({
      type: 'pickup',
      icon: '🚐',
      title: `${airportCode} 공항 픽업`,
      subtitle: `스타리아 프라이빗 픽업 · No Hidden Fee`,
      price: pickups[0]?.price || '₩124,800~',
      cta: '지금 예약',
      url: pickupLink,
      color: '#7C5CFC',
    });
  }

  // 호텔 카드
  cards.push({
    type: 'hotel',
    icon: '🏨',
    title: `${firstCity} 추천 호텔`,
    subtitle: `Booking.com · 즉시 확정 · 무료 취소`,
    price: '최저가 비교',
    cta: '가격 보기',
    url: `https://www.booking.com/searchresults.html?ss=${cityQuery}&no_rooms=1&group_adults=2`,
    color: '#003580',
  });

  // KTX 카드 (수도권 공항에만 표시)
  if (['ICN', 'GMP'].includes(airportCode) && cities.length > 1) {
    const dest = cities[cities.length - 1];
    cards.push({
      type: 'ktx',
      icon: '🚄',
      title: `서울 → ${dest} KTX`,
      subtitle: `코레일 · 당일 발권 가능`,
      price: '시간표 확인',
      cta: '예매하기',
      url: `https://www.letskorail.com/ebizbf/EbizBfKrbs020a.do`,
      color: '#00498A',
    });
  } else {
    cards.push({
      type: 'car',
      icon: '🚗',
      title: `${firstCity} 렌터카`,
      subtitle: `KT렌터카 · 공항 인수 가능`,
      price: '실시간 최저가',
      cta: '최저가 검색',
      url: `https://www.rentalcars.com/en/search/Korea/${cityQuery}/`,
      color: '#EA537E',
    });
  }

  return cards;
}

// ─────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────
export function WizardForm({ onSubmit, isLoading }: any) {
  const [step, setStep] = useState(0); // 0:공항 1:도시 2:광고 3:채팅

  // Step 0 - 공항
  const [activeTab, setActiveTab] = useState('capital');
  const [selectedAirport, setSelectedAirport] = useState('');
  const [customAirport, setCustomAirport] = useState('');

  // Step 1 - 도시
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [duration, setDuration] = useState(3);
  const [pax, setPax] = useState(2);

  // Step 3 - 채팅
  const [messages, setMessages] = useState<{role: 'ai'|'user', text: string}[]>([
    { role: 'ai', text: '정보를 잘 받았습니다! 특별히 원하시는 것이 있거나 궁금한 점이 있으면 편하게 물어보세요.\n예) "채식 식당 위주로 해주세요", "아이 동반이라 볼거리 많은 코스로요"' }
  ]);
  const [input, setInput] = useState('');
  const [loadingReply, setLoadingReply] = useState(false);
  const [extracted, setExtracted] = useState<any>({ destination: null, durationDays: null, pax: null, preferences: [] });
  const [isComplete, setIsComplete] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);

  const airportCode = selectedAirport || customAirport || 'ICN';
  const affiliateCards = getAffiliateCards(airportCode, selectedCities);

  // Step 3 진입 시 AI 메시지 업데이트
  useEffect(() => {
    if (step === 3) {
      const cityList = selectedCities.length > 0 ? selectedCities.join(' → ') : '미정';
      const greeting = `${airportCode} 공항으로 입국하셔서 ${cityList} 여행 ${duration}일 ${pax}명이시군요!\n추가로 궁금한 점이나 특별한 요청 사항을 자유롭게 말씀해 주세요.`;
      setMessages([{ role: 'ai', text: greeting }]);
      setExtracted(prev => ({
        ...prev,
        destination: selectedCities[0] || '서울',
        durationDays: duration,
        pax,
        preferences: [],
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loadingReply]);

  function toggleCity(name: string) {
    setSelectedCities(prev =>
      prev.includes(name) ? prev.filter(c => c !== name) : [...prev, name]
    );
  }

  async function handleSend(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!input.trim() || loadingReply) return;
    const userMsg = input.trim();
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setInput('');
    setLoadingReply(true);

    try {
      const history = messages.slice(1).map(m => m.text).join('\n---\n');
      const res = await fetch('/.netlify/functions/ai-chat-extractor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, history, currentExtracted: extracted })
      });
      const data = await res.json();
      if (data.extracted) {
        setExtracted(data.extracted);
        if (data.isComplete) setIsComplete(true);
      }
      setMessages(prev => [...prev, { role: 'ai', text: data.reply || '알겠습니다! 더 필요한 건 없으신가요?' }]);
    } catch {
      setMessages(prev => [...prev, { role: 'ai', text: '네트워크 오류가 발생했습니다. 다시 말씀해 주시겠어요?' }]);
    }
    setLoadingReply(false);
  }

  function handleFinalSubmit() {
    const start = new Date();
    const end = new Date();
    end.setDate(start.getDate() + duration);
    const formValues: PlannerFormValues = {
      startDate: start.toISOString().split('T')[0],
      endDate: end.toISOString().split('T')[0],
      regions: selectedCities.length > 0 ? selectedCities : [extracted.destination || 'Seoul'],
      categories: extracted.preferences || [],
      transport: 'staria',
      pax: pax,
      durationDays: duration,
      freeText: messages.map(m => m.text).join('\n'),
    };
    onSubmit(formValues);
  }

  // ─── 공통 스텝 헤더 ───
  const STEP_LABELS = ['공항 선택', '도시 & 일정', '추천 서비스', 'AI 상담'];

  // ─────────────────────────────────────────────
  // STEP 0: 공항 선택
  // ─────────────────────────────────────────────
  const Step0 = () => (
    <div className="space-y-5">
      <p className="text-white/60 text-sm">어느 공항으로 입국하시나요?</p>

      {/* 탭 */}
      <div className="flex gap-1 bg-white/5 rounded-xl p-1">
        {AIRPORT_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              activeTab === tab.id
                ? 'bg-gradient-to-r from-[#7C5CFC] to-[#EA537E] text-white shadow-lg'
                : 'text-white/40 hover:text-white/70'
            }`}
          >{tab.label}</button>
        ))}
      </div>

      {/* 공항 칩 */}
      <div className="flex flex-wrap gap-2">
        {AIRPORT_TABS.find(t => t.id === activeTab)?.airports.map(ap => (
          <button
            key={ap.code}
            onClick={() => setSelectedAirport(ap.code)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-all ${
              selectedAirport === ap.code
                ? 'border-[#7C5CFC] bg-[#7C5CFC]/20 text-white shadow-[0_0_12px_rgba(124,92,252,0.4)]'
                : 'border-white/10 bg-white/5 text-white/60 hover:border-white/30 hover:text-white'
            }`}
          >
            <span>{ap.emoji}</span>
            <div className="text-left">
              <div className="text-xs text-white/40">{ap.code}</div>
              <div>{ap.name}</div>
            </div>
            {selectedAirport === ap.code && <Check className="w-3.5 h-3.5 text-[#7C5CFC] ml-1" />}
          </button>
        ))}
      </div>

      {/* 직접 입력 */}
      <div className="relative">
        <Plane className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
        <input
          type="text"
          value={customAirport}
          onChange={e => { setCustomAirport(e.target.value); setSelectedAirport(''); }}
          placeholder="그 외 공항 직접 입력 (예: 청주, 원주)"
          className="w-full bg-white/5 border border-white/10 text-white placeholder-white/30 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-[#7C5CFC]/60"
        />
      </div>

      <button
        onClick={() => setStep(1)}
        disabled={!selectedAirport && !customAirport.trim()}
        className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#7C5CFC] to-[#EA537E] text-white font-bold flex items-center justify-center gap-2 disabled:opacity-40 hover:scale-[1.01] transition-all"
      >
        다음: 방문 도시 선택 <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );

  // ─────────────────────────────────────────────
  // STEP 1: 도시 & 일정
  // ─────────────────────────────────────────────
  const Step1 = () => (
    <div className="space-y-5">
      <p className="text-white/60 text-sm">방문하고 싶은 도시를 순서대로 골라보세요. <span className="text-[#EA537E]">(복수 선택 가능)</span></p>

      <div className="grid grid-cols-2 gap-2">
        {CITIES.map((city, idx) => {
          const order = selectedCities.indexOf(city.name);
          const isSelected = order >= 0;
          return (
            <button
              key={city.id}
              onClick={() => toggleCity(city.name)}
              className={`relative flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-xl border text-left transition-all ${
                isSelected
                  ? 'border-[#EA537E] bg-[#EA537E]/15 text-white'
                  : 'border-white/10 bg-white/5 text-white/60 hover:border-white/25 hover:text-white'
              }`}
            >
              {isSelected && (
                <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-gradient-to-br from-[#7C5CFC] to-[#EA537E] text-white text-[10px] font-bold flex items-center justify-center">
                  {order + 1}
                </span>
              )}
              <span className="font-bold text-sm">{city.name} <span className="text-white/40 font-normal text-[11px]">{city.nameEn}</span></span>
              <span className="text-[11px] text-white/40">{city.tag}</span>
            </button>
          );
        })}
      </div>

      {/* 선택 동선 표시 */}
      {selectedCities.length > 0 && (
        <div className="bg-[#7C5CFC]/10 border border-[#7C5CFC]/25 rounded-xl px-4 py-3 flex items-center gap-2 flex-wrap">
          <MapPin className="w-3.5 h-3.5 text-[#7C5CFC] shrink-0" />
          {selectedCities.map((c, i) => (
            <span key={c} className="flex items-center gap-1 text-sm text-white/80">
              <span className="font-semibold text-white">{c}</span>
              {i < selectedCities.length - 1 && <ArrowRight className="w-3 h-3 text-white/30" />}
            </span>
          ))}
        </div>
      )}

      {/* 기간 & 인원 */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[11px] text-white/40 mb-2 flex items-center gap-1"><Calendar className="w-3 h-3" /> 여행 기간</p>
          <div className="flex flex-wrap gap-1.5">
            {DURATIONS.map(d => (
              <button key={d} onClick={() => setDuration(d)}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${duration === d ? 'bg-gradient-to-r from-[#7C5CFC] to-[#EA537E] text-white' : 'bg-white/5 border border-white/10 text-white/50 hover:text-white'}`}
              >{d}일</button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[11px] text-white/40 mb-2 flex items-center gap-1"><Users className="w-3 h-3" /> 인원</p>
          <div className="flex flex-wrap gap-1.5">
            {PAX_OPTIONS.map(n => (
              <button key={n} onClick={() => setPax(n)}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${pax === n ? 'bg-gradient-to-r from-[#7C5CFC] to-[#EA537E] text-white' : 'bg-white/5 border border-white/10 text-white/50 hover:text-white'}`}
              >{n}명</button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setStep(0)} className="flex items-center gap-1 px-4 py-3 rounded-xl border border-white/10 text-white/50 hover:text-white text-sm transition-all">
          <ChevronLeft className="w-4 h-4" /> 이전
        </button>
        <button
          onClick={() => setStep(2)}
          disabled={selectedCities.length === 0}
          className="flex-1 py-3 rounded-xl bg-gradient-to-r from-[#7C5CFC] to-[#EA537E] text-white font-bold flex items-center justify-center gap-2 disabled:opacity-40 hover:scale-[1.01] transition-all"
        >
          다음: 추천 서비스 <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  // ─────────────────────────────────────────────
  // STEP 2: 제휴 광고 카드
  // ─────────────────────────────────────────────
  const Step2 = () => (
    <div className="space-y-5">
      <p className="text-white/60 text-sm">
        <span className="text-[#7C5CFC] font-semibold">{airportCode}</span> 입국 ·
        <span className="text-[#EA537E] font-semibold"> {selectedCities.join(' → ')}</span> 여정에 맞는 서비스를 모았어요.
      </p>

      <div className="grid grid-cols-1 gap-3">
        {affiliateCards.map((card, i) => (
          <div key={i} className="flex items-center gap-3 bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4 hover:border-white/20 transition-all">
            <div className="text-2xl shrink-0">{card.icon}</div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-white text-sm">{card.title}</p>
              <p className="text-[11px] text-white/40 mt-0.5">{card.subtitle}</p>
              <p className="text-xs font-semibold mt-1" style={{ color: card.color }}>{card.price}</p>
            </div>
            <a
              href={card.url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold text-white transition-all hover:opacity-90 hover:scale-105"
              style={{ background: `linear-gradient(135deg, ${card.color}, ${card.color}cc)` }}
            >
              {card.cta} <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        ))}
      </div>

      <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3">
        <p className="text-xs text-amber-200/70 leading-relaxed">
          위 링크는 제휴 파트너십 링크입니다. 클릭 및 구매 시 CocoTrip이 소정의 수수료를 받을 수 있으며, 고객님의 가격에는 영향이 없습니다.
        </p>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setStep(1)} className="flex items-center gap-1 px-4 py-3 rounded-xl border border-white/10 text-white/50 hover:text-white text-sm transition-all">
          <ChevronLeft className="w-4 h-4" /> 이전
        </button>
        <button
          onClick={() => setStep(3)}
          className="flex-1 py-3 rounded-xl bg-gradient-to-r from-[#7C5CFC] to-[#EA537E] text-white font-bold flex items-center justify-center gap-2 hover:scale-[1.01] transition-all"
        >
          AI 플래너와 상담하기 <Sparkles className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  // ─────────────────────────────────────────────
  // STEP 3: AI 채팅 상담
  // ─────────────────────────────────────────────
  const Step3 = () => (
    <div className="flex flex-col h-[460px]">
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 pb-2">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[82%] px-4 py-3 text-sm leading-relaxed ${
              m.role === 'user'
                ? 'bg-gradient-to-r from-[#7C5CFC] to-[#EA537E] rounded-[18px_18px_4px_18px] text-white shadow-lg'
                : 'bg-[#1a1a2e] border border-white/10 rounded-[18px_18px_18px_4px] text-white/90'
            }`}>
              {m.text.split('\n').map((line, l) => <p key={l}>{line}</p>)}
            </div>
          </div>
        ))}
        {loadingReply && (
          <div className="flex justify-start">
            <div className="bg-[#1a1a2e] border border-white/10 rounded-[18px_18px_18px_4px] p-3 flex gap-1.5">
              <div className="w-1.5 h-1.5 bg-[#7C5CFC] rounded-full animate-bounce" />
              <div className="w-1.5 h-1.5 bg-[#EA537E] rounded-full animate-bounce" style={{ animationDelay: '0.15s' }} />
              <div className="w-1.5 h-1.5 bg-[#7C5CFC] rounded-full animate-bounce" style={{ animationDelay: '0.3s' }} />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-white/5 pt-3 space-y-2">
        <form onSubmit={handleSend} className="flex gap-2 relative">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="특별 요청이나 궁금한 점을 입력해 주세요"
            disabled={isLoading || loadingReply}
            className="flex-1 bg-white/5 border border-white/10 text-white placeholder-white/35 rounded-full px-5 py-3 text-sm focus:outline-none focus:border-[#7C5CFC]/60"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading || loadingReply}
            className="absolute right-1 top-1 w-[40px] h-[40px] rounded-full bg-gradient-to-br from-[#7C5CFC] to-[#EA537E] flex items-center justify-center text-white disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>

        {(isComplete || true) && (
          <button
            onClick={handleFinalSubmit}
            disabled={isLoading}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#7C5CFC] to-[#EA537E] text-white font-bold flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(124,92,252,0.35)] hover:scale-[1.01] transition-all disabled:opacity-50"
          >
            <Wand2 className="w-4 h-4" />
            {isLoading ? 'AI 플랜 생성 중...' : '매직 플랜 생성하기'}
          </button>
        )}
      </div>
    </div>
  );

  // ─────────────────────────────────────────────
  // 렌더
  // ─────────────────────────────────────────────
  return (
    <div className="flex flex-col md:flex-row gap-6">
      {/* 왼쪽: 메인 패널 */}
      <div className="flex-1 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.1)] rounded-2xl overflow-hidden">
        {/* 스텝 인디케이터 */}
        <div className="flex items-center border-b border-white/5 px-4 py-3">
          {STEP_LABELS.map((label, idx) => (
            <div key={idx} className="flex items-center">
              <button
                onClick={() => idx < step && setStep(idx)}
                className={`flex items-center gap-1.5 text-[11px] font-semibold transition-all ${
                  idx === step ? 'text-white' : idx < step ? 'text-[#7C5CFC] cursor-pointer' : 'text-white/25'
                }`}
              >
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  idx === step ? 'bg-gradient-to-br from-[#7C5CFC] to-[#EA537E] text-white'
                  : idx < step ? 'bg-[#7C5CFC]/30 text-[#7C5CFC]'
                  : 'bg-white/10 text-white/25'
                }`}>
                  {idx < step ? <Check className="w-2.5 h-2.5" /> : idx + 1}
                </span>
                <span className="hidden sm:inline">{label}</span>
              </button>
              {idx < STEP_LABELS.length - 1 && (
                <ChevronRight className="w-3 h-3 text-white/15 mx-1" />
              )}
            </div>
          ))}
        </div>

        {/* 스텝 콘텐츠 */}
        <div className="p-5">
          {step === 0 && <Step0 />}
          {step === 1 && <Step1 />}
          {step === 2 && <Step2 />}
          {step === 3 && <Step3 />}
        </div>
      </div>

      {/* 오른쪽: 판별된 정보 패널 */}
      <div className="w-full md:w-[240px] shrink-0">
        <div className="bg-[#0f111a] border border-[#7C5CFC]/30 rounded-2xl p-4 shadow-[0_0_20px_rgba(124,92,252,0.12)] sticky top-4">
          <h3 className="text-white/70 font-bold mb-4 flex items-center gap-2 text-xs uppercase tracking-wider">
            <Wand2 className="w-3.5 h-3.5 text-[#EA537E]" /> 선택 현황
          </h3>
          <div className="space-y-3">
            <InfoRow icon={<Plane className="w-3 h-3" />} label="입국 공항" value={selectedAirport || customAirport || '-'} />
            <InfoRow icon={<MapPin className="w-3 h-3" />} label="방문 도시" value={selectedCities.length > 0 ? selectedCities.join(' → ') : '-'} />
            <InfoRow icon={<Calendar className="w-3 h-3" />} label="여행 기간" value={step >= 1 ? `${duration}일` : '-'} />
            <InfoRow icon={<Users className="w-3 h-3" />} label="인원" value={step >= 1 ? `${pax}명` : '-'} />
            {extracted.preferences?.length > 0 && (
              <InfoRow icon={<Sparkles className="w-3 h-3" />} label="선호 테마" value={extracted.preferences.join(', ')} highlight />
            )}
          </div>

          {step >= 2 && (
            <div className="mt-4 pt-4 border-t border-white/5">
              <p className="text-[10px] text-white/30 text-center">픽업 예상 요금</p>
              {(PICKUP_PRICES[airportCode] || []).slice(0, 2).map((p: any, i: number) => (
                <div key={i} className="flex justify-between text-[11px] mt-1.5">
                  <span className="text-white/45">{p.destination}</span>
                  <span className="text-[#7C5CFC] font-semibold">{p.price}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ icon, label, value, highlight }: { icon: React.ReactNode; label: string; value: string; highlight?: boolean }) {
  return (
    <div className="bg-white/[0.04] rounded-xl p-3 border border-white/5">
      <span className="flex items-center gap-1.5 text-[10px] text-white/35 mb-1">{icon} {label}</span>
      <span className={`text-sm font-bold ${highlight ? 'text-[#EA537E]' : 'text-white'}`}>{value}</span>
    </div>
  );
}
