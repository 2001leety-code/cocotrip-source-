import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Users, MapPin, X, Plus, Info, ShieldAlert, Car, Contact, BarChart3, Truck, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  addDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

// --- Types ---
type BookingStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'blocked';

interface Booking {
  id: string;          // Firestore doc id (orderID for paid bookings, auto-id for blocks/manual)
  collectionName: 'bookings' | 'calendar_blocks';
  date: string;        // YYYY-MM-DD
  customer: string;
  pax: number;
  tourName: string;
  tourDuration?: number;
  extraCharge?: number;
  status: BookingStatus;
  price?: number;
  vehicle?: string;
  driver?: string;
  memo?: string;
  pickup?: string;
  requireCarSeat?: boolean;
  requirePicket?: boolean;
  actualEndTime?: string;
  overtimeCost?: number;
  totalCollected?: number;
  // PR-J: PayPal Smart Buttons capture 응답 일부 (capturePaypalOrder.js L85-91 가
  // bookings/{orderID} 에 머지). 운영자 디버깅용 — manual QR 흐름은 pending_bookings
  // 에 별도 저장되며 본 컬럼은 비어있음.
  rawCapturePayload?: {
    payer?: { email_address?: string };
    amount?: { value?: string; currency_code?: string };
    captureID?: string;
    status?: string;
    create_time?: string;
  };
}

// --- Helpers ---
const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

// Firestore status (CONFIRMED/CANCELED 대문자 from server) → UI status
function normalizeStatus(s: string | undefined): BookingStatus {
  if (!s) return 'pending';
  const lower = s.toLowerCase();
  if (lower === 'canceled' || lower === 'cancelled') return 'cancelled';
  if (lower === 'confirmed') return 'confirmed';
  if (lower === 'completed') return 'completed';
  if (lower === 'pending') return 'pending';
  if (lower === 'blocked') return 'blocked';
  return 'pending';
}

interface FirestoreBooking {
  bookingRef?: string;
  orderID?: string;
  payerName?: string;
  userEmail?: string;
  paxCount?: number;
  productType?: string;
  status?: string;
  adminStatus?: string;       // admin-overridden status (pending/confirmed/completed)
  tourDate?: string;
  pickupLocation?: string;
  vehicleType?: string;
  driver?: string;
  memo?: string;
  amountUSD?: string | number;
  exchangeRate?: number;
  requireCarSeat?: boolean;
  requirePicket?: boolean;
  actualEndTime?: string;
  overtimeCost?: number;
  totalCollected?: number;
  tourDuration?: number;
  extraCharge?: number;
  // PR-J: PayPal capture 디버깅 페이로드. capturePaypalOrder.js 가 bookings/{orderID}
  // 에 merge 저장. manual QR 흐름은 pending_bookings 에 저장되어 본 필드 없음.
  rawCapturePayload?: {
    payer?: { email_address?: string };
    amount?: { value?: string; currency_code?: string };
    captureID?: string;
    status?: string;
    create_time?: string;
  };
}

function mapFirestoreToBooking(id: string, data: FirestoreBooking): Booking {
  // adminStatus가 있으면 그것 우선 (어드민이 수동으로 confirmed→completed로 진행)
  const status = normalizeStatus(data.adminStatus || data.status);
  const priceUSD = parseFloat(String(data.amountUSD || 0));
  return {
    id,
    collectionName: 'bookings',
    date: (data.tourDate || '').slice(0, 10),
    customer: data.payerName || data.userEmail || '-',
    pax: Number(data.paxCount || 0),
    tourName: data.productType || '예약',
    status,
    pickup: data.pickupLocation || '',
    price: priceUSD || 0,
    vehicle: data.vehicleType || '',
    driver: data.driver || '',
    memo: data.memo || '',
    requireCarSeat: !!data.requireCarSeat,
    requirePicket: !!data.requirePicket,
    actualEndTime: data.actualEndTime || '',
    overtimeCost: data.overtimeCost || 0,
    totalCollected: data.totalCollected || 0,
    tourDuration: data.tourDuration,
    extraCharge: data.extraCharge,
    rawCapturePayload: data.rawCapturePayload,
  };
}

interface FirestoreBlock {
  date?: string;
  vehicle?: string;
  reason?: string;
}

