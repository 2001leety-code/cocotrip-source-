// /admin/sales — 매출 대시보드. KPI + 일별 추이 + 상품별 분포 + 최근 예약 리스트.
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { Header } from '@/sections/Header';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { usePageMeta } from '@/hooks/usePageMeta';

interface Bucket { usd: number; count: number }
interface DailyEntry { date: string; usd: number; count: number }
interface RecentEntry {
  bookingRef: string;
  tourDate: string;
  productType: string;
  paxCount: number;
  amountUSD: number;
  status: string;
  customerEmail: string;
  createdAt: string | null;
}
interface ExcludedMeta {
  adminBypass: number;
  canceled: number;
}
interface SalesResponse {
  kpi: { today: Bucket; week: Bucket; month: Bucket; ytd: Bucket };
  daily: DailyEntry[];
  byProduct: Record<string, Bucket>;
  recent: RecentEntry[];
  exchangeRate: number;
  totalBookings: number;
  // A1-7-1 (2026-05-24): 매출 집계에서 제외된 건수 — 운영자 본인 테스트 결제 + 취소.
  // 서버 응답이 구버전이면 undefined.
  excluded?: ExcludedMeta;
  generatedAt: string;
}

const fmtUSD = (n: number) => `$${n.toFixed(2)}`;
const fmtKRW = (n: number) => `₩${Math.round(n).toLocaleString()}`;
const fmtCount = (n: number) => n.toLocaleString();

const cardStyle = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.10)',
};

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    CONFIRMED: { bg: 'rgba(16,185,129,0.15)', color: '#6EE7B7', label: '확정' },
    CANCELED:  { bg: 'rgba(248,113,113,0.15)', color: '#FCA5A5', label: '취소' },
  };
  const s = map[status] || { bg: 'rgba(255,255,255,0.06)', color: '#cbd5e1', label: status };
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{ background: s.bg, color: s.color }}
    >
      {s.label}
    </span>
  );
}

function KpiCard({ title, bucket, rate }: { title: string; bucket: Bucket; rate: number }) {
  return (
    <div className="rounded-2xl p-5" style={cardStyle}>
      <p className="text-[11px] font-semibold text-white/50 mb-2 uppercase tracking-wider">{title}</p>
      <p className="text-[24px] font-black text-white tabular-nums">{fmtUSD(bucket.usd)}</p>
      <p className="text-[12px] text-white/50 tabular-nums mt-1">
        {fmtKRW(bucket.usd * rate)} · {fmtCount(bucket.count)}건
      </p>
    </div>
  );
}

