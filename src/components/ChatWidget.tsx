import { useState, useRef, useEffect, useCallback, forwardRef } from 'react';
import { Bot, MessageCircle, X, Send, Plus } from 'lucide-react';
import { translations, type Language } from '@/i18n';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
import { signInWithGoogle } from '@/lib/firebase';
import { trackChatOpen } from '@/lib/analytics';

interface Message {
  id: string;
  role: 'user' | 'ai' | 'admin';
  text: string;
  time: string;
  adminName?: string;
}

interface ChatWidgetProps {
  language: Language;
}

const WELCOME: Record<Language, string> = {
  ko: '안녕하세요! 코코트립입니다.\n한국 여행에 대해 무엇이든 물어보세요!',
  en: 'Hi there! Welcome to CocoTrip.\nAsk me anything about your Korea trip!',
  ja: 'こんにちは！CocoTripです。\n韓国旅行について何でもお聞きください！',
  zh: '您好！欢迎来到CocoTrip。\n请随时询问有关韩国旅行的任何问题！',
};

const QUICK_QUESTIONS: Record<Language, string[]> = {
  ko: ['투어 가격이 궁금해요', '공항 픽업 있나요?', 'K-pop 셔틀 정보', '예약 방법'],
  en: ['Tour prices?', 'Airport pickup?', 'K-pop shuttle?', 'How to book?'],
  ja: ['ツアー料金は？', '空港送迎は？', 'K-popシャトル？', '予約方法は？'],
  zh: ['旅游价格？', '机场接送？', 'K-pop班车？', '如何预订？'],
};

const PLACEHOLDER: Record<Language, string> = {
  ko: '메시지를 입력하세요...',
  en: 'Type your message...',
  ja: 'メッセージを入力...',
  zh: '输入消息...',
};

const SUBTITLE: Record<Language, string> = {
  ko: '보통 즉시 답변',
  en: 'Usually replies instantly',
  ja: '通常すぐに返信',
  zh: '通常立即回复',
};

const WHATSAPP_TEXT: Record<Language, string> = {
  ko: '더 자세한 문의는 WhatsApp으로',
  en: 'For detailed inquiries, contact WhatsApp',
  ja: '詳細はWhatsAppで',
  zh: '详细咨询请联系WhatsApp',
};

function generateId() {
  return Math.random().toString(36).slice(2, 9);
}

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}




const LOGIN_CHAT_TEXT: Record<Language, { title: string; desc: string; google: string; apple: string; loading: string }> = {
  ko: { title: '로그인 후 이용 가능합니다', desc: '로그인하면 AI와 대화할 수 있어요.', google: '구글로 시작하기', apple: 'Apple로 시작하기', loading: '로그인 중...' },
  en: { title: 'Sign in to chat', desc: 'Login to start chatting with our AI.', google: 'Continue with Google', apple: 'Continue with Apple', loading: 'Signing in...' },
  ja: { title: 'ログインして利用', desc: 'AIとチャットするにはログインが必要です。', google: 'Googleで続ける', apple: 'Appleで続ける', loading: 'ログイン中...' },
  zh: { title: '登录后使用', desc: '登录后即可与AI对话。', google: '使用Google登录', apple: '使用Apple登录', loading: '登录中...' },
};

