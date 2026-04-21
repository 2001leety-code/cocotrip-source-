import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { translations, type Language } from '@/i18n';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/** Detect language from localStorage (same logic as useLanguage hook) */
function detectLang(): Language {
  try {
    const saved = window.localStorage.getItem('cocotrip_lang') as Language | null;
    if (saved && ['ko', 'en', 'ja', 'zh'].includes(saved)) return saved;
  } catch { /* ignore */ }
  return 'en';
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      const t = translations[detectLang()].errorBoundary;
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
              </div>
            )}
            <button
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 active:scale-95"
              style={{ background: 'linear-gradient(135deg, #7C5CFC, #EA537E)' }}
            >
              <RefreshCw className="w-4 h-4" />
              {t.retry}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
