/**
 * CartButton — 장바구니 담기 버튼 + 사이드 패널 (WishlistButton 패턴 복제).
 *
 * 플래그 OFF (isCartEnabled=false) → outer 가 null 렌더 (inner 미렌더 = useCart 미구독)
 *   → 현행 100% 무영향. Rules of Hooks: early return 은 hook 없는 outer 에서만.
 * ⚠️ 1차 PR(FOUNDATION): 담기/보기/제거만. 결제 버튼 없음 (2차 PR sum-one-order).
 *    priceKRW/priceUSD 표시 전용 — 결제는 booking 키로 backend 재계산 (P311).
 */
import { useState, useEffect, useRef } from 'react';
import { ShoppingCart, X, Trash2, Calendar } from 'lucide-react';
import { useCart } from '@/hooks/useCart';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { isCartEnabled, type CartItemBooking } from '@/lib/cart-types';

interface CartAddProps {
  id: string;
  booking: CartItemBooking;
  displayName: string;
  thumbnailUrl?: string;
  priceKRW?: number;
  priceUSD?: number;
  className?: string;
  /** 아이콘 전용 (카드 오버레이용 — 위시리스트 하트 옆) */
  compact?: boolean;
}

// ── 담기 버튼 (상품 카드 삽입) ──
export function CartAddButton(props: CartAddProps) {
  if (!isCartEnabled()) return null;
  return <CartAddButtonInner {...props} />;
}

function CartAddButtonInner({ id, booking, displayName, thumbnailUrl, priceKRW, priceUSD, className, compact }: CartAddProps) {
  const { add, remove, isInCart } = useCart();
  const { t } = useLanguage();
  const c = (t as { cart?: Record<string, string> }).cart || {};
  const inCart = isInCart(id);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (inCart) {
      await remove(id);
    } else {
      await add({ id, booking, displayName, thumbnailUrl, priceKRW, priceUSD });
    }
  };

  const label = inCart ? (c.added || 'In cart') : (c.add || 'Add to cart');

  // 아이콘 전용 (카드 오버레이 — 위시리스트 하트 옆 패리티). 자체 backdrop 컨테이너
  // 포함 → 플래그 OFF 시 outer 가 null = 빈 래퍼도 미렌더.
  if (compact) {
    return (
      <div
        className="rounded-full backdrop-blur-sm"
        style={{ background: 'rgba(8,4,18,0.65)', border: '1px solid rgba(255,255,255,0.12)' }}
      >
        <button onClick={handleClick} className="p-2 rounded-full transition-all hover:bg-white/10" aria-label={label}>
          <ShoppingCart size={16} className={inCart ? 'text-[#7C5CFC]' : 'text-white/55 hover:text-white/70'} />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleClick}
      className={className || `inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-colors ${
        inCart
          ? 'bg-[#7C5CFC]/20 text-[#7C5CFC] border border-[#7C5CFC]/30'
          : 'bg-white/[0.06] text-white/80 border border-white/10 hover:bg-white/[0.1]'
      }`}
      aria-label={label}
    >
      <ShoppingCart size={15} />
      {label}
    </button>
  );
}

// ── 장바구니 사이드 패널 (헤더 아이콘 + 슬라이드) ──
export function CartPanel() {
  if (!isCartEnabled()) return null;
  return <CartPanelInner />;
}

function CartPanelInner() {
  const { items, remove, clear, loading } = useCart();
  const { user } = useAuth();
  const { t } = useLanguage();
  const c = (t as { cart?: Record<string, string> }).cart || {};
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

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
      {/* 트리거 (헤더 아이콘) */}
      <button
        onClick={() => setIsOpen(true)}
        className="relative p-2 rounded-full hover:bg-white/10 transition-colors"
        aria-label={c.title || 'Cart'}
      >
        <ShoppingCart size={20} className="text-white/70 hover:text-white" />
        {items.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-[#7C5CFC] rounded-full text-[9px] font-bold text-white flex items-center justify-center">
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
            <div className="sticky top-0 bg-[#0c1220]/95 backdrop-blur-sm border-b border-white/10 p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingCart size={18} className="text-[#7C5CFC]" />
                <h2 className="text-white font-semibold text-lg">{c.title || 'Cart'}</h2>
                <span className="text-white/55 text-sm">({items.length})</span>
              </div>
              <button onClick={() => setIsOpen(false)} className="p-1.5 rounded-lg hover:bg-white/10">
                <X size={18} className="text-white/50" />
              </button>
            </div>

            {!user && (
              <div className="mx-4 mt-4 p-3 rounded-lg bg-[#7C5CFC]/10 border border-[#7C5CFC]/20">
                <p className="text-xs text-[#7C5CFC]">
                  {c.signInHint || '💡 Sign in to keep your cart across devices'}
                </p>
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="w-6 h-6 border-2 border-[#7C5CFC] border-t-transparent animate-spin rounded-full" />
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-white/55">
                <ShoppingCart size={40} className="mb-3 opacity-30" />
                <p className="text-sm">{c.empty || 'Your cart is empty'}</p>
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
                        <p className="text-white text-sm font-medium truncate">{item.displayName}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          {item.priceUSD ? (
                            <span className="text-[#C4956A] font-semibold text-sm">${item.priceUSD}</span>
                          ) : null}
                          <span className="text-white/55 text-[10px] uppercase tracking-wider">
                            {item.booking ? item.booking.productType : ''}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => remove(item.id)}
                        className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/10 transition-all"
                        aria-label={c.remove || 'Remove'}
                      >
                        <Trash2 size={14} className="text-red-400/60" />
                      </button>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 text-white/55 text-[10px]">
                      <Calendar size={10} />
                      <span>{new Date(item.addedAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}

                {/* 1차 PR FOUNDATION: 결제 버튼 없음 — sum-one-order 결제는 2차 PR.
                    비우기 + "결제 준비 중" 안내만. */}
                <div className="pt-1">
                  <button
                    onClick={() => clear()}
                    className="text-xs text-red-400/70 hover:text-red-400 inline-flex items-center gap-1"
                  >
                    <Trash2 size={12} /> {c.clear || 'Clear cart'}
                  </button>
                </div>
                <p className="text-[11px] text-white/40 text-center pt-1">
                  {c.checkoutSoon || 'One-click checkout for multiple items is coming soon'}
                </p>
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
