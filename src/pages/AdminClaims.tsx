/**
 * AdminClaims — Admin moderation page for free-plan claims AND charter
 * inquiries (P3-B + P4 backoffice).
 *
 * Route: /admin/claims (gated by AdminRoute)
 *
 * Two tabs (claims | inquiries) sharing the same approve/reject pattern.
 * Uses Firestore client SDK directly — auth context (admin email) is the
 * gate, firestore.rules also enforces (`isAdminEmail()`).
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { collection, query, orderBy, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { Shield, ArrowLeft, FileCheck, Car, CheckCircle2, XCircle, Loader2, ExternalLink } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';

type Tab = 'claims' | 'inquiries';
type Status = 'pending' | 'approved' | 'rejected';

interface ClaimRow {
  id: string;
  email: string;
  status: Status;
  createdAt?: { toMillis(): number };
  // free-claim specific
  flightRef?: string | null;
  hotelRef?: string | null;
  tripDates?: string | null;
  receipts?: { name: string; url: string; size: number }[];
  // inquiry specific
  name?: string | null;
  phone?: string | null;
  notes?: string | null;
  planId?: string | null;
  recommendedTour?: string;
  quotedKRW?: number;
  hours?: number;
  startDate?: string | null;
  pax?: number | null;
  dayCount?: number;
  itinerarySummary?: { day: number; theme: string; stopCount: number }[];
}

function formatTs(ts?: { toMillis(): number }): string {
  if (!ts) return '';
  return new Date(ts.toMillis()).toLocaleString();
}

export default function AdminClaims() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('claims');
  const [filter, setFilter] = useState<Status | 'all'>('pending');
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [inquiries, setInquiries] = useState<ClaimRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const isAdmin = user?.email === '2001leety@gmail.com';

  useEffect(() => {
    if (!isAdmin) { setLoading(false); return; }
    const cQ = query(collection(db, 'pending_free_claims'), orderBy('createdAt', 'desc'));
    const iQ = query(collection(db, 'charter_inquiries'), orderBy('createdAt', 'desc'));
    const u1 = onSnapshot(cQ, snap => {
      setClaims(snap.docs.map(d => ({ id: d.id, ...d.data() } as ClaimRow)));
      setLoading(false);
    }, err => { console.error('claims:', err); setLoading(false); });
    const u2 = onSnapshot(iQ, snap => {
      setInquiries(snap.docs.map(d => ({ id: d.id, ...d.data() } as ClaimRow)));
    }, err => console.error('inquiries:', err));
    return () => { u1(); u2(); };
  }, [isAdmin]);

  const handleAction = useCallback(async (collectionName: string, id: string, status: Status) => {
    setBusyId(id);
    try {
      await updateDoc(doc(db, collectionName, id), {
        status,
        reviewedAt: serverTimestamp(),
        reviewedBy: user?.email || 'admin',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Action failed';
      alert(msg);
    } finally {
      setBusyId(null);
    }
  }, [user?.email]);

  const list = tab === 'claims' ? claims : inquiries;
  const filtered = useMemo(
    () => filter === 'all' ? list : list.filter(r => r.status === filter),
    [list, filter]
  );

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[#0a0b14] text-white flex items-center justify-center">
        <div className="text-center">
          <Shield className="w-12 h-12 text-rose-400/40 mx-auto mb-3" />
          <p className="text-lg font-bold">Admin only</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0b14] text-white">
      <div className="max-w-5xl mx-auto px-4 py-10">
        <Link to="/admin" className="inline-flex items-center gap-1.5 text-white/40 text-sm hover:text-white/70 mb-6">
          <ArrowLeft className="w-3.5 h-3.5" /> Admin home
        </Link>

        <div className="flex items-center gap-3 mb-6">
          <Shield className="w-7 h-7 text-amber-400" />
          <div>
            <h1 className="text-2xl font-bold">Claims & Charter Inquiries</h1>
            <p className="text-sm text-white/40">Approve or reject pending requests</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-4 border-b border-white/[0.08]">
          {(['claims', 'inquiries'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
                tab === t ? 'border-[#7C5CFC] text-white' : 'border-transparent text-white/40 hover:text-white/70'
              }`}>
              {t === 'claims' ? <FileCheck className="w-4 h-4" /> : <Car className="w-4 h-4" />}
              {t === 'claims' ? 'Free claims' : 'Charter inquiries'}
              <span className="ml-1 text-[11px] text-white/40">
                ({(t === 'claims' ? claims : inquiries).filter(r => r.status === 'pending').length} pending)
              </span>
            </button>
          ))}
        </div>

        {/* Filter pills */}
        <div className="flex gap-2 mb-4">
          {(['pending', 'approved', 'rejected', 'all'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-full text-[11px] font-bold transition-colors ${
                filter === f ? 'bg-[#7C5CFC]/30 text-white' : 'bg-white/[0.05] text-white/40 hover:text-white/70'
              }`}>
              {f}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-white/40 text-sm">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-white/40 text-sm">No {filter === 'all' ? '' : filter} {tab}.</p>
        ) : (
          <div className="space-y-3">
            {filtered.map(row => (
              <div key={row.id} className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-bold text-white truncate">{row.email}</p>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        row.status === 'pending' ? 'bg-amber-500/15 text-amber-400'
                        : row.status === 'approved' ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-rose-500/15 text-rose-400'
                      }`}>
                        {row.status}
                      </span>
                      <span className="text-[10px] text-white/30">{formatTs(row.createdAt)}</span>
                    </div>

                    {tab === 'claims' && (
                      <div className="text-[12px] text-white/60 space-y-0.5">
                        {row.flightRef && <p>Flight PNR: <span className="text-white/80">{row.flightRef}</span></p>}
                        {row.hotelRef && <p>Hotel ref: <span className="text-white/80">{row.hotelRef}</span></p>}
                        {row.tripDates && <p>Dates: <span className="text-white/80">{row.tripDates}</span></p>}
                        {row.receipts && row.receipts.length > 0 && (
                          <div className="mt-1">
                            <p className="text-[11px] text-white/40 mb-1">Receipts ({row.receipts.length}):</p>
                            <div className="flex flex-wrap gap-1.5">
                              {row.receipts.map((r, i) => (
                                <a key={i} href={r.url} target="_blank" rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 px-2 py-1 bg-white/5 rounded-lg text-[11px] text-cyan-300 hover:bg-white/10">
                                  <ExternalLink className="w-3 h-3" /> {r.name}
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {tab === 'inquiries' && (
                      <div className="text-[12px] text-white/60 space-y-0.5">
                        {row.recommendedTour && <p>Tour: <span className="text-white/80">{row.recommendedTour}</span> · ₩{(row.quotedKRW || 0).toLocaleString()} / {row.hours}h</p>}
                        {row.name && <p>Name: <span className="text-white/80">{row.name}</span> {row.phone && `· ${row.phone}`}</p>}
                        {row.startDate && <p>Trip: <span className="text-white/80">{row.startDate}</span> · {row.pax} pax · {row.dayCount} days</p>}
                        {row.notes && <p className="text-white/50">Notes: {row.notes}</p>}
                        {row.planId && (
                          <p>Plan: <a href={`/my-plans/${row.planId}`} target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline">{row.planId}</a></p>
                        )}
                      </div>
                    )}
                  </div>

                  {row.status === 'pending' && (
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <button disabled={busyId === row.id}
                        onClick={() => handleAction(tab === 'claims' ? 'pending_free_claims' : 'charter_inquiries', row.id, 'approved')}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-[12px] font-semibold disabled:opacity-40">
                        {busyId === row.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                        Approve
                      </button>
                      <button disabled={busyId === row.id}
                        onClick={() => handleAction(tab === 'claims' ? 'pending_free_claims' : 'charter_inquiries', row.id, 'rejected')}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-[12px] font-semibold disabled:opacity-40">
                        <XCircle className="w-3.5 h-3.5" /> Reject
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
