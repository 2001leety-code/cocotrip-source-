import { useState, useEffect } from 'react';
import { X, Tag } from 'lucide-react';
import { doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useLanguage } from '@/hooks/useLanguage';

export function EarlyBirdBanner() {
  const { t } = useLanguage();
  const ad = (t as any).ads?.earlyBird ?? { banner: 'Early Bird 20% OFF · First 50 bookings only · {remaining} spots left', code: 'EARLY50' };
  const [dismissed, setDismissed] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [visible, setVisible] = useState(false);

  // 모바일에서 5초 딜레이 후 표시
  useEffect(() => {
    const isMobile = window.innerWidth < 640;
    const timer = setTimeout(() => setVisible(true), isMobile ? 5000 : 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    import('firebase/firestore').then(({ getDoc }) => {
      getDoc(doc(db, 'earlybird', 'counter')).then((snap) => {
        if (cancelled) return;
        const data = snap.data();
        const used = data?.used ?? 0;
        setRemaining(Math.max(0, 50 - used));
      }).catch(() => {
        if (!cancelled) setRemaining(50);
      });
    });
    return () => { cancelled = true; };
  }, []);

  if (dismissed || remaining === null || remaining <= 0 || !visible) return null;

  const text = ad.banner.replace('{remaining}', String(remaining));

  return (
    <div
      className="fixed bottom-[88px] left-3 sm:bottom-6 sm:top-auto sm:left-6 p-2.5 sm:p-4 text-white rounded-xl sm:rounded-2xl shadow-2xl shadow-[#7C5CFC]/30 border border-white/20 transition-all z-40 hover:scale-105"
      style={{ background: 'linear-gradient(135deg, #7C5CFC, #EA537E)', width: 130, maxWidth: 'calc(100vw - 24px)' }}
    >
      <div className="flex items-start justify-between mb-2">
        <Tag className="w-4 h-4 shrink-0" />
        <button
          onClick={() => setDismissed(true)}
          className="p-1.5 -mr-2 -mt-2 bg-black/10 text-white rounded-full hover:bg-black/30 transition-colors"
          aria-label="Close"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
      <p className="text-[11px] leading-relaxed font-semibold mb-3">
        {text.split(' \u00B7 ').map((line, i) => (
          <span key={i} className="block pb-0.5">{line}</span>
        ))}
      </p>
      <div className="px-1 py-1.5 rounded-lg bg-white/25 text-[11px] font-extrabold tracking-widest text-center shadow-inner">
      {ad.code}
      </div>
    </div>
  );
}
