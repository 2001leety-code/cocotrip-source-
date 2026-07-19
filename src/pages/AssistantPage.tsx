// AssistantPage (/assistant) — AI 어시스턴트 전면 화면 (2026-07-19 모바일 UI 리디자인 Task 3).
// 기준 이미지 p.10 'AI Assistant' 카드의 실동작 구현: useChatSession(ChatWidget 과 동일 코어 —
// /api/chat AI 응답 + /api/chat-poll 운영자 라이브 답장)을 전면 라이트 화면으로.
// 언어칩(EN/한국어/日本語/中文)은 실제 changeLanguage 와 연결. "죽은 탭 금지" 원칙의
// Assistant 탭 선행 화면. 라이트 셸 클래스 불필요 — MobileHomeV2 처럼 자체 완결형 라이트.
import { useState, useRef, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Bot, MessageCircle, Send } from 'lucide-react';
import type { Language } from '@/i18n';
import { useLanguage } from '@/hooks/useLanguage';
import { usePageMeta } from '@/hooks/usePageMeta';
import { signInWithGoogle } from '@/lib/firebase';
import { trackChatOpen } from '@/lib/analytics';
import { COCO } from '@/components/coco/CocoUI';
import {
  useChatSession,
  QUICK_QUESTIONS,
  PLACEHOLDER,
  SUBTITLE,
  WHATSAPP_TEXT,
  LOGIN_CHAT_TEXT,
  FAQ_QUICK_REPLIES,
} from '@/hooks/useChatSession';

const LANG_CHIPS: { code: Language; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'ko', label: '한국어' },
  { code: 'ja', label: '日本語' },
  { code: 'zh', label: '中文' },
];

