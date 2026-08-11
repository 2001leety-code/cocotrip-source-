import { Component, type ReactNode, type ErrorInfo } from 'react';
import { MessageCircle } from 'lucide-react';
import { translations, type Language } from '@/i18n';
import { captureException } from '@/lib/sentry';
import { EcError } from '@/components/ui/states';

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
 * - 개발 환경(import.meta.env.DEV)에선 stack trace + 원문 메시지 노출
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
      // `||` — the repo's mojibake guard rejects the nullish operator here.
      this.setState({ componentStack: info.componentStack || null });
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
        <div className="ec-root min-h-screen flex items-center justify-center">
          <div className="w-full max-w-xl">
            <EcError
              title={t.title}
              body={t.description}
              retryLabel={t.retry}
              onRetry={this.handleReset}
              secondary={
                <a
                  href="https://wa.me/821087140611"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ec-btn ec-btn-quiet"
                >
                  <MessageCircle className="w-4 h-4" aria-hidden />
                  {t.contact}
                </a>
              }
            />
            {isDev && this.state.error && (
              <div className="mx-6 mb-10 rounded-ec-sm border border-ec-line bg-ec-sunken p-4 text-left">
                <p className="ec-body-sm font-mono break-all text-ec-critical">
                  {this.state.error.message}
                </p>
                {this.state.componentStack && (
                  <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-ec-ink-3">
                    {this.state.componentStack}
                  </pre>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