// FAQ Quick Reply — "+" 버튼 클릭 시 펼치는 자주 묻는 질문 패널.
// 각 질문 클릭 시 sendMessage()로 전송 → AI가 SYSTEM_PROMPT(FAQ 지식 + 라우팅)에
// 따라 답변. 카테고리는 booking/info/escalate 라우팅에 자연스럽게 매핑됨.
const FAQ_QUICK_REPLIES: Record<Language, { id: string; label: string; q: string }[]> = {
  ko: [
    { id: 'price', label: '💰 투어 가격', q: '투어 가격 알려주세요' },
    { id: 'airport', label: '✈️ 공항 픽업', q: '공항 픽업 가능한가요?' },
    { id: 'kpop', label: '🎤 K-pop 셔틀', q: 'K-pop 콘서트 셔틀 정보 알려주세요' },
    { id: 'refund', label: '💵 환불 정책', q: '환불 정책이 어떻게 되나요?' },
    { id: 'planner', label: '🗺️ AI 플래너', q: 'AI 플래너 무엇이고 가격이 얼마인가요?' },
    { id: 'food', label: '🍽️ 할랄/비건', q: '할랄/비건 식당 안내해 주시나요?' },
    { id: 'tip', label: '💁 팁 문화', q: '한국에서 팁 줘야 하나요?' },
    { id: 'visa', label: '📘 비자', q: '한국 입국 비자 필요한가요?' },
    { id: 'esim', label: '📶 eSIM', q: 'eSIM 추천해 주세요' },
    { id: 'group', label: '👥 단체 9인+', q: '10명 단체 견적 부탁드려요' },
    { id: 'book', label: '📅 예약 방법', q: '어디서 예약하나요?' },
    { id: 'safe', label: '🛡️ 보험·안전', q: '여행자 보험·안전 안내해 주세요' },
  ],
  en: [
    { id: 'price', label: '💰 Tour prices', q: 'How much are your tours?' },
    { id: 'airport', label: '✈️ Airport pickup', q: 'Do you offer airport pickup?' },
    { id: 'kpop', label: '🎤 K-pop shuttle', q: 'Tell me about K-pop concert shuttles' },
    { id: 'refund', label: '💵 Refund policy', q: 'What is your refund policy?' },
    { id: 'planner', label: '🗺️ AI Planner', q: 'What is the AI Planner and how much?' },
    { id: 'food', label: '🍽️ Halal/vegan', q: 'Do you support halal or vegan options?' },
    { id: 'tip', label: '💁 Tipping', q: 'Should I tip in Korea?' },
    { id: 'visa', label: '📘 Visa', q: 'Do I need a visa for Korea?' },
    { id: 'esim', label: '📶 eSIM', q: 'Can you recommend an eSIM?' },
    { id: 'group', label: '👥 Group 9+', q: 'Quote for a group of 10 please' },
    { id: 'book', label: '📅 How to book', q: 'How do I book a tour?' },
    { id: 'safe', label: '🛡️ Insurance', q: 'Tell me about insurance and safety' },
  ],
  ja: [
    { id: 'price', label: '💰 ツアー料金', q: 'ツアーの料金を教えてください' },
    { id: 'airport', label: '✈️ 空港送迎', q: '空港送迎は可能ですか？' },
    { id: 'kpop', label: '🎤 K-popシャトル', q: 'K-popコンサートシャトルの情報を教えて' },
    { id: 'refund', label: '💵 返金規定', q: '返金規定はどうなっていますか？' },
    { id: 'planner', label: '🗺️ AIプランナー', q: 'AIプランナーとは？料金は？' },
    { id: 'food', label: '🍽️ ハラール/ビーガン', q: 'ハラールやビーガンに対応していますか？' },
    { id: 'tip', label: '💁 チップ', q: '韓国でチップは必要ですか？' },
    { id: 'visa', label: '📘 ビザ', q: '韓国入国にビザは必要ですか？' },
    { id: 'esim', label: '📶 eSIM', q: 'eSIMのおすすめを教えてください' },
    { id: 'group', label: '👥 10名以上', q: '10名のグループ見積りお願いします' },
    { id: 'book', label: '📅 予約方法', q: 'どうやって予約しますか？' },
    { id: 'safe', label: '🛡️ 保険', q: '保険と安全について教えてください' },
  ],
  zh: [
    { id: 'price', label: '💰 旅游价格', q: '请告诉我旅游价格' },
    { id: 'airport', label: '✈️ 机场接送', q: '可以提供机场接送吗？' },
    { id: 'kpop', label: '🎤 K-pop班车', q: '请告诉我K-pop演唱会班车信息' },
    { id: 'refund', label: '💵 退款政策', q: '退款政策是什么？' },
    { id: 'planner', label: '🗺️ AI规划师', q: 'AI规划师是什么？价格多少？' },
    { id: 'food', label: '🍽️ 清真/素食', q: '是否支持清真或素食？' },
    { id: 'tip', label: '💁 小费', q: '在韩国需要给小费吗？' },
    { id: 'visa', label: '📘 签证', q: '入境韩国需要签证吗？' },
    { id: 'esim', label: '📶 eSIM', q: '请推荐eSIM' },
    { id: 'group', label: '👥 10人+', q: '10人团体报价请' },
    { id: 'book', label: '📅 如何预订', q: '如何预订旅游？' },
    { id: 'safe', label: '🛡️ 保险', q: '请告诉我保险和安全相关信息' },
  ],
};

