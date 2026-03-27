import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { db } from '@/lib/firebase';

import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { toast, Toaster } from 'sonner';

export default function Admin() {
  const { user, loading, error } = useAuth();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState<number>(0);
  const [totalSeats, setTotalSeats] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
    <div className="min-h-screen bg-[#faf9f6] p-6">
      <Toaster position="top-center" richColors />
      <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow p-6">
        <h1 className="text-2xl font-bold text-[#1a1a2e] mb-2">Admin</h1>
        <p className="text-sm text-gray-600 mb-6">
          여행 상품을 등록합니다. (`tours` 컬렉션에 저장)
        </p>
        {error ? <p className="text-sm text-red-500 mb-4">{error}</p> : null}

        <form onSubmit={handleCreateTour} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Title
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none"
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
              className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none"
              rows={4}
              placeholder="상품 상세 설명"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Price
              </label>
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(parseFloat(e.target.value || '0'))}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none"
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
                className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none"
                min={1}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={!canSubmit || isSubmitting}
            className="w-full py-3 rounded-xl bg-[#0f3460] text-white font-bold hover:bg-[#1a1a2e] transition-colors disabled:opacity-50"
          >
            {isSubmitting ? '등록 중...' : '상품 등록'}
          </button>
        </form>
      </div>
    </div>
  );
}

