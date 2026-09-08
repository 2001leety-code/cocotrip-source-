import { useEffect } from 'react';
import { useLanguage } from '@/hooks/useLanguage';

const COPY = {
  ko: { loading: '검색창을 준비하고 있어요.', failed: '검색창을 불러오지 못했어요. 현재 화면은 그대로 이용할 수 있어요. 계속 실패하면 작성 내용을 따로 보관한 뒤 페이지를 다시 열어주세요.', close: '검색 닫기', retry: '다시 시도' },
  en: { loading: 'Loading search…', failed: 'Search could not load. You can keep using this page. If it keeps failing, keep a copy of your draft before reopening this page.', close: 'Close search', retry: 'Try again' },
  ja: { loading: '検索を準備しています。', failed: '検索を読み込めませんでした。このページは引き続き使えます。失敗が続く場合は、入力内容を控えてからこのページを開き直してください。', close: '検索を閉じる', retry: '再試行' },
  zh: { loading: '正在准备搜索。', failed: '无法加载搜索。您可以继续使用当前页面。若持续失败，请先另存输入内容，再重新打开本页。', close: '关闭搜索', retry: '重试' },
};

export function CommandPaletteStatus({ open, failed = false, onClose, onRetry }: {
  open: boolean;
  failed?: boolean;
  onClose: () => void;
  onRetry?: () => void;
}) {
  const { language } = useLanguage();
  const copy = COPY[language] || COPY.en;
  useEffect(() => {
    if (!open || failed) return;
    const keepPageEditing = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || target.closest('[data-cocotrip-search-status], [data-cocotrip-search-input]')) return;
      if (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) onClose();
    };
    // Loading is non-modal: continuing a draft cancels the pending opening,
    // including typing into the same field that originally received Ctrl+K.
    document.addEventListener('focusin', keepPageEditing, true);
    document.addEventListener('input', keepPageEditing, true);
    return () => {
      document.removeEventListener('focusin', keepPageEditing, true);
      document.removeEventListener('input', keepPageEditing, true);
    };
  }, [open, failed, onClose]);
  if (!open) return null;
  return (
    <aside data-cocotrip-search-status className="fixed inset-x-4 top-20 z-[210] mx-auto max-w-sm rounded-ec-md border border-ec-line bg-ec-raised p-4 text-ec-ink shadow-ec-overlay">
      <p role={failed ? 'alert' : 'status'} className="text-sm leading-relaxed">{failed ? copy.failed : copy.loading}</p>
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        {failed && <button type="button" onClick={onRetry} className="ec-btn ec-btn-primary min-h-[44px] min-w-[44px] focus-visible:ring-2 focus-visible:ring-ec-brand">{copy.retry}</button>}
        <button type="button" onClick={onClose} className="ec-btn ec-btn-quiet min-h-[44px] min-w-[44px] focus-visible:ring-2 focus-visible:ring-ec-brand">{copy.close}</button>
      </div>
    </aside>
  );
}
