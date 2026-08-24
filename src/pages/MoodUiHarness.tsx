import { useEffect, useRef, useState } from 'react';
import { MoodBookingChangeModal, type ChangeableMoodBooking } from '@/components/mood/MoodBookingChangeModal';
import { MoodBookingCopyButton, MoodBookingShareCard } from '@/components/mood/MoodBookingShareCard';
import {
  MoodSettlementApprovalPanel,
  MoodSettlementEditor,
  type SettlementApprovalSummary,
  type SettlementBooking,
  type SettlementMode,
} from '@/components/mood/MoodSettlementEditor';
import { MoodReceiptModal } from '@/components/mood/MoodReceiptModal';
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
    { address: '서울역', moodPercentage: 100, lat: points[0].lat, lng: points[0].lng },
    { address: '성수동', moodPercentage: 50, lat: points[1].lat, lng: points[1].lng },
    { address: '잠실', moodPercentage: 50, lat: points[2].lat, lng: points[2].lng },
    { address: '강남역', moodPercentage: 0, lat: points[3].lat, lng: points[3].lng },
    { address: '서울시청', moodPercentage: 33, lat: points[4].lat, lng: points[4].lng },
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
  date: '2026-09-10',
  startTime: '18:30',
  durationHours: 4,
  serviceType: 'vehicle',
  amountKRW: 100000,
  revision: 2,
  influencerName: '예시 인플루언서',
  note: '촬영 장비가 있어 트렁크 공간을 확보해 주세요.',
  courseMoodPercentages: [100, 50, 50, 0, 33],
  breakdown: {
    origin: '서울역',
    waypoints: ['성수동', '잠실', '강남역'],
    destination: '서울시청',
  },
};

const actualTolls = [
  { label: '서울 → 평택', date: '2026-08-20 11:23:47', amountKRW: 5100, status: 'pending' as const, includedInSettlement: true, evidenceRef: '하이패스 카드 캡처 2/2' },
  { label: '평택 → 송악', date: '2026-08-20 11:46:50', amountKRW: 2300, status: 'pending' as const, includedInSettlement: true, evidenceRef: '하이패스 카드 캡처 2/2' },
  { label: '당진 → 서산', date: '2026-08-20 12:27:13', amountKRW: 1700, status: 'pending' as const, includedInSettlement: true, evidenceRef: '하이패스 카드 캡처 2/2' },
  { label: '서산 → 당진', date: '2026-08-20 16:25:56', amountKRW: 1700, status: 'pending' as const, includedInSettlement: true, evidenceRef: '하이패스 카드 캡처 2/2' },
  { label: '송악 → 서울', date: '2026-08-20 18:32:09', amountKRW: 5300, status: 'pending' as const, includedInSettlement: true, evidenceRef: '하이패스 카드 캡처 2/2' },
  { label: '충전(제외내역)', date: '2026-08-20 15:27:25', amountKRW: 10000, status: 'confirmed' as const, includedInSettlement: false, evidenceRef: '하이패스 카드 캡처 2/2' },
];

const initialSettlementBooking: SettlementBooking = {
  id: 'MOOD-20260820',
  date: '2026-08-20',
  startTime: '09:30',
  durationHours: 10,
  serviceType: 'vehicle',
  amountKRW: 537740,
  status: 'confirmed',
  revision: 1,
  breakdown: {
    baseKRW: 300000,
    distanceSurchargeKRW: 228540,
    tollKRW: 9200,
    km: 380.9,
    origin: '서울역',
    destination: '당진',
  },
};

