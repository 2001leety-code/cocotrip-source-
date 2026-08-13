import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Bot, MessageCircle, Send } from 'lucide-react';
import type { Language } from '@/i18n';
import { useLanguage } from '@/hooks/useLanguage';
import { usePageMeta } from '@/hooks/usePageMeta';
import { signInWithGoogle } from '@/lib/firebase';
import { trackChatOpen } from '@/lib/analytics';
import {
  useChatSession,
  WELCOME,
  QUICK_QUESTIONS,
  PLACEHOLDER,
  WHATSAPP_TEXT,
  LOGIN_CHAT_TEXT,
  FAQ_QUICK_REPLIES,
} from '@/hooks/useChatSession';
import type { ChatMessage } from '@/hooks/useChatSession';
import '@/styles/editorial-assistant.css';

type AssistantFixture = 'signed-out' | 'ready' | 'loading' | 'auth-error';

type AssistantUiCopy = {
  title: string;
  metaTitle: string;
  subtitle: string;
  back: string;
  chooseLanguage: string;
  conversation: string;
  message: string;
  send: string;
  preparing: string;
  quickQuestions: string;
  commonQuestions: string;
  authPreviewError: string;
  team: string;
};

const ASSISTANT_FIXTURES: AssistantFixture[] = ['signed-out', 'ready', 'loading', 'auth-error'];

const ASSISTANT_UI: Record<Language, AssistantUiCopy> = {
  ko: {
    title: 'CocoTrip 여행 도우미',
    metaTitle: '여행 도우미',
    subtitle: '한국 여행 질문을 한곳에서 정리해 보세요.',
    back: '홈으로 돌아가기',
    chooseLanguage: '언어 선택',
    conversation: '대화',
    message: '메시지',
    send: '보내기',
    preparing: '답변을 준비하고 있습니다',
    quickQuestions: '빠른 질문',
    commonQuestions: '자주 묻는 질문',
    authPreviewError: '미리보기에서는 로그인할 수 없습니다.',
    team: 'CocoTrip 담당자',
  },
  en: {
    title: 'CocoTrip assistant',
    metaTitle: 'Assistant',
    subtitle: 'Keep your Korea trip questions in one place.',
    back: 'Back to home',
    chooseLanguage: 'Choose language',
    conversation: 'Conversation',
    message: 'Message',
    send: 'Send',
    preparing: 'Preparing a reply',
    quickQuestions: 'Quick questions',
    commonQuestions: 'Common questions',
    authPreviewError: 'Sign-in is unavailable in this preview.',
    team: 'CocoTrip team',
  },
  ja: {
    title: 'CocoTrip 旅行アシスタント',
    metaTitle: '旅行アシスタント',
    subtitle: '韓国旅行の質問をひとつの場所で整理できます。',
    back: 'ホームに戻る',
    chooseLanguage: '言語を選択',
    conversation: '会話',
    message: 'メッセージ',
    send: '送信',
    preparing: '回答を準備しています',
    quickQuestions: 'クイック質問',
    commonQuestions: 'よくある質問',
    authPreviewError: 'プレビューではログインできません。',
    team: 'CocoTrip 担当者',
  },
  zh: {
    title: 'CocoTrip 旅行助手',
    metaTitle: '旅行助手',
    subtitle: '在一个页面整理韩国旅行问题。',
    back: '返回首页',
    chooseLanguage: '选择语言',
    conversation: '对话',
    message: '消息',
    send: '发送',
    preparing: '正在准备回复',
    quickQuestions: '快捷问题',
    commonQuestions: '常见问题',
    authPreviewError: '预览中无法登录。',
    team: 'CocoTrip 团队',
  },
};

const LANG_CHIPS: { code: Language; label: string; accessibleName: string }[] = [
  { code: 'en', label: 'EN', accessibleName: 'English' },
  { code: 'ko', label: '한국어', accessibleName: '한국어' },
  { code: 'ja', label: '日本語', accessibleName: '日本語' },
  { code: 'zh', label: '中文', accessibleName: '中文' },
];

