/**
 * AdminPromoStats — 여름 이벤트 프로모션 쿠폰 현황 어드민 페이지
 *
 * Route: /admin/promo-stats (gated by AdminRoute)
 * Backend: GET /api/admin-promo-stats
 *
 * 표시 항목:
 *   - 쿠폰 현황: 종류별(AI무료·차터·투어) 발급 수·사용 수·사용률
 *   - 프로모션 KPI: 가입 수·AI무료쿠폰 사용 수·무료→유료 전환율
 *   - 최근 무료 플랜 5건
 */
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Loader2, Gift, TrendingUp, Users, Ticket } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

interface CouponBucket {
  issued: number;
  used: number;
  rate: number;
}

interface PromoData {
  coupons: {
    aiPlan: CouponBucket;
    charter: CouponBucket;
    tourPackage: CouponBucket;
    total: { issued: number; used: number };
  };
  kpi: {
    promoSignups: number;
    aiCouponUsed: number;
    freePlanCount: number;
    conversionRate: number;
  };
  recentFreePlans: Array<{
    planId: string;
    userEmail: string | null;
    createdAt: number | null;
    region: string | null;
    days: number | null;
  }>;
  generatedAt: number;
}

function formatTs(ms: number | null): string {
  if (!ms) return '-';
  return new Date(ms).toLocaleString('ko-KR', { hour12: false });
}

function RateBar({ rate }: { rate: number }) {
  return (
    <div className="mt-2 h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
      <div
        className="h-full rounded-full bg-gradient-to-r from-[#7C5CFC] to-[#B668FC] transition-all duration-500"
        style={{ width: `${Math.min(rate, 100)}%` }}
      />
    </div>
  );
}

function CouponCard({
  label,
  emoji,
  bucket,
  color,
}: {
  label: string;
  emoji: string;
  bucket: CouponBucket;
  color: string;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${color}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-white/55 uppercase tracking-wider">{label}</span>
        <span className="text-xl">{emoji}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center mb-2">
        <div>
          <p className="text-lg font-extrabold text-white">{bucket.issued.toLocaleString()}</p>
          <p className="text-[10px] text-white/45 mt-0.5">발급</p>
        </div>
        <div>
          <p className="text-lg font-extrabold text-white">{bucket.used.toLocaleString()}</p>
          <p className="text-[10px] text-white/45 mt-0.5">사용</p>
        </div>
        <div>
          <p className="text-lg font-extrabold text-white">{bucket.rate}%</p>
          <p className="text-[10px] text-white/45 mt-0.5">사용률</p>
        </div>
      </div>
      <RateBar rate={bucket.rate} />
    </div>
  );
}

