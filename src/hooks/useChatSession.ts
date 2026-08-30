// useChatSession — ChatWidget(홈 플로팅)과 AssistantPage(/assistant 전면 화면)가 공유하는
// AI 채팅 코어 (2026-07-19 모바일 UI 리디자인 Task 3에서 ChatWidget 로부터 추출).
// 여기는 상태·/api/chat 호출·운영자 답장 폴링(/api/chat-poll, 8초)만 담당하고 UI 는 소비자 몫.
// 문구 상수(웰컴·빠른질문·FAQ·에러)는 두 소비자가 같이 쓰므로 이 파일에서 export.
import { useState, useEffect, useCallback } from 'react';
import type { Language } from '@/i18n';
import { useAuth } from '@/hooks/useAuth';

export interface ChatMessage {
  id: string;
  role: 'user' | 'ai' | 'admin';
  text: string;
  time: string;
  adminName?: string;
}

export const WELCOME: Record<Language, string> = {
  ko: '안녕하세요! 코코트립입니다.\n한국 여행에 대해 무엇이든 물어보세요!',
  en: 'Hi there! Welcome to CocoTrip.\nAsk me anything about your Korea trip!',
  ja: 'こんにちは！CocoTripです。\n韓国旅行について何でもお聞きください！',
  zh: '您好！欢迎来到CocoTrip。\n请随时询问有关韩国旅行的任何问题！',
};

export const QUICK_QUESTIONS: Record<Language, string[]> = {
  ko: ['투어 가격이 궁금해요', '공항 픽업 있나요?', 'K-pop 셔틀 정보', '예약 방법'],
  en: ['Tour prices?', 'Airport pickup?', 'K-pop shuttle?', 'How to book?'],
  ja: ['ツアー料金は？', '空港送迎は？', 'K-popシャトル？', '予約方法は？'],
  zh: ['旅游价格？', '机场接送？', 'K-pop班车？', '如何预订？'],
};

export const PLACEHOLDER: Record<Language, string> = {
  ko: '메시지를 입력하세요...',
  en: 'Type your message...',
  ja: 'メッセージを入力...',
  zh: '输入消息...',
};

export const SUBTITLE: Record<Language, string> = {
  ko: '보통 즉시 답변',
  en: 'Usually replies instantly',
  ja: '通常すぐに返信',
  zh: '通常立即回复',
};

export const WHATSAPP_TEXT: Record<Language, string> = {
  ko: '더 자세한 문의는 WhatsApp으로',
  en: 'For detailed inquiries, contact WhatsApp',
  ja: '詳細はWhatsAppで',
  zh: '详细咨询请联系WhatsApp',
};

export const LOGIN_CHAT_TEXT: Record<Language, { title: string; desc: string; google: string; apple: string; loading: string }> = {
  ko: { title: '로그인 후 이용 가능합니다', desc: '로그인하면 AI와 대화할 수 있어요.', google: '구글로 시작하기', apple: 'Apple로 시작하기', loading: '로그인 중...' },
  en: { title: 'Sign in to chat', desc: 'Login to start chatting with our AI.', google: 'Continue with Google', apple: 'Continue with Apple', loading: 'Signing in...' },
  ja: { title: 'ログインして利用', desc: 'AIとチャットするにはログインが必要です。', google: 'Googleで続ける', apple: 'Appleで続ける', loading: 'ログイン中...' },
  zh: { title: '登录后使用', desc: '登录后即可与AI对话。', google: '使用Google登录', apple: '使用Apple登录', loading: '登录中...' },
};

// 게스트 무료 문답 (2026-08-18 퍼널 감사 1번 — 로그인 벽 제거).
// 비로그인도 바로 질문 가능, 이 수를 다 쓰면 로그인 카드로 전환.
// 서버(api/chat.js)는 IP 키 일 15건 백스톱 — 이 상수만 늘려도 우회는 안 됨.
export const GUEST_FREE_QUESTIONS = 3;

export const GUEST_GATE_TEXT: Record<Language, { title: string; desc: string }> = {
  ko: { title: '무료 질문 3개를 모두 사용했어요', desc: '구글 로그인하면 이어서 계속 대화할 수 있어요.' },
  en: { title: 'You used your 3 free questions', desc: 'Sign in with Google to keep chatting.' },
  ja: { title: '無料質問3回を使い切りました', desc: 'Googleでログインすると続けて会話できます。' },
  zh: { title: '3次免费提问已用完', desc: '使用Google登录即可继续对话。' },
};

