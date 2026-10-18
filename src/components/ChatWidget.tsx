import { useState, useRef, useEffect, useCallback, forwardRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bot, MessageCircle, MessageSquareText, X, Send, Plus, Maximize2 } from 'lucide-react';
import { translations, type Language } from '@/i18n';
import { useIsMobile } from '@/hooks/use-mobile';
import { signInWithGoogle } from '@/lib/firebase-auth';
import { trackChatOpen } from '@/lib/analytics';
// 채팅 코어(상태·/api/chat·운영자 폴링)와 문구 상수는 useChatSession 으로 추출 —
// /assistant 전면 화면(AssistantPage)과 공유 (2026-07-19 Task 3).
import {
  useChatSession,
  QUICK_QUESTIONS,
  PLACEHOLDER,
  SUBTITLE,
  WHATSAPP_TEXT,
  LOGIN_CHAT_TEXT,
  GUEST_GATE_TEXT,
  FAQ_QUICK_REPLIES,
} from '@/hooks/useChatSession';

interface ChatWidgetProps {
  language: Language;
  hideTrigger?: boolean;
}

const CHAT_PANEL_ID = 'chat-widget-panel';

// Icon-only panel buttons (en expand/faq keep their previous labels).
const ICON_LABELS: Record<Language, { expand: string; close: string; faq: string; send: string }> = {
  ko: { expand: '전체 화면으로 열기', close: '채팅 닫기', faq: '자주 묻는 질문 열기', send: '보내기' },
  en: { expand: 'Open full screen assistant', close: 'Close chat', faq: 'Open FAQ', send: 'Send' },
  ja: { expand: '全画面で開く', close: 'チャットを閉じる', faq: 'よくある質問を開く', send: '送信' },
  zh: { expand: '全屏打开', close: '关闭聊天', faq: '打开常见问题', send: '发送' },
};

// The home full-screen menu sets this on <html> (Header.tsx) and hides the chat
// under it (home-dope.css). A delayed input focus must not pull focus out of it.
const isMenuOpen = () => document.documentElement.dataset.menuOpen === 'true';

const ChatInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>((props, ref) => (
  <input ref={ref} {...props} />
));

