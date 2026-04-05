import { useMemo, useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { db } from '@/lib/firebase';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { toast, Toaster } from 'sonner';
import { RefreshCw, Plus, List, ChevronDown, ChevronUp } from 'lucide-react';

interface Booking {
  id: string;
  [key: string]: any;
}

export default function Admin() {
  const { user, loading, error } = useAuth();

  // ── Tour creation form ──
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState<number>(0);
  const [totalSeats, setTotalSeats] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── Booking list (Google Sheets) ──
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingHeaders, setBookingHeaders] = useState<string[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [totalBookings, setTotalBookings] = useState(0);
  const [showForm, setShowForm] = useState(false);

  const canSubmit = useMemo(() => {
    return (
      !loading &&
      !!user &&
      title.trim().length > 0 &&
      description.trim().length > 0 &&
      Number.isFinite(price) &&
      price >= 0 &&
      Number.isFinite(totalSeats) &&
      totalSeats > 0
    );
  }, [loading, user, title, description, price, totalSeats]);

  const fetchBookings = async () => {
    setLoadingBookings(true);
    try {
      const resp = await fetch('/api/admin-bookings');
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      const list: Booking[] = data.bookings || [];
      setBookings(list);
      setTotalBookings(data.total || list.length);
      // 헤더 자동 추출 (id 제외)
      if (list.length > 0) {
        const keys = Object.keys(list[0]).filter(k => k !== 'id');
        setBookingHeaders(keys.slice(0, 8)); // 최대 8컬럼
      }
    } catch (err) {
      console.error('Failed to fetch bookings:', err);
      toast.error('예약 목록 로딩 실패');
    } finally {
      setLoadingBookings(false);
    }
  };

  useEffect(() => {
    if (user && !loading) {
      fetchBookings();
    }
  }, [user, loading]);

  const handleCreateTour = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) {
      toast.error('먼저 로그인을 해주세요.');
      return;
    }
    if (!title.trim() || !description.trim()) {
      toast.error('제목/설명을 입력해주세요.');
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      toast.error('가격은 0 이상의 숫자여야 합니다.');
      return;
    }
    if (!Number.isFinite(totalSeats) || totalSeats <= 0) {
      toast.error('총 정원은 1 이상의 숫자여야 합니다.');
      return;
    }

    try {
      setIsSubmitting(true);
      const payload = {
        title: title.trim(),
        description: description.trim(),
        price: Number(price),
        totalSeats: Number(totalSeats),
        currentBookings: 0,
        createdAt: serverTimestamp(),
      };

      await addDoc(collection(db, 'tours'), payload);
      toast.success('상품이 등록되었습니다.');

      setTitle('');
      setDescription('');
      setPrice(0);
      setTotalSeats(0);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : '상품 등록에 실패했습니다.';
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#faf9f6] text-[#0f3460]">
        Loading...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#faf9f6] p-4 sm:p-6">
      <Toaster position="top-center" richColors />
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#1a1a2e]">Admin Dashboard</h1>
            <p className="text-sm text-gray-500 mt-1">
              투어 상품 관리 · 예약 목록 조회
            </p>
          </div>
        </div>

        {error ? <p className="text-sm text-red-500">{error}</p> : null}

        {/* ── Bookings Table (Google Sheets) ── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <List className="w-5 h-5 text-[#7C5CFC]" />
              <h2 className="text-lg font-bold text-[#1a1a2e]">예약 목록</h2>
              <span className="text-xs bg-[#7C5CFC]/10 text-[#7C5CFC] px-2 py-0.5 rounded-full font-medium">
                {totalBookings}건
              </span>
              <span className="text-xs text-gray-400">
                (Google Sheets)
              </span>
            </div>
            <button
              onClick={fetchBookings}
              disabled={loadingBookings}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#7C5CFC] bg-[#7C5CFC]/5 rounded-lg hover:bg-[#7C5CFC]/10 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingBookings ? 'animate-spin' : ''}`} />
              새로고침
            </button>
          </div>

          {loadingBookings ? (
            <div className="p-12 text-center text-gray-400 text-sm">Loading...</div>
          ) : bookings.length === 0 ? (
            <div className="p-12 text-center text-gray-400 text-sm">
              등록된 예약이 없습니다
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                    {bookingHeaders.map((h) => (
                      <th key={h} className="text-left px-5 py-3 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {bookings.map((b) => (
                    <tr key={b.id} className="hover:bg-gray-50/50 transition-colors">
                      {bookingHeaders.map((h) => (
                        <td key={h} className="px-5 py-3.5 text-gray-600 max-w-[200px] truncate">
                          {String(b[h] || '-')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Tour Creation Form (Collapsible) ── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <button
            onClick={() => setShowForm(!showForm)}
            className="w-full flex items-center justify-between p-5 text-left hover:bg-gray-50/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Plus className="w-5 h-5 text-[#7C5CFC]" />
              <h2 className="text-lg font-bold text-[#1a1a2e]">상품 등록</h2>
            </div>
            {showForm ? (
              <ChevronUp className="w-5 h-5 text-gray-400" />
            ) : (
              <ChevronDown className="w-5 h-5 text-gray-400" />
            )}
          </button>

          {showForm && (
            <div className="p-5 pt-0 border-t border-gray-100">
              <form onSubmit={handleCreateTour} className="space-y-5 mt-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Title
                  </label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC] transition-all"
                    placeholder="예: Seoul Private Tour"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Description
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC] transition-all"
                    rows={4}
                    placeholder="상품 상세 설명"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Price ($)
                    </label>
                    <input
                      type="number"
                      value={price}
                      onChange={(e) => setPrice(parseFloat(e.target.value || '0'))}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC] transition-all"
                      min={0}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Total Seats
                    </label>
                    <input
                      type="number"
                      value={totalSeats}
                      onChange={(e) => setTotalSeats(parseFloat(e.target.value || '0'))}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC] transition-all"
                      min={1}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={!canSubmit || isSubmitting}
                  className="w-full py-3 rounded-xl bg-[#7C5CFC] text-white font-bold hover:bg-[#6b4ce0] transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? '등록 중...' : '상품 등록'}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