const completedSettlementBooking: SettlementBooking = {
  ...initialSettlementBooking,
  status: 'completed',
  revision: 2,
  actualHours: 10,
  finalAmountKRW: 551300,
  finalBreakdown: {
    baseKRW: 300000,
    distanceSurchargeKRW: 235200,
    tollKRW: 16100,
    estimatedTollKRW: 9200,
    km: 392,
    distanceSource: 'manual',
    actualTotalKm: 438,
    excludedKm: 46,
    origin: '서울역',
    destination: '당진',
  },
  tollMode: 'itemized',
  tollEntries: actualTolls,
  manualAdjustmentKRW: 0,
  settlementReason: '픽업 전 46km 제외, 8월 20일 미확정 톨비 5건 잠정 반영',
};

function settlementApproval(
  status: SettlementApprovalSummary['status'],
  version: number,
  changeRequestReason: string | null = null,
  mode: SettlementMode = 'initial',
): SettlementApprovalSummary {
  const correction = mode === 'correction';
  return {
    status,
    mode,
    proposalId: `proposal-${version}`,
    version,
    bookedAmountKRW: 537740,
    previousFinalAmountKRW: correction ? 551300 : null,
    finalAmountKRW: correction ? 550100 : 551300,
    deltaKRW: correction ? -1200 : 13560,
    actualHours: 10,
    finalBreakdown: correction
      ? { ...(completedSettlementBooking.finalBreakdown || {}), km: 390, excludedKm: 48, distanceSurchargeKRW: 234000 }
      : completedSettlementBooking.finalBreakdown || {},
    tollMode: 'itemized',
    tollEntries: actualTolls,
    settlementReason: '픽업 전 46km 제외, 8월 20일 미확정 톨비 5건 잠정 반영',
    proposedByEmail: 'operator@cocotrip.test',
    proposedAt: Date.UTC(2026, 7, 21, 1, 30),
    changeRequestReason,
    approvedByEmail: status === 'approved' ? 'mood-approver@example.com' : null,
    approvedAt: status === 'approved' ? Date.UTC(2026, 7, 21, 2, 15) : null,
    proposedBalanceKRW: correction ? 986440 : 1000000,
    proposedResultingBalanceKRW: correction ? 987640 : 986440,
    pendingIncludedTollCount: 5,
  };
}

