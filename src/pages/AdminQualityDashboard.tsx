// AdminQualityDashboard — /api/admin-quality-summary 응답 시각화.
// Tier 2-D 학습 루프: area/지표/worst plans 빠른 진단으로 약점 영역 식별.
// 한국어 admin 정책 (5/4 세션) — i18n 키 X, 인라인 한국어.
// PR-D (2026-05-07): 수집 단위 라벨, AI 요약 fallback UI, _collectionMissing 배너.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

interface MetricCell {
  stops: number;
  violations: number;
  avgRate: number;
}

interface AreaCell {
  count: number;
  avgScore: number;
  worstMetric: string | null;
  worstMetricCount: number;
}

interface TopMetric {
  metric: string;
  count: number;
  total: number;
}

interface WorstPlan {
  id: string;
  score: number;
  area: string;
  createdAt: string | null;
  topMetrics: TopMetric[];
}

interface QualitySummary {
  window: {
    days: number;
    limit: number;
    sinceISO: string;
    scannedTotal: number;
    scoredCount: number;
  };
  overall: {
    avgScore: number | null;
    minScore: number | null;
    maxScore: number | null;
  };
  metricFrequency: Record<string, MetricCell>;
  byArea: Record<string, AreaCell>;
  worstPlans: WorstPlan[];
  // PR-D 신규
  csTicketCount?: number;
  errorLogCount?: number;
  userReportCount?: number;
  _collectionMissing?: string[];
  _collectionErrors?: Record<string, string>;
  generatedAt: string;
}

// PR-D: 약점 카운트 측정 단위 라벨 (docs/quality-metrics.md 와 동기화)
const METRIC_UNIT_LABELS: Record<string, string> = {
  dietary_violation:     '(per stop)',
  unverified_restaurant: '(per stop)',
  field_completeness:    '(per stop)',
  route_failure:         '(per stop)',
  bad_address_prefix:    '(per stop)',
  language_mismatch:     '(per stop)',
  duplicate_stops:       '(per duplicate)',
  tight_schedule:        '(per segment)',
  loose_schedule:        '(per segment)',
};

// PR-D: LLM 임계값 가드 (helper 와 동일 — plans>=5 AND signals>=3)
const LLM_MIN_PLANS = 5;
const LLM_MIN_SIGNALS = 3;
function hasSufficientData(d: QualitySummary): boolean {
  const plans = d.window?.scoredCount ?? 0;
  const signals = (d.csTicketCount ?? 0) + (d.errorLogCount ?? 0) + (d.userReportCount ?? 0);
  return plans >= LLM_MIN_PLANS && signals >= LLM_MIN_SIGNALS;
}

function formatScore(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return String(v);
}

function Stat({ label, value, colorClass = '' }: { label: string; value: number | null | undefined; colorClass?: string }) {
  return (
    <div>
      <p className="text-xs text-white/55">{label}</p>
      <p className={`text-2xl font-bold ${colorClass}`}>{formatScore(value)}</p>
    </div>
  );
}

function QualityDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<QualitySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [limit, setLimit] = useState(100);

  useEffect(() => {
    let cancelled = false;
    async function fetchSummary() {
      setLoading(true);
      setError(null);
      try {
        if (!user) {
          if (!cancelled) setError('admin 인증 필요');
          return;
        }
        const idToken = await user.getIdToken();
        const res = await fetch(`/api/admin-quality-summary?days=${days}&limit=${limit}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const json = await res.json();
        if (!res.ok) {
          if (!cancelled) setError(json?.error || '조회 실패');
          return;
        }
        if (!cancelled) setData(json as QualitySummary);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'unknown');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void fetchSummary();
    return () => { cancelled = true; };
  }, [days, limit, user]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0b14] text-white p-6">
        <p className="text-white/70">로딩 중...</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="min-h-screen bg-[#0a0b14] text-white p-6">
        <p className="text-red-400">에러: {error}</p>
      </div>
    );
  }
  if (!data) return null;

  const overallMin = data.overall?.minScore;
  const sortedMetrics = Object.entries(data.metricFrequency || {})
    .sort((a, b) => (b[1]?.violations || 0) - (a[1]?.violations || 0));
  const sortedAreas = Object.entries(data.byArea || {})
    .sort((a, b) => (a[1]?.avgScore || 0) - (b[1]?.avgScore || 0));

  return (
    <div className="min-h-screen bg-[#0a0b14] text-white p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link
          to="/admin"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 hover:border-amber-500/50 text-sm font-medium transition-all duration-200 min-h-[44px]"
        >
          <ArrowLeft className="w-4 h-4 shrink-0" /> 어드민 홈으로
        </Link>
      </div>

      <h1 className="text-2xl font-bold">AI 플래너 Quality 대시보드</h1>

      {/* PR-D: 수집 미작동 컬렉션 배너 (silent fail 금지 — 운영자 즉시 인지) */}
      {data._collectionMissing && data._collectionMissing.length > 0 && (
        <section className="bg-red-500/15 border border-red-500/40 rounded-2xl p-4 flex gap-3 items-start">
          <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <p className="text-red-300 font-semibold">
              수집 미작동 컬렉션: <span className="font-mono">{data._collectionMissing.join(', ')}</span>
            </p>
            <p className="text-red-200/80 text-xs mt-1">
              해당 컬렉션이 비어있거나 미존재합니다. 데이터 수집 경로를 점검하세요.
              ({Object.keys(data._collectionErrors || {}).length > 0
                ? `에러: ${Object.entries(data._collectionErrors || {}).map(([k, v]) => `${k}: ${v}`).join('; ')}`
                : '에러 없음 — 빈 컬렉션'})
            </p>
          </div>
        </section>
      )}

      {/* 필터 */}
      <div className="flex flex-wrap gap-4 items-center">
        <label className="flex items-center gap-2 text-sm">
          기간
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="bg-white/[0.08] border border-white/15 rounded px-2 py-1 text-sm"
          >
            <option value={7}>7일</option>
            <option value={30}>30일</option>
            <option value={90}>90일</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          최대 건수
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="bg-white/[0.08] border border-white/15 rounded px-2 py-1 text-sm"
          >
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={500}>500</option>
          </select>
        </label>
      </div>

      {/* 전체 통계 */}
      <section className="bg-white/[0.04] rounded-2xl p-4 border border-white/10">
        <h2 className="text-lg font-semibold mb-3">전체 통계</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Stat label="평균 score" value={data.overall?.avgScore} />
          <Stat
            label="최저 score"
            value={overallMin}
            colorClass={typeof overallMin === 'number' && overallMin < 60 ? 'text-red-400' : ''}
          />
          <Stat label="최고 score" value={data.overall?.maxScore} />
        </div>
        <p className="text-xs text-white/55 mt-3">
          기간: {data.window?.days}일 · 스캔 {data.window?.scannedTotal} · qualityScore 보유 {data.window?.scoredCount}
        </p>
      </section>

      {/* 가장 빈번한 약점 지표 */}
      <section className="bg-white/[0.04] rounded-2xl p-4 border border-white/10">
        <h2 className="text-lg font-semibold mb-3">가장 빈번한 약점 지표</h2>
        {sortedMetrics.length === 0 ? (
          <p className="text-sm text-white/55">데이터 없음</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-white/55">
                  <th className="py-2 pr-4">지표</th>
                  <th className="py-2 pr-4">위반 건수</th>
                  <th className="py-2 pr-4">전체 stops</th>
                  <th className="py-2 pr-4">평균 비율</th>
                </tr>
              </thead>
              <tbody>
                {sortedMetrics.map(([metric, m]) => (
                  <tr key={metric} className="border-t border-white/10">
                    <td className="py-2 pr-4 font-mono">
                      {metric}
                      <span className="ml-2 text-[10px] text-white/40 font-sans">
                        {METRIC_UNIT_LABELS[metric] || ''}
                      </span>
                    </td>
                    <td className="py-2 pr-4">{m?.violations ?? 0}</td>
                    <td className="py-2 pr-4">{m?.stops ?? 0}</td>
                    <td className="py-2 pr-4">{((m?.avgRate ?? 0) * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* area 별 평균 */}
      <section className="bg-white/[0.04] rounded-2xl p-4 border border-white/10">
        <h2 className="text-lg font-semibold mb-3">지역별 평균 score</h2>
        {sortedAreas.length === 0 ? (
          <p className="text-sm text-white/55">데이터 없음</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-white/55">
                  <th className="py-2 pr-4">지역</th>
                  <th className="py-2 pr-4">건수</th>
                  <th className="py-2 pr-4">평균 score</th>
                  <th className="py-2 pr-4">최악 약점</th>
                </tr>
              </thead>
              <tbody>
                {sortedAreas.map(([area, a]) => (
                  <tr key={area} className="border-t border-white/10">
                    <td className="py-2 pr-4 capitalize">{area}</td>
                    <td className="py-2 pr-4">{a?.count ?? 0}</td>
                    <td
                      className={`py-2 pr-4 ${
                        typeof a?.avgScore === 'number' && a.avgScore < 60
                          ? 'text-red-400 font-bold'
                          : ''
                      }`}
                    >
                      {formatScore(a?.avgScore)}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">
                      {a?.worstMetric ? `${a.worstMetric} (${a.worstMetricCount}건)` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* worst plans top 10 */}
      <section className="bg-white/[0.04] rounded-2xl p-4 border border-white/10">
        <h2 className="text-lg font-semibold mb-3">최저 score plan top 10</h2>
        {(!data.worstPlans || data.worstPlans.length === 0) ? (
          <p className="text-sm text-white/55">데이터 없음</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-white/55">
                  <th className="py-2 pr-4">plan ID</th>
                  <th className="py-2 pr-4">score</th>
                  <th className="py-2 pr-4">지역</th>
                  <th className="py-2 pr-4">생성일</th>
                  <th className="py-2 pr-4">주요 약점</th>
                </tr>
              </thead>
              <tbody>
                {data.worstPlans.map((p) => (
                  <tr key={p.id} className="border-t border-white/10">
                    <td className="py-2 pr-4">
                      <a
                        href={`/my-plans/${p.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-400 hover:underline font-mono text-xs"
                      >
                        {p.id}
                      </a>
                    </td>
                    <td
                      className={`py-2 pr-4 ${
                        p.score < 50 ? 'text-red-400 font-bold' : ''
                      }`}
                    >
                      {p.score}
                    </td>
                    <td className="py-2 pr-4 capitalize">{p.area}</td>
                    <td className="py-2 pr-4 text-xs text-white/55">
                      {p.createdAt ? new Date(p.createdAt).toLocaleDateString('ko-KR') : '—'}
                    </td>
                    <td className="py-2 pr-4 text-xs">
                      {(p.topMetrics || [])
                        .map((m) => `${m.metric}(${m.count})`)
                        .join(', ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* PR-D: 추가 신호 카운트 (cs_tickets / error_log / plan_complaints) */}
      <section className="bg-white/[0.04] rounded-2xl p-4 border border-white/10">
        <h2 className="text-lg font-semibold mb-3">추가 품질 신호</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Stat label="사용자 신고 (plan_complaints)" value={data.userReportCount ?? null} />
          <Stat label="CS 티켓 (cs_tickets)" value={data.csTicketCount ?? null} />
          <Stat label="에러 로그 (error_log)" value={data.errorLogCount ?? null} />
        </div>
        <p className="text-xs text-white/55 mt-3">
          기간: 최근 {data.window?.days}일.
          신고/티켓/에러는 <span className="font-mono text-white/70">createdAt</span> 기준 카운트
          (per record).
        </p>
      </section>

      {/* PR-D: AI 요약 상태 카드 (실제 Gemini 호출은 주간 cron 만 — 여기는 임계값 안내) */}
      <section className="bg-white/[0.04] rounded-2xl p-4 border border-white/10">
        <h2 className="text-lg font-semibold mb-3">AI 요약 (주간 리포트)</h2>
        {hasSufficientData(data) ? (
          <div className="text-sm text-white/70 space-y-2">
            <p className="text-emerald-300">
              데이터 충분 — 주간 cron 이 Gemini 요약을 생성합니다.
            </p>
            <p className="text-xs text-white/50">
              매주 월요일 KST 09:00 에 텔레그램 admin 채널 + Firestore
              <span className="font-mono mx-1">weekly_quality_reports</span> 보관.
            </p>
          </div>
        ) : (
          <div className="bg-white/[0.04] rounded-xl p-4 border border-white/10 text-sm">
            <p className="text-white/70">
              이번 주 데이터가 부족해 트렌드 분석이 어렵습니다 (plans: {data.window?.scoredCount ?? 0}건,
              신호: {(data.csTicketCount ?? 0) + (data.errorLogCount ?? 0) + (data.userReportCount ?? 0)}건).
            </p>
            <p className="text-white/55 text-xs mt-2">
              임계값: plans ≥ {LLM_MIN_PLANS} AND (cs+error+report) ≥ {LLM_MIN_SIGNALS}.
              미달 시 LLM 호출 스킵 (비용 + hallucination 방지). 수집 경로 점검 권장.
            </p>
          </div>
        )}
      </section>

      <p className="text-xs text-white/40 text-right">
        생성: {data.generatedAt ? new Date(data.generatedAt).toLocaleString('ko-KR') : '—'}
      </p>
    </div>
  );
}

export default QualityDashboard;
