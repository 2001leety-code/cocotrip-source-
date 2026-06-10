// /admin/briefing — 어제 회사 한 장 (조종석 웹). 텔레그램 모닝브리핑과 같은 집계 API.
import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { Header } from '@/sections/Header';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

interface Bucket { usd: number; count: number }
interface BriefingResponse {
  revenue: Bucket;
  trends: { week: Bucket; month: Bucket };
  byProduct: Record<string, Bucket>;
  aiPlanner: { paidCount: number; feeUsd: number };
  newUsers: number;
  errors: { total: number; bySeverity: { critical: number; high: number; medium: number; low: number }; top: { key: string; count: number }[] };
  customer: { newTickets: number; reviewsSent: number };
  meta: { excludedBypass: number; excludedCanceled: number };
  marketing: { skipped: boolean; reason?: string; visitors?: number; conversions?: number };
  exchangeRate: number;
  generatedAt: string;
}

const fmtUSD = (n: number) => `$${(n || 0).toFixed(2)}`;
const fmtKRW = (n: number) => `₩${Math.round(n || 0).toLocaleString()}`;
const cardStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)' };

function KpiCard({ title, bucket, rate }: { title: string; bucket: Bucket; rate: number }) {
  return (
    <div className="rounded-2xl p-5" style={cardStyle}>
      <p className="text-[11px] font-semibold text-white/50 mb-2 uppercase tracking-wider">{title}</p>
      <p className="text-[24px] font-black text-white tabular-nums">{fmtUSD(bucket.usd)}</p>
      <p className="text-[12px] text-white/50 tabular-nums mt-1">{fmtKRW(bucket.usd * rate)} · {bucket.count}건</p>
    </div>
  );
}

function SectionTitle({ icon, title }: { icon: string; title: string }) {
  return <h2 className="text-[15px] font-bold text-white/90 mb-3 mt-8">{icon} {title}</h2>;
}

export default function AdminBriefing() {
  const { user } = useAuth();
  const { language, t, changeLanguage } = useLanguage();
  const [data, setData] = useState<BriefingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user) return;
    setLoading(true); setError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin-briefing', { headers: { Authorization: `Bearer ${idToken}` } });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '불러오기 실패');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { reload(); }, [reload]);

  const rate = data?.exchangeRate || 1450;
  const products = data ? Object.entries(data.byProduct).filter(([, v]) => v.count > 0) : [];

  return (
    <div className="min-h-screen" style={{ background: '#0a0b14' }}>
      <Header language={language} t={t} onLanguageChange={changeLanguage} />
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <Link to="/admin" className="inline-flex items-center gap-1.5 text-white/60 hover:text-white text-sm">
            <ArrowLeft size={16} /> 어드민
          </Link>
          <button onClick={reload} disabled={loading} className="px-3 py-1.5 rounded-lg text-sm text-white/80" style={cardStyle}>
            {loading ? '갱신 중...' : '↻ 갱신'}
          </button>
        </div>
        <h1 className="text-[22px] font-black text-white mb-1">☀️ 어제 회사 한 장</h1>
        <p className="text-[12px] text-white/40 mb-2">텔레그램 모닝브리핑과 동일 집계 · KST 기준</p>

        {error && <p className="text-red-400 text-sm py-8">{error}</p>}
        {!data && !error && <p className="text-white/40 py-12 text-center">{loading ? '불러오는 중...' : '데이터 없음'}</p>}

        {data && (
          <>
            {/* 💰 재무 */}
            <SectionTitle icon="💰" title="재무" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <KpiCard title="어제 매출" bucket={data.revenue} rate={rate} />
              <KpiCard title="이번주 누적" bucket={data.trends.week} rate={rate} />
              <KpiCard title="이번달 누적" bucket={data.trends.month} rate={rate} />
            </div>
            <div className="rounded-2xl p-5 mt-3" style={cardStyle}>
              {products.length > 0 ? (
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-white/70">
                  {products.map(([k, v]) => <span key={k}>{k} <b className="text-white">{v.count}건</b> {fmtUSD(v.usd)}</span>)}
                </div>
              ) : <p className="text-[13px] text-white/40">어제 예약 없음</p>}
              <p className="text-[13px] text-white/70 mt-2">🤖 AI 플래너 유료 <b className="text-white">{data.aiPlanner.paidCount}건</b> · 수수료 {fmtUSD(data.aiPlanner.feeUsd)} &nbsp;·&nbsp; 👤 신규 가입 <b className="text-white">{data.newUsers}명</b></p>
            </div>

            {/* 🛠️ 운영 */}
            <SectionTitle icon="🛠️" title="운영" />
            <div className="rounded-2xl p-5" style={cardStyle}>
              {data.errors.total === 0 ? (
                <p className="text-[14px] text-emerald-300">어제 오류 <b>0건</b> ✅</p>
              ) : (
                <>
                  <p className="text-[14px] text-white/80">어제 오류 <b className="text-white">{data.errors.total}건</b> <span className="text-white/50 text-[12px]">(심각 {data.errors.bySeverity.critical} · 높음 {data.errors.bySeverity.high} · 보통 {data.errors.bySeverity.medium} · 낮음 {data.errors.bySeverity.low})</span></p>
                  {data.errors.top.length > 0 && (
                    <ul className="mt-2 text-[12px] text-white/50 space-y-0.5">
                      {data.errors.top.map((t) => <li key={t.key}>· {t.key} {t.count}회</li>)}
                    </ul>
                  )}
                </>
              )}
            </div>

            {/* 📣 마케팅 */}
            <SectionTitle icon="📣" title="마케팅" />
            <div className="rounded-2xl p-5" style={cardStyle}>
              {data.marketing && !data.marketing.skipped ? (
                <p className="text-[14px] text-white/80">어제 방문자 <b className="text-white">{(data.marketing.visitors || 0).toLocaleString()}명</b> · 결제 전환 <b className="text-white">{data.marketing.conversions || 0}건</b></p>
              ) : (
                <p className="text-[13px] text-white/40">데이터 수집 중 (PostHog {data.marketing?.reason || '미연동'})</p>
              )}
            </div>

            {/* 💬 고객 */}
            <SectionTitle icon="💬" title="고객" />
            <div className="rounded-2xl p-5" style={cardStyle}>
              <p className="text-[14px] text-white/80">신규 문의 <b className="text-white">{data.customer.newTickets}건</b> · 리뷰요청 발송 <b className="text-white">{data.customer.reviewsSent}건</b></p>
            </div>

            <p className="text-[11px] text-white/30 mt-6">환율 ₩{rate.toLocaleString()}/$ · 제외 {data.meta.excludedBypass + data.meta.excludedCanceled}건(테스트·취소) · {new Date(data.generatedAt).toLocaleString('ko-KR')}</p>
          </>
        )}
      </div>
    </div>
  );
}
