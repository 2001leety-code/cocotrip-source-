import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, AlertTriangle, TrendingUp, TrendingDown, Activity, Loader2, Info } from 'lucide-react';
import { collection, query, where, getDocs, getCountFromServer } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { auth } from '@/lib/firebase';

interface FunnelStep {
  label: string;
  count: number;
  prevCount?: number;
  source: 'firestore' | 'posthog' | 'derived';
}

function thisMonthRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end };
}

function prevMonthRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start, end };
}

interface PostHogStep { id: string; label: string; count: number }

export default function ConversionFunnel() {
  const [posthogSteps, setPosthogSteps] = useState<PostHogStep[] | null>(null);
  const [posthogError, setPosthogError] = useState<string | null>(null);
  const [thisPlans, setThisPlans] = useState(0);
  const [prevPlans, setPrevPlans] = useState(0);
  const [thisBookings, setThisBookings] = useState(0);
  const [prevBookings, setPrevBookings] = useState(0);
  const [thisCompleted, setThisCompleted] = useState(0);
  const [prevCompleted, setPrevCompleted] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // PostHog 4단계 funnel 시도 (configured 시) — 1회 fetch
  useEffect(() => {
    const loadPosthog = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;
        const token = await user.getIdToken();
        const res = await fetch('/api/admin-posthog-funnel?days=30', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 503) {
          // PostHog 미설정 — Firestore-only 폴백
          setPosthogSteps(null);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setPosthogSteps(json?.data?.steps || null);
      } catch (err) {
        console.warn('[ConversionFunnel] PostHog fetch failed, using Firestore only:', err);
        setPosthogError(err instanceof Error ? err.message : 'unknown');
        setPosthogSteps(null);
      }
    };
    loadPosthog();
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const now = new Date();
        const cur = thisMonthRange(now);
        const prv = prevMonthRange(now);

        // plans (createdAtMs epoch ms) — 버그헌트 #5: createdAt 은 ISO string 이라 number 와
        //   비교 시 Firestore 타입버킷 불일치로 항상 0건. epoch ms 필드 createdAtMs 사용.
        const plansRef = collection(db, 'plans');
        const [thisPlansSnap, prevPlansSnap] = await Promise.all([
          getCountFromServer(query(plansRef, where('createdAtMs', '>=', cur.start.getTime()), where('createdAtMs', '<', cur.end.getTime()))),
          getCountFromServer(query(plansRef, where('createdAtMs', '>=', prv.start.getTime()), where('createdAtMs', '<', prv.end.getTime()))),
        ]);
        setThisPlans(thisPlansSnap.data().count);
        setPrevPlans(prevPlansSnap.data().count);

        // bookings (tourDate string YYYY-MM-DD; aggregate by status)
        const bookingsRef = collection(db, 'bookings');
        const cYM = `${cur.start.getFullYear()}-${String(cur.start.getMonth() + 1).padStart(2, '0')}`;
        const pYM = `${prv.start.getFullYear()}-${String(prv.start.getMonth() + 1).padStart(2, '0')}`;
        const cMonthStart = `${cYM}-01`;
        const cMonthEnd = `${cur.end.getFullYear()}-${String(cur.end.getMonth() + 1).padStart(2, '0')}-01`;
        const pMonthStart = `${pYM}-01`;
        const pMonthEnd = cMonthStart;

        const [thisAll, prevAll] = await Promise.all([
          getDocs(query(bookingsRef, where('tourDate', '>=', cMonthStart), where('tourDate', '<', cMonthEnd))),
          getDocs(query(bookingsRef, where('tourDate', '>=', pMonthStart), where('tourDate', '<', pMonthEnd))),
        ]);

        let cTotal = 0, cDone = 0;
        thisAll.forEach((d) => {
          const data = d.data();
          const s = (data.adminStatus || data.status || '').toLowerCase();
          if (s === 'canceled' || s === 'cancelled') return;
          cTotal++;
          if (s === 'confirmed' || s === 'completed') cDone++;
        });
        let pTotal = 0, pDone = 0;
        prevAll.forEach((d) => {
          const data = d.data();
          const s = (data.adminStatus || data.status || '').toLowerCase();
          if (s === 'canceled' || s === 'cancelled') return;
          pTotal++;
          if (s === 'confirmed' || s === 'completed') pDone++;
        });
        setThisBookings(cTotal);
        setPrevBookings(pTotal);
        setThisCompleted(cDone);
        setPrevCompleted(pDone);
        setLoading(false);
      } catch (err) {
        console.error('[ConversionFunnel] load error:', err);
        setError(err instanceof Error ? err.message : 'unknown');
        setLoading(false);
      }
    };
    load();
  }, []);

  const steps: FunnelStep[] = useMemo(() => {
    // PostHog 데이터가 있으면 그것 우선 — 4단계 모두 PostHog로 통일 (이번 달 30일)
    if (posthogSteps && posthogSteps.length === 4) {
      return posthogSteps.map((s) => ({
        label: s.label,
        count: s.count,
        source: 'posthog' as const,
      }));
    }
    // 폴백: Firestore 기반 3단계 (페이지 진입 0)
    return [
      { label: '플래너 페이지 진입', count: 0, prevCount: 0, source: 'posthog' },
      { label: 'AI 일정 생성 완료', count: thisPlans, prevCount: prevPlans, source: 'firestore' },
      { label: '예약/결제창 진입', count: thisBookings, prevCount: prevBookings, source: 'firestore' },
      { label: '결제 완료', count: thisCompleted, prevCount: prevCompleted, source: 'firestore' },
    ];
  }, [posthogSteps, thisPlans, prevPlans, thisBookings, prevBookings, thisCompleted, prevCompleted]);

  // PostHog 4단계가 있으면 그대로, 없으면 페이지 진입(0) 제거하고 3단계
  const visibleSteps = posthogSteps && posthogSteps.length === 4 ? steps : steps.slice(1);
  const maxCount = Math.max(1, ...visibleSteps.map((s) => s.count));

  let worstDropIdx = 0;
  let worstDropRate = 0;
  for (let i = 1; i < visibleSteps.length; i++) {
    const prevC = visibleSteps[i - 1].count;
    if (prevC === 0) continue;
    const dropRate = 1 - visibleSteps[i].count / prevC;
    if (dropRate > worstDropRate) {
      worstDropRate = dropRate;
      worstDropIdx = i;
    }
  }

  const overallConversion = visibleSteps[0].count > 0
    ? ((visibleSteps[visibleSteps.length - 1].count / visibleSteps[0].count) * 100).toFixed(1)
    : '0';

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm px-3 py-2 rounded-lg">
          ⚠ {error}
        </div>
      )}

      <div className="flex justify-between items-center">
        <div className="flex gap-2">
          <span className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#FBBF24] text-black">
            이번 달 {loading && <Loader2 className="w-3 h-3 inline animate-spin ml-1" />}
          </span>
          <span className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#12131C] border border-gray-800 text-gray-500">
            이번 주 (예정)
          </span>
        </div>
        <div className="bg-[#12131C] border border-gray-800 rounded-xl px-4 py-2 text-center">
          <div className="text-xs text-gray-500">전환율 (보이는 단계 기준)</div>
          <div className="text-xl font-bold text-[#FBBF24]">{overallConversion}%</div>
        </div>
      </div>

      {!posthogSteps && (
        <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-3 flex items-start gap-2">
          <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
          <p className="text-xs text-gray-400">
            <b className="text-blue-300">"플래너 페이지 진입"</b> 단계는 PostHog 연동 후 표시됩니다.
            Vercel 환경변수에 <code className="bg-gray-800 px-1 rounded">POSTHOG_PERSONAL_API_KEY</code> +
            {' '}<code className="bg-gray-800 px-1 rounded">POSTHOG_PROJECT_ID</code> 추가 후 활성화.
            {posthogError && <span className="text-red-400 block mt-1">PostHog 오류: {posthogError}</span>}
          </p>
        </div>
      )}
      {posthogSteps && (
        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3 flex items-start gap-2">
          <Info className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <p className="text-xs text-gray-400">
            PostHog 실시간 데이터 (지난 30일). $pageview /planner → plan_generated → payment_started → payment_completed
          </p>
        </div>
      )}

      <div className="bg-[#12131C] border border-gray-800 rounded-2xl p-6 shadow-xl">
        <div className="max-w-2xl mx-auto space-y-0">
          {visibleSteps.map((step, idx) => {
            const widthPct = Math.max((step.count / maxCount) * 100, 25);
            const prevC = idx > 0 ? visibleSteps[idx - 1].count : step.count;
            const convRate = idx > 0 && prevC > 0 ? ((step.count / prevC) * 100).toFixed(1) : '100';
            const dropRate = idx > 0 ? (100 - parseFloat(convRate)).toFixed(1) : '0';
            const isWorstDrop = idx === worstDropIdx && idx > 0;
            const prevDiff = step.prevCount != null ? step.count - step.prevCount : 0;
            const prevPct = step.prevCount && step.prevCount > 0 ? ((prevDiff / step.prevCount) * 100).toFixed(1) : '0';

            return (
              <div key={idx}>
                {idx > 0 && (
                  <div className="flex items-center justify-center gap-2 py-2">
                    <ArrowDown className={`w-4 h-4 ${isWorstDrop ? 'text-red-400' : 'text-gray-600'}`} />
                    <span className={`text-xs font-medium ${isWorstDrop ? 'text-red-400' : 'text-gray-500'}`}>
                      전환 {convRate}% | 이탈 {dropRate}%
                    </span>
                    {isWorstDrop && <AlertTriangle className="w-3.5 h-3.5 text-red-400" />}
                  </div>
                )}

                <div className="flex items-center gap-4">
                  <div className="w-[140px] shrink-0 text-right">
                    <div className="text-sm font-medium text-gray-200">{step.label}</div>
                    <div className="flex items-center justify-end gap-1 mt-0.5">
                      {prevDiff !== 0 && step.prevCount != null && (
                        <span className={`text-[10px] flex items-center gap-0.5 ${prevDiff > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {prevDiff > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {prevDiff > 0 ? '+' : ''}{prevPct}%
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 relative">
                    <div
                      className={`h-12 rounded-lg flex items-center justify-center transition-all duration-500 ${
                        isWorstDrop
                          ? 'bg-gradient-to-r from-red-600/80 to-red-500/60 ring-1 ring-red-500/50'
                          : idx === 0
                            ? 'bg-gradient-to-r from-indigo-600 to-indigo-500'
                            : idx === visibleSteps.length - 1
                              ? 'bg-gradient-to-r from-emerald-600 to-emerald-500'
                              : 'bg-gradient-to-r from-blue-600/80 to-blue-500/60'
                      }`}
                      style={{ width: `${widthPct}%` }}
                    >
                      <span className="text-white font-bold text-sm">
                        {loading && step.source === 'firestore' ? '...' : `${step.count.toLocaleString()}건`}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {worstDropIdx > 0 && visibleSteps[worstDropIdx - 1] && (
          <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-bold text-red-400 mb-1">최대 이탈 구간</h3>
                <p className="text-xs text-gray-400">
                  "{visibleSteps[worstDropIdx - 1].label}" → "{visibleSteps[worstDropIdx].label}" 단계에서
                  <span className="text-red-400 font-bold"> {(worstDropRate * 100).toFixed(1)}%</span> 이탈.
                </p>
              </div>
            </div>
          </div>
        )}
        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4">
          <div className="flex items-start gap-2">
            <Activity className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-emerald-400 mb-1">데이터 소스</h3>
              <p className="text-xs text-gray-400">
                Firestore <code className="bg-gray-800 px-1 rounded">plans</code> +
                {' '}<code className="bg-gray-800 px-1 rounded">bookings</code> 실시간 집계.
                전체 페이지뷰 funnel은 PostHog 연동 후 활성화.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
