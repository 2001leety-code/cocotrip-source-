import { useState, useRef, useEffect } from 'react';
import {
  Send, MapPin, Users, Calendar, Sparkles, Wand2,
  ChevronRight, Plane, Check, ExternalLink, ArrowRight,
  Mail, Clock, Shield, Star
} from 'lucide-react';
import type { PlannerFormValues } from './PlannerForm';
import { PICKUP_PRICES } from '@/config/affiliateLinks';

// ─────────────────────────────────────────────────────────
// 데이터 상수
// ─────────────────────────────────────────────────────────
const AIRPORT_TABS = [
  { id: 'capital',  label: '수도권', airports: [
    { code: 'ICN', name: '인천국제공항', nameEn: 'Incheon Intl' },
    { code: 'GMP', name: '김포공항',    nameEn: 'Gimpo Intl'   },
  ]},
  { id: 'gyeong', label: '경상', airports: [
    { code: 'PUS', name: '김해국제공항', nameEn: 'Gimhae Intl'  },
    { code: 'TAE', name: '대구국제공항', nameEn: 'Daegu Intl'   },
  ]},
  { id: 'jeolla', label: '전라', airports: [
    { code: 'KWJ', name: '광주공항',    nameEn: 'Gwangju'       },
    { code: 'MWX', name: '무안국제공항', nameEn: 'Muan Intl'    },
  ]},
  { id: 'gangwon', label: '강원', airports: [
    { code: 'YNY', name: '양양국제공항', nameEn: 'Yangyang Intl' },
  ]},
  { id: 'jeju', label: '제주', airports: [
    { code: 'CJU', name: '제주국제공항', nameEn: 'Jeju Intl'    },
  ]},
];

const CITIES = [
  { id: 'seoul',     name: '서울',  tag: '궁궐 · K-pop · 쇼핑'  },
  { id: 'busan',     name: '부산',  tag: '해운대 · 야경 · 해산물' },
  { id: 'gyeongju', name: '경주',  tag: '천년고도 · 불국사'      },
  { id: 'jeonju',   name: '전주',  tag: '한옥마을 · 비빔밥'      },
  { id: 'jeju',     name: '제주',  tag: '자연 · 오름 · 해녀'     },
  { id: 'gangneung',name: '강릉',  tag: '커피 · 경포대'          },
  { id: 'incheon',  name: '인천',  tag: '차이나타운 · 을왕리'    },
  { id: 'yeosu',    name: '여수',  tag: '오동도 · 밤바다'        },
];

const DURATIONS = [2, 3, 4, 5, 7, 10];
const PAX_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10];

// AI 가이드 채팅 시나리오 (왼쪽 패널)
const GUIDE_MESSAGES = [
  "안녕하세요! 코코트립 AI 플래너입니다.\n저와 함께 완벽한 한국 여행을 설계해 드릴게요.",
  "오른쪽에서 입국 공항을 먼저 선택해 주세요.\n인천공항(ICN)이 가장 편리합니다.",
  "방문하고 싶은 도시를 클릭 순서대로 골라 주시면\n최적 동선으로 일정을 짜드립니다.",
  "이메일을 입력하시면 3페이지 분량의 VVIP 리포트를\n5분 안에 발송해 드립니다!",
];

