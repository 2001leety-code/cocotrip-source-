import { useState, useEffect } from 'react';
import { X, Tag } from 'lucide-react';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, onSnapshot } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app);

const TEXTS: Record<string, { banner: string; code: string }> = {
  ko: { banner: '\uC5BC\uB9AC\uBC84\uB4DC \uD2B9\uAC00 20% \uD560\uC778 \u00B7 \uC120\uCC29\uC21C 50\uD300 \uD55C\uC815 \u00B7 \uB0A8\uC740 \uC790\uB9AC: {remaining}\uD300', code: 'EARLY50' },
  en: { banner: 'Early Bird 20% OFF \u00B7 First 50 bookings only \u00B7 {remaining} spots left', code: 'EARLY50' },
  ja: { banner: '\u65E9\u671F\u5272\u5F15 20% OFF \u00B7 \u5148\u774050\u7D44\u9650\u5B9A \u00B7 \u6B8B\u308A{remaining}\u7D44', code: 'EARLY50' },
  zh: { banner: '\u65E9\u9E1F\u4F18\u60E0 20% OFF \u00B7 \u4EC5\u9650\u524D50\u7EC4 \u00B7 \u5269\u4F59{remaining}\u7EC4', code: 'EARLY50' },
};

interface Props {
  language: string;
}

export function EarlyBirdBanner({ language }: Props) {
  const [dismissed, setDismissed] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'earlybird', 'counter'),
      (snap) => {
        const data = snap.data();
        const used = data?.used ?? 0;
        setRemaining(Math.max(0, 50 - used));
      },
      () => {
        // If doc doesn't exist or error, show default
        setRemaining(50);
      }
    );
    return () => unsub();
  }, []);

  if (dismissed || remaining === null || remaining <= 0) return null;

  const t = TEXTS[language] ?? TEXTS.en;
  const text = t.banner.replace('{remaining}', String(remaining));

  return (
    <div
      className="fixed top-20 left-4 sm:bottom-6 sm:top-auto sm:left-6 p-4 text-white rounded-2xl shadow-2xl shadow-[#7C5CFC]/30 border border-white/20 transition-all z-50 hover:scale-105"
      style={{ background: 'linear-gradient(135deg, #7C5CFC, #EA537E)', width: 150 }}
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
        {t.code}
      </div>
    </div>
  );
}