export default function MoodUiHarness() {
  const [changeOpen, setChangeOpen] = useState(false);
  const [lastRouteOrder, setLastRouteOrder] = useState('');
  const [lastChangePayload, setLastChangePayload] = useState('');
  const [settlementMode, setSettlementMode] = useState<'initial' | 'correction' | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [settlementResult, setSettlementResult] = useState('');
  const [role, setRole] = useState<'operator' | 'client'>('operator');
  const [clientCanApprove, setClientCanApprove] = useState(true);
  const [activeApproval, setActiveApproval] = useState<SettlementApprovalSummary | null>(null);
  const [flowCompleted, setFlowCompleted] = useState(false);
  const proposalVersionRef = useRef(0);

  const flowBooking: SettlementBooking = flowCompleted
    ? { ...completedSettlementBooking, settlementApproval: activeApproval }
    : { ...initialSettlementBooking, settlementApproval: activeApproval };

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/api/mood-route')) {
        const parsed = new URL(url, window.location.origin);
        const origin = parsed.searchParams.get('origin') || '';
        const destination = parsed.searchParams.get('destination') || '';
        const waypoints = (parsed.searchParams.get('waypoints') || '').split('|').filter(Boolean);
        const order = [origin, ...waypoints, destination];
        const originalOrder = waypoints.join('|') === '성수동|잠실|강남역';
        setLastRouteOrder(order.join(' → '));
        return new Response(JSON.stringify({
          ok: true,
          data: {
            km: originalOrder ? 64 : 71,
            tollKRW: originalOrder ? 8000 : 9000,
            durationMin: originalOrder ? 85 : 97,
            points,
            path: shareData.route?.path,
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/mood-change')) {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
        setLastChangePayload(JSON.stringify({
          origin: body.booking?.origin || '',
          waypoints: body.booking?.waypoints || [],
          destination: body.booking?.destination || '',
          courseMoodPercentages: body.booking?.courseMoodPercentages || [],
        }));
        return new Response(JSON.stringify({ ok: true, data: { revision: 3 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/mood-settle-preview')) {
        const bodyStr = typeof init?.body === 'string' ? init.body : '{}';
        const body = JSON.parse(bodyStr);
        const correction = body.mode === 'correction';
        return new Response(JSON.stringify({
          ok: true,
          data: {
            mode: correction ? 'correction' : 'initial',
            bookingId: 'MOOD-20260820',
            revision: correction ? 2 : 1,
            actualHours: 10,
            km: correction ? 390 : 392,
            distanceSource: 'manual',
            actualTotalKm: 438,
            excludedKm: correction ? 48 : 46,
            baseKRW: 300000,
            distanceSurchargeKRW: correction ? 234000 : 235200,
            estimatedTollKRW: 9200,
            tollKRW: 16100,
            manualAdjustmentKRW: 0,
            bookedAmountKRW: 537740,
            previousFinalAmountKRW: correction ? 551300 : undefined,
            finalAmountKRW: correction ? 550100 : 551300,
            deltaKRW: correction ? -1200 : 13560,
            currentBalanceKRW: correction ? 986440 : 1000000,
            resultingBalanceKRW: correction ? 987640 : 986440,
            previewHash: 'a'.repeat(64),
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/mood-settle-respond')) {
        const bodyStr = typeof init?.body === 'string' ? init.body : '{}';
        const body = JSON.parse(bodyStr);
        if (body.action === 'approve') {
          setActiveApproval((current) => current ? {
            ...current,
            status: 'approved',
            approvedByEmail: 'mood-approver@example.com',
            approvedAt: Date.UTC(2026, 7, 21, 2, 15),
          } : current);
          setFlowCompleted(true);
          return new Response(JSON.stringify({
            ok: true,
            data: { proposalId: body.proposalId, bookingId: 'MOOD-20260820', status: 'approved', finalAmountKRW: 551300, deltaKRW: 13560, balanceKRW: 986440, revision: 2 },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (body.action === 'request_changes') {
          setActiveApproval((current) => current ? { ...current, status: 'changes_requested', changeRequestReason: String(body.reason || '') } : current);
          return new Response(JSON.stringify({
            ok: true,
            data: { proposalId: body.proposalId, bookingId: 'MOOD-20260820', status: 'changes_requested', changeRequestReason: body.reason, finalAmountKRW: 551300, deltaKRW: 13560, revision: 1 },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        setActiveApproval(null);
        return new Response(JSON.stringify({
          ok: true,
          data: { proposalId: body.proposalId, bookingId: 'MOOD-20260820', status: 'withdrawn', finalAmountKRW: 551300, deltaKRW: 13560, revision: 1 },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/mood-settle-correct')) {
        proposalVersionRef.current += 1;
        const proposal = settlementApproval('awaiting_mood', proposalVersionRef.current, null, 'correction');
        setActiveApproval(proposal);
        setFlowCompleted(true);
        return new Response(JSON.stringify({ ok: true, data: { status: 'awaiting_mood', proposalId: proposal.proposalId, version: proposal.version, finalAmountKRW: 550100, deltaKRW: -1200 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/mood-settle')) {
        proposalVersionRef.current += 1;
        const proposal = settlementApproval('awaiting_mood', proposalVersionRef.current);
        setActiveApproval(proposal);
        setFlowCompleted(false);
        return new Response(JSON.stringify({ ok: true, data: { status: 'awaiting_mood', proposalId: proposal.proposalId, version: proposal.version, finalAmountKRW: 551300, deltaKRW: 13560 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
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
      {(lastRouteOrder || lastChangePayload) && (
        <div className="mx-auto mb-4 max-w-[430px] space-y-1 rounded-xl bg-white/5 px-3 py-2 text-[10px] text-white/70">
          {lastRouteOrder && <p data-testid="mood-harness-route-order">최근 계산 순서: {lastRouteOrder}</p>}
          {lastChangePayload && <p className="break-all" data-testid="mood-harness-change-payload">최근 저장 요청: {lastChangePayload}</p>}
        </div>
      )}
      <MoodBookingShareCard data={shareData} />
      <div className="mx-auto mt-5 max-w-[430px] rounded-2xl bg-white/5 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-black text-white">양측 정산 확인 하네스</p>
            <p className="mt-0.5 text-[11px] text-white/70">운영자 제안 → MOOD 확인 → 완료 흐름</p>
          </div>
          <button type="button" onClick={() => { setActiveApproval(null); setFlowCompleted(false); setSettlementMode(null); setSettlementResult('흐름을 처음 상태로 되돌렸습니다.'); }} className="min-h-[44px] rounded-xl bg-white/10 px-3 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">초기화</button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2" aria-label="하네스 역할 선택">
          <button type="button" onClick={() => setRole('operator')} className={`min-h-[44px] rounded-xl px-3 text-xs font-black text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${role === 'operator' ? 'bg-violet-600' : 'bg-white/10'}`}>운영자 화면</button>
          <button type="button" onClick={() => setRole('client')} className={`min-h-[44px] rounded-xl px-3 text-xs font-black text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${role === 'client' ? 'bg-violet-600' : 'bg-white/10'}`}>MOOD 화면</button>
        </div>
        {role === 'client' && (
          <label className="mt-2 flex min-h-[44px] items-center gap-2 rounded-xl bg-white/10 px-3 text-xs text-white focus-within:ring-2 focus-within:ring-violet-300">
            <input type="checkbox" checked={clientCanApprove} onChange={(event) => setClientCanApprove(event.target.checked)} /> 지정 승인자 권한
          </label>
        )}
        {role === 'operator' && (
          <div className="mt-2 grid grid-cols-3 gap-2">
            <button type="button" onClick={() => { setFlowCompleted(false); setSettlementMode('initial'); }} className="min-h-[44px] rounded-xl bg-violet-600 px-2 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">최초 제안</button>
            <button type="button" onClick={() => { setFlowCompleted(true); setSettlementMode('correction'); }} className="min-h-[44px] rounded-xl bg-white/10 px-2 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">정정 제안</button>
            <button type="button" onClick={() => setReceiptOpen(true)} className="min-h-[44px] rounded-xl bg-white/10 px-2 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">완료 영수증</button>
          </div>
        )}
        {settlementResult && <p className="mt-2 text-xs text-emerald-300" role="status">{settlementResult}</p>}
        {role === 'operator' && settlementMode && (
          <MoodSettlementEditor
            key={settlementMode}
            booking={settlementMode === 'initial' ? flowBooking : { ...completedSettlementBooking, settlementApproval: activeApproval }}
            mode={settlementMode}
            onClose={() => setSettlementMode(null)}
            onCompleted={(message) => { setSettlementResult(message); setSettlementMode(null); }}
          />
        )}
        {activeApproval && (
          <MoodSettlementApprovalPanel
            booking={flowBooking}
            isAdmin={role === 'operator'}
            canApproveSettlement={role === 'client' && clientCanApprove}
            onEdit={(mode) => { setRole('operator'); setSettlementMode(mode); }}
            onResponded={(message) => setSettlementResult(message)}
          />
        )}
      </div>
      {changeOpen && (
        <MoodBookingChangeModal
          booking={changeBooking}
          balanceKRW={500000}
          onClose={() => setChangeOpen(false)}
          onChanged={() => undefined}
        />
      )}
      <MoodReceiptModal
        booking={receiptOpen
          ? flowCompleted && activeApproval?.status === 'approved'
            ? flowBooking
            : { ...completedSettlementBooking, settlementApproval: settlementApproval('approved', 1) }
          : null}
        onClose={() => setReceiptOpen(false)}
      />
    </main>
  );
}