// FAQ Quick Reply — 각 질문 클릭 시 sendMessage()로 전송 → AI가 SYSTEM_PROMPT(FAQ 지식 + 라우팅)에
// 따라 답변. 카테고리는 booking/info/escalate 라우팅에 자연스럽게 매핑됨.
export const FAQ_QUICK_REPLIES: Record<Language, { id: string; label: string; q: string }[]> = {
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
const CHAT_ERROR_TEXT: Record<Language, { rateLimitUser: string; rateLimitDaily: string; guestDaily: string; authRequired: string; connectionError: string; generic: string }> = {
  ko: {
    rateLimitUser: '메시지를 너무 빠르게 보내고 있어요. 잠시 후 다시 시도해 주세요.',
    rateLimitDaily: '오늘 문의 한도에 도달했습니다. WhatsApp으로 연락해 주세요: +82-10-8714-0611',
    guestDaily: '무료 문의 한도에 도달했습니다. 로그인하면 계속 대화할 수 있어요.',
    authRequired: '로그인 후 채팅을 이용하실 수 있습니다.',
    connectionError: '연결 오류가 발생했습니다. WhatsApp으로 문의해 주세요: +82-10-8714-0611',
    generic: '일시적인 오류가 발생했습니다. 다시 시도해 주세요.',
  },
  en: {
    rateLimitUser: 'You are sending messages too quickly. Please wait a few minutes.',
    rateLimitDaily: 'Daily limit reached. Please contact us via WhatsApp: +82-10-8714-0611',
    guestDaily: 'Free guest limit reached. Sign in to keep chatting.',
    authRequired: 'Please sign in to continue chatting.',
    connectionError: 'Connection error. Please try WhatsApp: +82-10-8714-0611',
    generic: 'Sorry, something went wrong. Please try again.',
  },
  ja: {
    rateLimitUser: 'メッセージの送信が速すぎます。少し待ってから再試行してください。',
    rateLimitDaily: '本日の問い合わせ上限に達しました。WhatsAppでご連絡ください: +82-10-8714-0611',
    guestDaily: '無料の問い合わせ上限に達しました。ログインすると続けられます。',
    authRequired: 'チャットを利用するにはログインが必要です。',
    connectionError: '接続エラーが発生しました。WhatsAppでお問い合わせください: +82-10-8714-0611',
    generic: '一時的なエラーが発生しました。もう一度お試しください。',
  },
  zh: {
    rateLimitUser: '您发送消息太快了，请稍候再试。',
    rateLimitDaily: '今日咨询次数已达上限，请通过WhatsApp联系我们: +82-10-8714-0611',
    guestDaily: '免费咨询次数已用完，登录后可继续对话。',
    authRequired: '请登录后使用聊天功能。',
    connectionError: '连接错误，请通过WhatsApp联系我们: +82-10-8714-0611',
    generic: '发生了临时错误，请重试。',
  },
};

function generateId() {
  return Math.random().toString(36).slice(2, 9);
}

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const CHAT_SESSION_STORAGE_KEY = 'cocotrip_chat_session_v1';

function loadStoredSessionId() {
  if (typeof window === 'undefined') return '';
  try {
    const stored = window.localStorage.getItem(CHAT_SESSION_STORAGE_KEY) || '';
    return /^sess_[A-Za-z0-9_-]{24,120}$/.test(stored) ? stored : '';
  } catch {
    return '';
  }
}

function rememberSessionId(value: string) {
  if (!/^sess_[A-Za-z0-9_-]{24,120}$/.test(value) || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CHAT_SESSION_STORAGE_KEY, value);
  } catch { /* 저장 불가 브라우저는 HttpOnly 쿠키만으로 현재 탭을 유지한다. */ }
}