function getAssistantFixture(value: string | null): AssistantFixture | null {
  if (!value) return null;
  return ASSISTANT_FIXTURES.includes(value as AssistantFixture) ? value as AssistantFixture : null;
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

export default function AssistantPage() {
  const { language, changeLanguage } = useLanguage();
  const [searchParams] = useSearchParams();
  const fixture = import.meta.env.DEV ? getAssistantFixture(searchParams.get('__fixture')) : null;
  const session = useChatSession(language, fixture === null);
  const [input, setInput] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const ui = ASSISTANT_UI[language];
  const login = LOGIN_CHAT_TEXT[language];
  const fixtureSignedIn = fixture === 'ready' || fixture === 'loading';
  const isSignedIn = fixture ? fixtureSignedIn : Boolean(session.user);
  const visibleLoading = fixture === 'loading' || (fixture === null && session.loading);
  const visibleMessages: ChatMessage[] = fixtureSignedIn
    ? [{ id: 'fixture-welcome', role: 'ai', text: WELCOME[language], time: '10:00' }]
    : session.messages;
  const visibleQuickShown = fixtureSignedIn ? true : session.quickShown;
  const visibleAuthError = fixture === 'auth-error' ? ui.authPreviewError : authError;
  const pageState: AssistantFixture = fixture || (visibleAuthError
    ? 'auth-error'
    : isSignedIn
      ? visibleLoading ? 'loading' : 'ready'
      : 'signed-out');
  const canSend = input.trim().length > 0 && !visibleLoading;

  usePageMeta({
    title: ui.metaTitle,
    description: ui.subtitle,
  });

  useEffect(() => {
    if (fixture === null) trackChatOpen();
  }, [fixture]);

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [fixture, language, session.messages, visibleLoading]);

  const handleGoogleLogin = useCallback(async () => {
    if (fixture) return;
    setAuthError(null);
    setAuthLoading(true);
    try {
      await signInWithGoogle();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Login failed');
    } finally {
      setAuthLoading(false);
    }
  }, [fixture]);

  const handleInputSend = useCallback((text: string, clearComposer = false) => {
    if (!text.trim() || visibleLoading) return;
    if (clearComposer) setInput('');
    if (fixture) return;
    session.sendMessage(text);
  }, [fixture, session, visibleLoading]);

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    handleInputSend(input, true);
  }, [handleInputSend, input]);

  return (
    <div
      className="ec-root assistant-editorial-page"
      data-testid="assistant-editorial-shell"
      data-state={pageState}
    >
      <header className="assistant-editorial-header">
        <div className="assistant-editorial-header-inner">
          <div className="assistant-editorial-heading-row">
            <Link to="/" aria-label={ui.back} className="assistant-editorial-back">
              <ArrowLeft aria-hidden="true" size={20} />
            </Link>
            <div className="assistant-editorial-mark" aria-hidden="true">
              <Bot size={22} />
            </div>
            <div className="assistant-editorial-heading-copy">
              <h1>{ui.title}</h1>
              <p>{ui.subtitle}</p>
            </div>
          </div>
          <div className="assistant-editorial-languages" role="group" aria-label={ui.chooseLanguage}>
            {LANG_CHIPS.map((chip) => (
              <button
                key={chip.code}
                type="button"
                aria-label={chip.accessibleName}
                aria-pressed={chip.code === language}
                lang={chip.code}
                className="assistant-editorial-language"
                onClick={() => changeLanguage(chip.code)}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {!isSignedIn ? (
        <main className="assistant-editorial-main assistant-editorial-access-main">
          <div className="assistant-editorial-access-layout">
            <div className="assistant-editorial-introduction">
              <span className="assistant-editorial-introduction-mark" aria-hidden="true">
                <MessageCircle size={26} />
              </span>
              <p>{ui.subtitle}</p>
            </div>
            <section className="assistant-editorial-access-card" aria-labelledby="assistant-login-title">
              <div className="assistant-editorial-access-icon" aria-hidden="true">
                <Bot size={24} />
              </div>
              <h2 id="assistant-login-title">{login.title}</h2>
              <p>{login.desc}</p>
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={authLoading}
                className="assistant-editorial-google"
              >
                <GoogleMark />
                <span>{authLoading ? login.loading : login.google}</span>
              </button>
              {visibleAuthError && (
                <p className="assistant-editorial-auth-error" role="alert">{visibleAuthError}</p>
              )}
              <a
                href="https://wa.me/821087140611"
                target="_blank"
                rel="noopener noreferrer"
                className="assistant-editorial-whatsapp"
              >
                <MessageCircle aria-hidden="true" size={18} />
                <span>{WHATSAPP_TEXT[language]}</span>
              </a>
            </section>
          </div>
        </main>
      ) : (
        <main className="assistant-editorial-main assistant-editorial-chat-main">
          <div className="assistant-editorial-chat-layout">
            <section className="assistant-editorial-thread" aria-labelledby="assistant-conversation-title">
              <div className="assistant-editorial-thread-heading">
                <h2 id="assistant-conversation-title">{ui.conversation}</h2>
              </div>
              <div
                ref={messagesRef}
                className="assistant-editorial-messages"
                role="log"
                aria-label={ui.conversation}
                aria-live="polite"
                aria-relevant="additions text"
                aria-busy={visibleLoading}
              >
                {visibleMessages.map((message, index) => (
                  <article key={message.id} className={`assistant-editorial-message-row assistant-editorial-message-row--${message.role}`}>
                    <div className={`assistant-editorial-message assistant-editorial-message--${message.role}`}>
                      {message.role === 'admin' && (
                        <p className="assistant-editorial-admin-label">
                          {message.adminName ? `${message.adminName} (CocoTrip)` : ui.team}
                        </p>
                      )}
                      <p>{message.text}</p>
                    </div>
                    <span className="assistant-editorial-message-time">{message.time}</span>
                    {index === 0 && visibleQuickShown && (
                      <div
                        className="assistant-editorial-quick-list"
                        role="group"
                        aria-label={ui.quickQuestions}
                        aria-live="off"
                      >
                        {QUICK_QUESTIONS[language].map((question) => (
                          <button
                            key={question}
                            type="button"
                            onClick={() => handleInputSend(question)}
                            disabled={visibleLoading}
                            className="assistant-editorial-quick-question"
                          >
                            {question}
                          </button>
                        ))}
                      </div>
                    )}
                  </article>
                ))}
                {visibleLoading && (
                  <div className="assistant-editorial-status" role="status">
                    <span className="assistant-editorial-status-dots" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                    <span>{ui.preparing}</span>
                  </div>
                )}
              </div>
              <form className="assistant-editorial-composer" onSubmit={handleSubmit}>
                <input
                  type="text"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder={PLACEHOLDER[language]}
                  aria-label={ui.message}
                  readOnly={visibleLoading}
                  aria-disabled={visibleLoading}
                  className="assistant-editorial-input"
                />
                <button
                  type="submit"
                  disabled={!canSend}
                  aria-label={ui.send}
                  className="assistant-editorial-send"
                >
                  <Send aria-hidden="true" size={18} />
                </button>
              </form>
            </section>

            <aside className="assistant-editorial-toolbox" aria-labelledby="assistant-common-questions">
              <h2 id="assistant-common-questions">{ui.commonQuestions}</h2>
              <div className="assistant-editorial-faq-list">
                {FAQ_QUICK_REPLIES[language].map((faq) => (
                  <button
                    key={faq.id}
                    type="button"
                    onClick={() => handleInputSend(faq.q)}
                    disabled={visibleLoading}
                    className="assistant-editorial-faq"
                  >
                    {faq.label}
                  </button>
                ))}
              </div>
              <a
                href="https://wa.me/821087140611"
                target="_blank"
                rel="noopener noreferrer"
                className="assistant-editorial-whatsapp"
              >
                <MessageCircle aria-hidden="true" size={18} />
                <span>{WHATSAPP_TEXT[language]}</span>
              </a>
            </aside>
          </div>
        </main>
      )}
    </div>
  );
}
