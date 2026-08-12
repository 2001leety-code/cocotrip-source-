import { useEffect, useState } from 'react';
import { MoodBookingChangeModal, type ChangeableMoodBooking } from '@/components/mood/MoodBookingChangeModal';
import { MoodBookingCopyButton, MoodBookingShareCard } from '@/components/mood/MoodBookingShareCard';
import type { MoodBookingShareData } from '@/lib/moodBookingShare';

const points = [
  { lat: 37.5547, lng: 126.9706, role: 'origin' as const },
  { lat: 37.5445, lng: 127.0557, role: 'waypoint' as const, index: 0 },
  { lat: 37.5133, lng: 127.1001, role: 'waypoint' as const, index: 1 },
  { lat: 37.4979, lng: 127.0276, role: 'waypoint' as const, index: 2 },
  { lat: 37.5663, lng: 126.9779, role: 'destination' as const },
];

const shareData: MoodBookingShareData = {
  bookingRef: 'M-1234',
  phase: 'expected',
  date: '2026-08-15',
  startTime: '09:30',
  influencerName: '예시 인플루언서',
  serviceLabel: '차량',
  durationHours: 4,
  stops: [
    { address: '서울역', payer: 'mood', lat: points[0].lat, lng: points[0].lng },
    { address: '성수동', payer: 'influencer', lat: points[1].lat, lng: points[1].lng },
    { address: '잠실', payer: 'influencer', lat: points[2].lat, lng: points[2].lng },
    { address: '강남역', payer: 'influencer', lat: points[3].lat, lng: points[3].lng },
    { address: '서울시청', payer: 'influencer', lat: points[4].lat, lng: points[4].lng },
  ],
  route: {
    km: 64,
    durationMin: 85,
    points,
    path: points.map((point) => [point.lng, point.lat]),
  },
  costs: {
    expected: {
      baseKRW: 80000,
      distanceSurchargeKRW: 12000,
      tollKRW: 8000,
      totalKRW: 100000,
    },
  },
  note: '촬영 장비가 있어 트렁크 공간을 확보해 주세요.',
};

const changeBooking: ChangeableMoodBooking = {
  id: 'M-1234',
  date: '2026-08-15',
  startTime: '09:30',
  durationHours: 4,
  serviceType: 'vehicle',
  amountKRW: 100000,
  revision: 2,
  influencerName: '예시 인플루언서',
  note: '촬영 장비가 있어 트렁크 공간을 확보해 주세요.',
  coursePayers: ['mood', 'influencer', 'influencer', 'influencer', 'influencer'],
  breakdown: {
    origin: '서울역',
    waypoints: ['성수동', '잠실', '강남역'],
    destination: '서울시청',
  },
};

export default function MoodUiHarness() {
  const [changeOpen, setChangeOpen] = useState(false);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/api/mood-route')) {
        return new Response(JSON.stringify({ ok: true, data: { km: 64, tollKRW: 8000, durationMin: 85, points, path: shareData.route?.path } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/mood-change')) {
        return new Response(JSON.stringify({ ok: true, data: { revision: 3 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return originalFetch(input, init);
    };
    return () => { window.fetch = originalFetch; };
  }, []);

  return (
    <main className="min-h-screen bg-[#090510] px-3 py-5 sm:px-6">
      <div className="mx-auto mb-4 flex max-w-[430px] gap-2">
        <MoodBookingCopyButton data={shareData} />
        <button type="button" onClick={() => setChangeOpen(true)} className="min-h-11 shrink-0 rounded-xl bg-white/10 px-4 text-sm font-black text-white">예약 변경</button>
      </div>
      <MoodBookingShareCard data={shareData} />
      {changeOpen && (
        <MoodBookingChangeModal
          booking={changeBooking}
          balanceKRW={500000}
          onClose={() => setChangeOpen(false)}
          onChanged={() => undefined}
        />
      )}
    </main>
  );
}
