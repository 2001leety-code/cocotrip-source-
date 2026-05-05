import { Component, type ReactNode, type ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw, MessageCircle } from 'lucide-react';
import { translations, type Language } from '@/i18n';
import { captureException } from '@/lib/sentry';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
}

/** Detect language from localStorage (same logic as useLanguage hook) */
function detectLang(): Language {
  try {
    const saved = window.localStorage.getItem('cocotrip_lang') as Language | null;
    if (saved && ['ko', 'en', 'ja', 'zh'].includes(saved)) return saved;
  } catch { /* ignore */ }
  return 'en';
}

/**
 * 전역 React Error Boundary.
 *
 * - componentDidCatch에서 Sentry로 자동 보고 (DSN 미설정 시 no-op)
 * - 4-lang fallback UI (title / description / contact / retry)
 * - 개발 환경(import.meta.env.DEV)에선 stack trace 노출
 * - WhatsApp 문의 링크 (다른 섹션과 동일한 https://wa.me/821087140611)
 *
 * SSR 무관 — class component는 클라이언트 hydration 후 동작.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, componentStack: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 콘솔 디버그 (개발/prod 공통)
    console.error('[ErrorBoundary]', error, info.componentStack);

    // Sentry 자동 보고 — DSN 미설정 시 no-op
    captureException(error, {
      errorBoundary: true,
      componentStack: info.componentStack,
    });

    // 개발 환경에서만 stack trace UI 노출용으로 저장
    if (import.meta.env.DEV) {
      this.setState({ componentStack: info.componentStack ?? null });
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, componentStack: null });
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      const lang = detectLang();
      const t = translations[lang].errorBoundary;
      const isDev = import.meta.env.DEV;

      return (
        <div className="min-h-screen flex items-center justify-center" style={{ background: '#080b14' }}>
          <div className="max-w-md mx-auto px-6 text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-red-400" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-3">
              {t.title}
            </h1>
            <p className="text-white/50 text-sm mb-6 leading-relaxed">
              {t.description}
            </p>
            {this.state.error && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6 text-left">
                <p className="text-xs text-red-300/70 font-mono break-all">
                  {this.state.error.message}
                </p>
                {isDev && this.state.componentStack && (
                  <pre className="mt-3 text-[10px] text-white/40 font-mono whitespace-pre-wrap break-all max-h-48 overflow-auto">
                    {this.state.componentStack}
                  </pre>
                )}
              </div>
            )}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
              <button
                onClick={this.handleReset}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 active:scale-95"
                style={{ background: 'linear-gradient(135deg, #7C5CFC, #EA537E)' }}
              >
                <RefreshCw className="w-4 h-4" />
                {t.retry}
              </button>
              <a
                href="https://wa.me/821087140611"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-white/80 border border-white/15 bg-white/5 transition-all hover:bg-white/10 active:scale-95"
              >
                <MessageCircle className="w-4 h-4" />
                {t.contact}
              </a>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
