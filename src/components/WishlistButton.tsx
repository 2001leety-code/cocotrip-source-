/**
 * WishlistButton — 하트 토글 버튼 + 위시리스트 사이드 패널
 * Guest/Login 모두 동작, 로그인 시 Firestore 동기화
 */
import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Heart, X, Calendar, Trash2, ShoppingBag, ChevronRight } from 'lucide-react';
import { useWishlist } from '@/hooks/useWishlist';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';

/**
 * 위시리스트 아이템 → 상세 경로. 저장 href 우선, 없으면 상품 목록 폴백.
 * ⚠️ 여기서 tours.ts(slugForTourId) 를 import 하면 전체 투어 데이터가 Header(eager)
 *    메인 번들로 끌려와 first-paint +27KB → size-limit 초과. 패널은 목록 폴백만 쓰고,
 *    id→slug 정확 매핑은 lazy 페이지인 MyPage 에서 처리(main 무관). 새 데이터는 href 저장돼
 *    패널에서도 정확히 이동, 과도기 기존(id-only) 데이터만 목록으로 폴백.
 */
function wishlistHref(item: { id: string; productType: string; href?: string }): string {
  if (item.href) return item.href;
  if (item.productType === 'charter') return '/charter';
  if (item.productType === 'planner') return '/planner';
  return '/tours';
}

// ── 하트 토글 버튼 (상품 카드에 삽입) ──
export function WishlistToggle({
  productId,
  productType = 'tour',
  name,
  priceUSD,
  thumbnailUrl,
  href,
  size = 20,
}: {
  productId: string;
  productType?: 'charter' | 'tour' | 'planner';
  name: string;
  priceUSD?: number;
  thumbnailUrl?: string;
  /** 상세 페이지 경로 — 저장해두면 위시리스트에서 정확히 이동 (2026-07-05). */
  href?: string;
  size?: number;
}) {
  const { toggle, isWishlisted } = useWishlist();
  const { t } = useLanguage();
  const wishlisted = isWishlisted(productId);
  const [animating, setAnimating] = useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setAnimating(true);
    await toggle({ id: productId, productType, name, priceUSD, thumbnailUrl, href });
    setTimeout(() => setAnimating(false), 300);
  };

  return (
    <button
      onClick={handleClick}
      className="group relative p-2 rounded-full transition-all duration-200 hover:bg-white/10"
      aria-label={wishlisted ? (t.a11y?.removeFromWishlist ||'Remove from wishlist') : (t.a11y?.addToWishlist ||'Add to wishlist')}
    >
      <Heart
        size={size}
        className={`transition-all duration-300 ${animating ? 'scale-125' : 'scale-100'} ${
          wishlisted
            ? 'fill-[#EA537E] text-[#EA537E]'
            : 'fill-none text-white/55 group-hover:text-white/70'
        }`}
      />
    </button>
  );
}

// ── 위시리스트 사이드 패널 ──
export function WishlistPanel() {
  const { items, toggle, loading } = useWishlist();
  const { user } = useAuth();
  const { t } = useLanguage();
  const wl = (t as { wishlist?: Record<string, string> }).wishlist || {};
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 닫기
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isOpen]);

  return (
    <>
      {/* 트리거 버튼 */}
      <button
        onClick={() => setIsOpen(true)}
        className="relative inline-flex min-w-[44px] min-h-[44px] items-center justify-center rounded-ec-sm text-ec-ink-2 transition-colors hover:text-ec-ink hover:bg-ec-page"
        aria-label={t.a11y?.wishlist ||'Wishlist'}
      >
        <Heart size={20} />
        {items.length > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 bg-ec-brand rounded-full text-[9px] font-bold text-ec-on-brand flex items-center justify-center">
            {items.length}
          </span>
        )}
      </button>

      {/* 슬라이드 패널 */}
      {isOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm">
          <div
            ref={panelRef}
            className="absolute right-0 top-0 h-full w-full max-w-sm bg-[#0c1220] border-l border-white/10 shadow-2xl animate-slide-in-right overflow-y-auto"
          >
            {/* 헤더 */}
            <div className="sticky top-0 bg-[#0c1220]/95 backdrop-blur-sm border-b border-white/10 p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Heart size={18} className="text-[#EA537E]" />
                <h2 className="text-white font-semibold text-lg">{wl.title || 'Wishlist'}</h2>
                <span className="text-white/55 text-sm">({items.length})</span>
              </div>
              <button onClick={() => setIsOpen(false)} className="p-1.5 rounded-lg hover:bg-white/10">
                <X size={18} className="text-white/50" />
              </button>
            </div>

            {/* 비로그인 안내 */}
            {!user && (
              <div className="mx-4 mt-4 p-3 rounded-lg bg-[#7C5CFC]/10 border border-[#7C5CFC]/20">
                <p className="text-xs text-[#7C5CFC]">
                  {wl.signInHint || '💡 Sign in to sync your wishlist across devices'}
                </p>
              </div>
            )}

            {/* 리스트 */}
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="w-6 h-6 border-2 border-[#7C5CFC] border-t-transparent animate-spin rounded-full" />
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-white/55">
                <ShoppingBag size={40} className="mb-3 opacity-30" />
                <p className="text-sm">{wl.empty || 'No items in wishlist'}</p>
                <p className="text-xs mt-1 text-white/55">{wl.tapToSave || 'Tap ❤️ to save tours you love'}</p>
              </div>
            ) : (
              <div className="p-4 space-y-3">
                {items.map(item => (
                  <div
                    key={item.id}
                    className="group bg-white/[0.04] rounded-xl border border-white/5 hover:border-[#7C5CFC]/30 transition-all"
                  >
                    <div className="flex items-stretch">
                      {/* 카드 본문 = 상세 이동 링크 (href 우선, 투어는 slug 폴백) */}
                      <Link
                        to={wishlistHref(item)}
                        onClick={() => setIsOpen(false)}
                        className="flex-1 min-w-0 p-3 pr-1"
                      >
                        <p className="text-white text-sm font-medium truncate">{item.name}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          {item.priceUSD && (
                            <span className="text-[#C4956A] font-semibold text-sm">
                              ${item.priceUSD}
                            </span>
                          )}
                          <span className="text-white/55 text-[10px] uppercase tracking-wider">
                            {item.productType}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center gap-1.5 text-white/55 text-[10px]">
                          <Calendar size={10} />
                          <span>{new Date(item.addedAt).toLocaleDateString()}</span>
                          <span className="ml-auto flex items-center gap-0.5 text-[#7C5CFC] font-semibold">
                            {wl.viewDetail || '상세보기'}<ChevronRight size={11} />
                          </span>
                        </div>
                      </Link>
                      {/* 삭제 — stopPropagation 으로 이동 차단, 삭제만 */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          toggle({
                            id: item.id,
                            productType: item.productType,
                            name: item.name,
                            priceUSD: item.priceUSD,
                          });
                        }}
                        aria-label={wl.remove || 'Remove'}
                        className="px-2.5 flex items-center rounded-r-xl opacity-0 group-hover:opacity-100 hover:bg-red-500/10 transition-all"
                      >
                        <Trash2 size={14} className="text-red-400/60" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes slide-in-right {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
        .animate-slide-in-right {
          animation: slide-in-right 0.25s ease-out;
        }
      `}</style>
    </>
  );
}
