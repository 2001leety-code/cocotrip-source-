// AdminReconciliation — charter_custom_estimate 추정가 결제 booking 정산 관리.
// 2026-10-23 (PR-4): 재전송 후보 = 서버 판정(failed/unknown), 정산 대상은 알림 상태와 별도 구역.
// 2026-05-04: PR #224 의 admin-scan-suspect-bookings + admin-replay-booking-notifications
// 엔드포인트를 UI 로 wrap. 어드민이 ① 알림 누락 의심 booking 일괄 복구, ② estimate
// 결제 booking 정산 대상 리스트 확인 가능.
import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw, AlertTriangle, Send, ExternalLink, Loader2 } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';

/** 서버 판정(api/_shared/booking-notification-state.js) — 후보는 이 둘뿐. */
type CandidateState = 'failed' | 'unknown';

/** 처리기 필수 단계(processor-outcome REQUIRED_STEPS). email = 확인메일(바우처) 발송. */
const STEP_LABELS: Record<string, string> = { sheets: '시트', email: '확인메일', loyalty: '적립' };
/** 텔레그램은 부가 알림 — 판정과 별도로 보여 준다. */
const TELEGRAM_LABELS: Record<string, string> = { unknown: '결과 미상', inflight: '처리 중', missing: '기록 없음' };

interface SuspectBooking {
  state: CandidateState;
  missingSteps: string[];
  lastFailureReason: string | null;
  telegram?: 'complete' | 'unknown' | 'inflight' | 'missing';
  bookingId: string;
  bookingRef: string | null;
  productType: string | null;
  productLabel: string;
  amountKRW: number | null;
  amountUSD: string | null;
  userEmail: string | null;
  tourDate: string | null;
  provider: string | null;
  captureID: string | null;
  createdAt: string | null;
  requiresReconciliation: boolean;
}

interface CandidateScanData {
  candidates: SuspectBooking[];
  /** 정산 필요 booking — 알림 상태와 무관(서버가 따로 돌려준다). 구버전 응답이면 없음. */
  reconciliation?: SuspectBooking[];
  scanned: number;
  rangeSince: string;
  rangeUntil: string;
}

