/**
 * 관리자 전환 퍼널 — 같은 사람·시간순 5단계 (2026-08-24, plan_generated 제거).
 *
 * wizard_seen -> preview_success -> payment_started(ai-planner-full)
 *   -> payment_completed(ai-planner-full) -> planner_complete
 *
 * 서버(api/admin-posthog-funnel.js)가 이미 순서·단조성을 검증해 200 을 준다 — 이 화면은
 * 서버가 보낸 steps 를 **그대로** 그린다(라벨·개수 하드코딩 금지). 서버가 거부하면
 * (503/500) 그 상태를 그대로 보여준다 — "0건"으로 오해할 수 있는 표시를 만들지 않는다.
 *
 * "실시간" 표현 금지 — API 응답의 generatedAt/windowStart/windowEnd/latestEventAt 만 표시.
 */
import { useEffect, useState } from 'react';
import { ArrowDown, AlertTriangle, Activity, Loader2, Info, Clock } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';

interface FunnelStep {
  id: string;
  label: string;
  count: number;
}

interface FunnelData {
  semanticsVersion: string;
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  latestEventAt: string | null;
  days: number;
  steps: FunnelStep[];
}

type FunnelErrorKind =
  | { kind: 'not_configured' }
  | { kind: 'invalid'; message: string }
  | { kind: 'query_failed'; message: string };

const DAYS = 30;

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ko-KR', { hour12: false });
  } catch {
    return iso;
  }
}

export default function ConversionFunnel() {
  const [data, setData] = useState<FunnelData | null>(null);
  const [error, setError] = useState<FunnelErrorKind | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await authFetch(`/api/admin-posthog-funnel?days=${DAYS}`);
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (res.status === 503) {
          setData(null);
          setError({ kind: 'not_configured' });
          return;
        }
        if (!res.ok || !body?.ok) {
          const code: string = body?.code || '';
          setData(null);
          if (code.startsWith('FUNNEL_')) {
            setError({ kind: 'invalid', message: body?.error || `HTTP ${res.status}` });
          } else {
            setError({ kind: 'query_failed', message: body?.error || `HTTP ${res.status}` });
          }
          return;
        }
        setData(body.data as FunnelData);
      } catch (err) {
        if (cancelled) return;
        setData(null);
        setError({ kind: 'query_failed', message: err instanceof Error ? err.message : '조회 실패' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  const steps = data?.steps || [];
  const maxCount = Math.max(1, ...steps.map((s) => s.count));

  let worstDropIdx = 0;
  let worstDropRate = 0;
  for (let i = 1; i < steps.length; i++) {
    const prevC = steps[i - 1].count;
    if (prevC === 0) continue;
    const dropRate = 1 - steps[i].count / prevC;
    if (dropRate > worstDropRate) {
      worstDropRate = dropRate;
      worstDropIdx = i;
    }
  }

  const overallConversion = steps.length > 0 && steps[0].count > 0
    ? ((steps[steps.length - 1].count / steps[0].count) * 100).toFixed(1)
    : '0';

  return (
    <div className="space-y-6">
      {loading && (
        <div className="flex items-center gap-2 text-xs text-gray-400" role="status" aria-live="polite">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          불러오는 중…
        </div>
      )}

      {error?.kind === 'not_configured' && (
        <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-3 flex items-start gap-2" role="status">
          <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
          <p className="text-xs text-gray-400">
            <b className="text-blue-300">PostHog 미연결</b> — Vercel 환경변수에{' '}
            <code className="bg-gray-800 px-1 rounded">POSTHOG_PERSONAL_API_KEY</code> +{' '}
            <code className="bg-gray-800 px-1 rounded">POSTHOG_PROJECT_ID</code> 추가 후 퍼널이 표시됩니다.
          </p>
        </div>
      )}

      {error?.kind === 'query_failed' && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm px-3 py-2 rounded-lg" role="alert">
          ⚠ PostHog 조회 실패: {error.message}
        </div>
      )}

      {error?.kind === 'invalid' && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm px-3 py-2 rounded-lg" role="alert">
          ⚠ 퍼널 데이터가 순서·단조성 검증에 실패해 표시를 보류했습니다: {error.message}
        </div>
      )}

      {data && steps.length === 0 && !loading && (
        <div className="bg-[#12131C] border border-gray-800 rounded-xl p-4 text-xs text-gray-500" role="status">
          표시할 퍼널 단계가 없습니다.
        </div>
      )}

      {data && steps.length > 0 && (
        <>
          <div className="flex flex-wrap justify-between items-center gap-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                조회 시각: {fmtDateTime(data.generatedAt)}
              </span>
              <span>기간: {fmtDateTime(data.windowStart)} ~ {fmtDateTime(data.windowEnd)}</span>
              <span>
                최근 이벤트:{' '}
                {data.latestEventAt ? fmtDateTime(data.latestEventAt) : '선택한 기간 내 이벤트 없음'}
              </span>
              <span className="text-gray-600">버전: {data.semanticsVersion}</span>
            </div>
            <div className="bg-[#12131C] border border-gray-800 rounded-xl px-4 py-2 text-center">
              <div className="text-xs text-gray-500">전체 전환율</div>
              <div className="text-xl font-bold text-[#FBBF24]">{overallConversion}%</div>
            </div>
          </div>

          <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3 flex items-start gap-2">
            <Info className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <p className="text-xs text-gray-400">
              같은 사람이 wizard_seen → preview_success → payment_started → payment_completed →
              planner_complete 순서로 실제 도달한 단계만 집니다(AI 플래너 결제만, 순서를 건너뛰면 제외).
            </p>
          </div>

          <div className="bg-[#12131C] border border-gray-800 rounded-2xl p-6 shadow-xl">
            <div className="max-w-2xl mx-auto space-y-0">
              {steps.map((step, idx) => {
                const widthPct = Math.max((step.count / maxCount) * 100, 25);
                const prevC = idx > 0 ? steps[idx - 1].count : step.count;
                const convRate = idx > 0 && prevC > 0 ? ((step.count / prevC) * 100).toFixed(1) : '100';
                const dropRate = idx > 0 ? (100 - parseFloat(convRate)).toFixed(1) : '0';
                const isWorstDrop = idx === worstDropIdx && idx > 0;

                return (
                  <div key={step.id}>
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
                      <div className="w-[160px] shrink-0 text-right">
                        <div className="text-sm font-medium text-gray-200">{step.label}</div>
                      </div>
                      <div className="flex-1 relative">
                        <div
                          className={`h-12 rounded-lg flex items-center justify-center transition-all duration-500 ${
                            isWorstDrop
                              ? 'bg-gradient-to-r from-red-600/80 to-red-500/60 ring-1 ring-red-500/50'
                              : idx === 0
                                ? 'bg-gradient-to-r from-indigo-600 to-indigo-500'
                                : idx === steps.length - 1
                                  ? 'bg-gradient-to-r from-emerald-600 to-emerald-500'
                                  : 'bg-gradient-to-r from-blue-600/80 to-blue-500/60'
                          }`}
                          style={{ width: `${widthPct}%` }}
                        >
                          <span className="text-white font-bold text-sm">{step.count.toLocaleString()}건</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {worstDropIdx > 0 && steps[worstDropIdx - 1] && (
            <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-bold text-red-400 mb-1">최대 이탈 구간</h3>
                  <p className="text-xs text-gray-400">
                    "{steps[worstDropIdx - 1].label}" → "{steps[worstDropIdx].label}" 단계에서
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
                  PostHog 이벤트 기반 (최근 {data.days}일). Firestore 예약 총량은 이 퍼널에 섞지 않습니다.
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