// 429/401 오류 메시지 다국어
const CHAT_ERROR_TEXT: Record<Language, { rateLimitUser: string; rateLimitIp: string; authRequired: string; connectionError: string; generic: string }> = {
  ko: {
    rateLimitUser: '메시지를 너무 빠르게 보내고 있어요. 잠시 후 다시 시도해 주세요.',
    rateLimitIp: '오늘 문의 한도에 도달했습니다. WhatsApp으로 연락해 주세요: +82-10-8714-0611',
    authRequired: '로그인 후 채팅을 이용하실 수 있습니다.',
    connectionError: '연결 오류가 발생했습니다. WhatsApp으로 문의해 주세요: +82-10-8714-0611',
    generic: '일시적인 오류가 발생했습니다. 다시 시도해 주세요.',
  },
  en: {
    rateLimitUser: 'You are sending messages too quickly. Please wait a few minutes.',
    rateLimitIp: 'Daily limit reached. Please contact us via WhatsApp: +82-10-8714-0611',
    authRequired: 'Please sign in to continue chatting.',
    connectionError: 'Connection error. Please try WhatsApp: +82-10-8714-0611',
    generic: 'Sorry, something went wrong. Please try again.',
  },
  ja: {
    rateLimitUser: 'メッセージの送信が速すぎます。少し待ってから再試行してください。',
    rateLimitIp: '本日の問い合わせ上限に達しました。WhatsAppでご連絡ください: +82-10-8714-0611',
    authRequired: 'チャットを利用するにはログインが必要です。',
    connectionError: '接続エラーが発生しました。WhatsAppでお問い合わせください: +82-10-8714-0611',
    generic: '一時的なエラーが発生しました。もう一度お試しください。',
  },
  zh: {
    rateLimitUser: '您发送消息太快了，请稍候再试。',
    rateLimitIp: '今日咨询次数已达上限，请通过WhatsApp联系我们: +82-10-8714-0611',
    authRequired: '请登录后使用聊天功能。',
    connectionError: '连接错误，请通过WhatsApp联系我们: +82-10-8714-0611',
    generic: '发生了临时错误，请重试。',
  },
};

const ChatInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>((props, ref) => (
  <input ref={ref} {...props} />
));

