import { useState, useRef, useEffect, useCallback } from 'react';
import { Bot, MessageCircle, X, Send } from 'lucide-react';
import type { Language } from '@/i18n';
import { useAuth } from '@/hooks/useAuth';
import { signInWithGoogle } from '@/lib/firebase';

interface Message {
  id: string;
  role: 'user' | 'ai';
  text: string;
  time: string;
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

export function ChatWidget({ language }: ChatWidgetProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(() => `sess_${generateId()}`);
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

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

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
        // 웰컴 메시지(idx=0 AI 메시지) 제외한 이전 대화 내역
        const history = messages
          .slice(1)
          .map((m) => ({ role: m.role, text: m.text }));

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: trimmed, messages: history, sessionId, language }),
        });
        const data = await res.json();
        setMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            role: 'ai',
            text: data.reply ?? 'Sorry, something went wrong.',
            time: nowTime(),
          },
        ]);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            role: 'ai',
            text: 'Connection error. Please try WhatsApp: +82-10-8714-0611',
            time: nowTime(),
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [loading, sessionId, language]
  );

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
            bottom: '88px',
            right: '24px',
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
            bottom: '88px',
            right: '24px',
            width: '360px',
            height: '500px',
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
                          : 'rgba(255,255,255,0.1)',
                      color: '#fff',
                      fontSize: '13px',
                      lineHeight: '1.5',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
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
            }}
          >
            <input
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
        onClick={() => setOpen((v) => !v)}
        aria-label="Open chat"
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          width: '60px',
          height: '60px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #7C5CFC, #EA537E)',
          border: 'none',
          cursor: 'pointer',
          boxShadow: '0 4px 24px rgba(124,92,252,0.5), 0 0 40px rgba(124,92,252,0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          transition: 'transform 0.3s cubic-bezier(.34,1.56,.64,1), box-shadow 0.3s ease',
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
