import { useState, useEffect, useMemo } from 'react';
import { Star, Award, MessageCircle, Clock, AlertCircle, Loader2 } from 'lucide-react';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';

// CS 티켓 컬렉션은 향후 작업 — 지금은 placeholder 유지
type CSTicketStatus = 'open' | 'in_progress' | 'resolved';
interface CSTicket {
  id: string;
  bookingId: string;
  customer: string;
  issue: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: CSTicketStatus;
}

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

  // CS 티켓: cs_tickets 컬렉션 신규 작업 후 활성. 지금은 빈 배열.
  const csTickets: CSTicket[] = [];

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
          { label: '평가 대상', value: targetRatings.length, color: 'text-emerald-400' },
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
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400" /> CS 이슈 트래커
          </h3>
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
        </div>

        <div className="text-center py-8 text-gray-500 text-xs bg-[#0a0b14] rounded-lg">
          <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p>CS 티켓 시스템 미구현</p>
          <p className="mt-1 text-[10px] text-gray-600">cs_tickets 컬렉션 + 입력 UI 추가 후 활성화 예정</p>
        </div>
      </div>
    </div>
  );
}