export function ChatWidget({ language, hideTrigger }: ChatWidgetProps) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  // Home trigger is the compact dark tile in home-dope.css; other routes keep the inline round button.
  const isHome = useLocation().pathname === '/';
  // Home panel look comes from .home-dope-chat* classes (home-dope.css); other routes keep the inline look.
  const skin = (className: string, style: React.CSSProperties) => (isHome ? { className } : { style });
  const labels = ICON_LABELS[language];
  // 모바일에선 bottom-nav(높이 ~62px)와 겹치지 않도록 위로 띄우고 살짝 작게.
  const togglePos = isMobile ? { bottom: '76px', right: '14px', size: '52px' } : { bottom: '24px', right: '24px', size: '60px' };
  const popupBottom = isMobile ? '140px' : '88px';
  const popupRight = isMobile ? '14px' : '24px';
  const [open, setOpen] = useState(false);
  // 채팅 코어(웰컴 초기화·전송·운영자 폴링)는 공유 훅 — open 이 active 신호.
  const { messages, loading, sendMessage, quickShown, guestGated } = useChatSession(language, open);
  const [input, setInput] = useState('');
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (open) {
      setTimeout(() => { if (!isMenuOpen()) inputRef.current?.focus(); }, 100);
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
      setTimeout(() => { if (!isMenuOpen()) inputRef.current?.focus(); }, 50);
    }
  }, [loading, open]);

  // 입력창 전송 — 훅과 동일 가드(빈 문자열/로딩 중이면 입력 보존) 후 입력 비움.
  const handleInputSend = useCallback((text: string) => {
    if (!text.trim() || loading) return;
    setInput('');
    sendMessage(text);
  }, [loading, sendMessage]);

  // FAQ Quick Reply 패널 토글 — "+" 버튼으로 펼침/접힘
  const [showFaqPanel, setShowFaqPanel] = useState(false);

  const handleFaqClick = useCallback((q: string) => {
    setShowFaqPanel(false);
    sendMessage(q);
  }, [sendMessage]);



  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleInputSend(input);
    }
  };

  return (
    <>
      {/* ── 채팅 팝업창 ─────────────────────────────────────────
          2026-08-18 퍼널 감사 1번: 로그인 벽 제거 — 게스트도 바로 대화.
          무료 3문답 소진 시 입력창 자리에 로그인 카드(guestGated). */}
      {open && (
        <div
          id={CHAT_PANEL_ID}
          className={isHome ? 'home-dope-chrome home-dope-chat-panel' : undefined}
          style={{
            position: 'fixed',
            bottom: popupBottom,
            right: popupRight,
            width: 'min(360px, calc(100vw - 28px))',
            height: 'min(500px, calc(100dvh - 160px))',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 9999,
            overflow: 'hidden',
            ...(isHome ? {} : {
              borderRadius: '16px',
              background: '#1a1a2e',
              boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
              border: '1px solid rgba(124,92,252,0.3)',
            }),
          }}
        >
          {/* 헤더 */}
          <div
            {...skin('home-dope-chat__head', {
              background: 'linear-gradient(135deg, #7C5CFC, #EA537E)',
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
            })}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
              <div
                {...skin('home-dope-chat__avatar', {
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                })}
              >
                {isHome ? <Bot size={20} aria-hidden /> : <Bot size={18} color="#fff" />}
              </div>
              <div style={{ minWidth: 0 }}>
                <div {...skin('home-dope-chat__title', { color: '#fff', fontWeight: 700, fontSize: '15px' })}>
                  CocoTrip AI
                </div>
                <div {...skin('home-dope-chat__subtitle', { color: 'rgba(255,255,255,0.8)', fontSize: '11px' })}>
                  {SUBTITLE[language]}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: isHome ? '0' : '6px' }}>
              {/* 전면 화면(/assistant)으로 확장 — 같은 useChatSession 코어 (2026-07-19) */}
              <button
                onClick={() => { setOpen(false); navigate('/assistant'); }}
                aria-label={labels.expand}
                {...skin('home-dope-chat__icon-btn', {
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
                })}
              >
                {isHome ? <Maximize2 size={16} aria-hidden /> : <Maximize2 size={13} color="#fff" />}
              </button>
              <button
                onClick={() => setOpen(false)}
                aria-label={labels.close}
                {...skin('home-dope-chat__icon-btn', {
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
                })}
              >
                {isHome ? <X size={18} aria-hidden /> : <X size={14} color="#fff" />}
              </button>
            </div>
          </div>

          {/* 메시지 영역 */}
          <div
            {...skin('home-dope-chat__messages', {
              flex: 1,
              overflowY: 'auto',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            })}
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
                    {...skin(`home-dope-chat__bubble home-dope-chat__bubble--${msg.role}`, {
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
                    })}
                  >
                    {msg.role === 'admin' && (
                      <div {...skin('home-dope-chat__staff', { fontSize: '10px', color: '#FBBF24', fontWeight: 700, marginBottom: '3px', letterSpacing: '0.4px' })}>
                        {msg.adminName ? `${msg.adminName} (CocoTrip)` : 'CocoTrip 직원'}
                      </div>
                    )}
                    {msg.text}
                  </div>
                </div>
                <div
                  {...skin(`home-dope-chat__time${msg.role === 'user' ? ' home-dope-chat__time--user' : ''}`, {
                    textAlign: msg.role === 'user' ? 'right' : 'left',
                    fontSize: '10px',
                    color: 'rgba(255,255,255,0.4)',
                    marginTop: '3px',
                    paddingLeft: msg.role === 'ai' ? '2px' : 0,
                    paddingRight: msg.role === 'user' ? '2px' : 0,
                  })}
                >
                  {msg.time}
                </div>

                {/* 웰컴 메시지 아래 빠른 질문 버튼 */}
                {idx === 0 && quickShown && (
                  <div
                    {...skin('home-dope-chat__quick', {
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '6px',
                      marginTop: '10px',
                    })}
                  >
                    {QUICK_QUESTIONS[language].map((q) => (
                      <button
                        key={q}
                        onClick={() => sendMessage(q)}
                        {...skin('home-dope-chat__chip', {
                          background: 'rgba(124,92,252,0.2)',
                          border: '1px solid rgba(124,92,252,0.5)',
                          borderRadius: '20px',
                          color: '#c4a8ff',
                          fontSize: '11px',
                          padding: '5px 10px',
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                        })}
                        onMouseEnter={isHome ? undefined : (e) => {
                          e.currentTarget.style.background = 'rgba(124,92,252,0.4)';
                        }}
                        onMouseLeave={isHome ? undefined : (e) => {
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
                  {...skin('home-dope-chat__loading', {
                    padding: '10px 16px',
                    borderRadius: '16px 16px 16px 4px',
                    background: 'rgba(255,255,255,0.1)',
                    display: 'flex',
                    gap: '4px',
                    alignItems: 'center',
                  })}
                >
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      style={{
                        width: '7px',
                        height: '7px',
                        borderRadius: '50%',
                        background: isHome ? 'var(--ec-brand)' : '#c4a8ff',
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
            {...skin('home-dope-chat__wa', {
              padding: '6px 14px',
              borderTop: '1px solid rgba(255,255,255,0.07)',
              flexShrink: 0,
            })}
          >
            <a
              href="https://wa.me/821087140611"
              target="_blank"
              rel="noopener noreferrer"
              {...skin('home-dope-chat__wa-link', {
                color: 'rgba(255,255,255,0.45)',
                fontSize: '11px',
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                justifyContent: 'center',
              })}
            >
              <MessageCircle size={13} color="#25D366" aria-hidden={isHome || undefined} />
              {WHATSAPP_TEXT[language]}
            </a>
          </div>

          {/* 입력창 — 게스트 3문답 소진 시 로그인 카드로 교체 */}
          {guestGated ? (
            <div
              {...skin('home-dope-chat__gate', {
                padding: '16px 14px',
                borderTop: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(0,0,0,0.2)',
                flexShrink: 0,
              })}
            >
              <div {...skin('home-dope-chat__gate-title', { color: '#fff', fontWeight: 700, fontSize: '14px', marginBottom: '6px' })}>
                {GUEST_GATE_TEXT[language].title}
              </div>
              <p {...skin('home-dope-chat__gate-desc', { color: 'rgba(255,255,255,0.6)', fontSize: '12px', marginBottom: '12px' })}>
                {GUEST_GATE_TEXT[language].desc}
              </p>
              <button
                onClick={handleGoogleLogin}
                disabled={authLoading !== null}
                aria-busy={authLoading === 'google' || undefined}
                {...skin('home-dope-chat__google', { width: '100%', padding: '10px', borderRadius: '10px', background: '#fff', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', opacity: authLoading !== null ? 0.6 : 1 })}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                {authLoading === 'google' ? LOGIN_CHAT_TEXT[language].loading : LOGIN_CHAT_TEXT[language].google}
              </button>
              {authError && <p role={isHome ? 'alert' : undefined} {...skin('home-dope-chat__gate-error', { color: '#f87171', fontSize: '11px', marginTop: '8px', textAlign: 'center' })}>{authError}</p>}
            </div>
          ) : (
          <div
            {...skin('home-dope-chat__composer', {
              padding: '10px 12px',
              borderTop: '1px solid rgba(255,255,255,0.08)',
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
              flexShrink: 0,
              background: 'rgba(0,0,0,0.2)',
              position: 'relative',
            })}
          >
            {/* FAQ Quick Reply 패널 — + 버튼 클릭 시 펼침 */}
            {showFaqPanel && (
              <div
                {...skin('home-dope-chat__faq', {
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
                })}
              >
                <div {...skin('home-dope-chat__faq-title', { fontSize: '11px', color: 'rgba(255,255,255,0.55)', marginBottom: '8px', paddingLeft: '4px' })}>
                  {language === 'ko' ? '자주 묻는 질문' : language === 'ja' ? 'よくある質問' : language === 'zh' ? '常见问题' : 'Frequently Asked'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '6px' }}>
                  {FAQ_QUICK_REPLIES[language].map((faq) => (
                    <button
                      key={faq.id}
                      onClick={() => handleFaqClick(faq.q)}
                      {...skin('home-dope-chat__faq-item', {
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.10)',
                        borderRadius: '10px',
                        padding: '8px 10px',
                        color: '#fff',
                        fontSize: '12px',
                        textAlign: 'left',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      })}
                      onMouseEnter={isHome ? undefined : (e) => {
                        e.currentTarget.style.background = 'rgba(124,92,252,0.15)';
                        e.currentTarget.style.borderColor = 'rgba(124,92,252,0.35)';
                      }}
                      onMouseLeave={isHome ? undefined : (e) => {
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
              aria-label={labels.faq}
              aria-expanded={showFaqPanel}
              {...skin('home-dope-chat__plus', {
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
              })}
            >
              <Plus size={18} aria-hidden />
            </button>
            <ChatInput
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={PLACEHOLDER[language]}
              aria-label={PLACEHOLDER[language]}
              disabled={loading}
              {...skin('home-dope-chat__input', {
                flex: 1,
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '20px',
                padding: '9px 14px',
                color: '#fff',
                fontSize: '13px',
                outline: 'none',
              })}
            />
            <button
              onClick={() => handleInputSend(input)}
              disabled={loading || !input.trim()}
              aria-label={labels.send}
              {...skin('home-dope-chat__send', {
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
              })}
            >
              {isHome ? <Send size={16} aria-hidden /> : <Send size={15} color="#fff" style={{ marginLeft: '2px' }} />}
            </button>
          </div>
          )}
        </div>
      )}

      {/* ── 토글 버튼 ─────────────────────────────────────────── */}
      <button
        onClick={() => { const next = !open; if (next) trackChatOpen(); setOpen(next); }}
        aria-label={open ? (translations[language].a11y?.close || 'Close') : (translations[language].a11y?.openChat || 'Open chat')}
        aria-expanded={open}
        aria-controls={CHAT_PANEL_ID}
        className={isHome ? 'home-dope-chrome home-dope-chat-trigger' : undefined}
        style={{
          position: 'fixed',
          bottom: togglePos.bottom,
          right: togglePos.right,
          display: hideTrigger ? 'none' : 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          // Home: size, surface, line and shadow come from .home-dope-chat-trigger.
          ...(isHome ? {} : {
            width: togglePos.size,
            height: togglePos.size,
            // 2026-08-10 Editorial Concierge: 그라데이션 + 글로우 → 단색 보라 + 잔잔한 그림자.
            // 패널 내부 스타일은 이번 PR 범위 밖 — 다음 PR 에서 함께 전환한다.
            borderRadius: '50%',
            background: 'var(--ec-brand)',
            border: 'none',
            cursor: 'pointer',
            boxShadow: 'var(--ec-shadow-raise)',
            transition: 'background-color var(--ec-duration-base) var(--ec-ease-standard)',
          }),
        }}
        onMouseEnter={isHome ? undefined : (e) => { e.currentTarget.style.background = 'var(--ec-brand-hover)'; }}
        onMouseLeave={isHome ? undefined : (e) => { e.currentTarget.style.background = 'var(--ec-brand)'; }}
      >
        {isHome
          ? (open ? <X size={20} aria-hidden /> : <MessageSquareText size={20} aria-hidden />)
          : (open ? <X size={24} color="#fff" /> : <MessageCircle size={26} color="#fff" />)}
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
