/**
 * PromoPopup — 사이트 진입 시 뜨는 프로모 팝업 모달.
 *
 * 어드민 설정 (admin_config/promo_popup via /api/promo-config):
 *   - enabled: false = 팝업 미표시 (기본). 어드민이 켜기 전 사용자에게 안 보임.
 *   - title / body (4언어) / imageUrl / ctaText (4언어) / ctaHref / frequency
 *
 * 빈도 게이트 (localStorage):
 *   - 'once'        : 한 번 닫으면 영구 미노출.
 *   - 'daily'       : 하루 1회 (마지막 닫기 기준 24h).
 *   - 'every_visit' : 매 페이지 방문마다 표시.
 *
 * 디자인: BRAND 토큰 (dark navy + purple/pink gradient). 모바일 대응. 접근성(esc/aria).
 *
 * 보안: 표시값 읽기만, 어드민 인증 없음 (공개 GET /api/promo-config).
 */
import { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { BRAND } from '@/lib/design-tokens';

// localStorage 키
const POPUP_KEY = 'coco_promo_popup_v1';

// ─── 타입 ──────────────────────────────────────────────────────────────────────
interface PopupConfig {
  enabled: boolean;
  title: Record<string, string>;
  body: Record<string, string>;
  imageUrl: string;
  ctaText: Record<string, string>;
  ctaHref: string;
  frequency: 'once' | 'daily' | 'every_visit';
}

// ─── 빈도 게이트 ────────────────────────────────────────────────────────────────
function shouldShow(frequency: PopupConfig['frequency']): boolean {
  try {
    const raw = localStorage.getItem(POPUP_KEY);
    if (!raw) return true; // 첫 방문 → 항상 표시
    const stored = JSON.parse(raw) as { at?: number };
    if (frequency === 'every_visit') return true;
    if (frequency === 'once') return false; // 한 번 기록 있으면 미표시
    if (frequency === 'daily') {
      const ms = Date.now() - (stored.at || 0);
      return ms > 24 * 60 * 60 * 1000; // 24h 경과 시 재표시
    }
    return true;
  } catch {
    return true;
  }
}

function recordDismiss(): void {
  try {
    localStorage.setItem(POPUP_KEY, JSON.stringify({ at: Date.now() }));
  } catch { /* noop */ }
}

// ─── 컴포넌트 ────────────────────────────────────────────────────────────────
export function PromoPopup() {
  const { language } = useLanguage();
  const [popupConfig, setPopupConfig] = useState<PopupConfig | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/promo-config')
      .then((r) => r.json())
      .then((json) => {
        if (cancelled || !json || !json.ok) return;
        const cfg = json.popup as PopupConfig | undefined;
        if (!cfg || !cfg.enabled) return;
        if (!shouldShow(cfg.frequency)) return;
        setPopupConfig(cfg);
        setVisible(true);
      })
      .catch(() => { /* fail-safe: 팝업 미표시 */ });
    return () => { cancelled = true; };
  }, []);

  // ESC 닫기
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleClose = useCallback(() => {
    recordDismiss();
    setVisible(false);
  }, []);

  const handleCta = useCallback(() => {
    recordDismiss();
    setVisible(false);
  }, []);

  if (!visible || !popupConfig) return null;

  const title = popupConfig.title[language] || popupConfig.title.en || '';
  const body = popupConfig.body[language] || popupConfig.body.en || '';
  const ctaText = popupConfig.ctaText[language] || popupConfig.ctaText.en || '';
  const { ctaHref, imageUrl } = popupConfig;

  return (
    // 배경 오버레이
    <div
      className="fixed inset-0 z-[9900] flex items-center justify-center p-4"
      style={{ background: 'rgba(5, 3, 14, 0.75)', backdropFilter: 'blur(4px)' }}
      role="dialog"
      aria-modal="true"
      aria-label={title || 'Promotion'}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      {/* 모달 카드 */}
      <div
        className="relative w-full max-w-sm sm:max-w-md rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: '#0d0a1a', border: '1px solid rgba(124, 92, 252, 0.35)' }}
      >
        {/* 그라데이션 헤더 바 */}
        <div className="h-1.5 w-full" style={{ background: BRAND.gradient.primaryHorizontal }} />

        {/* 닫기 버튼 */}
        <button
          type="button"
          onClick={handleClose}
          aria-label="팝업 닫기"
          className="absolute top-3 right-3 p-1.5 rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors z-10"
        >
          <X size={16} />
        </button>

        {/* 이미지 (설정 시) */}
        {imageUrl && (
          <div className="w-full aspect-video overflow-hidden">
            <img
              src={imageUrl}
              alt=""
              aria-hidden
              className="w-full h-full object-cover"
              loading="eager"
            />
          </div>
        )}

        {/* 본문 */}
        <div className="px-5 pt-4 pb-5 space-y-3">
          {/* 제목 */}
          {title && (
            <h2 className="text-base sm:text-lg font-bold text-white leading-snug pr-6">
              {title}
            </h2>
          )}

          {/* 내용 */}
          {body && (
            <p className="text-[13px] sm:text-sm text-white/70 leading-relaxed">
              {body}
            </p>
          )}

          {/* CTA 버튼 */}
          {ctaText && (
            <a
              href={ctaHref || '/tours'}
              onClick={handleCta}
              className="block w-full text-center text-white text-[13px] sm:text-sm font-bold py-2.5 px-4 rounded-xl transition-all hover:brightness-110 active:scale-[0.98] mt-1"
              style={{ background: BRAND.gradient.primary }}
              rel="noopener"
            >
              {ctaText}
            </a>
          )}

          {/* 닫기 텍스트 링크 */}
          <button
            type="button"
            onClick={handleClose}
            className="block w-full text-center text-[11px] text-white/35 hover:text-white/55 transition-colors pt-0.5"
          >
            {language === 'ko' ? '닫기' : language === 'ja' ? '閉じる' : language === 'zh' ? '关闭' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