async function fetchCandidateScan(user: { getIdToken(): Promise<string> }): Promise<CandidateScanData> {
  const idToken = await user.getIdToken();
  const res = await fetch('/api/admin-scan-suspect-bookings', {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Scan failed');
  return json.data as CandidateScanData;
}

function friendlyScanError(rawMsg: string): string {
  if (rawMsg.includes('FAILED_PRECONDITION') || rawMsg.includes('index is currently building')) {
    return 'Firestore 인덱스 빌드 중입니다. 1~3분 후 새로고침 해주세요.';
  }
  if (rawMsg.includes('requires an index')) {
    return 'Firestore 인덱스 미생성. firebase deploy --only firestore:indexes 실행 또는 에러 메시지의 URL 클릭으로 자동 생성.';
  }
  return rawMsg;
}

export default function AdminReconciliation() {
  const { user, loading } = useAuth();
  const [scanLoading, setScanLoading] = useState(Boolean(user && !loading));
  const [replayLoading, setReplayLoading] = useState(false);
  const [candidates, setCandidates] = useState<SuspectBooking[]>([]);
  const [reconciliation, setReconciliation] = useState<SuspectBooking[]>([]);
  const [scanned, setScanned] = useState(0);
  const [rangeSince, setRangeSince] = useState<string>('');
  const [rangeUntil, setRangeUntil] = useState<string>('');
  // 2026-05-04: 쿼리 실패 (FAILED_PRECONDITION 인덱스 빌드 중 등) 와 정상 0건 결과를 UI 에서 구분.
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanSucceeded, setScanSucceeded] = useState(false);
  const [previousUser, setPreviousUser] = useState(user);
  const [previousAuthLoading, setPreviousAuthLoading] = useState(loading);
  if (previousUser !== user || previousAuthLoading !== loading) {
    setPreviousUser(user);
    setPreviousAuthLoading(loading);
    if (user && !loading) {
      setScanLoading(true);
      setScanError(null);
      setScanSucceeded(false);
    }
  }

  const fetchCandidates = useCallback(async () => {
    if (!user) return;
    setScanLoading(true);
    setScanError(null);
    try {
      const data = await fetchCandidateScan(user);
      setCandidates(data.candidates || []);
      setReconciliation(data.reconciliation || []);
      setScanned(data.scanned || 0);
      setRangeSince(data.rangeSince || '');
      setRangeUntil(data.rangeUntil || '');
      setScanSucceeded(true);
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : 'unknown';
      const friendlyMsg = friendlyScanError(rawMsg);
      setScanError(friendlyMsg);
      setScanSucceeded(false);
      toast.error('스캔 실패: ' + friendlyMsg);
    } finally {
      setScanLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user || loading) return;
    let cancelled = false;
    void fetchCandidateScan(user)
      .then((data) => {
        if (cancelled) return;
        setCandidates(data.candidates || []);
        setReconciliation(data.reconciliation || []);
        setScanned(data.scanned || 0);
        setRangeSince(data.rangeSince || '');
        setRangeUntil(data.rangeUntil || '');
        setScanSucceeded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        const rawMsg = err instanceof Error ? err.message : 'unknown';
        const friendlyMsg = friendlyScanError(rawMsg);
        setScanError(friendlyMsg);
        setScanSucceeded(false);
        toast.error('스캔 실패: ' + friendlyMsg);
      })
      .finally(() => {
        if (!cancelled) setScanLoading(false);
      });
    return () => { cancelled = true; };
  }, [user, loading]);

  // 일괄 재전송은 "실패" 만 — "결과 미상" 은 다시 보내면 손님에게 두 번 갈 수 있어 자동 대상이 아니다(수신 확인 필요).
  const failedCount = candidates.filter((c) => c.state === 'failed').length;
  const unknownCount = candidates.filter((c) => c.state === 'unknown').length;

  const handleReplayAll = async () => {
    if (!user || failedCount === 0) return;
    if (!confirm(`실패 ${failedCount}건의 미완료 단계를 재처리합니다(이미 완료된 단계는 처리기가 건너뜀). 결과 미상 ${unknownCount}건은 제외됩니다(수신 확인 필요). 진행할까요?`)) {
      return;
    }
    setReplayLoading(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin-scan-suspect-bookings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ dryRun: false }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Replay failed');
      const { replayed, failed, skipped } = json.data as { replayed: number; failed: number; skipped?: number };
      // 🔴 0건 재전송을 "성공" 으로 보이지 않는다. skipped = 실행 직전 상태가 바뀌어 보내지 않은 건(실패 아님).
      if (replayed > 0) toast.success(`${replayed}건 재전송 완료${failed > 0 ? ` · ${failed}건 미완료` : ''}`);
      else if (failed > 0) toast.error(`재전송 ${failed}건 모두 미완료 — 단계 상태를 확인하세요`);
      else if (skipped) toast.info(`재전송 대상 0건 — 실행 직전 상태가 바뀐 ${skipped}건은 건너뜀`);
      else toast.info('재전송 대상 0건');
      // 재스캔 — 완료로 판정된 booking 은 후보에서 빠진다
      void fetchCandidates();
    } catch (err) {
      toast.error('Replay 실패: ' + (err instanceof Error ? err.message : 'unknown'));
    } finally {
      setReplayLoading(false);
    }
  };

  const handleReplayOne = async (b: SuspectBooking) => {
    const { bookingId } = b;
    if (!user) return;
    // 결과 미상 = 보냈는지 모르거나 기록이 아예 없다. 격리 마커가 있는 단계만 처리기가 막고,
    //   기록이 없는 단계는 실제로 발송된다 → 고객 수신 여부를 확인한 뒤에만.
    if (b.state === 'unknown' && !confirm(
      `${b.bookingRef || bookingId} 고객 수신 여부를 확인했나요?\n\n• 결과 미상 격리 단계는 다시 보내지 않습니다\n• 기록이 없는 단계(확인메일 등)는 실제로 발송되어 중복될 수 있습니다\n\n진행할까요?`,
    )) {
      return;
    }
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin-replay-booking-notifications', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ bookingId }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Replay failed');
      // replayed = 처리기가 의미상 완료를 돌려줬을 때만 true — 아니면 "완료" 라고 하지 않는다.
      if (json.data.replayed) toast.success(`${bookingId.slice(0, 12)}… 알림 재전송 완료`);
      else if (json.data.reason === 'ALREADY_COMPLETE') toast.info(`${bookingId.slice(0, 12)}… 이미 처리 완료 — 재처리하지 않았습니다`);
      else toast.warning(`${bookingId.slice(0, 12)}… 재처리 미완료(${json.data.outcome}) — 단계 상태·고객 수신을 확인하세요`);
      void fetchCandidates();
    } catch (err) {
      toast.error('Replay 실패: ' + (err instanceof Error ? err.message : 'unknown'));
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">로딩...</div>;
  }

  return (
    <div className="min-h-screen bg-[#faf9f6] p-4 sm:p-6">
      <Toaster position="top-center" richColors />
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link to="/admin" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 hover:border-amber-500/50 text-sm font-medium transition-all duration-200 min-h-[44px]">
            <ArrowLeft className="w-4 h-4 shrink-0" />
            <span>어드민 홈으로</span>
          </Link>
        </div>

        <div>
          <h1 className="text-2xl font-bold text-[#1a1a2e]">정산·복구 관리</h1>
          <p className="text-sm text-gray-500 mt-1">
            추정가 결제 booking 사후 정산 + 알림 누락 booking 복구
          </p>
        </div>

        {/* 스캔 헤더 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              <h2 className="text-lg font-bold text-[#1a1a2e]">의심 booking 스캔</h2>
            </div>
            <button
              type="button"
              onClick={fetchCandidates}
              disabled={scanLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#7C5CFC] bg-[#7C5CFC]/5 rounded-lg hover:bg-[#7C5CFC]/10 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${scanLoading ? 'animate-spin' : ''}`} />
              새로고침
            </button>
          </div>
          <div className="text-xs text-gray-500 mb-4 space-y-0.5">
            {/* 2026-10-23 (PR-4): 판정 = 처리기 필수 단계(시트·확인메일·적립) 기록 + 재시도 문서. 텔레그램은 따로 표시. provider 무관. */}
            <p>대상: 기간 안 CONFIRMED 최신 {scanned}건 중 필수 단계(시트·확인메일·적립)가 <b>실패</b>했거나 <b>결과 미상</b>(근거 없음 포함)인 booking — 완료·정상 생략·생성 24시간 이내 처리 중·테스트 결제는 제외</p>
            <p>범위: {rangeSince} ~ {rangeUntil}</p>
            <p>스캔: {scanned}건 / 후보: <strong>{candidates.length}건</strong> (실패 {failedCount} · 결과 미상 {unknownCount})</p>
          </div>

          {failedCount > 0 && (
            <button
              type="button"
              onClick={handleReplayAll}
              disabled={replayLoading}
              className="flex items-center gap-2 px-4 py-2 bg-[#B668FC] text-white text-sm font-bold rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              {replayLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {replayLoading ? '재처리 중...' : `실패 ${failedCount}건 미완료 단계 재처리`}
            </button>
          )}
        </div>

        {/* 후보 리스트 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {scanLoading ? (
            <div className="p-12 text-center text-gray-400 text-sm">스캔 중...</div>
          ) : scanError ? (
            // 2026-05-04: 쿼리 실패 — 빈 결과 메시지 대신 명시적 에러 + 새로고침 가이드.
            <div className="p-12 text-center">
              <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
              <p className="text-sm text-amber-700 font-bold mb-1">스캔 실패</p>
              <p className="text-xs text-gray-500 max-w-md mx-auto leading-relaxed">{scanError}</p>
            </div>
          ) : !scanSucceeded ? (
            <div className="p-12 text-center text-gray-400 text-sm">
              "새로고침" 버튼을 눌러 스캔을 시작하세요.
            </div>
          ) : candidates.length === 0 ? (
            // 조회 한도 안의 결과일 뿐 — "모두 정상" 이라고 단정하지 않는다.
            <div className="p-12 text-center text-gray-400 text-sm">
              조회 {scanned}건 중 재전송 후보 0건
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                    <th className="text-left px-5 py-3 font-medium">상태</th>
                    <th className="text-left px-5 py-3 font-medium">시각</th>
                    <th className="text-left px-5 py-3 font-medium">예약번호</th>
                    <th className="text-left px-5 py-3 font-medium">상품</th>
                    <th className="text-left px-5 py-3 font-medium">투어일</th>
                    <th className="text-right px-5 py-3 font-medium">금액</th>
                    <th className="text-left px-5 py-3 font-medium">고객</th>
                    <th className="text-center px-5 py-3 font-medium">정산</th>
                    <th className="text-center px-5 py-3 font-medium">액션</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {candidates.map((b) => (
                    <tr key={b.bookingId} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-5 py-3 text-xs" title={b.lastFailureReason || undefined}>
                        {b.state === 'unknown' ? (
                          <span className="inline-block px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">결과 미상</span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[10px] font-bold">실패</span>
                        )}
                        {(b.missingSteps || []).length > 0 && (
                          <p className="text-[10px] text-gray-500 mt-1">{b.missingSteps.map((s) => STEP_LABELS[s] || s).join(' · ')}</p>
                        )}
                        {b.state === 'unknown' && <p className="text-[10px] text-amber-700 mt-1">수신 확인 필요</p>}
                        {b.telegram && b.telegram !== 'complete' && (
                          <p className="text-[10px] text-gray-400 mt-1">텔레그램: {TELEGRAM_LABELS[b.telegram] || b.telegram}</p>
                        )}
                      </td>
                      <td className="px-5 py-3 text-xs text-gray-500 font-mono">
                        {b.createdAt ? new Date(b.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-'}
                      </td>
                      <td className="px-5 py-3 text-xs font-mono text-gray-600">{b.bookingRef || b.bookingId.slice(0, 12)}</td>
                      <td className="px-5 py-3 text-sm">{b.productLabel}</td>
                      <td className="px-5 py-3 text-xs text-gray-600">{b.tourDate || '-'}</td>
                      <td className="px-5 py-3 text-right text-sm font-bold text-emerald-600">
                        ₩{(b.amountKRW || 0).toLocaleString('ko-KR')}
                      </td>
                      <td className="px-5 py-3 text-xs text-gray-600 max-w-[160px] truncate">{b.userEmail || '-'}</td>
                      <td className="px-5 py-3 text-center">
                        {b.requiresReconciliation && (
                          <span className="inline-block px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">
                            정산 필요
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-center">
                        <button
                          type="button"
                          onClick={() => handleReplayOne(b)}
                          className="text-xs text-[#7C5CFC] hover:underline inline-flex items-center gap-1"
                        >
                          <ExternalLink className="w-3 h-3" /> 알림 재전송
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 정산 필요 — 알림 상태와 무관(알림이 정상이어도 여기 남는다). */}
        {scanSucceeded && !scanError && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5" data-testid="reconciliation-section">
            <h2 className="text-lg font-bold text-[#1a1a2e] mb-1">정산 필요 booking</h2>
            <p className="text-xs text-gray-500 mb-3">추정가 결제 등 사후 정산 대상 — 조회 {scanned}건 기준, 알림 상태와 무관</p>
            {reconciliation.length === 0 ? (
              <p className="text-sm text-gray-400">조회 {scanned}건 중 정산 대상 0건</p>
            ) : (
              <ul className="divide-y divide-gray-50 text-sm">
                {reconciliation.map((b) => (
                  <li key={b.bookingId} className="py-2 flex flex-wrap items-center gap-3">
                    <span className="text-xs font-mono text-gray-600">{b.bookingRef || b.bookingId.slice(0, 12)}</span>
                    <span>{b.productLabel}</span>
                    <span className="text-xs text-gray-600">{b.tourDate || '-'}</span>
                    <span className="font-bold text-emerald-600">₩{(b.amountKRW || 0).toLocaleString('ko-KR')}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* 가이드 */}
        <div className="bg-blue-50 rounded-xl p-4 text-xs text-blue-900 space-y-1">
          <p className="font-bold">사용 방법</p>
          <ul className="list-disc pl-5 space-y-0.5">
            <li>"미완료 단계 재처리" — <b>실패</b> 후보만 재처리(이미 완료된 단계는 처리기가 건너뜀, 1초 간격 rate-limit). 실행 직전 최신 상태로 다시 확인</li>
            <li>"결과 미상" — 보냈는지 알 수 없거나 기록이 없는 단계가 있어 자동 대상에서 제외. <b>고객 수신 확인 필요</b> — 단건 재처리에서 <b>격리 마커가 있는 단계만</b> 재발송이 막히고, <b>기록이 없는 단계는 실제로 발송될 수 있음</b>(중복 주의, 실행 전 확인창)</li>
            <li>"알림 재전송" — 단건 복구. 이미 완료된 예약은 재처리하지 않음. 처리기가 완료를 돌려준 booking 만 replayedAt 으로 표시되어 다음 스캔에서 제외</li>
            <li>"정산 필요" 배지 — charter_custom_estimate (추정가) booking. 운행 후 실 거리 ±10% 이상 차이 시 admin 수동 정산</li>
            <li>스캔 범위는 PR #221~#223 사이 (~24시간) 의심 구간. 필요 시 endpoint POST body 의 since/until 로 조정 가능</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
