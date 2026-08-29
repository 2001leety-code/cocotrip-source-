import { useEffect, useRef, useState } from 'react';
import {
  MoodBookingChangeModal,
  type BookingChangeApprovalSummary,
  type ChangeableMoodBooking,
} from '@/components/mood/MoodBookingChangeModal';
import { MoodBookingCopyButton, MoodBookingShareCard } from '@/components/mood/MoodBookingShareCard';
import {
  MoodSettlementApprovalPanel,
  MoodSettlementEditor,
  type SettlementApprovalSummary,
  type SettlementBooking,
  type SettlementMode,
} from '@/components/mood/MoodSettlementEditor';
import { MoodReceiptModal } from '@/components/mood/MoodReceiptModal';
import { MoodBookingBlockManager } from '@/components/mood/MoodBookingBlockManager';
import { MoodQuoteBuilder } from '@/components/mood/MoodQuoteBuilder';
import type { MoodBookingShareData } from '@/lib/moodBookingShare';
import type { MoodBookingAvailability, MoodBookingOpenException } from '@/lib/moodBookingAvailability';
import type { VehicleQuotePreviewRequest, VehicleQuoteProfile } from '@/lib/vehicleQuote';

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
  routeSnapshot: {
    km: 64,
    tollKRW: 8000,
    durationMin: 85,
    points,
    path: shareData.route?.path || [],
  },
};

const initialBookingAvailability: MoodBookingAvailability = {
  schemaVersion: 1,
  revision: 3,
  rules: [{
    id: 'demo-saturday-evening-block',
    enabled: true,
    startDate: '2026-08-01',
    endDate: '2026-12-31',
    weekdays: [6],
    mode: 'starts_from',
    startTime: '18:00',
    reason: '토요일 저녁 배차 조정',
  }],
  exceptions: [],
};

const actualTolls = [
  { label: '서울 → 평택', date: '2026-08-20 11:23:47', amountKRW: 5100, status: 'pending' as const, includedInSettlement: true, evidenceRef: '하이패스 카드 캡처 2/2' },
  { label: '평택 → 송악', date: '2026-08-20 11:46:50', amountKRW: 2300, status: 'pending' as const, includedInSettlement: true, evidenceRef: '하이패스 카드 캡처 2/2' },
  { label: '당진 → 서산', date: '2026-08-20 12:27:13', amountKRW: 1700, status: 'pending' as const, includedInSettlement: true, evidenceRef: '하이패스 카드 캡처 2/2' },
  { label: '서산 → 당진', date: '2026-08-20 16:25:56', amountKRW: 1700, status: 'pending' as const, includedInSettlement: true, evidenceRef: '하이패스 카드 캡처 2/2' },
  { label: '송악 → 서울', date: '2026-08-20 18:32:09', amountKRW: 5300, status: 'pending' as const, includedInSettlement: true, evidenceRef: '하이패스 카드 캡처 2/2' },
  { label: '충전(제외내역)', date: '2026-08-20 15:27:25', amountKRW: 10000, status: 'confirmed' as const, includedInSettlement: false, evidenceRef: '하이패스 카드 캡처 2/2' },
];

const harnessQuoteProfiles: VehicleQuoteProfile[] = [
  {
    id: 'mood-default',
    version: 1,
    companyName: 'MOOD',
    hourlyRateKRW: 30000,
    minMinutes: 180,
    maxMinutes: 900,
    billingIncrementMinutes: 1,
    distanceThresholdMeters: 50000,
    distanceRateKRWPerKm: 600,
    distanceBillingMode: 'all_distance_when_threshold_reached',
    vatBasisPoints: 1000,
    tollPolicy: 'route_estimate',
    parkingPolicy: 'manual',
    overtimeRateKRW: 33000,
    overtimeIncludesVat: true,
    documentTitle: '전용 차량 일정 및 예상 견적',
    footer: '실제 운행 결과에 따라 이용시간·거리·통행료·주차비가 달라질 수 있습니다.',
    builtIn: true,
  },
  {
    id: 'partner-demo',
    version: 3,
    companyName: '파트너 차량 예시',
    hourlyRateKRW: 35000,
    minMinutes: 240,
    maxMinutes: 720,
    billingIncrementMinutes: 60,
    distanceThresholdMeters: 80000,
    distanceRateKRWPerKm: 700,
    distanceBillingMode: 'excess_only',
    vatBasisPoints: 1000,
    tollPolicy: 'manual',
    parkingPolicy: 'manual',
    overtimeRateKRW: 38500,
    overtimeIncludesVat: true,
    documentTitle: '파트너 전용 차량 견적',
    footer: '파트너 업체 테스트 프로필입니다.',
  },
];