export function ChatWidget({ language }: ChatWidgetProps) {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  // 모바일에선 bottom-nav(높이 ~62px)와 겹치지 않도록 위로 띄우고 살짝 작게.
  const togglePos = isMobile ? { bottom: '76px', right: '14px', size: '52px' } : { bottom: '24px', right: '24px', size: '60px' };
  const popupBottom = isMobile ? '140px' : '88px';
  const popupRight = isMobile ? '14px' : '24px';
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(() => `sess_${generateId()}`);
  const [lastPollTs, setLastPollTs] = useState(0);
  const [quickShown, setQuickShown] = useState(true);
  const [authLoading, setAuthLoading] = useState<'google' | 'apple' | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);


  const handleGoogleLogin = useCallback(async () => {
    setAuthError(null);
    setAuthLoading('google');
    try { await signInWithGoogle(); } catch (e) { setAuthError(e instanceof Error ? e.message : 'Login failed'); }
    finally { setAuthLoading(null); }
  }, []);

  // 채팅창 열릴 때 웰컴 메시지 초기화
  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([
        {
          id: generateId(),
          role: 'ai',
          text: WELCOME[language],
          time: nowTime(),
        },
      ]);
      setQuickShown(true);
    }
  }, [open, language, messages.length]);

  // 언어 변경 시 웰컴 메시지만 교체
  useEffect(() => {
    if (open && messages.length > 0 && messages[0].role === 'ai') {
      setMessages((prev) => [
        { ...prev[0], text: WELCOME[language] },
        ...prev.slice(1),
      ]);
    }
  }, [language]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // 관리자 답장 폴링 — 위젯 열린 동안 + 사용자가 1번 이상 메시지 보낸 후
  useEffect(() => {
    if (!open) return;
    const userHasSent = messages.some((m) => m.role === 'user');
    if (!userHasSent) return;

    const POLL_INTERVAL = 8000;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/chat-poll?sessionId=${encodeURIComponent(sessionId)}&since=${lastPollTs}`);
        const json = await res.json();
        if (cancelled) return;
        const adminMessages = json?.data?.messages || [];
        if (adminMessages.length > 0) {
          const newest = Math.max(...adminMessages.map((m: { ts: number }) => m.ts));
          setLastPollTs(newest);
          setMessages((prev) => [
            ...prev,
            ...adminMessages.map((m: { id: string; text: string; ts: number; adminName?: string }) => ({
              id: m.id,
              role: 'admin' as const,
              text: m.text,
              time: new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              adminName: m.adminName,
            })),
          ]);
        }
      } catch (err) {
        console.warn('[chat-poll] failed (continuing):', err);
      }
    };

    const interval = setInterval(poll, POLL_INTERVAL);
    return () => { cancelled = true; clearInterval(interval); };
  }, [open, sessionId, lastPollTs, messages]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  // PR-R (2026-05-08): 글로벌 이벤트 'cocotrip:open-chat' listen → ChatWidget 자동 오픈.
  // PayPalBookingButton 이 BOOKING_CLOSED 응답 시 dispatch 함. 다른 컴포넌트도
  // 같은 이벤트 dispatch 로 챗 상담 유도 가능.
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('cocotrip:open-chat', handler);
    return () => window.removeEventListener('cocotrip:open-chat', handler);
  }, []);

  // Restore focus automatically when loading completes
  useEffect(() => {
    if (!loading && open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [loading, open]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      setQuickShown(false);
      setInput('');
      setMessages((prev) => [
        ...prev,
        { id: generateId(), role: 'user', text: trimmed, time: nowTime() },
      ]);
      setLoading(true);

      try {
        // 웰컴 메시지 제외, 최근 5턴만 전송 (토큰 비용 최적화)
        const history = messages
          .slice(1)
          .slice(-10)  // 최근 10개 메시지 = 5턴
          .map((m) => ({ role: m.role, text: m.text }));

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: trimmed, messages: history, sessionId, language, userId: user?.uid }),
        });
        const json = await res.json();
        const payload = json.data;
        // 429 / 401은 사용자에게 명확히 안내 (그냥 generic 에러 메시지면 혼란)
        if (!res.ok) {
          const code = json.code || '';
          const errT = CHAT_ERROR_TEXT[language];
          let msg = errT.generic;
          if (code === 'RATE_LIMIT_USER') msg = errT.rateLimitUser;
          else if (code === 'RATE_LIMIT_IP') msg = errT.rateLimitIp;
          else if (code === 'AUTH_REQUIRED') msg = errT.authRequired;
          setMessages((prev) => [
            ...prev,
            { id: generateId(), role: 'ai', text: msg, time: nowTime() },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: generateId(),
              role: 'ai',
              text: payload?.reply ||'Sorry, something went wrong.',
              time: nowTime(),
            },
          ]);
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            role: 'ai',
            text: CHAT_ERROR_TEXT[language].connectionError,
            time: nowTime(),
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [loading, sessionId, language]
  );

  // FAQ Quick Reply 패널 토글 — "+" 버튼으로 펼침/접힘
  const [showFaqPanel, setShowFaqPanel] = useState(false);

  const handleFaqClick = useCallback((q: string) => {
    setShowFaqPanel(false);
    sendMessage(q);
  }, [sendMessage]);



  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <>
      {/* ── 채팅 팝업창 ───────────────────────────────────────── */}
      {open && !user && (
        <div
          style={{
            position: 'fixed',
            bottom: popupBottom,
            right: popupRight,
            width: '320px',
            borderRadius: '16px',
            background: '#1a1a2e',
            boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 9999,
            overflow: 'hidden',
            border: '1px solid rgba(124,92,252,0.3)',
            padding: '20px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: '15px' }}>
              {LOGIN_CHAT_TEXT[language].title}
            </div>
            <button onClick={() => setOpen(false)} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '50%', width: '26px', height: '26px', cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={13} color="#fff" />
            </button>
          </div>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px', marginBottom: '16px' }}>
            {LOGIN_CHAT_TEXT[language].desc}
          </p>
          <button
            onClick={handleGoogleLogin}
            disabled={authLoading !== null}
            style={{ width: '100%', padding: '10px', borderRadius: '10px', background: '#fff', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '8px', opacity: authLoading !== null ? 0.6 : 1 }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            {authLoading === 'google' ? LOGIN_CHAT_TEXT[language].loading : LOGIN_CHAT_TEXT[language].google}
          </button>
          {/* Apple 로그인 임시 비활성화 */}
          {authError && <p style={{ color: '#f87171', fontSize: '11px', marginTop: '8px', textAlign: 'center' }}>{authError}</p>}
        </div>
      )}

      {open && user && (
        <div
          style={{
            position: 'fixed',
            bottom: popupBottom,
            right: popupRight,
            width: 'min(360px, calc(100vw - 28px))',
            height: 'min(500px, calc(100dvh - 160px))',
            borderRadius: '16px',
            background: '#1a1a2e',
            boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 9999,
            overflow: 'hidden',
            border: '1px solid rgba(124,92,252,0.3)',
          }}
        >
          {/* 헤더 */}
          <div
            style={{
              background: 'linear-gradient(135deg, #7C5CFC, #EA537E)',
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Bot size={18} color="#fff" />
              </div>
              <div>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: '15px' }}>
                  CocoTrip AI
                </div>
                <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: '11px' }}>
                  {SUBTITLE[language]}
                </div>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{
                background: 'rgba(255,255,255,0.2)',
                border: 'none',
                borderRadius: '50%',
                width: '28px',
                height: '28px',
                cursor: 'pointer',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={14} color="#fff" />
            </button>
          </div>

          {/* 메시지 영역 */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            {messages.map((msg, idx) => (
              <div key={msg.id}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  }}
                >
                  <div
                    style={{
                      maxWidth: '78%',
                      padding: '9px 13px',
                      borderRadius:
                        msg.role === 'user'
                          ? '16px 16px 4px 16px'
                          : '16px 16px 16px 4px',
                      background:
                        msg.role === 'user'
                          ? 'linear-gradient(135deg, #7C5CFC, #EA537E)'
                          : msg.role === 'admin'
                          ? 'linear-gradient(135deg, rgba(251,191,36,0.18), rgba(251,191,36,0.08))'
                          : 'rgba(255,255,255,0.1)',
                      color: '#fff',
                      fontSize: '13px',
                      lineHeight: '1.5',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      border: msg.role === 'admin' ? '1px solid rgba(251,191,36,0.35)' : 'none',
                    }}
                  >
                    {msg.role === 'admin' && (
                      <div style={{ fontSize: '10px', color: '#FBBF24', fontWeight: 700, marginBottom: '3px', letterSpacing: '0.4px' }}>
                        {msg.adminName ? `${msg.adminName} (CocoTrip)` : 'CocoTrip 직원'}
                      </div>
                    )}
                    {msg.text}
                  </div>
                </div>
                <div
                  style={{
                    textAlign: msg.role === 'user' ? 'right' : 'left',
                    fontSize: '10px',
                    color: 'rgba(255,255,255,0.4)',
                    marginTop: '3px',
                    paddingLeft: msg.role === 'ai' ? '2px' : 0,
                    paddingRight: msg.role === 'user' ? '2px' : 0,
                  }}
                >
                  {msg.time}
                </div>

                {/* 웰컴 메시지 아래 빠른 질문 버튼 */}
                {idx === 0 && quickShown && (
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '6px',
                      marginTop: '10px',
                    }}
                  >
                    {QUICK_QUESTIONS[language].map((q) => (
                      <button
                        key={q}
                        onClick={() => sendMessage(q)}
                        style={{
                          background: 'rgba(124,92,252,0.2)',
                          border: '1px solid rgba(124,92,252,0.5)',
                          borderRadius: '20px',
                          color: '#c4a8ff',
                          fontSize: '11px',
                          padding: '5px 10px',
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(124,92,252,0.4)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'rgba(124,92,252,0.2)';
                        }}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* 로딩 애니메이션 */}
            {loading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div
                  style={{
                    padding: '10px 16px',
                    borderRadius: '16px 16px 16px 4px',
                    background: 'rgba(255,255,255,0.1)',
                    display: 'flex',
                    gap: '4px',
                    alignItems: 'center',
                  }}
                >
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      style={{
                        width: '7px',
                        height: '7px',
                        borderRadius: '50%',
                        background: '#c4a8ff',
                        display: 'inline-block',
                        animation: `chatDot 1.2s ease-in-out ${i * 0.2}s infinite`,
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* WhatsApp 링크 */}
          <div
            style={{
              padding: '6px 14px',
              borderTop: '1px solid rgba(255,255,255,0.07)',
              flexShrink: 0,
            }}
          >
            <a
              href="https://wa.me/821087140611"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: 'rgba(255,255,255,0.45)',
                fontSize: '11px',
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                justifyContent: 'center',
              }}
            >
              <MessageCircle size={13} color="#25D366" />
              {WHATSAPP_TEXT[language]}
            </a>
          </div>

          {/* 입력창 */}
          <div
            style={{
              padding: '10px 12px',
              borderTop: '1px solid rgba(255,255,255,0.08)',
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
              flexShrink: 0,
              background: 'rgba(0,0,0,0.2)',
              position: 'relative',
            }}
          >
            {/* FAQ Quick Reply 패널 — + 버튼 클릭 시 펼침 */}
            {showFaqPanel && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 'calc(100% + 6px)',
                  left: '8px',
                  right: '8px',
                  background: 'rgba(20,20,30,0.98)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: '14px',
                  padding: '10px',
                  maxHeight: '260px',
                  overflowY: 'auto',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                  zIndex: 10,
                }}
              >
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.55)', marginBottom: '8px', paddingLeft: '4px' }}>
                  {language === 'ko' ? '자주 묻는 질문' : language === 'ja' ? 'よくある質問' : language === 'zh' ? '常见问题' : 'Frequently Asked'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                  {FAQ_QUICK_REPLIES[language].map((faq) => (
                    <button
                      key={faq.id}
                      onClick={() => handleFaqClick(faq.q)}
                      style={{
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.10)',
                        borderRadius: '10px',
                        padding: '8px 10px',
                        color: '#fff',
                        fontSize: '12px',
                        textAlign: 'left',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(124,92,252,0.15)';
                        e.currentTarget.style.borderColor = 'rgba(124,92,252,0.35)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)';
                      }}
                    >
                      {faq.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button
              onClick={() => setShowFaqPanel((v) => !v)}
              aria-label={language === 'ko' ? '자주 묻는 질문 열기' : 'Open FAQ'}
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                background: showFaqPanel ? 'rgba(124,92,252,0.25)' : 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                flexShrink: 0,
                transition: 'all 0.2s',
                transform: showFaqPanel ? 'rotate(45deg)' : 'rotate(0)',
              }}
            >
              <Plus size={18} />
            </button>
            <ChatInput
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={PLACEHOLDER[language]}
              disabled={loading}
              style={{
                flex: 1,
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '20px',
                padding: '9px 14px',
                color: '#fff',
                fontSize: '13px',
                outline: 'none',
              }}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={loading || !input.trim()}
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                background:
                  input.trim() && !loading
                    ? 'linear-gradient(135deg, #7C5CFC, #EA537E)'
                    : 'rgba(255,255,255,0.1)',
                border: 'none',
                cursor: input.trim() && !loading ? 'pointer' : 'default',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                transition: 'all 0.2s',
              }}
            >
              <Send size={15} color="#fff" style={{ marginLeft: '2px' }} />
            </button>
          </div>
        </div>
      )}

      {/* ── 토글 버튼 ─────────────────────────────────────────── */}
      <button
        onClick={() => { const next = !open; if (next) trackChatOpen(); setOpen(next); }}
        aria-label={translations[language].a11y?.openChat ||'Open chat'}
        style={{
          position: 'fixed',
          bottom: togglePos.bottom,
          right: togglePos.right,
          width: togglePos.size,
          height: togglePos.size,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #7C5CFC, #EA537E)',
          border: 'none',
          cursor: 'pointer',
          boxShadow: '0 4px 24px rgba(124,92,252,0.5), 0 0 40px rgba(124,92,252,0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          transition: 'transform 0.3s cubic-bezier(.2,0,.2,1), box-shadow 0.3s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'scale(1.1)';
          e.currentTarget.style.boxShadow = '0 6px 32px rgba(124,92,252,0.7), 0 0 50px rgba(234,83,126,0.3)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1)';
          e.currentTarget.style.boxShadow = '0 4px 24px rgba(124,92,252,0.5), 0 0 40px rgba(124,92,252,0.25)';
        }}
      >
        {open ? <X size={24} color="#fff" /> : <MessageCircle size={26} color="#fff" />}
      </button>

      {/* 점 깜빡임 keyframe */}
      <style>{`
        @keyframes chatDot {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </>
  );
}
