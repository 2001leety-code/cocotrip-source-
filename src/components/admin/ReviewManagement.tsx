import { useState, useEffect, useMemo } from 'react';
import { Star, Award, MessageCircle, Clock, AlertCircle, Loader2, Plus, X, ArrowRight } from 'lucide-react';
import { collection, query, where, orderBy, limit, onSnapshot, addDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

type CSPriority = 'low' | 'medium' | 'high' | 'critical';
type CSTicketStatus = 'open' | 'in_progress' | 'resolved';

interface CSTicket {
  id: string;
  bookingId: string;
  customer: string;
  issue: string;
  priority: CSPriority;
  status: CSTicketStatus;
  notes?: string;
  createdAt?: number;
  resolvedAt?: number;
}

const PRIORITY_STYLE: Record<CSPriority, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  low: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

interface ReviewDoc {
  authorUid?: string;
  authorName?: string;
  targetType?: string;       // 'tour' | 'driver' 등
  targetId?: string;         // tourSlug 또는 driverId
  rating?: number;
  text?: string;
  language?: string;
  status?: 'published' | 'reported';
  createdAt?: number;        // epoch ms
  driverChatId?: number;     // 기사 chat_id (선택 — 운행 → 리뷰 흐름에서 채워짐)
  driverName?: string;       // 기사 이름
  bookingId?: string;        // 연관 예약
}

interface ReviewEntry extends ReviewDoc {
  id: string;
}

interface TargetRating {
  targetId: string;
  targetType: string;
  totalReviews: number;
  averageRating: number;
  badge: 'gold' | 'silver' | 'none';
}

interface DriverRating {
  driverChatId: number;
  driverName: string;
  totalReviews: number;
  averageRating: number;
  badge: 'gold' | 'silver' | 'none';
}

const STATUS_STYLE: Record<CSTicketStatus, { label: string; color: string }> = {
  open: { label: 'Open', color: 'text-red-400' },
  in_progress: { label: '처리중', color: 'text-yellow-400' },
  resolved: { label: '해결', color: 'text-emerald-400' },
};

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star key={s} className={`w-3.5 h-3.5 ${s <= rating ? 'text-[#FBBF24] fill-[#FBBF24]' : 'text-gray-700'}`} />
      ))}
    </div>
  );
}

function badgeFor(avg: number, count: number): 'gold' | 'silver' | 'none' {
  if (count < 3) return 'none';
  if (avg >= 4.8) return 'gold';
  if (avg >= 4.5) return 'silver';
  return 'none';
}

function shortLabel(targetId: string, targetType: string): string {
  // tour slug → human label (간이 변환)
  if (!targetId) return '미지정';
  const slug = targetId.replace(/[-_]/g, ' ');
  return targetType ? `[${targetType}] ${slug}` : slug;
}

