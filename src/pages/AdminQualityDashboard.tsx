// AdminQualityDashboard — /api/admin-quality-summary 응답 시각화.
// Tier 2-D 학습 루프: area/지표/worst plans 빠른 진단으로 약점 영역 식별.
// 한국어 admin 정책 (5/4 세션) — i18n 키 X, 인라인 한국어.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
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
  generatedAt: string;
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
          className="inline-flex items-center gap-1 text-sm text-white/70 hover:text-white"
        >
          <ArrowLeft className="w-4 h-4" /> Admin 홈
        </Link>
      </div>

      <h1 className="text-2xl font-bold">AI 플래너 Quality 대시보드</h1>

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
                    <td className="py-2 pr-4 font-mono">{metric}</td>
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

      <p className="text-xs text-white/40 text-right">
        생성: {data.generatedAt ? new Date(data.generatedAt).toLocaleString('ko-KR') : '—'}
      </p>
    </div>
  );
}

export default QualityDashboard;
