// Inline status widget for MyPlans page — shows the user any pending /
// approved Firestore-backed requests so they don't lose track:
//   - pending_free_claims  (P4: "이미 예약 → 무료 플랜")
//   - charter_inquiries     (P3-B: 인앱 견적 요청)
//
// Reads via where('email', '==', user.email). Firestore rules limit reads to
// the matching email (or admin), so this is safe to render unauthenticated
// (in which case it shows nothing).
import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { Car, FileCheck, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';

type ClaimStatus = 'pending' | 'approved' | 'rejected';

interface ClaimRow {
  id: string;
  type: 'free_claim' | 'charter_inquiry';
  status: ClaimStatus;
  createdAt?: { toMillis(): number } | number;
  recommendedTour?: string;
  quotedKRW?: number;
  flightRef?: string;
  hotelRef?: string;
}

function statusBadge(s: ClaimStatus) {
  if (s === 'approved') return { Icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/15', label: 'Approved' };
  if (s === 'rejected') return { Icon: XCircle, color: 'text-rose-400', bg: 'bg-rose-500/15', label: 'Rejected' };
  return { Icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/15', label: 'Pending review' };
}

function formatDate(ts?: { toMillis(): number } | number): string {
  if (!ts) return '';
  const ms = typeof ts === 'number' ? ts : ts.toMillis();
  return new Date(ms).toLocaleDateString();
}

export function PendingClaimsWidget() {
  const { user } = useAuth();
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [inquiries, setInquiries] = useState<ClaimRow[]>([]);

  useEffect(() => {
    if (!user?.email) return;
    const cQ = query(
      collection(db, 'pending_free_claims'),
      where('email', '==', user.email),
      orderBy('createdAt', 'desc'),
      limit(5),
    );
    const iQ = query(
      collection(db, 'charter_inquiries'),
      where('email', '==', user.email),
      orderBy('createdAt', 'desc'),
      limit(5),
    );
    const u1 = onSnapshot(cQ, snap => setClaims(
      snap.docs.map(d => ({ id: d.id, type: 'free_claim', ...d.data() } as ClaimRow))
    ), err => console.warn('[claims widget] free_claims:', err.message));
    const u2 = onSnapshot(iQ, snap => setInquiries(
      snap.docs.map(d => ({ id: d.id, type: 'charter_inquiry', ...d.data() } as ClaimRow))
    ), err => console.warn('[claims widget] inquiries:', err.message));
    return () => { u1(); u2(); };
  }, [user?.email]);

  const all = [...claims, ...inquiries].sort((a, b) => {
    const ta = a.createdAt ? (typeof a.createdAt === 'number' ? a.createdAt : a.createdAt.toMillis()) : 0;
    const tb = b.createdAt ? (typeof b.createdAt === 'number' ? b.createdAt : b.createdAt.toMillis()) : 0;
    return tb - ta;
  });

  if (all.length === 0) return null;

  return (
    <div className="mb-6 bg-white/[0.03] border border-white/[0.08] rounded-2xl p-5">
      <p className="text-[11px] uppercase tracking-wider text-white/55 font-semibold mb-3">
        Your requests
      </p>
      <div className="space-y-2">
        {all.map(row => {
          const badge = statusBadge(row.status);
          const Icon = row.type === 'free_claim' ? FileCheck : Car;
          const title = row.type === 'free_claim'
            ? `Free plan claim${row.flightRef ? ` (PNR ${row.flightRef})` : ''}`
            : `Charter quote${row.recommendedTour ? ` — ${row.recommendedTour}` : ''}`;
          const sub = row.type === 'charter_inquiry' && row.quotedKRW
            ? `Quoted ₩${row.quotedKRW.toLocaleString()} · ${formatDate(row.createdAt)}`
            : formatDate(row.createdAt);
          return (
            <div key={`${row.type}-${row.id}`}
              className="flex items-center gap-3 bg-white/[0.03] border border-white/[0.06] rounded-xl px-3 py-2.5">
              <Icon className="w-4 h-4 text-white/50 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-white/90 truncate">{title}</p>
                <p className="text-[11px] text-white/55">{sub}</p>
              </div>
              <span className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold ${badge.bg} ${badge.color} shrink-0`}>
                <badge.Icon className="w-3 h-3" />
                {badge.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