function mapFirestoreToBlock(id: string, data: FirestoreBlock): Booking {
  return {
    id,
    collectionName: 'calendar_blocks',
    date: (data.date || '').slice(0, 10),
    customer: '-',
    pax: 0,
    tourName: data.reason || '일정 마감',
    status: 'blocked',
    pickup: '-',
    price: 0,
    vehicle: data.vehicle || '',
    memo: data.reason || '',
  };
}

const STATUS_COLORS: Record<BookingStatus, string> = {
  pending: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  confirmed: 'bg-green-500/20 text-green-400 border border-green-500/30',
  completed: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  cancelled: 'bg-red-500/20 text-red-400 border border-red-500/30 line-through',
  blocked: 'bg-gray-800 text-gray-400 border border-gray-700'
};

const STATUS_LABELS: Record<BookingStatus, string> = {
  pending: '대기',
  confirmed: '확정',
  completed: '운행종료',
  cancelled: '취소',
  blocked: '블록'
};

export default function AdminCalendar() {
  const [currentDate, setCurrentDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [blocks, setBlocks] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal States
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'booking' | 'block'>('booking');
  const [formData, setFormData] = useState<Partial<Booking>>({ status: 'confirmed' });
  const [submitting, setSubmitting] = useState(false);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);

  const nextMonthDate = new Date(year, month + 2, 1);
  const monthRangeEnd = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}-01`;

  // Firestore real-time listeners — current month +/- 1
  useEffect(() => {
    setLoading(true);
    setError(null);

    const prevMonthDate = new Date(year, month - 1, 1);
    const rangeStart = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}-01`;

    const bookingsQ = query(
      collection(db, 'bookings'),
      where('tourDate', '>=', rangeStart),
      where('tourDate', '<', monthRangeEnd),
    );
    const blocksQ = query(
      collection(db, 'calendar_blocks'),
      where('date', '>=', rangeStart),
      where('date', '<', monthRangeEnd),
    );

    const unsubB = onSnapshot(
      bookingsQ,
      (snap) => {
        const list: Booking[] = [];
        snap.forEach((d) => list.push(mapFirestoreToBooking(d.id, d.data() as FirestoreBooking)));
        setBookings(list);
        setLoading(false);
      },
      (err) => {
        console.error('[AdminCalendar] bookings listen error:', err);
        setError(err.message);
        setLoading(false);
      },
    );

    const unsubBlk = onSnapshot(
      blocksQ,
      (snap) => {
        const list: Booking[] = [];
        snap.forEach((d) => list.push(mapFirestoreToBlock(d.id, d.data() as FirestoreBlock)));
        setBlocks(list);
      },
      (err) => {
        console.error('[AdminCalendar] blocks listen error:', err);
      },
    );

    return () => {
      unsubB();
      unsubBlk();
    };
  }, [year, month, monthRangeEnd]);

  const allItems = useMemo(() => [...bookings, ...blocks], [bookings, blocks]);

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

  const days: (number | null)[] = (Array.from({ length: firstDay }, (): null => null) as (number | null)[]).concat(
    Array.from({ length: daysInMonth }, (_, i) => i + 1)
  );

  const handleDateClick = (dateStr: string) => {
    setSelectedDate(dateStr);
    setIsDrawerOpen(true);
  };

  const handleStatusChange = async (bookingId: string, currentStatus: BookingStatus) => {
    const nextMap: Record<BookingStatus, BookingStatus> = {
      pending: 'confirmed',
      confirmed: 'completed',
      completed: 'cancelled',
      cancelled: 'pending',
      blocked: 'blocked',
    };
    const nextStatus = nextMap[currentStatus];

    // Destructive transitions — confirm before applying. 실수 클릭으로 데이터 손실
    // (운행종료된 건이 갑자기 취소 처리되거나, 취소 건이 다시 대기로 돌아가는 케이스) 방지.
    const DESTRUCTIVE: Array<[BookingStatus, BookingStatus]> = [
      ['completed', 'cancelled'],
      ['cancelled', 'pending'],
    ];
    const isDestructive = DESTRUCTIVE.some(([f, t]) => f === currentStatus && t === nextStatus);
    if (isDestructive) {
      const fromLabel = STATUS_LABELS[currentStatus];
      const toLabel = STATUS_LABELS[nextStatus];
      if (!confirm(`정말 [${fromLabel}]에서 [${toLabel}]로 변경하시겠습니까?`)) return;
    }

    try {
      await updateDoc(doc(db, 'bookings', bookingId), {
        adminStatus: nextStatus,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('[AdminCalendar] status update failed:', err);
      alert('상태 변경 실패: ' + (err instanceof Error ? err.message : 'unknown'));
    }
  };

  const openAddModal = (mode: 'booking' | 'block', dateStr?: string) => {
    setModalMode(mode);
    setFormData({
      date: dateStr || new Date().toISOString().split('T')[0],
      status: mode === 'block' ? 'blocked' : 'confirmed',
      tourName: mode === 'block' ? '일정 마감' : '',
      customer: mode === 'block' ? '-' : '',
      pax: mode === 'block' ? 0 : 2
    });
    setIsAddModalOpen(true);
    setIsDrawerOpen(false);
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (modalMode === 'block') {
        await addDoc(collection(db, 'calendar_blocks'), {
          date: formData.date!,
          vehicle: formData.vehicle || '',
          reason: formData.memo || formData.tourName || '일정 마감',
          createdAt: serverTimestamp(),
        });
      } else {
        // 어드민 수동 예약: bookings 컬렉션에 createdBy='admin' 마킹
        const docId = `MANUAL-${Date.now()}`;
        await setDoc(doc(db, 'bookings', docId), {
          bookingRef: docId,
          orderID: docId,
          createdBy: 'admin',
          tourDate: formData.date!,
          payerName: formData.customer || '-',
          userEmail: '',
          paxCount: formData.pax || 0,
          productType: formData.tourName || '수동 예약',
          status: 'confirmed',
          adminStatus: 'confirmed',
          pickupLocation: formData.pickup || '',
          vehicleType: formData.vehicle || '',
          driver: formData.driver || '',
          memo: formData.memo || '',
          tourDuration: formData.tourDuration || 10,
          extraCharge: formData.extraCharge || 30000,
          requireCarSeat: !!formData.requireCarSeat,
          requirePicket: !!formData.requirePicket,
          amountUSD: formData.price || 0,
          createdAt: serverTimestamp(),
        });
      }
      setIsAddModalOpen(false);
    } catch (err) {
      console.error('[AdminCalendar] add failed:', err);
      alert('추가 실패: ' + (err instanceof Error ? err.message : 'unknown'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (item: Booking) => {
    if (!confirm('정말로 이 일정을 삭제하시겠습니까?')) return;
    try {
      await deleteDoc(doc(db, item.collectionName, item.id));
    } catch (err) {
      console.error('[AdminCalendar] delete failed:', err);
      alert('삭제 실패: ' + (err instanceof Error ? err.message : 'unknown'));
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0b14] text-white pt-16 sm:pt-20 px-3 sm:px-4 pb-8 sm:pb-12 lg:px-8 font-sans overflow-x-hidden">
      <div className="max-w-7xl mx-auto">

        {/* Header — 모바일 수직 스택 */}
        <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center mb-5 sm:mb-8 gap-3 md:gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
              <CalendarIcon className="w-5 h-5 sm:w-6 sm:h-6 text-[#FBBF24]" />
              예약 캘린더
              {loading && <Loader2 className="w-4 h-4 animate-spin text-gray-500" />}
            </h1>
            <p className="text-gray-400 text-xs sm:text-sm mt-1">
              {error ? <span className="text-red-400">{error}</span> : '예약 현황과 차량 배정 (Firestore 실시간)'}
            </p>
          </div>

          <div className="flex items-center justify-between md:justify-center gap-3 md:gap-6 bg-[#12131C] p-2 rounded-xl border border-gray-800">
            <button onClick={prevMonth} className="p-2 hover:bg-gray-800 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center" aria-label="이전 달">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-base sm:text-lg font-semibold min-w-[100px] sm:min-w-[120px] text-center">
              {year}년 {month + 1}월
            </span>
            <button onClick={nextMonth} className="p-2 hover:bg-gray-800 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center" aria-label="다음 달">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {/* 모바일에서 가로 스크롤 가능, 데스크톱 가로 정렬 */}
          <div className="flex gap-2 sm:gap-3 overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
            <Link to="/admin/analytics" className="hidden md:flex px-4 py-2 bg-[#1a1b26] hover:bg-gray-800 border border-gray-800 rounded-lg text-sm font-medium transition-colors text-gray-300 items-center gap-2 min-h-[44px]">
              <BarChart3 className="w-4 h-4" /> 통계
            </Link>
            <Link to="/admin/ops" className="hidden md:flex px-4 py-2 bg-[#1a1b26] hover:bg-gray-800 border border-gray-800 rounded-lg text-sm font-medium transition-colors text-gray-300 items-center gap-2 min-h-[44px]">
              <Truck className="w-4 h-4" /> 운영 허브
            </Link>
            <button onClick={() => openAddModal('block')} className="px-3 sm:px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors border border-gray-700 flex items-center gap-2 min-h-[44px] shrink-0 whitespace-nowrap flex-1 md:flex-none justify-center">
              <ShieldAlert className="w-4 h-4" /> 일정 블록
            </button>
            <button onClick={() => openAddModal('booking')} className="px-3 sm:px-4 py-2 bg-[#FBBF24] hover:bg-[#FBBF24]/90 text-black rounded-lg text-sm font-bold transition-colors flex items-center gap-2 min-h-[44px] shrink-0 whitespace-nowrap flex-1 md:flex-none justify-center">
              <Plus className="w-4 h-4" /> 예약 추가
            </button>
          </div>
        </div>

        {/* Calendar Grid — 모바일에서는 셀 작아짐, 점만 표시 / 데스크톱은 풀텍스트 */}
        <div className="bg-[#12131C] border border-gray-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="grid grid-cols-7 border-b border-gray-800 bg-[#1a1b26]">
            {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
              <div key={d} className={`p-2 sm:p-3 text-center text-xs sm:text-sm font-semibold ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-300'}`}>
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 auto-rows-[64px] sm:auto-rows-[120px]">
            {days.map((day, index) => {
              if (day === null) {
                return <div key={`empty-${index}`} className="border-r border-b border-gray-800/50 bg-[#0a0b14]/50" />;
              }

              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const dayBookings = allItems.filter(b => b.date === dateStr);
              const isToday = new Date().toISOString().split('T')[0] === dateStr;

              return (
                <div
                  key={day}
                  onClick={() => handleDateClick(dateStr)}
                  className={`border-r border-b border-gray-800/50 p-1 sm:p-2 relative cursor-pointer hover:bg-gray-800/30 transition-colors group ${isToday ? 'bg-[#FBBF24]/5' : ''}`}
                >
                  <span className={`text-xs sm:text-sm font-medium w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center rounded-full mb-0.5 sm:mb-1 ${
                    isToday ? 'bg-[#FBBF24] text-black' : 'text-gray-400 group-hover:text-white'
                  }`}>
                    {day}
                  </span>

                  {/* 모바일: 점 indicator만 / 데스크톱: 카드 리스트 */}
                  <div className="sm:hidden flex flex-wrap gap-0.5 mt-0.5">
                    {dayBookings.slice(0, 4).map(booking => (
                      <span
                        key={booking.id}
                        className={`w-2 h-2 rounded-full ${STATUS_COLORS[booking.status].split(' ')[0]}`}
                        title={`${booking.tourName} (${booking.customer})`}
                      />
                    ))}
                    {dayBookings.length > 4 && (
                      <span className="text-[9px] text-gray-500 leading-none">+{dayBookings.length - 4}</span>
                    )}
                  </div>

                  <div className="hidden sm:flex flex-col gap-1 overflow-hidden h-[80px]">
                    {dayBookings.slice(0, 3).map(booking => (
                      <div
                        key={booking.id}
                        className={`text-xs px-2 py-1 rounded truncate flex items-center gap-1 ${STATUS_COLORS[booking.status]}`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70 shrink-0"></span>
                        <span className="truncate">{booking.tourName} {booking.customer !== '-' && `(${booking.customer})`}</span>
                      </div>
                    ))}
                    {dayBookings.length > 3 && (
                      <div className="text-[10px] text-gray-500 text-center font-medium">
                        +{dayBookings.length - 3}개 더보기
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Legend — 모바일에서 wrap, 작게 */}
        <div className="flex gap-3 sm:gap-4 mt-4 sm:mt-6 text-xs sm:text-sm text-gray-400 justify-start sm:justify-end flex-wrap">
          <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/50"></span> 대기</div>
          <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/50"></span> 확정</div>
          <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-blue-500/20 border border-blue-500/50"></span> 운행종료</div>
          <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50"></span> 취소</div>
          <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-gray-800 border border-gray-600"></span> 블록</div>
        </div>
      </div>

      {/* Drawer */}
      <AnimatePresence>
        {isDrawerOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsDrawerOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
            />
            <motion.div
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
              className="fixed top-0 right-0 h-full w-full sm:max-w-md bg-[#12131C] border-l border-gray-800 shadow-2xl z-50 flex flex-col"
            >
              <div className="p-4 sm:p-6 border-b border-gray-800 flex justify-between items-center bg-[#0a0b14]">
                <div>
                  <h2 className="text-lg sm:text-xl font-bold text-white">{selectedDate} 일정</h2>
                  <p className="text-gray-400 text-xs sm:text-sm mt-1">총 {allItems.filter(b => b.date === selectedDate).length}건</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => openAddModal('booking', selectedDate!)} className="p-2 hover:bg-[#FBBF24]/20 text-[#FBBF24] rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center" aria-label="예약 추가">
                    <Plus className="w-5 h-5" />
                  </button>
                  <button onClick={() => setIsDrawerOpen(false)} className="p-2 hover:bg-gray-800 rounded-lg text-gray-400 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center" aria-label="닫기">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
                {allItems.filter(b => b.date === selectedDate).length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <CalendarIcon className="w-12 h-12 mx-auto mb-3 opacity-20" />
                    <p className="text-sm">이 날짜에 일정이 없습니다.</p>
                  </div>
                ) : (
                  allItems.filter(b => b.date === selectedDate).map((booking) => (
                    <div key={booking.id} className="bg-[#1a1b26] border border-gray-800 rounded-xl p-3 sm:p-4 shadow-lg">
                      <div className="flex justify-between items-start mb-3 gap-2">
                        <h3 className="font-bold text-base sm:text-lg text-white break-words flex-1 min-w-0">{booking.tourName}</h3>
                        <span className={`text-xs px-2 py-1 rounded-full font-medium shrink-0 ${STATUS_COLORS[booking.status].split(' ')[0]} ${STATUS_COLORS[booking.status].split(' ')[1]}`}>
                          {STATUS_LABELS[booking.status]}
                        </span>
                      </div>

                      {booking.status !== 'blocked' && (
                        <>
                          <div className="space-y-2 text-sm text-gray-300">
                            <div className="flex items-center gap-2">
                              <Users className="w-4 h-4 text-gray-500" />
                              <span>{booking.customer} ({booking.pax}명)</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <MapPin className="w-4 h-4 text-gray-500" />
                              <span>{booking.pickup || '미지정'}</span>
                            </div>
                            {(booking.tourDuration || booking.extraCharge) && (
                              <div className="flex items-center gap-2 text-gray-400 mt-1 bg-[#0a0b14] p-2 rounded-lg">
                                <Info className="w-4 h-4 text-indigo-400 shrink-0" />
                                <span>기준 {booking.tourDuration}시간 (초과 시 30분당 {booking.extraCharge?.toLocaleString()}원)</span>
                              </div>
                            )}
                          </div>

                          <div className="mt-4 pt-3 border-t border-gray-800/60 grid grid-cols-2 gap-3 text-sm">
                            <div className="flex items-center gap-2">
                              <Car className={`w-4 h-4 ${booking.vehicle ? 'text-indigo-400' : 'text-gray-600'}`} />
                              <span className={booking.vehicle ? 'text-gray-200' : 'text-gray-500'}>
                                {booking.vehicle || '차량 미배정'}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Contact className={`w-4 h-4 ${booking.driver ? 'text-emerald-400' : 'text-gray-600'}`} />
                              <span className={booking.driver ? 'text-gray-200' : 'text-gray-500'}>
                                {booking.driver || '기사 미배정'}
                              </span>
                            </div>
                          </div>

                          {(booking.requireCarSeat || booking.requirePicket) && (
                            <div className="flex gap-2 mt-2 pt-2 border-t border-gray-800/40">
                              {booking.requireCarSeat && (
                                <span className="px-2 py-0.5 bg-orange-500/10 text-orange-400 border border-orange-500/20 rounded text-xs font-medium">
                                  카시트 요청
                                </span>
                              )}
                              {booking.requirePicket && (
                                <span className="px-2 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded text-xs font-medium">
                                  공항 피켓 요청
                                </span>
                              )}
                            </div>
                          )}

                          {booking.status === 'completed' && (
                            <div className="mt-3 bg-blue-500/5 border border-blue-500/20 rounded-lg p-3">
                              <div className="flex items-center gap-2 mb-2 pb-2 border-b border-blue-500/10">
                                <span className="text-blue-400 font-bold text-xs flex items-center gap-1">
                                  ✓ 텔레그램 자동 정산 완료 (고객정보 파기됨)
                                </span>
                              </div>
                              <div className="space-y-1.5 text-xs">
                                <div className="flex justify-between text-gray-400">
                                  <span>실제 종료 시간:</span>
                                  <span className="font-medium text-gray-300">{booking.actualEndTime || '-'}</span>
                                </div>
                                <div className="flex justify-between text-gray-400">
                                  <span>초과 시간(OT) 정산:</span>
                                  <span className="font-medium text-orange-400">
                                    {booking.overtimeCost ? `+${booking.overtimeCost.toLocaleString()}원` : '0원'}
                                  </span>
                                </div>
                                <div className="flex justify-between pt-1.5 mt-1 border-t border-blue-500/10">
                                  <span className="text-gray-300 font-medium">최종 기사 현장수금:</span>
                                  <span className="font-bold text-blue-300 text-sm">
                                    {booking.totalCollected ? `${booking.totalCollected.toLocaleString()}원` : '-'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          )}
                        </>
                      )}

                      {booking.memo && (
                        <div className="flex items-start gap-2 bg-[#0a0b14] p-2 rounded-lg mt-3 text-gray-400 text-xs">
                          <Info className="w-4 h-4 text-[#FBBF24] shrink-0" />
                          <span>{booking.memo}</span>
                        </div>
                      )}

                      <div className="mt-4 pt-4 border-t border-gray-800 flex gap-2">
                        {booking.status !== 'blocked' && (
                          <button
                            onClick={() => handleStatusChange(booking.id, booking.status)}
                            className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors text-white min-h-[44px]"
                          >
                            상태 변경
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(booking)}
                          className="flex-1 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-sm font-medium transition-colors border border-red-500/20 min-h-[44px]"
                        >
                          일정 삭제
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}

        {/* Add/Block Modal — 모바일 풀스크린 / 데스크톱 중앙 */}
        {isAddModalOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-stretch sm:items-center justify-center sm:p-4"
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
                className="bg-[#12131C] border border-gray-800 sm:rounded-2xl p-4 sm:p-6 w-full sm:max-w-md shadow-2xl overflow-y-auto max-h-screen"
              >
                <div className="flex justify-between items-center mb-5 sm:mb-6 sticky top-0 bg-[#12131C] -mt-1 pt-1 z-10">
                  <h2 className="text-lg sm:text-xl font-bold text-white">
                    {modalMode === 'block' ? '일정 블록 (마감)' : '수동 예약 추가'}
                  </h2>
                  <button onClick={() => setIsAddModalOpen(false)} className="text-gray-400 hover:text-white min-h-[44px] min-w-[44px] flex items-center justify-center" aria-label="닫기">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={handleAddSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">날짜</label>
                    <input type="date" required value={formData.date || ''} onChange={e => setFormData({...formData, date: e.target.value})} className="w-full bg-[#0a0b14] border border-gray-800 rounded-lg p-3 text-white focus:outline-none focus:border-[#FBBF24] min-h-[44px]" />
                  </div>

                  {modalMode === 'booking' && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1">투어 / 차량 이름</label>
                        <input type="text" required placeholder="예: DMZ 프라이빗 투어" value={formData.tourName || ''} onChange={e => setFormData({...formData, tourName: e.target.value})} className="w-full bg-[#0a0b14] border border-gray-800 rounded-lg p-3 text-white focus:outline-none focus:border-[#FBBF24] min-h-[44px]" />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-400 mb-1">고객명</label>
                          <input type="text" required value={formData.customer || ''} onChange={e => setFormData({...formData, customer: e.target.value})} className="w-full bg-[#0a0b14] border border-gray-800 rounded-lg p-3 text-white focus:outline-none focus:border-[#FBBF24] min-h-[44px]" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-400 mb-1">인원</label>
                          <input type="number" min="1" required value={formData.pax || 2} onChange={e => setFormData({...formData, pax: parseInt(e.target.value)})} className="w-full bg-[#0a0b14] border border-gray-800 rounded-lg p-3 text-white focus:outline-none focus:border-[#FBBF24] min-h-[44px]" />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-400 mb-1">기준 시간 (H)</label>
                          <input type="number" min="1" placeholder="예: 10" value={formData.tourDuration || ''} onChange={e => setFormData({...formData, tourDuration: parseInt(e.target.value)})} className="w-full bg-[#0a0b14] border border-gray-800 rounded-lg p-3 text-white focus:outline-none focus:border-[#FBBF24] min-h-[44px]" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-400 mb-1">초과 30분당 요금 (원)</label>
                          <input type="number" min="0" step="1000" placeholder="예: 30000" value={formData.extraCharge || ''} onChange={e => setFormData({...formData, extraCharge: parseInt(e.target.value)})} className="w-full bg-[#0a0b14] border border-gray-800 rounded-lg p-3 text-white focus:outline-none focus:border-[#FBBF24] min-h-[44px]" />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-400 mb-1">배정 차량</label>
                          <select value={formData.vehicle || ''} onChange={e => setFormData({...formData, vehicle: e.target.value})} className="w-full bg-[#0a0b14] border border-gray-800 rounded-lg p-3 text-white focus:outline-none focus:border-[#FBBF24] min-h-[44px]">
                            <option value="">미지정</option>
                            <option value="스타리아 1호">스타리아 1호</option>
                            <option value="스타리아 2호">스타리아 2호</option>
                            <option value="카니발 1호">카니발 1호</option>
                            <option value="쏠라티 1호">쏠라티 1호</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-400 mb-1">담당 기사</label>
                          <select value={formData.driver || ''} onChange={e => setFormData({...formData, driver: e.target.value})} className="w-full bg-[#0a0b14] border border-gray-800 rounded-lg p-3 text-white focus:outline-none focus:border-[#FBBF24] min-h-[44px]">
                            <option value="">미지정</option>
                            <option value="김기사">김기사</option>
                            <option value="이기사">이기사</option>
                            <option value="박기사">박기사</option>
                            <option value="최기사">최기사</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1">픽업 장소</label>
                        <input type="text" placeholder="예: 인천공항 T1 / 명동 L7 호텔" value={formData.pickup || ''} onChange={e => setFormData({...formData, pickup: e.target.value})} className="w-full bg-[#0a0b14] border border-gray-800 rounded-lg p-3 text-white focus:outline-none focus:border-[#FBBF24] min-h-[44px]" />
                      </div>

                      <div className="flex flex-col sm:flex-row gap-3 sm:gap-6 p-3 bg-[#0a0b14] border border-gray-800 rounded-lg">
                        <label className="flex items-center gap-2 cursor-pointer min-h-[44px]">
                          <input
                            type="checkbox"
                            checked={formData.requireCarSeat || false}
                            onChange={e => setFormData({...formData, requireCarSeat: e.target.checked})}
                            className="w-5 h-5 accent-[#FBBF24] bg-gray-800 border-gray-700 rounded"
                          />
                          <span className="text-sm font-medium text-gray-300">카시트 장착</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer min-h-[44px]">
                          <input
                            type="checkbox"
                            checked={formData.requirePicket || false}
                            onChange={e => setFormData({...formData, requirePicket: e.target.checked})}
                            className="w-5 h-5 accent-[#FBBF24] bg-gray-800 border-gray-700 rounded"
                          />
                          <span className="text-sm font-medium text-gray-300">공항 피켓 서비스</span>
                        </label>
                      </div>
                    </>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">메모</label>
                    <textarea rows={3} placeholder={modalMode === 'block' ? "차량 정비, 휴무 등 사유" : "카시트 필요, 특정 식당 요청 등"} value={formData.memo || ''} onChange={e => setFormData({...formData, memo: e.target.value})} className="w-full bg-[#0a0b14] border border-gray-800 rounded-lg p-3 text-white focus:outline-none focus:border-[#FBBF24] resize-none" />
                  </div>

                  <button type="submit" disabled={submitting} className={`w-full py-3 rounded-lg font-bold mt-2 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 min-h-[44px] ${
                    modalMode === 'block'
                      ? 'bg-red-500 hover:bg-red-600 text-white'
                      : 'bg-[#FBBF24] hover:bg-[#FBBF24]/90 text-black'
                  }`}>
                    {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                    {modalMode === 'block' ? '해당 날짜 블록' : '예약 추가'}
                  </button>
                </form>
              </motion.div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
