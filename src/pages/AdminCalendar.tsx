import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Users, MapPin, X, Plus, Info, ShieldAlert, Car, Contact, BarChart3, Truck, Loader2, Send } from 'lucide-react';
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
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';

// --- Types ---
type BookingStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'blocked';

interface Driver {
  chatId: string;       // Firestore doc id (= chat_id)
  name: string;
  vehicle: string;
  active: boolean;
}

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
  driverChatId?: number;
  driverName?: string;
  driverVehicle?: string;
  dispatchMemo?: string;
  extraCost?: number;
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
  driverChatId?: number;
  driverName?: string;
  driverVehicle?: string;
  dispatchMemo?: string;
  extraCost?: number;
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
    vehicle: data.driverVehicle || data.vehicleType || '',
    driver: data.driverName || data.driver || '',
    driverChatId: data.driverChatId,
    driverName: data.driverName || '',
    driverVehicle: data.driverVehicle || '',
    dispatchMemo: data.dispatchMemo || '',
    extraCost: data.extraCost || 0,
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
  const { user } = useAuth();
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

  // Dispatch Modal States — 예약 카드 → 배차 상세 입력
  const [dispatchBooking, setDispatchBooking] = useState<Booking | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [driversLoading, setDriversLoading] = useState(false);
  const [dispatchForm, setDispatchForm] = useState({
    driverChatId: '',
    dispatchMemo: '',
    actualEndAt: '',
    extraCost: '',
  });
  const [dispatchSubmitting, setDispatchSubmitting] = useState(false);
  const [dispatchToast, setDispatchToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

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

  // 배차 모달 오픈 — 기사 목록 fetch + 기존 값 prefill
  const openDispatchModal = async (booking: Booking) => {
    if (booking.collectionName !== 'bookings') return;
    setDispatchBooking(booking);
    setDispatchForm({
      driverChatId: booking.driverChatId ? String(booking.driverChatId) : '',
      dispatchMemo: booking.dispatchMemo || '',
      actualEndAt: booking.actualEndTime || '',
      extraCost: booking.extraCost ? String(booking.extraCost) : '',
    });
    setDispatchToast(null);
    setIsDrawerOpen(false); // 드로어 닫고 모달 열기

    // active=true 기사 목록 fetch (간단한 1회 fetch — 기사 변경 빈도 낮음)
    setDriversLoading(true);
    try {
      const snap = await getDocs(collection(db, 'drivers'));
      const list: Driver[] = [];
      snap.forEach((d) => {
        const data = d.data();
        if (data.active === false) return; // active=false 제외
        list.push({
          chatId: d.id,
          name: data.name || '',
          vehicle: data.vehicle || '',
          active: data.active !== false,
        });
      });
      setDrivers(list);
    } catch (err) {
      console.error('[AdminCalendar] drivers fetch failed:', err);
      setDrivers([]);
    } finally {
      setDriversLoading(false);
    }
  };

  const closeDispatchModal = () => {
    setDispatchBooking(null);
    setDispatchForm({ driverChatId: '', dispatchMemo: '', actualEndAt: '', extraCost: '' });
    setDispatchToast(null);
  };

  // 배차 저장 — POST /api/admin-update-booking
  const handleDispatchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dispatchBooking || !user) return;
    if (!dispatchForm.driverChatId) {
      setDispatchToast({ kind: 'error', message: '기사를 선택해 주세요.' });
      return;
    }

    setDispatchSubmitting(true);
    setDispatchToast(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin-update-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          orderID: dispatchBooking.id,
          action: 'dispatch',
          driverChatId: dispatchForm.driverChatId,
          dispatchMemo: dispatchForm.dispatchMemo || undefined,
          actualEndAt: dispatchForm.actualEndAt || undefined,
          extraCost: dispatchForm.extraCost ? Number(dispatchForm.extraCost) : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        const msg = json.error || `배차 저장 실패 (HTTP ${res.status})`;
        throw new Error(msg);
      }

      // 부분 성공 — Firestore 업데이트는 됐지만 텔레그램 발송 실패
      if (json.partial) {
        setDispatchToast({ kind: 'error', message: `⚠ ${json.warning || '텔레그램 발송 실패 — 어드민 채널 확인'}` });
      } else {
        setDispatchToast({ kind: 'success', message: '✓ 배차 완료 (기사봇 발송됨)' });
        // 1.5초 후 모달 닫기
        setTimeout(() => closeDispatchModal(), 1500);
      }
    } catch (err) {
      console.error('[AdminCalendar] dispatch failed:', err);
      setDispatchToast({
        kind: 'error',
        message: `❌ 저장 실패: ${err instanceof Error ? err.message : 'unknown'}`,
      });
    } finally {
      setDispatchSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0b14] text-white pt-20 px-4 pb-12 lg:px-8 font-sans">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CalendarIcon className="w-6 h-6 text-[#FBBF24]" />
              예약 캘린더 대시보드
              {loading && <Loader2 className="w-4 h-4 animate-spin text-gray-500" />}
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              {error ? <span className="text-red-400">⚠ {error}</span> : '예약 현황과 차량 배정을 한눈에 관리하세요. (Firestore 실시간 연동)'}
            </p>
          </div>

          <div className="flex items-center gap-6 bg-[#12131C] p-2 rounded-xl border border-gray-800">
            <button onClick={prevMonth} className="p-2 hover:bg-gray-800 rounded-lg transition-colors">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-lg font-semibold min-w-[120px] text-center">
              {year}년 {month + 1}월
            </span>
            <button onClick={nextMonth} className="p-2 hover:bg-gray-800 rounded-lg transition-colors">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          <div className="flex gap-3">
            <Link to="/admin/analytics" className="hidden md:flex px-4 py-2 bg-[#1a1b26] hover:bg-gray-800 border border-gray-800 rounded-lg text-sm font-medium transition-colors text-gray-300 items-center gap-2">
              <BarChart3 className="w-4 h-4" /> 통계
            </Link>
            <Link to="/admin/ops" className="hidden md:flex px-4 py-2 bg-[#1a1b26] hover:bg-gray-800 border border-gray-800 rounded-lg text-sm font-medium transition-colors text-gray-300 items-center gap-2">
              <Truck className="w-4 h-4" /> 운영 허브
            </Link>
            <button onClick={() => openAddModal('block')} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors border border-gray-700 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4" /> 일정 블록
            </button>
            <button onClick={() => openAddModal('booking')} className="px-4 py-2 bg-[#FBBF24] hover:bg-[#FBBF24]/90 text-black rounded-lg text-sm font-bold transition-colors flex items-center gap-2">
              <Plus className="w-4 h-4" /> 예약 추가
            </button>
          </div>
        </div>

        {/* Calendar Grid */}
        <div className="bg-[#12131C] border border-gray-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="grid grid-cols-7 border-b border-gray-800 bg-[#1a1b26]">
            {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
              <div key={d} className={`p-3 text-center text-sm font-semibold ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-300'}`}>
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 auto-rows-[120px]">
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
                  className={`border-r border-b border-gray-800/50 p-2 relative cursor-pointer hover:bg-gray-800/30 transition-colors group ${isToday ? 'bg-[#FBBF24]/5' : ''}`}
                >
                  <span className={`text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full mb-1 ${
                    isToday ? 'bg-[#FBBF24] text-black' : 'text-gray-400 group-hover:text-white'
                  }`}>
                    {day}
                  </span>

                  <div className="flex flex-col gap-1 overflow-hidden h-[80px]">
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

        {/* Legend */}
        <div className="flex gap-4 mt-6 text-sm text-gray-400 justify-end flex-wrap">
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/50"></span> 대기</div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/50"></span> 확정</div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-blue-500/20 border border-blue-500/50"></span> 운행종료</div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50"></span> 취소</div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 bg-gray-800 border border-gray-600"></span> 블록</div>
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
              className="fixed top-0 right-0 h-full w-full max-w-md bg-[#12131C] border-l border-gray-800 shadow-2xl z-50 flex flex-col"
            >
              <div className="p-6 border-b border-gray-800 flex justify-between items-center bg-[#0a0b14]">
                <div>
                  <h2 className="text-xl font-bold text-white">{selectedDate} 일정</h2>
                  <p className="text-gray-400 text-sm mt-1">총 {allItems.filter(b => b.date === selectedDate).length}건</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => openAddModal('booking', selectedDate!)} className="p-2 hover:bg-[#FBBF24]/20 text-[#FBBF24] rounded-lg transition-colors">
                    <Plus className="w-5 h-5" />
                  </button>
                  <button onClick={() => setIsDrawerOpen(false)} className="p-2 hover:bg-gray-800 rounded-lg text-gray-400 transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {allItems.filter(b => b.date === selectedDate).length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <CalendarIcon className="w-12 h-12 mx-auto mb-3 opacity-20" />
                    <p>이 날짜에 일정이 없습니다.</p>
                  </div>
                ) : (
                  allItems.filter(b => b.date === selectedDate).map((booking) => (
                    <div key={booking.id} className="bg-[#1a1b26] border border-gray-800 rounded-xl p-4 shadow-lg">
                      <div className="flex justify-between items-start mb-3">
                        <h3 className="font-bold text-lg text-white">{booking.tourName}</h3>
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[booking.status].split(' ')[0]} ${STATUS_COLORS[booking.status].split(' ')[1]}`}>
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

                      <div className="mt-4 pt-4 border-t border-gray-800 flex flex-col gap-2">
                        {booking.collectionName === 'bookings' && booking.status !== 'cancelled' && (
                          <button
                            onClick={() => openDispatchModal(booking)}
                            className="w-full py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 rounded-lg text-sm font-medium transition-colors border border-emerald-500/30 flex items-center justify-center gap-2"
                          >
                            <Send className="w-4 h-4" />
                            {booking.driverChatId ? '배차 수정' : '배차 입력'}
                          </button>
                        )}
                        <div className="flex gap-2">
                          {booking.status !== 'blocked' && (
                            <button
                              onClick={() => handleStatusChange(booking.id, booking.status)}
                              className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors text-white"
                            >
                              상태 변경
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(booking)}
                            className="flex-1 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-sm font-medium transition-colors border border-red-500/20"
                          >
                            일정 삭제
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}

        {/* Add/Block Modal */}
        {isAddModalOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
                className="bg-[#12131C] border border-gray-800 rounded-2xl p-6 w-full max-w-md shadow-2xl"
              >
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl font-bold text-white">
                    {modalMode === 'block' ? '일정 블록(마감)' : '수동 예약 추가'}
                  </h2>
                  <button onClick={() => setIsAddModalOpen(false)} className="text-gray-400 hover:text-white">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={handleAddSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">날짜</label>
                    <input type="date" required value={formData.date || ''} onChange={e => setFormData({...formData, date: e.target.value})} className="w-full bg-[#0a0b14] border border-gray-800 rounded-lg p-3 text-white focus:outline-none focus:border-[#FBBF24]" />
                  </div>

                  {modalMode === 'booking' && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1">투어/차량 이름</label>
                        <input type="text" required placeholder="ex) DMZ 프라이빗 투어" value={formData.tourName || ''} onChange={e => setFormData({...formData, tourName: e.target.value})} className="w-full bg-[#0a0b14] border border-gray-800 rounded-lg p-3 text-white focus:outline-none focus:border-[#FBBF24]" />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-400 mb-1">고객명</label>
                          <input type="text" required value={formData.customer || ''} onChange={e => setFormData({...formData, customer: e.target.value})} className="w-full bg-[#0a0b14] border border-gray-800 rounded-lg p-3 text-white focus:outline-none focus:border-[#FBBF24]" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-400 mb-1">인원 수</label>
                          <input type="number" min="1" required value={formData.pax || 2} onChange={e => setFormData({...formData, pax: parseInt(e.target.value)})} className="w-full bg-[#0a0b14] border border-gray-800 rounded-lg p-3 text-white focus:outline-none focus:border-[#FBBF24]" />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-400 mb-1">기준 시간(H)</label>
                          <input type="number" min="1" placeholder="ex) 10" value={formData.tourDuration || ''} onChange={e => setFormData({...formData, tourDuration: parseInt(e.target.value)})} className="w-full bg-[#0a0b14] border border-gray-800 rounded-lg p-3 text-white focus:outline-none focus:border-[#FBBF24]" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-400 mb-1">초과 30분당 요금(원)</label>
                          <input type="number" min="0" step="1000" placeholder="ex) 30000" value={formData.extraCharge || ''} onChange={e => setFormData({...formData, extraCharge: parseInt(e.target.value)})} className="w-full bg-[#0a0b14] border border-gray-800 rounded-lg p-3 text-white focus:outline-none focus:border-[#FBBF24]" />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-400 mb-1">배정 차량</label>
                          <select value={formData.vehicle || ''} onChange={e => setFormData({...formData, vehicle: e.target.value})} className="w-full bg-[#0a0b14] border border-gray-800 rounded-lg p-3 text-white focus:outline-none focus:border-[#FBBF24]">
                            <option value="">미지정</option>
                            <option value="스타리아 1호">스타리아 1호</option>
                            <option value="스타리아 2호">스타리아 2호</option>
                            <option value="카니발 1호">카니발 1호</option>
                            <option value="쏠라티 1호">쏠라티 1호</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-400 mb-1">담당 기사</label>
                          <select value={formData.driver || ''} onChange={e => setFormData({...formData, driver: e.target.value})} className="w-full bg-[#0a0b14] border border-gray-800 rounded-lg p-3 text-white focus:outline-none focus:border-[#FBBF24]">
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
                        <input type="text" placeholder="ex) 인천공항 T1 / 명동 L7 호텔" value={formData.pickup || ''} onChange={e => setFormData({...formData, pickup: e.target.value})} className="w-full bg-[#0a0b14] border border-gray-800 rounded-lg p-3 text-white focus:outline-none focus:border-[#FBBF24]" />
                      </div>

                      <div className="flex gap-6 p-3 bg-[#0a0b14] border border-gray-800 rounded-lg">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formData.requireCarSeat || false}
                            onChange={e => setFormData({...formData, requireCarSeat: e.target.checked})}
                            className="w-4 h-4 accent-[#FBBF24] bg-gray-800 border-gray-700 rounded"
                          />
                          <span className="text-sm font-medium text-gray-300">카시트 장착</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formData.requirePicket || false}
                            onChange={e => setFormData({...formData, requirePicket: e.target.checked})}
                            className="w-4 h-4 accent-[#FBBF24] bg-gray-800 border-gray-700 rounded"
                          />
                          <span className="text-sm font-medium text-gray-300">공항 피켓 서비스</span>
                        </label>
                      </div>
                    </>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">메모사항</label>
                    <textarea rows={3} placeholder={modalMode === 'block' ? "차량 정비, 휴무 등 사유 입력" : "카시트 필요, 특정 식당 요청 등"} value={formData.memo || ''} onChange={e => setFormData({...formData, memo: e.target.value})} className="w-full bg-[#0a0b14] border border-gray-800 rounded-lg p-3 text-white focus:outline-none focus:border-[#FBBF24] resize-none" />
                  </div>

                  <button type="submit" disabled={submitting} className={`w-full py-3 rounded-lg font-bold mt-2 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 ${
                    modalMode === 'block'
                      ? 'bg-red-500 hover:bg-red-600 text-white'
                      : 'bg-[#FBBF24] hover:bg-[#FBBF24]/90 text-black'
                  }`}>
                    {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                    {modalMode === 'block' ? '해당 날짜 블록하기' : '예약 추가하기'}
                  </button>
                </form>
              </motion.div>
            </motion.div>
          </>
        )}

        {/* Dispatch Modal — 배차 상세 입력 */}
        {dispatchBooking && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-end md:items-center justify-center md:p-4"
            >
              <motion.div
                initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
                className="bg-[#12131C] border border-gray-800 md:rounded-2xl rounded-t-2xl p-5 md:p-6 w-full md:max-w-lg shadow-2xl max-h-[92vh] overflow-y-auto"
              >
                <div className="flex justify-between items-start mb-5">
                  <div>
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                      <Send className="w-5 h-5 text-emerald-400" />
                      배차 상세 입력
                    </h2>
                    <p className="text-xs text-gray-500 mt-1">
                      <code className="bg-[#0a0b14] px-1.5 py-0.5 rounded">{dispatchBooking.id}</code>
                      {' · '}{dispatchBooking.tourName}{' · '}{dispatchBooking.date}
                    </p>
                  </div>
                  <button onClick={closeDispatchModal} className="text-gray-400 hover:text-white p-1">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={handleDispatchSubmit} className="space-y-4">
                  {/* 기사 선택 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">
                      기사 선택 <span className="text-red-400">*</span>
                    </label>
                    {driversLoading ? (
                      <div className="w-full bg-[#0a0b14] border border-gray-800 rounded-lg p-3 text-gray-500 text-sm flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        기사 목록 로드 중...
                      </div>
                    ) : drivers.length === 0 ? (
                      <div className="w-full bg-[#0a0b14] border border-amber-500/30 rounded-lg p-3 text-amber-400 text-sm">
                        등록된 활성 기사가 없습니다. 텔레그램에서 <code className="bg-[#12131C] px-1.5 py-0.5 rounded">기사추가 ...</code> 명령으로 먼저 등록하세요.
                      </div>
                    ) : (
                      <select
                        required
                        value={dispatchForm.driverChatId}
                        onChange={(e) => setDispatchForm({ ...dispatchForm, driverChatId: e.target.value })}
                        className="w-full bg-[#0a0b14] border border-gray-800 rounded-lg p-3 text-white text-base focus:outline-none focus:border-emerald-400"
                      >
                        <option value="">— 기사를 선택하세요 —</option>
                        {drivers.map((d) => (
                          <option key={d.chatId} value={d.chatId}>
                            {d.name || '(이름 없음)'} {d.vehicle ? `· ${d.vehicle}` : ''} (chat_id: {d.chatId})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* 배차 메모 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">
                      배차 메모 <span className="text-gray-500 text-xs">(선택)</span>
                    </label>
                    <textarea
                      rows={3}
                      placeholder="픽업 위치 추가 안내, 특이사항 등"
                      value={dispatchForm.dispatchMemo}
                      onChange={(e) => setDispatchForm({ ...dispatchForm, dispatchMemo: e.target.value })}
                      className="w-full bg-[#0a0b14] border border-gray-800 rounded-lg p-3 text-white text-base focus:outline-none focus:border-emerald-400 resize-none"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* 실제 종료 시간 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1.5">
                        실제 종료 시간 <span className="text-gray-500 text-xs">(운영 후)</span>
                      </label>
                      <input
                        type="datetime-local"
                        value={dispatchForm.actualEndAt}
                        onChange={(e) => setDispatchForm({ ...dispatchForm, actualEndAt: e.target.value })}
                        className="w-full bg-[#0a0b14] border border-gray-800 rounded-lg p-3 text-white text-base focus:outline-none focus:border-emerald-400"
                      />
                    </div>

                    {/* 초과 비용 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1.5">
                        초과 비용 <span className="text-gray-500 text-xs">(원)</span>
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="1000"
                        placeholder="톨비, 야간할증 등"
                        value={dispatchForm.extraCost}
                        onChange={(e) => setDispatchForm({ ...dispatchForm, extraCost: e.target.value })}
                        className="w-full bg-[#0a0b14] border border-gray-800 rounded-lg p-3 text-white text-base focus:outline-none focus:border-emerald-400"
                      />
                    </div>
                  </div>

                  {/* Toast */}
                  {dispatchToast && (
                    <div className={`text-sm p-3 rounded-lg border ${
                      dispatchToast.kind === 'success'
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                        : 'bg-red-500/10 border-red-500/30 text-red-300'
                    }`}>
                      {dispatchToast.message}
                    </div>
                  )}

                  {/* 버튼 그룹 */}
                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={closeDispatchModal}
                      disabled={dispatchSubmitting}
                      className="flex-1 py-3 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 rounded-lg text-white font-medium transition-colors"
                    >
                      취소
                    </button>
                    <button
                      type="submit"
                      disabled={dispatchSubmitting || drivers.length === 0}
                      className="flex-[2] py-3 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white font-bold transition-colors flex items-center justify-center gap-2"
                    >
                      {dispatchSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      배차 저장
                    </button>
                  </div>
                </form>
              </motion.div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