// 광고 카드 생성기
function buildAffiliateCards(airportCode: string, cities: string[]) {
  const pickups = PICKUP_PRICES[airportCode] || [];
  const firstCity = cities[0] || '서울';
  const cityQ = encodeURIComponent(firstCity);
  const cards = [];

  if (pickups.length > 0) {
    cards.push({
      type: 'pickup', icon: '🚐',
      title: `${airportCode} 공항 픽업 — 스타리아 프라이빗`,
      sub: `No Hidden Fee · 전액 선결제 보장`,
      badge: pickups[0]?.price ?? '₩124,800~',
      cta: '지금 예약', url: 'https://cocotripkr.com/charter',
      gradient: 'from-[#7C5CFC] to-[#5B3FD4]',
    });
  }
  cards.push({
    type: 'hotel', icon: '🏨',
    title: `${firstCity} 추천 호텔`,
    sub: 'Booking.com · 무료 취소 · 즉시 확정',
    badge: '최저가 비교',
    cta: '가격 보기',
    url: `https://www.booking.com/searchresults.html?ss=${cityQ}&no_rooms=1&group_adults=2`,
    gradient: 'from-[#003580] to-[#0055B3]',
  });
  if (['ICN','GMP'].includes(airportCode) && cities.length > 1) {
    const last = cities[cities.length - 1];
    cards.push({
      type: 'ktx', icon: '🚄',
      title: `서울 → ${last} KTX`,
      sub: '코레일 · 당일 발권 가능',
      badge: '시간표 확인',
      cta: '예매하기',
      url: 'https://www.letskorail.com/ebizbf/EbizBfKrbs020a.do',
      gradient: 'from-[#00498A] to-[#006DC4]',
    });
  } else if (cities.length > 0) {
    cards.push({
      type: 'car', icon: '🚗',
      title: `${firstCity} 렌터카`,
      sub: '공항 직접 인수 가능',
      badge: '실시간 최저가',
      cta: '검색하기',
      url: `https://www.rentalcars.com/en/search/Korea/${cityQ}/`,
      gradient: 'from-[#EA537E] to-[#C03A61]',
    });
  }
  return cards;
}

