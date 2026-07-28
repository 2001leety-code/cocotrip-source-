/**
 * AdminIntentClassifier (P130, 2026-05-21)
 * Route: /admin/intent-classifier (gated by AdminRoute)
 *
 * 운영자가 `/api/ai-planner-modify` 의 intent classifier 정확도를 모니터링.
 *
 * 표시 항목:
 *   - 이번 주 / 지난 주 intent 분포 (bar chart, CSS only)
 *   - LLM 폴백률 + 평균 confidence + 평균 elapsed
 *   - mutator 실패율 + mutator_code breakdown
 *   - 최근 100건 raw 로그 table (raw_text + rule_intent + llm_intent + mutator_code)
 *   - LLM 폴백 sample 30건 (rule classifier 정확도 개선 자료)
 *
 * 데이터 소스: src/lib/intent-classifier-logs.ts (Firestore admin-only).
 * Auth gate: AdminRoute + firestore.rules (`isAdminEmail`).
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw, AlertTriangle, BarChart3, Database, ListChecks } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import {
  fetchRecentLogs,
  fetchWeeklyStats,
  fetchHighFallbackSamples,
  type IntentClassifierLog,
  type WeeklyStats,
} from '@/lib/intent-classifier-logs';

const INTENT_LABEL: Record<string, string> = {
  block_swap: '블록 교체',
  stop_swap: '정류지 교체',
  stop_add: '정류지 추가',
  stop_remove: '정류지 삭제',
  no_change: '변경 없음',
};

function formatPercent(rate: number | null | undefined): string {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return '-';
  return `${(rate * 100).toFixed(1)}%`;
}

function formatNumber(value: number | null | undefined, fallback = '-'): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return value.toLocaleString();
}

function formatTime(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function truncate(s: string, max = 80): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

// ─────────────────────────────────────────────────────────────────────
// Bar chart — pure CSS. 외부 라이브러리 도입 X (bundle size 절감).
// ─────────────────────────────────────────────────────────────────────
interface BarChartProps {
  data: Record<string, number>;
  emptyLabel: string;
}
function BarChart({ data, emptyLabel }: BarChartProps) {
  const entries = useMemo(
    () => Object.entries(data || {}).sort((a, b) => b[1] - a[1]),
    [data],
  );
  const max = useMemo(() => entries.reduce((acc, [, v]) => (v > acc ? v : acc), 0) || 1, [entries]);

  if (entries.length === 0) {
    return <p className="text-sm text-gray-400 italic">{emptyLabel}</p>;
  }
  return (
    <div className="space-y-2">
      {entries.map(([key, val]) => {
        const ratio = val / max;
        const widthPct = Math.max(2, ratio * 100);
        return (
          <div key={key} className="flex items-center gap-3 text-sm">
            <div className="w-32 font-mono text-xs text-gray-600 truncate">{INTENT_LABEL[key] || key}</div>
            <div className="flex-1 bg-gray-100 rounded-full overflow-hidden h-5 relative">
              <div
                className="bg-[#7C5CFC] h-full rounded-full"
                style={{ width: `${widthPct}%` }}
              />
            </div>
            <div className="w-12 text-right font-mono text-xs text-gray-700">{val}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Threshold-aware metric card
// ─────────────────────────────────────────────────────────────────────
interface MetricCardProps {
  label: string;
  value: string;
  hint?: string;
  warning?: boolean;
}
function MetricCard({ label, value, hint, warning }: MetricCardProps) {
  return (
    <div
      className={`rounded-xl p-4 border ${warning ? 'border-amber-300 bg-amber-50' : 'border-gray-100 bg-white'}`}
    >
      <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
        {warning ? <AlertTriangle className="w-3 h-3 text-amber-600" /> : null}
        {label}
      </div>
      <div className={`text-xl font-bold ${warning ? 'text-amber-700' : 'text-[#1a1a2e]'}`}>{value}</div>
      {hint ? <div className="text-[10px] text-gray-400 mt-1">{hint}</div> : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────
export default function AdminIntentClassifier() {
  const { t } = useLanguage();
  const ta = (t as { admin?: Record<string, unknown> }).admin || {};
  const adminTitle = typeof ta.intentClassifierTitle === 'string' ? ta.intentClassifierTitle : '🧭 Intent Classifier 모니터링';
  const distributionLabel = typeof ta.intentDistribution === 'string' ? ta.intentDistribution : 'Intent 분포';
  const llmFallbackLabel = typeof ta.llmFallbackRate === 'string' ? ta.llmFallbackRate : 'LLM 폴백률';
  const mutatorFailureLabel = typeof ta.mutatorFailureRate === 'string' ? ta.mutatorFailureRate : 'Mutator 실패율';
  const trainingDataLabel = typeof ta.trainingDataSuggestion === 'string' ? ta.trainingDataSuggestion : 'Training data 제안 (rule keyword 추가)';

  const [stats, setStats] = useState<{ thisWeek: WeeklyStats; lastWeek: WeeklyStats } | null>(null);
  const [recentLogs, setRecentLogs] = useState<IntentClassifierLog[]>([]);
  const [fallbackSamples, setFallbackSamples] = useState<IntentClassifierLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [weekly, recent, fallback] = await Promise.all([
        fetchWeeklyStats(),
        fetchRecentLogs(100),
        fetchHighFallbackSamples(30),
      ]);
      setStats(weekly);
      setRecentLogs(recent);
      setFallbackSamples(fallback);
    } catch (err) {
      // 🔴 2026-07-28: Firestore 색인 오류는 원문이 매우 길고 콘솔 주소까지 들어 있다.
      //   화면에는 운영자가 바로 이해할 짧은 문장만 띄우고, 원문은 콘솔에 남긴다.
      console.error('[AdminIntentClassifier] load failed:', err);
      const raw = err instanceof Error ? err.message : String(err);
      const needsIndex = /index/i.test(raw) && /(requires|필요)/i.test(raw);
      setError(needsIndex
        ? 'Firestore 색인이 아직 배포되지 않았습니다. `firebase deploy --only firestore:indexes` 실행 후 다시 시도하세요. (상세 내용은 브라우저 콘솔)'
        : '데이터를 불러오지 못했습니다. 상세 내용은 브라우저 콘솔을 확인하세요.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const thisWeek = stats?.thisWeek;
  const lastWeek = stats?.lastWeek;

  const llmFallbackWarning = !!thisWeek && thisWeek.totalRequests >= 10 && thisWeek.llmFallbackRate > 0.30;
  const mutatorFailureWarning = !!thisWeek && thisWeek.totalRequests >= 10 && thisWeek.mutatorFailureRate > 0.10;
  const elapsedWarning = !!thisWeek && thisWeek.totalRequests >= 10 && (thisWeek.avgElapsedMs || 0) > 5000;

  // 최근 폴백 sample 의 raw_text 기반 — rule classifier 가 놓친 키워드 추출
  // (운영자가 patterns 추가하는 데이터 자료). 단순 substring 빈도.
  const trainingHints = useMemo(() => {
    if (fallbackSamples.length === 0) return [] as { text: string; count: number; sampleIntents: string[] }[];
    const counter = new Map<string, { count: number; intents: Set<string> }>();
    for (const log of fallbackSamples) {
      const text = (log.raw_text || '').toLowerCase().replace(/[\.,!?]/g, ' ');
      const tokens = text.split(/\s+/).filter((w) => w.length >= 2 && w.length <= 15);
      for (const tok of tokens) {
        const existing = counter.get(tok) || { count: 0, intents: new Set<string>() };
        existing.count += 1;
        existing.intents.add(log.final_intent);
        counter.set(tok, existing);
      }
    }
    const entries: { text: string; count: number; sampleIntents: string[] }[] = [];
    counter.forEach((v, k) => {
      // 의미 있는 후보 — count >= 2 + 한 글자 이상 한국어/영어. 너무 일반적인 token 제외.
      if (v.count >= 2 && !['the', 'and', 'for', 'with', 'plan', '저', '제', '좀', '거', '걸'].includes(k)) {
        entries.push({ text: k, count: v.count, sampleIntents: Array.from(v.intents) });
      }
    });
    return entries.sort((a, b) => b.count - a.count).slice(0, 15);
  }, [fallbackSamples]);

  // 🔴 2026-07-28: 모바일 390px 에서 문서 폭이 1,809px 까지 벌어졌다.
  //   표가 페이지를 밀지 않도록 루트에서 가로 넘침을 막고, 표는 자기 컨테이너 안에서만
  //   가로 스크롤하게 한다(아래 overflow-x-auto max-w-full + table min-w).
  return (
    <div className="min-h-screen bg-[#faf9f6] p-4 sm:p-6 overflow-x-hidden">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/admin"
              className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#7C5CFC]"
            >
              <ArrowLeft className="w-4 h-4" />
              어드민 홈
            </Link>
            <h1 className="text-2xl font-bold text-[#1a1a2e]">{adminTitle}</h1>
          </div>
          <button
            type="button"
            onClick={() => void reload()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#7C5CFC] bg-[#7C5CFC]/5 rounded-lg hover:bg-[#7C5CFC]/10 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            새로고침
          </button>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            <span>{error}</span>
          </div>
        ) : null}

        {/* 최상위 지표 */}
        <section>
          <h2 className="text-base font-bold text-[#1a1a2e] mb-3 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-[#7C5CFC]" />
            이번 주 핵심 지표
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricCard
              label="총 modify 요청"
              value={`${formatNumber(thisWeek?.totalRequests)} 건`}
              hint={lastWeek ? `지난주 ${formatNumber(lastWeek.totalRequests)} 건` : undefined}
            />
            <MetricCard
              label={llmFallbackLabel}
              value={formatPercent(thisWeek?.llmFallbackRate)}
              hint={thisWeek ? `${thisWeek.llmFallbackCount}/${thisWeek.totalRequests}` : undefined}
              warning={llmFallbackWarning}
            />
            <MetricCard
              label={mutatorFailureLabel}
              value={formatPercent(thisWeek?.mutatorFailureRate)}
              hint={thisWeek ? `${thisWeek.mutatorFailureCount}/${thisWeek.totalRequests}` : undefined}
              warning={mutatorFailureWarning}
            />
            <MetricCard
              label="평균 elapsed"
              value={thisWeek?.avgElapsedMs ? `${formatNumber(thisWeek.avgElapsedMs)}ms` : '-'}
              hint={`평균 rule confidence ${thisWeek && thisWeek.avgRuleConfidence != null ? thisWeek.avgRuleConfidence : '-'}`}
              warning={elapsedWarning}
            />
          </div>
        </section>

        {/* Intent 분포 — 이번 주 / 지난 주 */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <h3 className="text-sm font-bold text-[#1a1a2e] mb-3">{distributionLabel} — 이번 주</h3>
            <BarChart data={thisWeek?.intentDistribution || {}} emptyLabel="데이터 없음" />
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <h3 className="text-sm font-bold text-[#1a1a2e] mb-3">{distributionLabel} — 지난 주</h3>
            <BarChart data={lastWeek?.intentDistribution || {}} emptyLabel="데이터 없음" />
          </div>
        </section>

        {/* 언어 분포 */}
        <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h3 className="text-sm font-bold text-[#1a1a2e] mb-3">언어 분포 (이번 주)</h3>
          <BarChart data={thisWeek?.languageBreakdown || {}} emptyLabel="데이터 없음" />
        </section>

        {/* 폴백 sample 으로부터 추출한 keyword 후보 */}
        <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h3 className="text-sm font-bold text-[#1a1a2e] mb-3 flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-[#7C5CFC]" />
            {trainingDataLabel}
          </h3>
          {trainingHints.length === 0 ? (
            <p className="text-sm text-gray-400 italic">폴백 sample 없음 — 데이터 누적 대기.</p>
          ) : (
            <div className="overflow-x-auto max-w-full">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-gray-500 text-xs uppercase tracking-wider bg-gray-50">
                    <th className="text-left px-3 py-2 font-medium">후보 token</th>
                    <th className="text-left px-3 py-2 font-medium">빈도</th>
                    <th className="text-left px-3 py-2 font-medium">관련 intent</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {trainingHints.map((hint) => (
                    <tr key={hint.text}>
                      <td className="px-3 py-2 font-mono text-xs text-gray-700">{hint.text}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{hint.count}</td>
                      <td className="px-3 py-2 text-xs text-gray-600">{hint.sampleIntents.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[10px] text-gray-400 mt-2">
                위 후보를 <code className="font-mono">src/ai_planner/intent-classifier.ts</code> 의 BLOCK_SWAP_KEYWORDS / STOP_SWAP_TRIGGERS / KNOWN_STOPS 등에 추가하면 폴백률이 떨어집니다.
              </p>
            </div>
          )}
        </section>

        {/* 최근 100건 로그 */}
        <section className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <h3 className="text-sm font-bold text-[#1a1a2e] flex items-center gap-2">
              <Database className="w-4 h-4 text-[#7C5CFC]" />
              최근 100건 로그
            </h3>
            <span className="text-xs text-gray-400">{recentLogs.length}건</span>
          </div>
          {recentLogs.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">데이터 없음</div>
          ) : (
            <div className="overflow-x-auto max-w-full">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-gray-500 text-xs uppercase tracking-wider bg-gray-50">
                    <th className="text-left px-3 py-2 font-medium">시각</th>
                    <th className="text-left px-3 py-2 font-medium">raw_text</th>
                    <th className="text-left px-3 py-2 font-medium">rule</th>
                    <th className="text-left px-3 py-2 font-medium">llm</th>
                    <th className="text-left px-3 py-2 font-medium">final</th>
                    <th className="text-left px-3 py-2 font-medium">conf</th>
                    <th className="text-left px-3 py-2 font-medium">mutator</th>
                    <th className="text-left px-3 py-2 font-medium">ms</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {recentLogs.map((log) => {
                    const usedLlm = log.used_llm_fallback;
                    const failed = !log.mutator_success;
                    return (
                      <tr key={log._docId} className={failed ? 'bg-amber-50/50' : ''}>
                        <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{formatTime(log.ts)}</td>
                        <td className="px-3 py-2 text-xs text-gray-700 max-w-[280px] truncate" title={log.raw_text}>
                          {truncate(log.raw_text, 60)}
                        </td>
                        <td className="px-3 py-2 text-xs font-mono text-gray-600">
                          {log.rule_intent} ({log.rule_confidence.toFixed(2)})
                        </td>
                        <td className={`px-3 py-2 text-xs font-mono ${usedLlm ? 'text-[#7C5CFC] font-semibold' : 'text-gray-400'}`}>
                          {log.llm_intent ? `${log.llm_intent} (${(log.llm_confidence == null ? 0 : log.llm_confidence).toFixed(2)})` : '-'}
                        </td>
                        <td className="px-3 py-2 text-xs font-mono text-[#1a1a2e]">{log.final_intent}</td>
                        <td className="px-3 py-2 text-xs text-gray-500">
                          {log.final_confidence ? log.final_confidence.toFixed(2) : '-'}
                        </td>
                        <td className={`px-3 py-2 text-xs ${failed ? 'text-amber-700 font-semibold' : 'text-emerald-600'}`}>
                          {failed ? log.mutator_code || 'fail' : 'ok'}
                        </td>
                        <td className="px-3 py-2 text-xs font-mono text-gray-500">{log.elapsed_ms == null ? '-' : log.elapsed_ms}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