/** active=true 인 동안 웰컴 초기화 + 운영자 답장 폴링. 위젯은 open, 전면 화면은 mount 상시 true. */
export function useChatSession(language: Language, active: boolean) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState(loadStoredSessionId);
  const [lastPollTs, setLastPollTs] = useState(0);
  const [quickShown, setQuickShown] = useState(true);

  // 활성화 시 웰컴 메시지 초기화
  useEffect(() => {
    if (active && messages.length === 0) {
      // 기존 위젯 계약: 열리는 순간 웰컴 메시지를 상태에 넣는다.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessages([{ id: generateId(), role: 'ai', text: WELCOME[language], time: nowTime() }]);
      setQuickShown(true);
    }
  }, [active, language, messages.length]);

  // 언어 변경 시 웰컴 메시지만 교체
  useEffect(() => {
    if (active && messages.length > 0 && messages[0].role === 'ai') {
      // 언어 전환 때 현재 웰컴 한 줄만 교체한다.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessages((prev) => [{ ...prev[0], text: WELCOME[language] }, ...prev.slice(1)]);
    }
  }, [language]); // eslint-disable-line react-hooks/exhaustive-deps

  // 관리자 답장 폴링 — 현재 탭에서 질문했거나, 이전 방문의 서버 세션이 남아 있으면 재개.
  // 새로고침 뒤에도 늦게 도착한 운영자 답장을 놓치지 않는다.
  useEffect(() => {
    if (!active) return;
    const hasChatSession = !!sessionId || messages.some((m) => m.role === 'user');
    if (!hasChatSession) return;

    const POLL_INTERVAL = 8000;
    let cancelled = false;

    const poll = async () => {
      try {
        if (!sessionId) return;
        const headers = new Headers();
        if (user) {
          headers.set('Authorization', `Bearer ${await user.getIdToken()}`);
        }
        const res = await fetch(
          `/api/chat-poll?sessionId=${encodeURIComponent(sessionId)}&since=${lastPollTs}`,
          { headers, credentials: 'same-origin' },
        );
        const json = await res.json();
        if (cancelled) return;
        const adminMessages = (json && json.data && json.data.messages) || [];
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
  }, [active, sessionId, lastPollTs, messages, user]);

  // 게스트 게이트 — 비로그인은 무료 3문답까지. 세션 내 보낸 user 메시지 수로 판정
  // (새로고침하면 초기화되지만 서버 IP 일 15건 캡이 백스톱).
  const guestQuestionCount = user ? 0 : messages.filter((m) => m.role === 'user').length;
  const guestGated = !user && guestQuestionCount >= GUEST_FREE_QUESTIONS;

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;
      // 게이트에 걸린 게스트는 전송 자체를 막는다 — UI 가 로그인 카드를 띄움.
      if (!user && messages.filter((m) => m.role === 'user').length >= GUEST_FREE_QUESTIONS) return;

      setQuickShown(false);
      setMessages((prev) => [
        ...prev,
        { id: generateId(), role: 'user', text: trimmed, time: nowTime() },
      ]);
      setLoading(true);

      try {
        // 웰컴 메시지 제외, 최근 5턴만 전송 (토큰 비용 최적화)
        const history = messages
          .slice(1)
          .slice(-10) // 최근 10개 메시지 = 5턴
          .map((m) => ({ role: m.role, text: m.text }));

        const headers = new Headers({ 'Content-Type': 'application/json' });
        if (user) {
          headers.set('Authorization', `Bearer ${await user.getIdToken()}`);
        }
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers,
          credentials: 'same-origin',
          body: JSON.stringify({ message: trimmed, messages: history, sessionId, language }),
        });
        const json = await res.json();
        const payload = json.data;
        const serverSessionId = payload && payload.sessionId;
        if (typeof serverSessionId === 'string') {
          setSessionId(serverSessionId);
          rememberSessionId(serverSessionId);
        }
        // 429 / 401은 사용자에게 명확히 안내 (그냥 generic 에러 메시지면 혼란)
        if (!res.ok) {
          const code = json.code || '';
          const errT = CHAT_ERROR_TEXT[language];
          let msg = errT.generic;
          if (code === 'RATE_LIMIT_USER') msg = errT.rateLimitUser;
          else if (code === 'RATE_LIMIT_USER_DAILY') msg = errT.rateLimitDaily;
          else if (code === 'RATE_LIMIT_GUEST_DAILY') msg = errT.guestDaily;
          else if (code === 'AUTH_REQUIRED') msg = errT.authRequired;
          setMessages((prev) => [...prev, { id: generateId(), role: 'ai', text: msg, time: nowTime() }]);
        } else {
          setMessages((prev) => [
            ...prev,
            { id: generateId(), role: 'ai', text: (payload && payload.reply) || 'Sorry, something went wrong.', time: nowTime() },
          ]);
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          { id: generateId(), role: 'ai', text: CHAT_ERROR_TEXT[language].connectionError, time: nowTime() },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [loading, sessionId, language, messages, user],
  );

  return { user, messages, loading, sendMessage, quickShown, sessionId, guestQuestionCount, guestGated };
}