export default function AssistantPage() {
  const { language, changeLanguage } = useLanguage();
  // 전면 화면은 mount 동안 상시 활성 (위젯의 open 대응)
  const { user, messages, loading, sendMessage, quickShown } = useChatSession(language, true);
  const [input, setInput] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  usePageMeta({
    title: 'AI Assistant — CocoTrip',
    description: SUBTITLE[language],
  });

  useEffect(() => { trackChatOpen(); }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleGoogleLogin = useCallback(async () => {
    setAuthError(null);
    setAuthLoading(true);
    try { await signInWithGoogle(); } catch (e) { setAuthError(e instanceof Error ? e.message : 'Login failed'); }
    finally { setAuthLoading(false); }
  }, []);

  const handleInputSend = useCallback((text: string) => {
    if (!text.trim() || loading) return;
    setInput('');
    sendMessage(text);
  }, [loading, sendMessage]);

  const login = LOGIN_CHAT_TEXT[language];

  return (
    <div
      className="flex h-[100dvh] flex-col"
      style={{ background: COCO.pageBg, color: COCO.navy }}
    >
      {/* 헤더 — 뒤로가기 + 아바타 + 언어칩 (기준 p.10 AI Assistant 카드) */}
      <header
        className="shrink-0 px-4 pb-3 pt-4"
        style={{ background: 'rgba(255,255,255,0.86)', borderBottom: COCO.cardBorder, backdropFilter: 'blur(14px)' }}
      >
        <div className="mx-auto flex w-full max-w-[430px] items-center gap-3">
          <Link
            to="/"
            aria-label="Back"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{ background: 'rgba(124,92,255,0.10)', color: COCO.purple }}
          >
            <ArrowLeft size={17} />
          </Link>
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            style={{ background: COCO.ctaGradient, boxShadow: COCO.ctaShadow }}
          >
            <Bot size={19} color="#fff" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-black leading-tight">CocoTrip AI</p>
            <p className="text-[11px]" style={{ color: COCO.muted }}>{SUBTITLE[language]}</p>
          </div>
        </div>
        {/* 언어칩 — 실제 언어 전환 (죽은 UI 금지) */}
        <div className="mx-auto mt-2.5 flex w-full max-w-[430px] gap-1.5">
          {LANG_CHIPS.map((c) => (
            <button
              key={c.code}
              type="button"
              onClick={() => changeLanguage(c.code)}
              className="rounded-full px-3 py-1 text-[11px] font-bold transition-colors"
              style={c.code === language
                ? { background: COCO.ctaGradient, color: '#fff' }
                : { background: 'rgba(124,92,255,0.08)', color: COCO.purple }}
            >
              {c.label}
            </button>
          ))}
        </div>
      </header>

      {!user ? (
        /* 로그인 게이트 — /api/chat 인증 필요 (위젯과 동일 정책) */
        <div className="flex flex-1 items-center justify-center px-6 pb-24">
          <div
            className="w-full max-w-[340px] rounded-[18px] bg-white px-6 py-8 text-center"
            style={{ border: COCO.cardBorder, boxShadow: COCO.cardShadow }}
          >
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full" style={{ background: COCO.ctaGradient }}>
              <Bot size={22} color="#fff" />
            </div>
            <p className="text-[15px] font-black">{login.title}</p>
            <p className="mt-1 text-[12px]" style={{ color: COCO.muted }}>{login.desc}</p>
            <button
              onClick={handleGoogleLogin}
              disabled={authLoading}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-full border py-3 text-[13px] font-bold"
              style={{ borderColor: 'rgba(124,92,255,0.22)', background: '#fff', color: COCO.navy, opacity: authLoading ? 0.6 : 1 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              {authLoading ? login.loading : login.google}
            </button>
            {authError && <p className="mt-2 text-[11px] text-red-500">{authError}</p>}
          </div>
        </div>
      ) : (
        <>
          {/* 메시지 영역 */}
          <div className="flex-1 overflow-y-auto px-4 py-3">
            <div className="mx-auto flex w-full max-w-[430px] flex-col gap-2.5">
              {messages.map((msg, idx) => (
                <div key={msg.id}>
                  <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className="max-w-[80%] whitespace-pre-wrap break-words px-3.5 py-2.5 text-[13px] leading-relaxed"
                      style={msg.role === 'user'
                        ? { background: COCO.ctaGradient, color: '#fff', borderRadius: '16px 16px 4px 16px', boxShadow: '0 8px 18px rgba(124,92,255,0.20)' }
                        : msg.role === 'admin'
                          ? { background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(217,152,20,0.35)', color: COCO.navy, borderRadius: '16px 16px 16px 4px' }
                          : { background: '#fff', border: COCO.cardBorder, color: COCO.navy, borderRadius: '16px 16px 16px 4px', boxShadow: '0 8px 18px rgba(48,39,118,0.06)' }}
                    >
                      {msg.role === 'admin' && (
                        <div className="mb-0.5 text-[10px] font-bold tracking-wide" style={{ color: '#B45309' }}>
                          {msg.adminName ? `${msg.adminName} (CocoTrip)` : 'CocoTrip 직원'}
                        </div>
                      )}
                      {msg.text}
                    </div>
                  </div>
                  <div
                    className={`mt-0.5 text-[10px] ${msg.role === 'user' ? 'pr-0.5 text-right' : 'pl-0.5 text-left'}`}
                    style={{ color: '#a79fc4' }}
                  >
                    {msg.time}
                  </div>

                  {/* 웰컴 메시지 아래 빠른 질문 칩 */}
                  {idx === 0 && quickShown && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {QUICK_QUESTIONS[language].map((q) => (
                        <button
                          key={q}
                          onClick={() => sendMessage(q)}
                          className="rounded-full px-3 py-1.5 text-[11.5px] font-semibold"
                          style={{ background: 'rgba(124,92,255,0.10)', border: '1px solid rgba(124,92,255,0.22)', color: COCO.purple }}
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div
                    className="flex items-center gap-1 px-4 py-2.5"
                    style={{ background: '#fff', border: COCO.cardBorder, borderRadius: '16px 16px 16px 4px' }}
                  >
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="inline-block h-[7px] w-[7px] rounded-full"
                        style={{ background: COCO.purple, animation: `chatDot 1.2s ease-in-out ${i * 0.2}s infinite` }}
                      />
                    ))}
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          {/* FAQ 가로 스크롤 칩 + WhatsApp */}
          <div className="shrink-0 px-4 pb-1 pt-1">
            <div className="mx-auto flex w-full max-w-[430px] gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
              {FAQ_QUICK_REPLIES[language].map((faq) => (
                <button
                  key={faq.id}
                  onClick={() => sendMessage(faq.q)}
                  className="shrink-0 rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold"
                  style={{ border: COCO.cardBorder, color: COCO.navy }}
                >
                  {faq.label}
                </button>
              ))}
            </div>
          </div>

          {/* 입력 바 — 모바일 하단 네비(≈62px) 위 여백 확보 */}
          <div className="shrink-0 px-4 pb-[74px] pt-1.5 md:pb-4" style={{ background: 'rgba(255,255,255,0.80)', borderTop: COCO.cardBorder, backdropFilter: 'blur(14px)' }}>
            <div className="mx-auto flex w-full max-w-[430px] items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleInputSend(input); } }}
                placeholder={PLACEHOLDER[language]}
                disabled={loading}
                className="min-w-0 flex-1 rounded-full px-4 py-2.5 text-[13px] outline-none"
                style={{ background: '#fff', border: COCO.cardBorder, color: COCO.navy }}
              />
              <button
                onClick={() => handleInputSend(input)}
                disabled={loading || !input.trim()}
                aria-label="Send"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                style={input.trim() && !loading
                  ? { background: COCO.ctaGradient, boxShadow: COCO.ctaShadow }
                  : { background: 'rgba(124,92,255,0.12)' }}
              >
                <Send size={15} color={input.trim() && !loading ? '#fff' : '#a79fc4'} style={{ marginLeft: 2 }} />
              </button>
            </div>
            <a
              href="https://wa.me/821087140611"
              target="_blank"
              rel="noopener noreferrer"
              className="mx-auto mt-1.5 flex w-full max-w-[430px] items-center justify-center gap-1.5 text-[10.5px]"
              style={{ color: COCO.muted }}
            >
              <MessageCircle size={12} color="#25D366" />
              {WHATSAPP_TEXT[language]}
            </a>
          </div>
        </>
      )}

      <style>{`
        @keyframes chatDot {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