// ─────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────
export function WizardForm({ onSubmit, isLoading }: any) {
  // 우측 위젯 상태
  const [activeTab, setActiveTab]         = useState('capital');
  const [airportCode, setAirportCode]     = useState('');
  const [customAirport, setCustomAirport] = useState('');
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [duration, setDuration]           = useState(3);
  const [pax, setPax]                     = useState(2);
  const [email, setEmail]                 = useState('');
  const [emailSent, setEmailSent]         = useState(false);

  // 왼쪽 AI 가이드 채팅 상태
  const [guideIdx, setGuideIdx]           = useState(0);
  const [chatInput, setChatInput]         = useState('');
  const [chatMessages, setChatMessages]   = useState<{role:'ai'|'user', text:string}[]>([
    { role: 'ai', text: GUIDE_MESSAGES[0] }
  ]);
  const [chatLoading, setChatLoading]     = useState(false);
  const [extracted, setExtracted]         = useState<any>({
    destination: null, durationDays: null, pax: null, preferences: [],
  });

  // 아이템 완료 체크
  const airportSelected = airportCode || customAirport.trim();
  const citiesSelected  = selectedCities.length > 0;
  const readyToGenerate = airportSelected && citiesSelected;

  const affiliateCards = buildAffiliateCards(
    airportCode || customAirport || 'ICN',
    selectedCities
  );

  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

  // 공항 선택 시 AI 가이드 자동 진행
  useEffect(() => {
    if (airportSelected && guideIdx === 1) {
      setTimeout(() => {
        setChatMessages(prev => [...prev, {
          role: 'ai',
          text: `${airportCode || customAirport} 공항 입국이군요! 스타리아 픽업 서비스를 오른쪽 배너에서 확인해 보세요.\n다음으로 방문하고 싶은 도시를 골라 주세요.`
        }]);
        setGuideIdx(2);
      }, 600);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [airportSelected]);

  useEffect(() => {
    if (citiesSelected && guideIdx === 2) {
      setTimeout(() => {
        setChatMessages(prev => [...prev, {
          role: 'ai',
          text: `${selectedCities.join(' → ')} 동선 확인! 이 루트라면 ${duration}일이 딱 좋겠네요.\n이메일을 입력하시면 VVIP 리포트를 무료로 보내 드릴게요.`
        }]);
        setGuideIdx(3);
      }, 600);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citiesSelected]);

  // AI 채팅 핸들러
  async function handleChatSend(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = chatInput.trim();
    setChatMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setChatInput('');
    setChatLoading(true);
    try {
      const history = chatMessages.map(m => m.text).join('\n---\n');
      const res = await fetch('/.netlify/functions/ai-chat-extractor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, history, currentExtracted: extracted }),
      });
      const data = await res.json();
      if (data.extracted) setExtracted(data.extracted);
      setChatMessages(prev => [...prev, {
        role: 'ai',
        text: data.reply || '알겠습니다! 더 필요한 건 없으신가요?',
      }]);
    } catch {
      setChatMessages(prev => [...prev, {
        role: 'ai',
        text: '네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      }]);
    }
    setChatLoading(false);
  }

  // 최종 플랜 생성 (1단계: quick preview)
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
      freeText: chatMessages.map(m => m.text).join('\n'),
    };
    onSubmit(formValues);
  }

  // 이메일 제출 (2단계: full report)
  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setEmailSent(true);

    // 백그라운드로 full 리포트 요청 (기다리지 않음 — UX 즉시 응답)
    const prefsRaw = extracted.preferences || [];
    const prefs = Array.isArray(prefsRaw) ? prefsRaw.join(', ') : prefsRaw;
    fetch('/.netlify/functions/ai-planner-full', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        destination: selectedCities[0] || 'Seoul',
        regions: selectedCities,
        durationDays: duration,
        duration,
        pax,
        preferences: prefs || 'K-pop, K-food, culture',
        language: 'en',
        vehicleType: 'staria',
        email: email.trim(),
      }),
    }).catch(err => console.warn('Full plan request error (background):', err));
  }

  function toggleCity(name: string) {
    setSelectedCities(prev =>
      prev.includes(name) ? prev.filter(c => c !== name) : [...prev, name]
    );
  }

  // ─────────────────────────────────────────────────────────
  // 렌더
  // ─────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col lg:flex-row gap-4 w-full">

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          왼쪽: AI 가이드 채팅 패널
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="flex-1 flex flex-col rounded-2xl overflow-hidden border border-white/[0.08]"
        style={{ background: 'linear-gradient(160deg, rgba(12,18,32,0.95) 0%, rgba(20,10,40,0.95) 100%)', minHeight: 480 }}>

        {/* 헤더 */}
        <div className="px-5 py-3 border-b border-white/5 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg, #7C5CFC, #EA537E)', boxShadow: '0 0 12px rgba(124,92,252,0.5)' }}>
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-white">CocoTrip AI 플래너</p>
            <p className="text-[11px] text-[#7C5CFC]">무엇이든 물어보세요</p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] text-white/40">온라인</span>
          </div>
        </div>

        {/* 채팅 영역 */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {chatMessages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] px-4 py-2.5 text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'rounded-[18px_18px_4px_18px] text-white'
                  : 'rounded-[18px_18px_18px_4px] text-white/90 border border-white/[0.08] bg-white/[0.04]'
              }`}
                style={m.role === 'user' ? { background: 'linear-gradient(135deg, #7C5CFC, #EA537E)' } : {}}>
                {m.text.split('\n').map((line, l) => <p key={l}>{line}</p>)}
              </div>
            </div>
          ))}

          {chatLoading && (
            <div className="flex justify-start">
              <div className="border border-white/[0.08] bg-white/[0.04] rounded-[18px_18px_18px_4px] px-4 py-3 flex gap-1.5">
                {[0, 0.15, 0.3].map((d, i) => (
                  <div key={i} className="w-1.5 h-1.5 rounded-full animate-bounce"
                    style={{ background: i % 2 === 0 ? '#7C5CFC' : '#EA537E', animationDelay: `${d}s` }} />
                ))}
              </div>
            </div>
          )}

          {/* 이메일 발송 성공 카드 */}
          {emailSent && (
            <div className="rounded-2xl border border-emerald-500/30 px-4 py-4 text-sm"
              style={{ background: 'rgba(16,185,129,0.08)' }}>
              <div className="flex items-center gap-2 mb-2">
                <Shield className="w-4 h-4 text-emerald-400" />
                <span className="font-bold text-emerald-300">분석 및 검증 예약 완료!</span>
              </div>
              <p className="text-white/70 leading-relaxed">
                5분 뒤 이메일로 VVIP 리포트가 발송됩니다.<br />
                창을 닫으셔도 안전합니다.
              </p>
              <div className="mt-3 flex items-center gap-2 text-[11px] text-white/40">
                <Clock className="w-3 h-3" />
                <span>백그라운드 AI 에이전트 6개팀 가동 중</span>
              </div>
            </div>
          )}

          <div ref={chatBottomRef} />
        </div>

        {/* 입력창 */}
        <div className="px-4 py-3 border-t border-white/5">
          <form onSubmit={handleChatSend} className="relative flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              placeholder="공항, 도시, 여행 스타일... 자유롭게 질문해 주세요"
              disabled={chatLoading}
              className="flex-1 bg-white/[0.05] border border-white/10 text-white placeholder-white/30 rounded-full px-5 py-3 text-sm focus:outline-none focus:border-[#7C5CFC]/60 transition-colors"
            />
            <button type="submit" disabled={!chatInput.trim() || chatLoading}
              className="absolute right-1 top-1 w-[40px] h-[40px] rounded-full flex items-center justify-center text-white disabled:opacity-40 transition-all hover:scale-105"
              style={{ background: 'linear-gradient(135deg, #7C5CFC, #EA537E)' }}>
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          오른쪽: 선택 위젯 패널
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="w-full lg:w-[360px] shrink-0 flex flex-col gap-4">

        {/* ── 공항 선택 ── */}
        <div className="rounded-2xl border border-white/[0.08] p-4"
          style={{ background: 'linear-gradient(160deg, rgba(12,18,32,0.95), rgba(20,10,40,0.95))' }}>
          <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3 flex items-center gap-1.5">
            <Plane className="w-3.5 h-3.5" /> 입국 공항 선택
          </p>

          {/* 탭 */}
          <div className="flex gap-1 bg-white/[0.05] rounded-xl p-0.5 mb-3">
            {AIRPORT_TABS.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all ${
                  activeTab === tab.id
                    ? 'text-white shadow-sm'
                    : 'text-white/35 hover:text-white/60'
                }`}
                style={activeTab === tab.id ? { background: 'linear-gradient(135deg, #7C5CFC, #EA537E)' } : {}}>
                {tab.label}
              </button>
            ))}
          </div>

          {/* 공항 칩 */}
          <div className="flex flex-wrap gap-2 mb-3">
            {AIRPORT_TABS.find(t => t.id === activeTab)?.airports.map(ap => (
              <button key={ap.code}
                onClick={() => { setAirportCode(ap.code); setCustomAirport(''); setChatInput(''); setGuideIdx(1); }}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-semibold transition-all ${
                  airportCode === ap.code
                    ? 'border-[#7C5CFC] bg-[#7C5CFC]/20 text-white shadow-[0_0_10px_rgba(124,92,252,0.4)]'
                    : 'border-white/10 bg-white/[0.04] text-white/55 hover:border-white/25 hover:text-white'
                }`}>
                <span className="text-[11px] font-mono text-white/40">{ap.code}</span>
                <span>{ap.name}</span>
                {airportCode === ap.code && <Check className="w-3 h-3 text-[#7C5CFC]" />}
              </button>
            ))}
          </div>

          {/* 직접 입력 */}
          <div className="relative">
            <Plane className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/25" />
            <input type="text" value={customAirport}
              onChange={e => { setCustomAirport(e.target.value); setAirportCode(''); }}
              placeholder="기타 공항 / 항구 직접 입력 (예: 청주, 군산항)"
              className="w-full bg-white/[0.04] border border-white/10 text-white placeholder-white/25 rounded-xl pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-[#7C5CFC]/50 transition-colors"
            />
          </div>

          {/* 공항 픽업 광고 — 즉시 노출 */}
          {airportSelected && (
            <div className="mt-3 rounded-xl border border-[#7C5CFC]/30 px-3 py-3 flex items-center gap-3"
              style={{ background: 'linear-gradient(135deg, rgba(124,92,252,0.15), rgba(234,83,126,0.10))' }}>
              <span className="text-xl">🚐</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white">{airportCode || customAirport} 공항 픽업</p>
                <p className="text-[11px] text-white/45 mt-0.5">스타리아 프라이빗 · No Hidden Fee</p>
                <p className="text-xs font-semibold text-[#7C5CFC] mt-0.5">
                  {(PICKUP_PRICES[airportCode] || [])[0]?.price ?? '₩124,800~'}
                </p>
              </div>
              <a href="https://cocotripkr.com/charter" target="_blank" rel="noopener noreferrer"
                className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold text-white flex items-center gap-1 hover:opacity-90 transition-opacity"
                style={{ background: 'linear-gradient(135deg, #7C5CFC, #EA537E)' }}>
                예약 <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>

        {/* ── 도시 선택 ── */}
        <div className="rounded-2xl border border-white/[0.08] p-4"
          style={{ background: 'linear-gradient(160deg, rgba(12,18,32,0.95), rgba(20,10,40,0.95))' }}>
          <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3 flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5" /> 방문 도시 <span className="text-[#EA537E] normal-case font-normal ml-1">클릭 순서 = 동선</span>
          </p>

          <div className="grid grid-cols-2 gap-2">
            {CITIES.map(city => {
              const order = selectedCities.indexOf(city.name);
              const sel   = order >= 0;
              return (
                <button key={city.id} onClick={() => toggleCity(city.name)}
                  className={`relative flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-xl border text-left transition-all ${
                    sel
                      ? 'border-[#EA537E] bg-[#EA537E]/12 text-white'
                      : 'border-white/[0.08] bg-white/[0.03] text-white/55 hover:border-white/20 hover:text-white'
                  }`}>
                  {sel && (
                    <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full text-white text-[10px] font-bold flex items-center justify-center"
                      style={{ background: 'linear-gradient(135deg, #7C5CFC, #EA537E)' }}>
                      {order + 1}
                    </span>
                  )}
                  <span className="text-sm font-bold">{city.name}</span>
                  <span className="text-[10px] text-white/35">{city.tag}</span>
                </button>
              );
            })}
          </div>

          {selectedCities.length > 0 && (
            <div className="mt-3 bg-[#7C5CFC]/10 border border-[#7C5CFC]/20 rounded-xl px-3 py-2 flex items-center gap-1.5 flex-wrap">
              <ArrowRight className="w-3 h-3 text-[#7C5CFC] shrink-0" />
              {selectedCities.map((c, i) => (
                <span key={c} className="flex items-center gap-1 text-sm">
                  <span className="font-semibold text-white">{c}</span>
                  {i < selectedCities.length - 1 && <ChevronRight className="w-3 h-3 text-white/25" />}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* ── 기간 & 인원 ── */}
        <div className="rounded-2xl border border-white/[0.08] p-4"
          style={{ background: 'linear-gradient(160deg, rgba(12,18,32,0.95), rgba(20,10,40,0.95))' }}>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[11px] text-white/35 mb-2 flex items-center gap-1 uppercase tracking-wider">
                <Calendar className="w-3 h-3" /> 기간
              </p>
              <div className="flex flex-wrap gap-1.5">
                {DURATIONS.map(d => (
                  <button key={d} onClick={() => setDuration(d)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      duration === d ? 'text-white shadow-sm' : 'bg-white/[0.05] border border-white/[0.08] text-white/45 hover:text-white'
                    }`}
                    style={duration === d ? { background: 'linear-gradient(135deg, #7C5CFC, #EA537E)' } : {}}>
                    {d}일
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[11px] text-white/35 mb-2 flex items-center gap-1 uppercase tracking-wider">
                <Users className="w-3 h-3" /> 인원
              </p>
              <div className="flex flex-wrap gap-1.5">
                {PAX_OPTIONS.map(n => (
                  <button key={n} onClick={() => setPax(n)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      pax === n ? 'text-white shadow-sm' : 'bg-white/[0.05] border border-white/[0.08] text-white/45 hover:text-white'
                    }`}
                    style={pax === n ? { background: 'linear-gradient(135deg, #7C5CFC, #EA537E)' } : {}}>
                    {n}명
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── 맥락형 제휴 광고 슬롯 ── */}
        {citiesSelected && (
          <div className="flex flex-col gap-2">
            {affiliateCards.filter(c => c.type !== 'pickup').map((card, i) => (
              <div key={i} className="rounded-xl border border-white/[0.08] px-3 py-3 flex items-center gap-3 hover:border-white/20 transition-all"
                style={{ background: 'rgba(255,255,255,0.03)' }}>
                <span className="text-lg shrink-0">{card.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-white truncate">{card.title}</p>
                  <p className="text-[10px] text-white/35 mt-0.5 truncate">{card.sub}</p>
                </div>
                <a href={card.url} target="_blank" rel="noopener noreferrer"
                  className="shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-white flex items-center gap-1 hover:opacity-90 transition-opacity"
                  style={{ background: `linear-gradient(135deg, #7C5CFC, #EA537E)` }}>
                  {card.cta} <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
            ))}
          </div>
        )}

        {/* ── 플랜 생성 / 이메일 퍼널 ── */}
        {readyToGenerate && (
          <div className="rounded-2xl border border-[#7C5CFC]/30 p-4 space-y-3"
            style={{ background: 'linear-gradient(160deg, rgba(124,92,252,0.10), rgba(234,83,126,0.08))', boxShadow: '0 0 30px rgba(124,92,252,0.15)' }}>

            {/* 1단계: 즉시 미리보기 */}
            <button onClick={handleGeneratePlan} disabled={isLoading}
              className="w-full py-3.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all hover:scale-[1.02] disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #7C5CFC, #EA537E)', boxShadow: '0 4px 20px rgba(124,92,252,0.4)' }}>
              <Wand2 className="w-4 h-4" />
              {isLoading ? 'AI 플랜 생성 중...' : '1페이지 미리보기 즉시 생성'}
            </button>

            {/* 2단계: 이메일 전체 리포트 */}
            {!emailSent ? (
              <form onSubmit={handleEmailSubmit} className="space-y-2">
                <p className="text-[11px] text-white/45 flex items-center gap-1.5">
                  <Star className="w-3 h-3 text-[#EA537E]" />
                  이메일로 3페이지 VVIP 전체 리포트 무료 발송
                </p>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
                    <input type="email" value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="이메일 주소 입력"
                      className="w-full bg-white/[0.06] border border-white/[0.12] text-white placeholder-white/30 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#7C5CFC]/60 transition-colors"
                    />
                  </div>
                  <button type="submit" disabled={!email.trim()}
                    className="px-4 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40 hover:opacity-90 transition-all"
                    style={{ background: 'linear-gradient(135deg, #EA537E, #7C5CFC)' }}>
                    발송
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-emerald-500/30"
                style={{ background: 'rgba(16,185,129,0.08)' }}>
                <Shield className="w-4 h-4 text-emerald-400 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-emerald-300">분석 및 검증 예약 완료!</p>
                  <p className="text-[11px] text-white/50 mt-0.5">5분 뒤 VVIP 리포트 발송 · 창을 닫으셔도 안전합니다</p>
                </div>
              </div>
            )}
          </div>
        )}

      </div>{/* end 오른쪽 패널 */}
    </div>
  );
}