function DailyBarChart({ daily, rate }: { daily: DailyEntry[]; rate: number }) {
  const max = Math.max(1, ...daily.map((d) => d.usd));
  const barW = 14;
  const gap = 4;
  const chartW = daily.length * (barW + gap);
  const chartH = 140;

  return (
    <div className="rounded-2xl p-5" style={cardStyle}>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-[14px] font-bold text-white">일별 매출 (최근 {daily.length}일)</h2>
        <p className="text-[11px] text-white/55">최대 {fmtUSD(max)}</p>
      </div>
      <div className="overflow-x-auto">
        <svg width={chartW} height={chartH + 24} style={{ display: 'block' }}>
          {daily.map((d, i) => {
            const h = (d.usd / max) * chartH;
            const x = i * (barW + gap);
            const y = chartH - h;
            const showLabel = i % 5 === 0 || i === daily.length - 1;
            return (
              <g key={d.date}>
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={h}
                  rx={2}
                  fill={d.usd > 0 ? '#C4956A' : 'rgba(255,255,255,0.06)'}
                >
                  <title>{`${d.date}\n${fmtUSD(d.usd)} · ${d.count}건`}</title>
                </rect>
                {showLabel && (
                  <text
                    x={x + barW / 2}
                    y={chartH + 14}
                    textAnchor="middle"
                    fill="rgba(255,255,255,0.4)"
                    fontSize="9"
                  >
                    {d.date.slice(5)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <p className="text-[11px] text-white/55 mt-2">
        총 {fmtUSD(daily.reduce((s, d) => s + d.usd, 0))} ({fmtKRW(daily.reduce((s, d) => s + d.usd, 0) * rate)})
      </p>
    </div>
  );
}

function ProductDistribution({ byProduct, rate }: { byProduct: Record<string, Bucket>; rate: number }) {
  const entries = Object.entries(byProduct).sort((a, b) => b[1].usd - a[1].usd);
  const max = Math.max(1, ...entries.map(([, b]) => b.usd));
  const total = entries.reduce((s, [, b]) => s + b.usd, 0);

  return (
    <div className="rounded-2xl p-5" style={cardStyle}>
      <h2 className="text-[14px] font-bold text-white mb-4">상품별 분포 (이번달)</h2>
      {entries.length === 0 ? (
        <p className="text-[12px] text-white/55">데이터 없음</p>
      ) : (
        <div className="space-y-3">
          {entries.map(([name, b]) => {
            const pct = total > 0 ? (b.usd / total) * 100 : 0;
            const w = (b.usd / max) * 100;
            return (
              <div key={name}>
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-[12px] font-semibold text-white">{name}</span>
                  <span className="text-[11px] text-white/50 tabular-nums">
                    {fmtUSD(b.usd)} · {b.count}건 · {pct.toFixed(0)}%
                  </span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${w}%`, background: '#C4956A' }}
                  />
                </div>
              </div>
            );
          })}
          <p className="text-[11px] text-white/55 pt-2 border-t border-white/10">
            합계 {fmtUSD(total)} ({fmtKRW(total * rate)})
          </p>
        </div>
      )}
    </div>
  );
}

function RecentBookingsTable({ recent }: { recent: RecentEntry[] }) {
  return (
    <div className="rounded-2xl p-5 overflow-x-auto" style={cardStyle}>
      <h2 className="text-[14px] font-bold text-white mb-3">최근 예약 ({recent.length}건)</h2>
      {recent.length === 0 ? (
        <p className="text-[12px] text-white/55">예약 없음</p>
      ) : (
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-white/50 text-[10px] uppercase tracking-wider">
              <th className="py-2 pr-3">예약번호</th>
              <th className="py-2 pr-3">상품</th>
              <th className="py-2 pr-3">투어일</th>
              <th className="py-2 pr-3">인원</th>
              <th className="py-2 pr-3 text-right">금액</th>
              <th className="py-2 pr-3">상태</th>
              <th className="py-2 pr-3">고객</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((r) => (
              <tr key={r.bookingRef} className="border-t border-white/5 text-white/80">
                <td className="py-2 pr-3 font-mono text-[11px]">{r.bookingRef.slice(0, 12)}</td>
                <td className="py-2 pr-3">{r.productType}</td>
                <td className="py-2 pr-3 tabular-nums">{r.tourDate}</td>
                <td className="py-2 pr-3 tabular-nums">{r.paxCount}</td>
                <td className="py-2 pr-3 text-right tabular-nums font-semibold">{fmtUSD(r.amountUSD)}</td>
                <td className="py-2 pr-3"><StatusBadge status={r.status} /></td>
                <td className="py-2 pr-3 text-white/60 truncate max-w-[180px]">{r.customerEmail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function AdminSales() {
  // 2026-07-28: 관리자 화면마다 브라우저 탭 제목이 같아 탭 구분이 안 됐다.
  usePageMeta({ title: '매출 (관리자)', description: 'Sales KPIs and daily revenue.' });
  const { user } = useAuth();
  const { language, t, changeLanguage } = useLanguage();
  const [data, setData] = useState<SalesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  const reload = useMemo(() => async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/admin-sales?days=${days}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as SalesResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error');
    } finally {
      setLoading(false);
    }
  }, [user, days]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <div
      className="min-h-screen pb-20"
      style={{ background: 'linear-gradient(180deg, #0a0412 0%, #0d0618 50%, #080210 100%)' }}
    >
      <Header language={language} t={t} onLanguageChange={changeLanguage} />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-24">
        {/* 어드민 홈 링크 */}
        <div className="mb-4">
          <Link to="/admin" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 hover:border-amber-500/50 text-sm font-medium transition-all duration-200 min-h-[44px]">
            <ArrowLeft className="w-4 h-4 shrink-0" />
            <span>어드민 홈으로</span>
          </Link>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-[22px] font-black text-white mb-1">매출 대시보드</h1>
            <p className="text-[12px] text-white/55">
              운영자 전용 — Firestore bookings 기준 (취소 제외).
              {data?.generatedAt && ` 갱신: ${new Date(data.generatedAt).toLocaleString('ko-KR')}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value, 10))}
              className="text-[12px] font-semibold px-3 py-2 rounded-xl focus:outline-none text-white"
              style={cardStyle}
            >
              <option value="7">최근 7일</option>
              <option value="14">최근 14일</option>
              <option value="30">최근 30일</option>
              <option value="60">최근 60일</option>
              <option value="90">최근 90일</option>
            </select>
            <button
              type="button"
              onClick={reload}
              disabled={loading}
              className="text-[12px] font-bold px-4 py-2 rounded-xl text-white disabled:opacity-50"
              style={cardStyle}
            >
              {loading ? '갱신 중...' : '↻ 갱신'}
            </button>
          </div>
        </div>

        {error && (
          <div
            className="rounded-2xl p-4 mb-6 text-[13px]"
            style={{ background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.30)', color: '#FCA5A5' }}
          >
            오류: {error}
          </div>
        )}

        {!data && !error ? (
          <div className="rounded-2xl p-10 text-center text-white/50" style={cardStyle}>
            {loading ? '데이터 불러오는 중...' : '데이터 없음'}
          </div>
        ) : data ? (
          <>
            {/* KPI 카드 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-2">
              <KpiCard title={t.adminSales?.kpi?.today ||'오늘'} bucket={data.kpi.today} rate={data.exchangeRate} />
              <KpiCard title={t.adminSales?.kpi?.week ||'이번 주'} bucket={data.kpi.week} rate={data.exchangeRate} />
              <KpiCard title={t.adminSales?.kpi?.month ||'이번 달'} bucket={data.kpi.month} rate={data.exchangeRate} />
              <KpiCard title={t.adminSales?.kpi?.ytd ||'연 누적'} bucket={data.kpi.ytd} rate={data.exchangeRate} />
            </div>

            {/* A1-7-1: 제외 메타 — 운영자가 KPI 숫자가 줄어든 이유 즉시 인지 */}
            {data.excluded && (data.excluded.adminBypass > 0 || data.excluded.canceled > 0) && (
              <p className="text-[11px] text-white/50 mb-5 px-1">
                {data.excluded.adminBypass > 0 && (
                  <span className="mr-3">
                    본인 테스트 결제 <span className="text-amber-300 font-semibold">{data.excluded.adminBypass}건</span> 제외 (TEST-/ADMIN-BYPASS-)
                  </span>
                )}
                {data.excluded.canceled > 0 && (
                  <span>취소 {data.excluded.canceled}건 제외</span>
                )}
              </p>
            )}
            {(!data.excluded || (data.excluded.adminBypass === 0 && data.excluded.canceled === 0)) && (
              <div className="mb-5" />
            )}

            {/* 일별 차트 */}
            <div className="mb-5">
              <DailyBarChart daily={data.daily} rate={data.exchangeRate} />
            </div>

            {/* 상품별 분포 */}
            <div className="mb-5">
              <ProductDistribution byProduct={data.byProduct} rate={data.exchangeRate} />
            </div>

            {/* 최근 예약 */}
            <RecentBookingsTable recent={data.recent} />

            <p className="text-[11px] text-white/55 text-center mt-6">
              전체 예약(취소 포함): {data.totalBookings.toLocaleString()}건 · 환율: ₩{data.exchangeRate.toLocaleString()}/USD (실시간)
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
