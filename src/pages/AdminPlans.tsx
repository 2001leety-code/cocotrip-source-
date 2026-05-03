// AdminPlans — admin 이 사용자 AI 플랜을 검색·조회·revisionCredits 조정.
// 2026-05-04: Q4 — /api/admin-plan-lookup 엔드포인트 wrap. CS 대응 + 학습 루프 신고 대응.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Search, Plus, Minus, ExternalLink, Loader2, AlertTriangle } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';

interface PlanSummary {
  planId: string;
  userEmail: string | null;
  title: string | null;
  days: number | null;
  revisionCredits: number;
  paymentStatus: string | null;
  transactionId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  language: string | null;
  complaintsCount: number;
}

interface ComplaintEntry {
  id: string;
  reason: string;
  detail: string;
  status: string;
  userEmail: string | null;
  createdAt: string | null;
}

interface PlanDetail extends PlanSummary {
  itinerary: unknown;
  complaints: ComplaintEntry[];
}

const REASON_LABELS_KO: Record<string, string> = {
  wrong_address: '주소 오류',
  closed_restaurant: '폐업·운영 종료',
  inefficient_route: '동선 비효율',
  wrong_timing: '시간 부정확',
  other: '기타',
};

export default function AdminPlans() {
  const { user, loading } = useAuth();
  const [searchEmail, setSearchEmail] = useState('');
  const [searchPlanId, setSearchPlanId] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<PlanDetail | null>(null);
  const [creditDelta, setCreditDelta] = useState<number>(1);
  const [adjusting, setAdjusting] = useState(false);

  const handleSearchByEmail = async () => {
    if (!user || !searchEmail.trim()) return;
    setSearchLoading(true);
    setSelectedPlan(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/admin-plan-lookup?email=${encodeURIComponent(searchEmail.trim())}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Search failed');
      setPlans(json.data.plans || []);
      if ((json.data.plans || []).length === 0) {
        toast.info('해당 이메일의 플랜 없음');
      }
    } catch (err) {
      toast.error('검색 실패: ' + (err instanceof Error ? err.message : 'unknown'));
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSelectPlan = async (planId: string) => {
    if (!user) return;
    setSearchLoading(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/admin-plan-lookup?planId=${encodeURIComponent(planId)}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Lookup failed');
      setSelectedPlan(json.data);
    } catch (err) {
      toast.error('상세 조회 실패: ' + (err instanceof Error ? err.message : 'unknown'));
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSearchByPlanId = async () => {
    if (!user || !searchPlanId.trim()) return;
    setPlans([]);
    void handleSelectPlan(searchPlanId.trim());
  };

  const handleAdjustCredits = async () => {
    if (!user || !selectedPlan || !creditDelta) return;
    if (!confirm(`revisionCredits 를 ${creditDelta > 0 ? '+' : ''}${creditDelta} 조정합니다. 진행할까요?`)) return;
    setAdjusting(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin-plan-lookup', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ planId: selectedPlan.planId, action: 'addCredits', credits: creditDelta }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Adjust failed');
      toast.success(`credits ${creditDelta > 0 ? '+' : ''}${creditDelta} 적용됨 (현재 ${json.data.revisionCredits})`);
      // 상세 재조회
      void handleSelectPlan(selectedPlan.planId);
    } catch (err) {
      toast.error('조정 실패: ' + (err instanceof Error ? err.message : 'unknown'));
    } finally {
      setAdjusting(false);
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
          <Link to="/admin" className="text-sm text-gray-500 hover:text-[#7C5CFC] flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> Admin
          </Link>
        </div>

        <div>
          <h1 className="text-2xl font-bold text-[#1a1a2e]">AI 플랜 검색</h1>
          <p className="text-sm text-gray-500 mt-1">사용자 이메일·planId 로 플랜 lookup + revisionCredits 조정</p>
        </div>

        {/* 검색 박스 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">사용자 이메일</label>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={searchEmail}
                  onChange={(e) => setSearchEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearchByEmail()}
                  placeholder="user@example.com"
                  className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-[#7C5CFC] outline-none"
                />
                <button
                  type="button"
                  onClick={handleSearchByEmail}
                  disabled={searchLoading || !searchEmail.trim()}
                  className="px-4 py-2 bg-[#7C5CFC] text-white text-sm font-bold rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Search className="w-3.5 h-3.5" /> 검색
                </button>
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">Plan ID 직접</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={searchPlanId}
                  onChange={(e) => setSearchPlanId(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearchByPlanId()}
                  placeholder="planId..."
                  className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm font-mono focus:border-[#7C5CFC] outline-none"
                />
                <button
                  type="button"
                  onClick={handleSearchByPlanId}
                  disabled={searchLoading || !searchPlanId.trim()}
                  className="px-4 py-2 bg-[#7C5CFC] text-white text-sm font-bold rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Search className="w-3.5 h-3.5" /> 조회
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 플랜 목록 (이메일 검색 결과) */}
        {plans.length > 0 && !selectedPlan && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-4 border-b border-gray-100">
              <h2 className="text-sm font-bold text-[#1a1a2e]">{searchEmail} — {plans.length}개 플랜</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-gray-500 text-xs uppercase tracking-wider">
                    <th className="text-left px-4 py-3 font-medium">Plan ID</th>
                    <th className="text-left px-4 py-3 font-medium">시각</th>
                    <th className="text-center px-4 py-3 font-medium">일수</th>
                    <th className="text-center px-4 py-3 font-medium">credits</th>
                    <th className="text-center px-4 py-3 font-medium">결제</th>
                    <th className="text-center px-4 py-3 font-medium">액션</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {plans.map((p) => (
                    <tr key={p.planId} className="hover:bg-gray-50/50">
                      <td className="px-4 py-3 text-xs font-mono text-gray-600 max-w-[160px] truncate">{p.planId}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {p.createdAt ? new Date(p.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-'}
                      </td>
                      <td className="px-4 py-3 text-center text-xs">{p.days || '-'}</td>
                      <td className="px-4 py-3 text-center text-sm font-bold text-[#7C5CFC]">{p.revisionCredits}</td>
                      <td className="px-4 py-3 text-center text-xs">{p.paymentStatus || '-'}</td>
                      <td className="px-4 py-3 text-center">
                        <button
                          type="button"
                          onClick={() => handleSelectPlan(p.planId)}
                          className="text-xs text-[#7C5CFC] hover:underline"
                        >
                          상세
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 단일 플랜 상세 */}
        {selectedPlan && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-[#1a1a2e]">{selectedPlan.title || '제목 없음'}</h2>
                <p className="text-xs text-gray-500 font-mono mt-1">{selectedPlan.planId}</p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`/my-plans/${selectedPlan.planId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[#7C5CFC] hover:underline inline-flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" /> 플랜 보기
                </a>
                <button
                  type="button"
                  onClick={() => setSelectedPlan(null)}
                  className="text-xs text-gray-500 hover:text-gray-800"
                >
                  닫기
                </button>
              </div>
            </div>
            <div className="p-5 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              <div>
                <p className="text-gray-500 uppercase">사용자</p>
                <p className="font-bold text-[#1a1a2e] mt-1">{selectedPlan.userEmail || '-'}</p>
              </div>
              <div>
                <p className="text-gray-500 uppercase">일수</p>
                <p className="font-bold text-[#1a1a2e] mt-1">{selectedPlan.days || '-'}일</p>
              </div>
              <div>
                <p className="text-gray-500 uppercase">credits</p>
                <p className="font-bold text-[#7C5CFC] mt-1 text-base">{selectedPlan.revisionCredits}</p>
              </div>
              <div>
                <p className="text-gray-500 uppercase">결제</p>
                <p className="font-bold text-[#1a1a2e] mt-1">{selectedPlan.paymentStatus || '-'}</p>
              </div>
            </div>

            {/* 신고 목록 */}
            {selectedPlan.complaints.length > 0 && (
              <div className="border-t border-gray-100 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  <h3 className="text-sm font-bold text-[#1a1a2e]">신고 {selectedPlan.complaints.length}건</h3>
                </div>
                <div className="space-y-2">
                  {selectedPlan.complaints.map((c) => (
                    <div key={c.id} className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-amber-900">{REASON_LABELS_KO[c.reason] || c.reason}</span>
                        <span className="text-amber-700">· {c.userEmail || '익명'}</span>
                        <span className="text-amber-600 font-mono">· {c.createdAt?.slice(0, 19)}</span>
                      </div>
                      {c.detail && <p className="text-amber-900 leading-relaxed">{c.detail}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* credits 조정 */}
            <div className="border-t border-gray-100 p-5">
              <h3 className="text-sm font-bold text-[#1a1a2e] mb-3">revisionCredits 조정</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCreditDelta((d) => d - 1)}
                  className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <input
                  type="number"
                  value={creditDelta}
                  onChange={(e) => setCreditDelta(Number(e.target.value))}
                  className="w-20 px-3 py-2 rounded-lg border border-gray-200 text-sm text-center"
                />
                <button
                  type="button"
                  onClick={() => setCreditDelta((d) => d + 1)}
                  className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50"
                >
                  <Plus className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleAdjustCredits}
                  disabled={adjusting || !creditDelta}
                  className="ml-auto px-4 py-2 bg-[#B668FC] text-white text-sm font-bold rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {adjusting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  적용
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                음수도 가능 (차감). 사용자가 환불·플랜 재생성 추가 요청 시 사용. 안전 범위: -100 ~ +100.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
