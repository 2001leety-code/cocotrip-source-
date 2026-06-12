// P312 (2026-06-12, B3 S2-a 후속): plan.status === 'error' 전용 풀페이지 에러 상태.
//
// 이전(P312 1차): index.tsx 상단 인라인 배너 + 그 아래 빈/깨진 슬라이드(SectionTabs/
//   SwipeContainer)를 그대로 렌더 → 결제 후 사용자가 빈 화면 + 작동 안 하는 탭을 봄.
// 이번(P312 2차): notfound/unauthorized/autherror 와 동일하게 **이른 return** 으로
//   슬라이드 렌더 자체를 막고, 친절한 에러 안내 화면(AlertCircle + 메시지 + "다시 시도"
//   + 1:1 문의)으로 대체. 빈 화면 / 깨진 캐러셀 노출 완전 차단.
//
// 디자인 SSOT: dark navy 배경 + 보라/핑크 그라데이션 primary 버튼(BRAND.gradient.primary).
// 4언어(ko/en/ja/zh) 인라인 — autherror 브랜치와 동일한 인라인 분기 패턴.
//
// "다시 시도" = /planner 로 이동(새 플랜 작성). error plan 재처리 정책(신규 planId vs
// revisionOf, Gemini 재호출 비용)은 운영자 결정사항 → 여기서는 표시 위주, 재요청 트리거는
// 가장 단순한 "플래너로 돌아가기"만 제공. (자동 재시도 = S2-b 별도)
import { AlertCircle, RefreshCw, MessageCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import { BRAND } from '@/lib/design-tokens';
import type { Language, Translations } from '@/i18n';
import { resolveErrorStateCopy } from './errorStateCopy';

// OutroSlide / pdfGenerator 와 동일한 WhatsApp 1:1 문의 채널 (SSOT 한 곳).
const WHATSAPP_CONTACT_URL = 'https://wa.me/821087140611';

interface ErrorStateProps {
  language: Language;
  /** i18n t() — Header/Footer 에 전달 (다른 풀페이지 브랜치와 동일 시그니처). */
  t: Translations;
  onLanguageChange: (lang: Language) => void;
  /** getPlanDetailUI(t) 결과. 키 없으면 인라인 폴백. */
  ui: Record<string, string>;
}

export function ErrorState({ language, t, onLanguageChange, ui }: ErrorStateProps) {
  const copy = resolveErrorStateCopy(language, ui);
  return (
    <div className="min-h-screen bg-[#0a0b14] text-white flex flex-col" data-testid="plan-error-state">
      <Header language={language} t={t} onLanguageChange={onLanguageChange} />
      <div className="flex-1 flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
        <AlertCircle className="w-16 h-16 text-red-400/50 mb-4" />
        <h1 className="text-xl font-bold mb-2">{copy.title}</h1>
        <p className="text-white/55 text-sm mb-6 max-w-md leading-relaxed">{copy.desc}</p>
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <Link
            to="/planner"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-white"
            style={{ background: BRAND.gradient.primary }}
          >
            <RefreshCw className="w-4 h-4" />
            {copy.retry}
          </Link>
          <a
            href={WHATSAPP_CONTACT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-white/90 border border-green-500/30 bg-green-500/10 hover:bg-green-500/20 transition-colors"
          >
            <MessageCircle className="w-4 h-4 text-green-400" />
            {copy.contact}
          </a>
        </div>
      </div>
      <Footer t={t} />
    </div>
  );
}
