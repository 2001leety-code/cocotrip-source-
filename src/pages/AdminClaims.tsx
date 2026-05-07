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
import { Shield, ArrowLeft, FileCheck, Car, CheckCircle2, XCircle, Loader2, ExternalLink, Gift } from 'lucide-react';
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
  rejectReason?: string;
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

  // 회원가입 쿠폰 0건 회원 보정 (PR #253 silent fail 사후)
  const [couponFixInput, setCouponFixInput] = useState('');
  const [couponFixBusy, setCouponFixBusy] = useState(false);
  const [couponFixResult, setCouponFixResult] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const isAdmin = user?.email === (import.meta.env.VITE_ADMIN_EMAIL || '2001leety@gmail.com');

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

  // 2026-05-03: confirm() prompt before destructive ops + optional reject reason.
  // 2026-05-04: 한국어 운영 — admin 본인이 한국 사용자라 영문 prompt/confirm 가독성 떨어짐.
  const handleAction = useCallback(async (collectionName: string, id: string, email: string, status: Status) => {
    let rejectReason: string | null = null;
    if (status === 'rejected') {
      const reason = window.prompt(`${email} 의 신청을 거절하시겠습니까?\n\n거절 사유 (audit log 에 저장됨, 비워도 됨):`, '');
      if (reason === null) return; // cancelled
      rejectReason = reason.trim() || null;
    } else {
      const ok = window.confirm(`${email} 의 신청을 승인하시겠습니까?\n\n승인 처리됩니다. 실제 플랜·토큰 발송은 기존 follow-up 프로세스로 진행하세요.`);
      if (!ok) return;
    }
    setBusyId(id);
    try {
      await updateDoc(doc(db, collectionName, id), {
        status,
        reviewedAt: serverTimestamp(),
        reviewedBy: user?.email || 'admin',
        ...(rejectReason ? { rejectReason } : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '처리 실패';
      alert(msg);
    } finally {
      setBusyId(null);
    }
  }, [user?.email]);

  // 회원가입 쿠폰 0건 회원 보정 — uid 또는 email 입력 → /api/admin-coupon-fix 호출
  const handleCouponFix = useCallback(async () => {
    const input = couponFixInput.trim();
    if (!input) return;
    setCouponFixBusy(true);
    setCouponFixResult(null);
    try {
      const idToken = await user?.getIdToken();
      if (!idToken) throw new Error('admin token unavailable');
      // @ 포함 → email, 그렇지 않으면 uid
      const payload = input.includes('@') ? { email: input } : { uid: input };
      const resp = await fetch('/api/admin-coupon-fix', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      const r = data.data;
      const msg = r.alreadyIssued
        ? `이미 발급됨 (uid: ${r.uid})`
        : `${r.issued}장 발급 완료 (uid: ${r.uid})`;
      setCouponFixResult({ kind: 'ok', msg });
      setCouponFixInput('');
    } catch (err) {
      const m = err instanceof Error ? err.message : 'unknown error';
      setCouponFixResult({ kind: 'err', msg: m });
    } finally {
      setCouponFixBusy(false);
    }
  }, [couponFixInput, user]);

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
          <p className="text-lg font-bold">관리자 전용</p>
        </div>
      </div>
    );
  }

  // 2026-05-04: 한국어 라벨 매핑 (사용자 본인이 한국인이라 영문 표시 가독성 ↓)
  const STATUS_LABELS: Record<Status, string> = {
    pending: '대기',
    approved: '승인',
    rejected: '거절',
  };
  const FILTER_LABELS: Record<Status | 'all', string> = {
    pending: '대기',
    approved: '승인',
    rejected: '거절',
    all: '전체',
  };
  const TAB_LABELS: Record<Tab, string> = {
    claims: '무료 신청',
    inquiries: '차터 문의',
  };

  return (
    <div className="min-h-screen bg-[#0a0b14] text-white">
      <div className="max-w-5xl mx-auto px-4 py-10">
        <Link to="/admin" className="inline-flex items-center gap-1.5 text-white/55 text-sm hover:text-white/70 mb-6">
          <ArrowLeft className="w-3.5 h-3.5" /> 관리자 홈
        </Link>

        <div className="flex items-center gap-3 mb-6">
          <Shield className="w-7 h-7 text-amber-400" />
          <div>
            <h1 className="text-2xl font-bold">신청·문의 관리</h1>
            <p className="text-sm text-white/55">대기 중인 무료 플랜 신청 및 차터 문의를 승인 또는 거절</p>
          </div>
        </div>

        {/* 회원가입 쿠폰 0건 회원 보정 (PR #253 silent fail 사후) */}
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-4 mb-6">
          <div className="flex items-center gap-2 mb-2">
            <Gift className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold">회원가입 쿠폰 보정</h2>
          </div>
          <p className="text-[11px] text-white/55 mb-3">
            가입 후 5% 쿠폰 2장(차터·투어)이 발급되지 않은 회원을 1-click 보정. uid 또는 이메일 입력. 멱등(이미 발급됐으면 재발급 X).
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={couponFixInput}
              onChange={e => setCouponFixInput(e.target.value)}
              placeholder="uid 또는 이메일"
              disabled={couponFixBusy}
              className="flex-1 px-3 py-2 bg-white/[0.05] border border-white/[0.08] rounded-lg text-sm text-white placeholder:text-white/30 outline-none focus:border-emerald-400/40 disabled:opacity-40"
              onKeyDown={e => { if (e.key === 'Enter') handleCouponFix(); }}
            />
            <button
              onClick={handleCouponFix}
              disabled={couponFixBusy || !couponFixInput.trim()}
              className="px-4 py-2 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-sm font-semibold disabled:opacity-40 flex items-center gap-1.5"
            >
              {couponFixBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Gift className="w-3.5 h-3.5" />}
              발급
            </button>
          </div>
          {couponFixResult && (
            <p className={`mt-2 text-[12px] ${couponFixResult.kind === 'ok' ? 'text-emerald-300' : 'text-rose-300'}`}>
              {couponFixResult.kind === 'ok' ? '✓ ' : '✗ 에러: '}{couponFixResult.msg}
            </p>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-4 border-b border-white/[0.08]">
          {(['claims', 'inquiries'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
                tab === t ? 'border-[#7C5CFC] text-white' : 'border-transparent text-white/55 hover:text-white/70'
              }`}>
              {t === 'claims' ? <FileCheck className="w-4 h-4" /> : <Car className="w-4 h-4" />}
              {TAB_LABELS[t]}
              <span className="ml-1 text-[11px] text-white/55">
                (대기 {(t === 'claims' ? claims : inquiries).filter(r => r.status === 'pending').length}건)
              </span>
            </button>
          ))}
        </div>

        {/* Filter pills */}
        <div className="flex gap-2 mb-4">
          {(['pending', 'approved', 'rejected', 'all'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-full text-[11px] font-bold transition-colors ${
                filter === f ? 'bg-[#7C5CFC]/30 text-white' : 'bg-white/[0.05] text-white/55 hover:text-white/70'
              }`}>
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-white/55 text-sm">불러오는 중…</p>
        ) : filtered.length === 0 ? (
          <p className="text-white/55 text-sm">{filter === 'all' ? '' : `${FILTER_LABELS[filter]} 상태의 `}{TAB_LABELS[tab]} 항목이 없습니다.</p>
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
                        {STATUS_LABELS[row.status] || row.status}
                      </span>
                      <span className="text-[10px] text-white/55">{formatTs(row.createdAt)}</span>
                    </div>

                    {row.status === 'rejected' && row.rejectReason && (
                      <p className="text-[11px] text-rose-300/80 italic mb-1">거절 사유: {row.rejectReason}</p>
                    )}

                    {tab === 'claims' && (
                      <div className="text-[12px] text-white/60 space-y-0.5">
                        {row.flightRef && <p>항공 PNR: <span className="text-white/80">{row.flightRef}</span></p>}
                        {row.hotelRef && <p>호텔 예약번호: <span className="text-white/80">{row.hotelRef}</span></p>}
                        {row.tripDates && <p>여행 일정: <span className="text-white/80">{row.tripDates}</span></p>}
                        {row.receipts && row.receipts.length > 0 && (
                          <div className="mt-1">
                            <p className="text-[11px] text-white/55 mb-1">영수증 ({row.receipts.length}건):</p>
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
                        {row.recommendedTour && <p>투어: <span className="text-white/80">{row.recommendedTour}</span> · ₩{(row.quotedKRW || 0).toLocaleString()} / {row.hours}시간</p>}
                        {row.name && <p>성함: <span className="text-white/80">{row.name}</span> {row.phone && `· ${row.phone}`}</p>}
                        {row.startDate && <p>일정: <span className="text-white/80">{row.startDate}</span> · {row.pax}명 · {row.dayCount}일</p>}
                        {row.notes && <p className="text-white/50">메모: {row.notes}</p>}
                        {row.planId && (
                          <p>플랜: <a href={`/my-plans/${row.planId}`} target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline">{row.planId}</a></p>
                        )}
                      </div>
                    )}
                  </div>

                  {row.status === 'pending' && (
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <button disabled={busyId === row.id}
                        onClick={() => handleAction(tab === 'claims' ? 'pending_free_claims' : 'charter_inquiries', row.id, row.email, 'approved')}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-[12px] font-semibold disabled:opacity-40">
                        {busyId === row.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                        승인
                      </button>
                      <button disabled={busyId === row.id}
                        onClick={() => handleAction(tab === 'claims' ? 'pending_free_claims' : 'charter_inquiries', row.id, row.email, 'rejected')}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-[12px] font-semibold disabled:opacity-40">
                        <XCircle className="w-3.5 h-3.5" /> 거절
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