export default function ReviewManagement() {
  const [reviews, setReviews] = useState<ReviewEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [csFilter, setCsFilter] = useState<string>('all');
  const [csTickets, setCsTickets] = useState<CSTicket[]>([]);

  // 신규 티켓 모달
  const [showCsModal, setShowCsModal] = useState(false);
  const [newTicket, setNewTicket] = useState<{ bookingId: string; customer: string; issue: string; priority: CSPriority }>({
    bookingId: '', customer: '', issue: '', priority: 'medium',
  });
  const [csSubmitting, setCsSubmitting] = useState(false);

  useEffect(() => {
    setLoading(true);
    const q = query(
      collection(db, 'reviews'),
      where('status', '==', 'published'),
      orderBy('createdAt', 'desc'),
      limit(50),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: ReviewEntry[] = [];
        snap.forEach((doc) => list.push({ id: doc.id, ...(doc.data() as ReviewDoc) }));
        setReviews(list);
        setLoading(false);
      },
      (err) => {
        console.error('[ReviewManagement] reviews listen error:', err);
        setError(err.message);
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);

  // CS tickets 실시간 (createdAt 내림차순, 최근 100건)
  useEffect(() => {
    const q = query(
      collection(db, 'cs_tickets'),
      orderBy('createdAt', 'desc'),
      limit(100),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: CSTicket[] = [];
        snap.forEach((d) => {
          const data = d.data() as Partial<CSTicket> & { createdAt?: { toMillis?: () => number } | number; resolvedAt?: { toMillis?: () => number } | number };
          const tsToMs = (v: unknown): number | undefined => {
            if (!v) return undefined;
            if (typeof v === 'number') return v;
            if (typeof v === 'object' && v !== null && 'toMillis' in v && typeof (v as { toMillis?: () => number }).toMillis === 'function') {
              return (v as { toMillis: () => number }).toMillis();
            }
            return undefined;
          };
          list.push({
            id: d.id,
            bookingId: data.bookingId || '',
            customer: data.customer || '',
            issue: data.issue || '',
            priority: (data.priority || 'medium') as CSPriority,
            status: (data.status || 'open') as CSTicketStatus,
            notes: data.notes,
            createdAt: tsToMs(data.createdAt),
            resolvedAt: tsToMs(data.resolvedAt),
          });
        });
        setCsTickets(list);
      },
      (err) => console.error('[ReviewManagement] cs_tickets listen error:', err),
    );
    return () => unsub();
  }, []);

  async function createTicket() {
    if (!newTicket.bookingId.trim() || !newTicket.issue.trim()) return;
    setCsSubmitting(true);
    try {
      await addDoc(collection(db, 'cs_tickets'), {
        bookingId: newTicket.bookingId.trim(),
        customer: newTicket.customer.trim() || '-',
        issue: newTicket.issue.trim(),
        priority: newTicket.priority,
        status: 'open',
        createdAt: serverTimestamp(),
      });
      setNewTicket({ bookingId: '', customer: '', issue: '', priority: 'medium' });
      setShowCsModal(false);
    } catch (err) {
      console.error('[ReviewManagement] create ticket failed:', err);
      alert('티켓 생성 실패: ' + (err instanceof Error ? err.message : 'unknown'));
    } finally {
      setCsSubmitting(false);
    }
  }

  async function advanceTicketStatus(t: CSTicket) {
    const next: CSTicketStatus = t.status === 'open' ? 'in_progress' : 'resolved';
    try {
      const update: Record<string, unknown> = { status: next };
      if (next === 'resolved') update.resolvedAt = serverTimestamp();
      await updateDoc(doc(db, 'cs_tickets', t.id), update);
    } catch (err) {
      console.error('[ReviewManagement] update ticket failed:', err);
      alert('상태 변경 실패: ' + (err instanceof Error ? err.message : 'unknown'));
    }
  }

  // 기사별 평점 집계 (driverChatId 있는 리뷰만)
  const driverRatings: DriverRating[] = useMemo(() => {
    const map = new Map<number, { sum: number; count: number; name: string }>();
    reviews.forEach((r) => {
      if (!r.driverChatId) return;
      const prev = map.get(r.driverChatId) || { sum: 0, count: 0, name: r.driverName || '' };
      prev.sum += Number(r.rating || 0);
      prev.count += 1;
      if (r.driverName) prev.name = r.driverName;
      map.set(r.driverChatId, prev);
    });
    const arr: DriverRating[] = [];
    map.forEach((v, driverChatId) => {
      const avg = v.count > 0 ? v.sum / v.count : 0;
      arr.push({
        driverChatId,
        driverName: v.name || `chat:${driverChatId}`,
        totalReviews: v.count,
        averageRating: Math.round(avg * 10) / 10,
        badge: badgeFor(avg, v.count),
      });
    });
    return arr.sort((a, b) => b.averageRating - a.averageRating);
  }, [reviews]);

  // 타겟별 평점 집계
  const targetRatings: TargetRating[] = useMemo(() => {
    const map = new Map<string, { sum: number; count: number; type: string }>();
    reviews.forEach((r) => {
      const key = r.targetId || 'unknown';
      const prev = map.get(key) || { sum: 0, count: 0, type: r.targetType || '' };
      prev.sum += Number(r.rating || 0);
      prev.count += 1;
      map.set(key, prev);
    });
    const arr: TargetRating[] = [];
    map.forEach((v, targetId) => {
      const avg = v.count > 0 ? v.sum / v.count : 0;
      arr.push({
        targetId,
        targetType: v.type,
        totalReviews: v.count,
        averageRating: Math.round(avg * 10) / 10,
        badge: badgeFor(avg, v.count),
      });
    });
    return arr.sort((a, b) => b.averageRating - a.averageRating).slice(0, 10);
  }, [reviews]);

  const totalReviews = reviews.length;
  const avgAll = totalReviews > 0
    ? (reviews.reduce((s, r) => s + Number(r.rating || 0), 0) / totalReviews).toFixed(1)
    : '0.0';

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm px-3 py-2 rounded-lg">
          ⚠ {error}
        </div>
      )}

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: '총 리뷰', value: totalReviews, color: 'text-blue-400' },
          { label: '평균 평점', value: avgAll, color: 'text-[#FBBF24]' },
          { label: '평가 기사', value: driverRatings.length, color: 'text-purple-400' },
          { label: '미해결 CS', value: csTickets.filter((t) => t.status !== 'resolved').length, color: 'text-red-400' },
        ].map((k, i) => (
          <div key={i} className="bg-[#12131C] border border-gray-800 rounded-xl p-3 text-center">
            <div className={`text-xl font-bold ${k.color}`}>
              {loading && k.label === '총 리뷰' ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : k.value}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">{k.label}</div>
          </div>
        ))}
      </div>

      {/* 기사별 평점 — driverChatId 필드 있는 리뷰만 집계 */}
      {driverRatings.length > 0 && (
        <div className="bg-[#12131C] border border-gray-800 rounded-2xl p-5 shadow-xl">
          <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <Award className="w-4 h-4 text-purple-400" /> 기사별 평점
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {driverRatings.map((d) => (
              <div key={d.driverChatId} className="flex items-center gap-3 p-2.5 bg-[#0a0b14] rounded-lg">
                <div className="w-9 h-9 rounded-full bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-sm font-bold text-purple-300 shrink-0">
                  {d.driverName[0] || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-200 truncate">{d.driverName}</span>
                    {d.badge === 'gold' && <span className="px-1.5 py-0.5 bg-[#FBBF24]/20 text-[#FBBF24] text-[10px] font-bold rounded border border-[#FBBF24]/30">GOLD</span>}
                    {d.badge === 'silver' && <span className="px-1.5 py-0.5 bg-gray-400/20 text-gray-300 text-[10px] font-bold rounded border border-gray-400/30">SILVER</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <StarRating rating={Math.round(d.averageRating)} />
                    <span className="text-xs text-gray-500">{d.totalReviews}건</span>
                  </div>
                </div>
                <span className="text-lg font-bold text-purple-400">{d.averageRating}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Target Ratings (Tour/Driver별) */}
        <div className="bg-[#12131C] border border-gray-800 rounded-2xl p-5 shadow-xl">
          <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <Award className="w-4 h-4 text-[#FBBF24]" /> 대상별 평점 (TOP 10)
          </h3>
          {targetRatings.length === 0 ? (
            <div className="text-center py-8 text-gray-500 text-xs">아직 리뷰 없음</div>
          ) : (
            <div className="space-y-3">
              {targetRatings.map((d) => (
                <div key={d.targetId} className="flex items-center gap-3 p-2.5 bg-[#0a0b14] rounded-lg">
                  <div className="w-9 h-9 rounded-full bg-gray-800 flex items-center justify-center text-sm font-bold text-gray-300 shrink-0">
                    {d.targetId[0]?.toUpperCase() || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-200 truncate">{shortLabel(d.targetId, d.targetType)}</span>
                      {d.badge === 'gold' && <span className="px-1.5 py-0.5 bg-[#FBBF24]/20 text-[#FBBF24] text-[10px] font-bold rounded border border-[#FBBF24]/30">GOLD</span>}
                      {d.badge === 'silver' && <span className="px-1.5 py-0.5 bg-gray-400/20 text-gray-300 text-[10px] font-bold rounded border border-gray-400/30">SILVER</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <StarRating rating={Math.round(d.averageRating)} />
                      <span className="text-xs text-gray-500">{d.totalReviews}건</span>
                    </div>
                  </div>
                  <span className="text-lg font-bold text-[#FBBF24]">{d.averageRating}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Reviews */}
        <div className="bg-[#12131C] border border-gray-800 rounded-2xl p-5 shadow-xl">
          <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-blue-400" /> 최근 리뷰 (50건)
          </h3>
          {reviews.length === 0 ? (
            <div className="text-center py-8 text-gray-500 text-xs">
              {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : '아직 리뷰 없음'}
            </div>
          ) : (
            <div className="space-y-3 max-h-[480px] overflow-y-auto">
              {reviews.map((r) => (
                <div key={r.id} className="p-3 bg-[#0a0b14] rounded-lg">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded shrink-0">
                        {r.targetType || 'tour'}
                      </span>
                      <span className="text-xs text-gray-400 truncate">{r.authorName || '익명'}</span>
                      <span className="text-[10px] text-gray-600 truncate">({r.targetId || '-'})</span>
                    </div>
                  </div>
                  {r.rating && r.rating > 0 && (
                    <div className="flex items-center gap-2 mb-1">
                      <StarRating rating={r.rating} />
                    </div>
                  )}
                  {r.text && <p className="text-xs text-gray-400 line-clamp-2">{r.text}</p>}
                  <div className="flex items-center gap-1 mt-1">
                    <Clock className="w-3 h-3 text-gray-600" />
                    <span className="text-[10px] text-gray-600">
                      {r.language || 'en'} · {r.createdAt ? new Date(r.createdAt).toLocaleDateString('ko-KR') : '-'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* CS Kanban — placeholder until cs_tickets collection lands */}
      <div className="bg-[#12131C] border border-gray-800 rounded-2xl p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400" /> CS 이슈 트래커
          </h3>
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {['all', 'open', 'in_progress', 'resolved'].map((f) => (
                <button
                  key={f}
                  onClick={() => setCsFilter(f)}
                  className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${
                    csFilter === f ? 'bg-[#FBBF24] text-black' : 'bg-gray-800 text-gray-400 hover:text-white'
                  }`}
                >
                  {f === 'all' ? '전체' : STATUS_STYLE[f as CSTicketStatus]?.label || f}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowCsModal(true)}
              className="ml-2 flex items-center gap-1 bg-[#FBBF24] hover:bg-[#FBBF24]/90 text-black px-2.5 py-1 rounded text-xs font-bold"
            >
              <Plus className="w-3 h-3" /> 신규
            </button>
          </div>
        </div>

        {csTickets.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-xs bg-[#0a0b14] rounded-lg">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p>등록된 CS 티켓 없음</p>
            <p className="mt-1 text-[10px] text-gray-600">우측 "신규" 버튼으로 첫 티켓을 만들어보세요</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {(['open', 'in_progress', 'resolved'] as CSTicketStatus[]).map((status) => {
              const tickets = csTickets.filter((t) => t.status === status);
              if (csFilter !== 'all' && csFilter !== status) return null;
              return (
                <div key={status} className="space-y-2">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`w-2 h-2 rounded-full ${status === 'open' ? 'bg-red-400' : status === 'in_progress' ? 'bg-yellow-400' : 'bg-emerald-400'}`} />
                    <span className={`text-xs font-bold ${STATUS_STYLE[status].color}`}>{STATUS_STYLE[status].label}</span>
                    <span className="text-[10px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">{tickets.length}</span>
                  </div>
                  {tickets.map((t) => (
                    <div key={t.id} className="p-3 bg-[#0a0b14] rounded-lg border border-gray-800/50">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">{t.bookingId}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${PRIORITY_STYLE[t.priority]}`}>{t.priority.toUpperCase()}</span>
                      </div>
                      <p className="text-xs text-gray-200 font-medium mb-1">{t.issue}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-gray-600">{t.customer}</span>
                        {t.status !== 'resolved' && (
                          <button
                            onClick={() => advanceTicketStatus(t)}
                            className="text-[10px] text-[#FBBF24] hover:underline flex items-center gap-0.5"
                          >
                            {t.status === 'open' ? '처리 시작' : '해결 완료'} <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                      {t.createdAt && (
                        <div className="text-[10px] text-gray-700 mt-1">
                          {new Date(t.createdAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      )}
                    </div>
                  ))}
                  {tickets.length === 0 && csFilter === 'all' && (
                    <div className="p-4 text-center text-gray-600 text-xs bg-[#0a0b14] rounded-lg">없음</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 신규 CS 티켓 모달 */}
      {showCsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[#12131C] border border-gray-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-white">신규 CS 티켓</h2>
              <button onClick={() => setShowCsModal(false)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">예약번호</label>
                <input
                  type="text"
                  placeholder="CT-20260502-123"
                  value={newTicket.bookingId}
                  onChange={(e) => setNewTicket({ ...newTicket, bookingId: e.target.value })}
                  className="w-full bg-[#0a0b14] border border-gray-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#FBBF24]"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">고객명</label>
                <input
                  type="text"
                  placeholder="(선택)"
                  value={newTicket.customer}
                  onChange={(e) => setNewTicket({ ...newTicket, customer: e.target.value })}
                  className="w-full bg-[#0a0b14] border border-gray-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#FBBF24]"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">우선순위</label>
                <select
                  value={newTicket.priority}
                  onChange={(e) => setNewTicket({ ...newTicket, priority: e.target.value as CSPriority })}
                  className="w-full bg-[#0a0b14] border border-gray-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#FBBF24]"
                >
                  <option value="low">low — 일반 문의</option>
                  <option value="medium">medium — 응대 필요</option>
                  <option value="high">high — 긴급</option>
                  <option value="critical">critical — 환불/분쟁</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">이슈 내용</label>
                <textarea
                  rows={3}
                  placeholder="ex) 픽업 시간 30분 지연 / 차량 에어컨 불량 / 결제 금액 오차"
                  value={newTicket.issue}
                  onChange={(e) => setNewTicket({ ...newTicket, issue: e.target.value })}
                  className="w-full bg-[#0a0b14] border border-gray-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#FBBF24] resize-none"
                />
              </div>

              <button
                onClick={createTicket}
                disabled={csSubmitting || !newTicket.bookingId.trim() || !newTicket.issue.trim()}
                className="w-full py-2.5 bg-[#FBBF24] hover:bg-[#FBBF24]/90 text-black rounded-lg text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {csSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                티켓 생성
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