const harnessParsedQuote = {
  serviceDate: '2026-09-01',
  startTime: '08:00',
  endTime: '20:00',
  departureAddress: '서울특별시 강남구 신사동 643-18',
  returnAddress: '서울특별시 강남구 신사동 643-18',
  needsConfirm: true,
  conflicts: [],
  warnings: ['붙여넣은 일정의 주소와 시간을 직접 확인해 주세요.'],
  stops: [
    {
      clientId: 'quote-stop-1', order: 1, arrivalTime: '10:00', departureTime: '12:00',
      name: '기원 위스키 증류소', purpose: '위스키 협업 관련 조사 및 미팅',
      sourceRegion: '남양주',
      roadAddress: '경기도 남양주시 화도읍 녹촌로 259-18', jibunAddress: '경기도 남양주시 화도읍 녹촌리 384-20',
      naverMapUrl: 'https://naver.me/Fx2gIj9B', optional: false, includeInRoute: true, addressVerified: false,
      lat: 37.661, lng: 127.352,
    },
    {
      clientId: 'quote-stop-2', order: 2, arrivalTime: '13:00', departureTime: '14:00',
      name: '왕십리 곱창거리', purpose: '소곱창 점심 식사',
      sourceRegion: '서울',
      roadAddress: '서울특별시 성동구 행당동', jibunAddress: '서울특별시 성동구 행당동',
      naverMapUrl: 'https://naver.me/FM9dQBOv', optional: false, includeInRoute: true, addressVerified: false,
      lat: 37.561, lng: 127.038,
    },
    {
      clientId: 'quote-stop-3', order: 3, arrivalTime: '14:30', departureTime: '16:00',
      name: '더 루프', purpose: '카펠라 서울 레지던스 클럽 4층 미팅',
      sourceRegion: '서울',
      roadAddress: '서울특별시 용산구 독서당로35길 4, 4층', jibunAddress: '서울특별시 용산구 한남동 60-24',
      naverMapUrl: 'https://naver.me/5eDY0Qr4', optional: false, includeInRoute: true, addressVerified: false,
      lat: 37.535, lng: 127.01,
    },
    {
      clientId: 'quote-stop-4', order: 4, arrivalTime: '17:00', departureTime: '19:00',
      name: '고척스카이돔', purpose: '야구 경기 관람',
      sourceRegion: '서울',
      roadAddress: '서울특별시 구로구 경인로 430', jibunAddress: '서울특별시 구로구 고척동 63-6',
      naverMapUrl: 'https://naver.me/F1a5w2dx', optional: false, includeInRoute: true, addressVerified: false,
      lat: 37.499, lng: 126.867,
    },
  ],
};

function quoteHarnessDocument(
  request: VehicleQuotePreviewRequest,
  breakdown: { timeFeeKRW: number; distanceFeeKRW: number; taxableSupplyKRW: number; vatKRW: number; tollKRW: number; parkingKRW: number; totalKRW: number },
): string {
  const confirmRequired = '확인 필요';
  const stopText = request.stops.map((stop) => [
    `${stop.arrivalTime || confirmRequired} – ${stop.name || confirmRequired}`,
    stop.purpose || confirmRequired,
    stop.name || confirmRequired,
    stop.roadAddress || confirmRequired,
    `지번 주소: ${stop.jibunAddress || confirmRequired}`,
    '',
    '네이버 지도:',
    stop.naverMapUrl || confirmRequired,
  ].join('\n')).join('\n\n');
  const distanceKm = Number(request.manualDistanceKm || 0);
  const totalHours = request.totalMinutes / 60;
  return [
    '[전용 차량 일정 및 예상 견적]',
    '',
    `이용일: ${request.serviceDate}`,
    `예상 차량 이용시간: ${totalHours}시간`,
    `예상 이용시간: ${request.startTime} ~ ${request.endTime}`,
    '',
    `${request.startTime} – 차량 탑승 및 출발`,
    request.departureAddress || confirmRequired,
    '',
    stopText,
    '',
    `${request.endTime}경 – 복귀 장소 도착 및 일정 종료`,
    request.returnAddress || confirmRequired,
    '',
    '[MOOD 차량 예상 견적]',
    '',
    `차량 이용시간: ${totalHours}시간 × 시간당 30,000원 = ${breakdown.timeFeeKRW.toLocaleString('ko-KR')}원`,
    `예상 총 운행거리: 약 ${distanceKm}km`,
    `거리 요금: ${distanceKm}km × 600원 = ${breakdown.distanceFeeKRW.toLocaleString('ko-KR')}원`,
    `차량 이용요금 공급가액: ${breakdown.taxableSupplyKRW.toLocaleString('ko-KR')}원`,
    `부가세 10%: ${breakdown.vatKRW.toLocaleString('ko-KR')}원`,
    `통행료 및 주차비 예상액: ${(breakdown.tollKRW + breakdown.parkingKRW).toLocaleString('ko-KR')}원`,
    `부가세·통행료·주차비 포함 최종 예상 금액: ${breakdown.totalKRW.toLocaleString('ko-KR')}원`,
    '',
    '※ 실제 이용시간, 운행거리, 통행료 또는 주차비가 예상 범위를 초과하면 추가 금액이 발생할 수 있습니다.',
    '※ 예정된 이용시간을 초과하는 경우 부가세를 포함해 시간당 33,000원의 추가 차량 이용요금이 발생합니다.',
  ].join('\n');
}