export default function AdminPromoStats() {
  const { user } = useAuth();
  const [data, setData] = useState<PromoData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = user?.email === (import.meta.env.VITE_ADMIN_EMAIL || '2001leety@gmail.com');

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin-promo-stats', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'unknown');
      setData(json.data as PromoData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#080b14' }}>
        <p className="text-white/60">관리자 전용 페이지입니다.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ background: '#080b14' }}>
      {/* Header */}
      <div className="border-b border-white/[0.06] bg-[#0c1220]/95 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-3 sm:px-5 py-3 sm:py-4 flex items-center justify-between gap-4">
          <Link to="/admin" className="flex items-center gap-2 text-white/60 hover:text-white text-sm min-h-[44px]">
            <ArrowLeft className="w-4 h-4" />
            관리자 홈
          </Link>
          <div className="flex items-center gap-2">
            <Gift className="w-5 h-5 text-[#B668FC]" />
            <h1 className="text-sm sm:text-base font-bold text-white">프로모션 쿠폰 현황</h1>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-white/55 hover:text-white min-h-[44px]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            새로고침
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-3 sm:px-5 py-4 sm:py-6 space-y-5">
        {error ? (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-200">
            오류: {error}
          </div>
        ) : null}

        {loading && !data ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-white/55" />
          </div>
        ) : data ? (
          <>
            {/* ── 프로모션 KPI ── */}
            <section>
              <h2 className="text-xs font-bold text-white/45 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5" />
                프로모션 KPI
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4 text-center">
                  <span className="text-xl block mb-1">👥</span>
                  <p className="text-2xl font-extrabold text-white">{data.kpi.promoSignups.toLocaleString()}</p>
                  <p className="text-[11px] text-white/45 mt-1">프로모션 가입</p>
                  <p className="text-[10px] text-white/30 mt-0.5">쿠폰 자동발급된 신규 회원</p>
                </div>
                <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4 text-center">
                  <span className="text-xl block mb-1">🎟️</span>
                  <p className="text-2xl font-extrabold text-white">{data.kpi.aiCouponUsed.toLocaleString()}</p>
                  <p className="text-[11px] text-white/45 mt-1">AI무료 쿠폰 사용</p>
                  <p className="text-[10px] text-white/30 mt-0.5">WELCOME-AIPLAN 사용 건</p>
                </div>
                <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4 text-center">
                  <span className="text-xl block mb-1">📑</span>
                  <p className="text-2xl font-extrabold text-white">{data.kpi.freePlanCount.toLocaleString()}</p>
                  <p className="text-[11px] text-white/45 mt-1">무료 플랜 발행</p>
                  <p className="text-[10px] text-white/30 mt-0.5">₩0 결제 플랜 (isFreeCoupon)</p>
                </div>
                <div className="bg-[#7C5CFC]/10 border border-[#7C5CFC]/30 rounded-2xl p-4 text-center">
                  <span className="text-xl block mb-1">📈</span>
                  <p className="text-2xl font-extrabold text-[#B9A4FF]">{data.kpi.conversionRate}%</p>
                  <p className="text-[11px] text-white/45 mt-1">무료 사용률</p>
                  <p className="text-[10px] text-white/30 mt-0.5">가입자 대비 무료플랜 사용</p>
                </div>
              </div>
            </section>

            {/* ── 쿠폰 종류별 현황 ── */}
            <section>
              <h2 className="text-xs font-bold text-white/45 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Ticket className="w-3.5 h-3.5" />
                쿠폰 종류별 현황
                <span className="ml-1 text-white/30 font-normal">(onboarding 발급 기준, Firestore collectionGroup)</span>
              </h2>

              {/* 전체 합계 배너 */}
              <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3 mb-3 flex items-center justify-between">
                <span className="text-xs text-white/55">전체 발급 / 사용</span>
                <span className="text-sm font-bold text-white">
                  {data.coupons.total.issued.toLocaleString()} 발급
                  <span className="text-white/45 mx-1.5">·</span>
                  {data.coupons.total.used.toLocaleString()} 사용
                  <span className="text-white/45 mx-1.5">·</span>
                  <span className="text-[#B9A4FF]">
                    {data.coupons.total.issued > 0
                      ? Math.round((data.coupons.total.used / data.coupons.total.issued) * 100)
                      : 0}% 사용률
                  </span>
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <CouponCard
                  label="AI 플랜 무료"
                  emoji="🤖"
                  bucket={data.coupons.aiPlan}
                  color="bg-[#7C5CFC]/[0.08] border-[#7C5CFC]/25"
                />
                <CouponCard
                  label="차터 5% 할인"
                  emoji="🚐"
                  bucket={data.coupons.charter}
                  color="bg-emerald-500/[0.06] border-emerald-500/20"
                />
                <CouponCard
                  label="투어 5% 할인"
                  emoji="🗺️"
                  bucket={data.coupons.tourPackage}
                  color="bg-amber-500/[0.06] border-amber-500/20"
                />
              </div>
            </section>

            {/* ── 최근 무료 플랜 ── */}
            {data.recentFreePlans.length > 0 ? (
              <section>
                <h2 className="text-xs font-bold text-white/45 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" />
                  최근 무료 플랜 (최신 5건)
                </h2>
                <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-white/40">
                        <th className="text-left px-4 py-3 font-medium">발급 시각</th>
                        <th className="text-left px-4 py-3 font-medium">이메일</th>
                        <th className="text-left px-4 py-3 font-medium">지역</th>
                        <th className="text-left px-4 py-3 font-medium">기간</th>
                        <th className="text-left px-4 py-3 font-medium">Plan ID</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04]">
                      {data.recentFreePlans.map((plan) => (
                        <tr key={plan.planId} className="hover:bg-white/[0.02] transition-colors">
                          <td className="px-4 py-3 text-[11px] text-white/55">{formatTs(plan.createdAt)}</td>
                          <td className="px-4 py-3 text-[12px] text-white/80 max-w-[180px] truncate">
                            {plan.userEmail || <span className="text-white/30 italic">-</span>}
                          </td>
                          <td className="px-4 py-3 text-[12px] text-white/70">{plan.region || '-'}</td>
                          <td className="px-4 py-3 text-[12px] text-white/70">{plan.days != null ? `${plan.days}일` : '-'}</td>
                          <td className="px-4 py-3">
                            <span className="font-mono text-[10px] text-[#B9A4FF] bg-[#7C5CFC]/10 px-2 py-0.5 rounded">
                              {plan.planId.slice(0, 8)}…
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : (
              <div className="text-center py-8 text-white/30 text-sm">
                무료 쿠폰 플랜 없음 (isFreeCoupon 필드 확인)
              </div>
            )}

            {/* 집계 시각 */}
            <p className="text-[10px] text-white/25 text-right">
              집계 기준: {formatTs(data.generatedAt)} · Firestore collectionGroup(coupons) + plans 실시간
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
