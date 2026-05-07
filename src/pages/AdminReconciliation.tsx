// AdminReconciliation — charter_custom_estimate 추정가 결제 booking 정산 관리.
// 2026-05-04: PR #224 의 admin-scan-suspect-bookings + admin-replay-booking-notifications
// 엔드포인트를 UI 로 wrap. 어드민이 ① 알림 누락 의심 booking 일괄 복구, ② estimate
// 결제 booking 정산 대상 리스트 확인 가능.
import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw, AlertTriangle, Send, ExternalLink, Loader2 } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';

interface SuspectBooking {
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

export default function AdminReconciliation() {
  const { user, loading } = useAuth();
  const [scanLoading, setScanLoading] = useState(false);
  const [replayLoading, setReplayLoading] = useState(false);
  const [candidates, setCandidates] = useState<SuspectBooking[]>([]);
  const [scanned, setScanned] = useState(0);
  const [rangeSince, setRangeSince] = useState<string>('');
  const [rangeUntil, setRangeUntil] = useState<string>('');
  // 2026-05-04: 쿼리 실패 (FAILED_PRECONDITION 인덱스 빌드 중 등) 와 정상 0건 결과를 UI 에서 구분.
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanSucceeded, setScanSucceeded] = useState(false);

  const fetchCandidates = useCallback(async () => {
    if (!user) return;
    setScanLoading(true);
    setScanError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin-scan-suspect-bookings', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Scan failed');
      setCandidates(json.data.candidates || []);
      setScanned(json.data.scanned || 0);
      setRangeSince(json.data.rangeSince || '');
      setRangeUntil(json.data.rangeUntil || '');
      setScanSucceeded(true);
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : 'unknown';
      // FAILED_PRECONDITION 은 인덱스 빌드 중일 때 발생. 친화 메시지로 매핑.
      const friendlyMsg = rawMsg.includes('FAILED_PRECONDITION') || rawMsg.includes('index is currently building')
        ? 'Firestore 인덱스 빌드 중입니다. 1~3분 후 새로고침 해주세요.'
        : rawMsg.includes('requires an index')
        ? 'Firestore 인덱스 미생성. firebase deploy --only firestore:indexes 실행 또는 에러 메시지의 URL 클릭으로 자동 생성.'
        : rawMsg;
      setScanError(friendlyMsg);
      setScanSucceeded(false);
      toast.error('스캔 실패: ' + friendlyMsg);
    } finally {
      setScanLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user && !loading) fetchCandidates();
  }, [user, loading, fetchCandidates]);

  const handleReplayAll = async () => {
    if (!user || candidates.length === 0) return;
    if (!confirm(`${candidates.length}개 booking 의 알림을 일괄 재전송합니다. 텔레그램·이메일·Sheets 모두 발송됩니다. 진행할까요?`)) {
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
      toast.success(`${json.data.replayed}/${json.data.candidatesCount} 성공 · ${json.data.failed} 실패`);
      // 재스캔 — replayedAt 기록된 booking 은 후보에서 제거됨
      void fetchCandidates();
    } catch (err) {
      toast.error('Replay 실패: ' + (err instanceof Error ? err.message : 'unknown'));
    } finally {
      setReplayLoading(false);
    }
  };

  const handleReplayOne = async (bookingId: string) => {
    if (!user) return;
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
      toast.success(`${bookingId.slice(0, 12)}… 알림 재전송 완료`);
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
            <p>대상: status=CONFIRMED + provider=braintree + replayedAt 미기록 booking</p>
            <p>범위: {rangeSince} ~ {rangeUntil}</p>
            <p>스캔: {scanned}건 / 후보: <strong>{candidates.length}건</strong></p>
          </div>

          {candidates.length > 0 && (
            <button
              type="button"
              onClick={handleReplayAll}
              disabled={replayLoading}
              className="flex items-center gap-2 px-4 py-2 bg-[#B668FC] text-white text-sm font-bold rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              {replayLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {replayLoading ? '재전송 중...' : `${candidates.length}건 일괄 재전송`}
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
            <div className="p-12 text-center text-gray-400 text-sm">
              현재 의심 booking 없음 — 모든 알림이 정상 전송됨
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
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
                          onClick={() => handleReplayOne(b.bookingId)}
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

        {/* 가이드 */}
        <div className="bg-blue-50 rounded-xl p-4 text-xs text-blue-900 space-y-1">
          <p className="font-bold">사용 방법</p>
          <ul className="list-disc pl-5 space-y-0.5">
            <li>"일괄 재전송" — 모든 후보 booking 의 텔레그램·이메일·Sheets·PDF 알림 한 번에 재발송 (1초 간격 rate-limit)</li>
            <li>"알림 재전송" — 단건 복구. 한 번 재전송된 booking 은 replayedAt 으로 표시되어 다음 스캔에서 제외</li>
            <li>"정산 필요" 배지 — charter_custom_estimate (추정가) booking. 운행 후 실 거리 ±10% 이상 차이 시 admin 수동 정산</li>
            <li>스캔 범위는 PR #221~#223 사이 (~24시간) 의심 구간. 필요 시 endpoint POST body 의 since/until 로 조정 가능</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