const HARNESS_ACCEPTANCE_BREAKDOWN = Object.freeze({
  currency: 'KRW' as const,
  timeMinutes: 720,
  billableMinutes: 720,
  timeFeeKRW: 360000,
  distanceFeeKRW: 75000,
  taxableSupplyKRW: 435000,
  vatKRW: 43500,
  tollKRW: 20000,
  parkingKRW: 10000,
  incidentalsKRW: 30000,
  totalKRW: 508500,
  overtimeRateKRW: 33000,
});

/**
 * 오프라인 하네스는 가격 계산기가 아니다. 서버가 이미 계산해 돌려준 것으로 간주하는
 * 승인 예시(12시간·125km·실비 30,000원) 한 건만 고정 응답한다.
 */
function quoteHarnessPreview(request: VehicleQuotePreviewRequest) {
  const distanceKm = Number(request.manualDistanceKm || 0);
  const breakdown = HARNESS_ACCEPTANCE_BREAKDOWN;
  return {
    profile: harnessQuoteProfiles[0],
    route: {
      source: request.routeMode,
      distanceMeters: Math.round(distanceKm * 1000),
      distanceKm,
      durationMinutes: 180,
      tollKRW: breakdown.tollKRW,
    },
    breakdown,
    documentText: quoteHarnessDocument(request, breakdown),
    warnings: request.routeMode === 'manual' ? ['예상 운행거리를 관리자가 직접 입력한 견적입니다.'] : [],
    quoteSnapshot: { profileId: request.profileId, profileVersion: request.profileVersion || 1 },
  };
}

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
  const [quoteHarnessReady, setQuoteHarnessReady] = useState(false);
  const [lastQuoteRequest, setLastQuoteRequest] = useState('');
  const [bookingAvailability, setBookingAvailability] = useState(initialBookingAvailability);
  const bookingAvailabilityRef = useRef(initialBookingAvailability);
  const [changeOpen, setChangeOpen] = useState(false);
  const [lastRouteOrder, setLastRouteOrder] = useState('');
  const [lastChangePayload, setLastChangePayload] = useState('');
  const [changeRole, setChangeRole] = useState<'operator' | 'approver'>('operator');
  const [changeApproval, setChangeApproval] = useState<BookingChangeApprovalSummary | null>(null);
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
      if (url.includes('/api/mood-quote-profiles')) {
        const method = String(init?.method || 'GET').toUpperCase();
        if (method === 'POST') {
          const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
          const saved = {
            ...harnessQuoteProfiles[0],
            ...(body.profile || {}),
            id: String(body.profile?.id || 'company-harness'),
            version: Number(body.expectedVersion || 0) + 1,
          };
          return new Response(JSON.stringify({ ok: true, data: { profile: saved } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({
          ok: true,
          data: { profiles: harnessQuoteProfiles, builtInProfileId: 'mood-default' },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/mood-quote-parse')) {
        return new Response(JSON.stringify({ ok: true, data: harnessParsedQuote }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/mood-quote-preview')) {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) as VehicleQuotePreviewRequest : {} as VehicleQuotePreviewRequest;
        setLastQuoteRequest(JSON.stringify({
          profileId: body.profileId,
          totalMinutes: body.totalMinutes,
          routeMode: body.routeMode,
          manualDistanceKm: body.manualDistanceKm,
          manualTollKRW: body.manualTollKRW,
          parkingKRW: body.parkingKRW,
          stopCount: Array.isArray(body.stops) ? body.stops.length : 0,
        }));
        const isAcceptanceFixture = body.totalMinutes === 720
          && body.routeMode === 'manual'
          && Number(body.manualDistanceKm) === 125
          && Number(body.manualTollKRW) === 20000
          && Number(body.parkingKRW) === 10000;
        if (!isAcceptanceFixture) {
          return new Response(JSON.stringify({ ok: false, error: 'HARNESS_FIXTURE_MISMATCH' }), {
            status: 422,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ ok: true, data: quoteHarnessPreview(body) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/place-search')) {
        return new Response(JSON.stringify({
          items: [{
            name: '기원 위스키 증류소',
            roadAddress: '경기도 남양주시 화도읍 녹촌로 259-18',
            address: '경기도 남양주시 화도읍 녹촌리 384-20',
            lat: 37.661,
            lng: 127.352,
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/mood-booking-blocks')) {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
        const current = bookingAvailabilityRef.current;
        let nextRules = current.rules;
        let nextExceptions = current.exceptions;
        if (body.action === 'upsert' && body.rule) {
          nextRules = current.rules.some((rule) => rule.id === body.rule.id)
            ? current.rules.map((rule) => rule.id === body.rule.id ? body.rule : rule)
            : [...current.rules, body.rule];
        }
        if (body.action === 'delete') {
          nextRules = current.rules.filter((rule) => rule.id !== body.ruleId);
          nextExceptions = current.exceptions
            .map((exception) => ({ ...exception, ruleIds: exception.ruleIds.filter((ruleId) => ruleId !== body.ruleId) }))
            .filter((exception) => exception.ruleIds.length > 0);
        }
        if (body.action === 'set_all_enabled') nextRules = current.rules.map((rule) => ({ ...rule, enabled: Boolean(body.enabled) }));
        if (body.action === 'upsert_exception' && body.exception) {
          const exception: MoodBookingOpenException = {
            ...body.exception,
            ruleIds: current.rules
              .filter((rule) => body.exception.startDate <= rule.endDate && body.exception.endDate >= rule.startDate)
              .map((rule) => rule.id),
          };
          nextExceptions = current.exceptions.some((item) => item.id === exception.id)
            ? current.exceptions.map((item) => item.id === exception.id ? exception : item)
            : [...current.exceptions, exception];
        }
        if (body.action === 'delete_exception') nextExceptions = current.exceptions.filter((item) => item.id !== body.exceptionId);
        const next: MoodBookingAvailability = {
          schemaVersion: 1,
          revision: current.revision + 1,
          rules: nextRules,
          exceptions: nextExceptions,
        };
        bookingAvailabilityRef.current = next;
        setBookingAvailability(next);
        return new Response(JSON.stringify({ ok: true, data: { bookingAvailability: next } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
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
        const origin = body.booking?.origin || '';
        const waypoints = Array.isArray(body.booking?.waypoints) ? body.booking.waypoints : [];
        const destination = body.booking?.destination || '';
        const order = [origin, ...waypoints, destination];
        const originalOrder = waypoints.join('|') === '성수동|잠실|강남역';
        const durationHours = Number(body.booking?.durationHours || changeBooking.durationHours);
        const changedFields: string[] = [];
        if (String(body.booking?.date || '') !== changeBooking.date) changedFields.push('date');
        if (String(body.booking?.startTime || '') !== changeBooking.startTime) changedFields.push('startTime');
        if (durationHours !== changeBooking.durationHours) changedFields.push('durationHours');
        if (String(body.booking?.serviceType || '') !== changeBooking.serviceType) changedFields.push('serviceType');
        if (
          origin !== changeBooking.breakdown?.origin
          || destination !== changeBooking.breakdown?.destination
          || !originalOrder
        ) changedFields.push('waypoints');
        if (String(body.booking?.note || '') !== String(changeBooking.note || '')) changedFields.push('note');
        if (String(body.booking?.influencerName || '') !== String(changeBooking.influencerName || '')) changedFields.push('influencerName');
        setLastChangePayload(JSON.stringify({
          action: body.action,
          quoteId: body.quoteId || null,
          durationHours: body.booking?.durationHours,
          origin,
          waypoints,
          destination,
          courseMoodPercentages: body.booking?.courseMoodPercentages || [],
        }));
        if (body.action === 'preview') {
          setLastRouteOrder(order.join(' → '));
          const amountKRW = 100000 + Math.max(0, durationHours - 4) * 20000 + (originalOrder ? 0 : 11000);
          return new Response(JSON.stringify({
            ok: true,
            data: {
              preview: true,
              quoteId: 'b'.repeat(64),
              expectedRevision: 2,
              currency: 'KRW',
              expiresAt: Date.now() + 15 * 60 * 1000,
              oldAmountKRW: 100000,
              amountKRW,
              adjustmentKRW: amountKRW - 100000,
              balanceKRW: 500000 - (amountKRW - 100000),
              changedFields,
              breakdown: {
                origin,
                waypoints,
                destination,
                km: originalOrder ? 64 : 71,
                tollKRW: originalOrder ? 8000 : 9000,
              },
              routeSnapshot: {
                km: originalOrder ? 64 : 71,
                tollKRW: originalOrder ? 8000 : 9000,
                durationMin: originalOrder ? 85 : 97,
                points,
                path: shareData.route?.path,
              },
            },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (body.action === 'propose') {
          const amountKRW = 100000 + Math.max(0, durationHours - 4) * 20000 + (originalOrder ? 0 : 11000);
          setChangeApproval({
            status: 'awaiting_mood',
            quoteId: String(body.quoteId || ''),
            proposalRevision: 2,
            proposedByEmail: 'operator@cocotrip.test',
            proposedAt: Date.now(),
            reason: String(body.reason || ''),
            currency: 'KRW',
            oldAmountKRW: 100000,
            amountKRW,
            adjustmentKRW: amountKRW - 100000,
            balanceBeforeKRW: 500000,
            balanceAfterKRW: 500000 - (amountKRW - 100000),
            changedFields,
            proposedBooking: body.booking,
            breakdown: { origin, waypoints, destination },
            routeSnapshot: null,
          });
          return new Response(JSON.stringify({ ok: true, data: { status: 'awaiting_mood', quoteId: body.quoteId, proposalRevision: 2 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (body.action === 'approve' || body.action === 'withdraw') {
          setChangeApproval(null);
          return new Response(JSON.stringify({ ok: true, data: { status: body.action === 'approve' ? 'approved' : 'withdrawn', revision: 4 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
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
    // 하위 MoodQuoteBuilder의 profile effect보다 먼저 mock을 설치한 뒤 렌더한다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuoteHarnessReady(true);
    return () => { window.fetch = originalFetch; };
  }, []);

  return (
    <main className="min-h-screen bg-[#090510] px-3 py-5 sm:px-6">
      <div className="mx-auto mb-4 max-w-[430px] text-white">
        <MoodBookingBlockManager
          availability={bookingAvailability}
          onUpdated={(next) => { bookingAvailabilityRef.current = next; setBookingAvailability(next); }}
          onReload={() => undefined}
        />
      </div>
      <div className="mx-auto mb-4 flex max-w-[430px] gap-2">
        <MoodBookingCopyButton data={shareData} />
        <button type="button" onClick={() => setChangeOpen(true)} className="min-h-11 shrink-0 rounded-xl bg-white/10 px-4 text-sm font-black text-white">예약 변경</button>
      </div>
      <div className="mx-auto mb-4 grid max-w-[430px] grid-cols-2 gap-2">
        <button type="button" onClick={() => setChangeRole('operator')} className="min-h-11 rounded-xl bg-violet-500/20 px-3 text-xs font-black text-white">변경 운영자 보기</button>
        <button type="button" onClick={() => setChangeRole('approver')} className="min-h-11 rounded-xl bg-violet-500/20 px-3 text-xs font-black text-white">MOOD 승인자 보기</button>
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
          booking={{ ...changeBooking, revision: changeApproval ? changeApproval.proposalRevision : changeBooking.revision, bookingChangeApproval: changeApproval }}
          bookingAvailability={initialBookingAvailability}
          balanceKRW={500000}
          isAdmin={changeRole === 'operator'}
          canApprove={changeRole === 'approver'}
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
      {quoteHarnessReady && (
        <section className="mx-auto mt-6 w-full max-w-[760px]" data-testid="mood-quote-harness">
          <MoodQuoteBuilder />
          {lastQuoteRequest && (
            <p className="mt-2 break-all rounded-xl bg-white/5 px-3 py-2 text-[10px] text-white/65" data-testid="mood-harness-quote-request">
              최근 견적 요청: {lastQuoteRequest}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
