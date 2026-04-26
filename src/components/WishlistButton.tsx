/**
 * WishlistButton — 하트 토글 버튼 + 위시리스트 사이드 패널
 * Guest/Login 모두 동작, 로그인 시 Firestore 동기화
 */
import { useState, useEffect, useRef } from 'react';
import { Heart, X, Calendar, Trash2, ShoppingBag } from 'lucide-react';
import { useWishlist } from '@/hooks/useWishlist';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';

// ── 하트 토글 버튼 (상품 카드에 삽입) ──
export function WishlistToggle({
  productId,
  productType = 'tour',
  name,
  priceUSD,
  thumbnailUrl,
  size = 20,
}: {
  productId: string;
  productType?: 'charter' | 'tour' | 'planner';
  name: string;
  priceUSD?: number;
  thumbnailUrl?: string;
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
    await toggle({ id: productId, productType, name, priceUSD, thumbnailUrl });
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
            : 'fill-none text-white/40 group-hover:text-white/70'
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
        className="relative p-2 rounded-full hover:bg-white/10 transition-colors"
        aria-label={t.a11y?.wishlist ||'Wishlist'}
      >
        <Heart size={20} className="text-white/70 hover:text-white" />
        {items.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-[#EA537E] rounded-full text-[9px] font-bold text-white flex items-center justify-center">
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
                <h2 className="text-white font-semibold text-lg">Wishlist</h2>
                <span className="text-white/40 text-sm">({items.length})</span>
              </div>
              <button onClick={() => setIsOpen(false)} className="p-1.5 rounded-lg hover:bg-white/10">
                <X size={18} className="text-white/50" />
              </button>
            </div>

            {/* 비로그인 안내 */}
            {!user && (
              <div className="mx-4 mt-4 p-3 rounded-lg bg-[#7C5CFC]/10 border border-[#7C5CFC]/20">
                <p className="text-xs text-[#7C5CFC]">
                  💡 Sign in to sync your wishlist across devices
                </p>
              </div>
            )}

            {/* 리스트 */}
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="w-6 h-6 border-2 border-[#7C5CFC] border-t-transparent animate-spin rounded-full" />
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-white/30">
                <ShoppingBag size={40} className="mb-3 opacity-30" />
                <p className="text-sm">No items in wishlist</p>
                <p className="text-xs mt-1 text-white/20">Tap ❤️ to save tours you love</p>
              </div>
            ) : (
              <div className="p-4 space-y-3">
                {items.map(item => (
                  <div
                    key={item.id}
                    className="group bg-white/[0.04] rounded-xl p-3 border border-white/5 hover:border-[#7C5CFC]/30 transition-all"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate">{item.name}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          {item.priceUSD && (
                            <span className="text-[#C4956A] font-semibold text-sm">
                              ${item.priceUSD}
                            </span>
                          )}
                          <span className="text-white/20 text-[10px] uppercase tracking-wider">
                            {item.productType}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => toggle({
                          id: item.id,
                          productType: item.productType,
                          name: item.name,
                          priceUSD: item.priceUSD,
                        })}
                        className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/10 transition-all"
                      >
                        <Trash2 size={14} className="text-red-400/60" />
                      </button>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 text-white/20 text-[10px]">
                      <Calendar size={10} />
                      <span>{new Date(item.addedAt).toLocaleDateString()}</span>
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
