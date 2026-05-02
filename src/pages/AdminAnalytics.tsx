// AdminAnalytics — 통계 대시보드 (Firestore 실데이터)
import { useState, useEffect, useMemo } from 'react';
import { BarChart3, TrendingUp, Users, Calendar, Map as MapIcon, ArrowUpRight, ArrowDownRight, Activity, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';

// 환율 — booking-processor.js와 동일 기본값. 실시간 환율은 별도 API 호출 비용이 있어 평균값 사용.
const USD_TO_KRW = 1380;

interface BookingDoc {
  tourDate?: string;        // YYYY-MM-DD
  productType?: string;
  paxCount?: number;
  amountUSD?: string | number;
  status?: string;
  adminStatus?: string;
  userEmail?: string;
}

interface MonthBucket {
  ymKey: string;            // YYYY-MM
  monthLabel: string;       // 1월, 2월…
  count: number;
  revenueUSD: number;
}

interface TourCount {
  productType: string;
  displayName: string;
  count: number;
}

interface ShareSlice {
  category: string;
  color: string;
  count: number;
  percent: number;
}

interface KpiCard {
  label: string;
  value: string;
  trend: string;
  isUp: boolean;
  icon: typeof TrendingUp;
  color: string;
  bg: string;
}

// 한국 카테고리 라벨
const PRODUCT_LABELS: Record<string, string> = {
  ai_planner_full:        'AI 플래너 (풀버전)',
  charter_seoul_city:     '서울 시내 전세',
  charter_seoul_suburb:   '서울 근교 전세',
  charter_dmz:            'DMZ 전세 투어',
  charter_gangwon:        '강원도 전세',
  charter_ski:            '스키 리조트 전세',
  charter_gyeongju:       '경주·전주 전세',
  charter_busan:          '부산 당일 전세',
  airport_seoul_central:  '인천공항→서울 도심',
  airport_seoul_gangnam:  '인천공항→강남',
  airport_gapyeong_nami:  '인천공항→가평/남이섬',
  airport_pyeongchang_yongpyong: '인천공항→평창',
  combo_airport_seoul:    '콤보 (공항+서울 시내)',
  combo_airport_nami:     '콤보 (공항+남이섬)',
  combo_airport_dmz:      '콤보 (공항+DMZ)',
  combo_airport_gangwon:  '콤보 (공항+강원)',
  combo_airport_busan:    '콤보 (공항+부산)',
  kpop_shuttle_oneway:    'K-pop 셔틀 (편도)',
  kpop_shuttle_roundtrip: 'K-pop 셔틀 (왕복)',
};

function categorizeProduct(productType: string): string {
  if (!productType) return '기타';
  if (productType.startsWith('ai_planner')) return 'AI 플래너 맞춤형';
  if (productType.startsWith('charter')) return '전세차량 (Charter)';
  if (productType.startsWith('airport')) return '공항 픽업';
  if (productType.startsWith('combo')) return '콤보 패키지';
  if (productType.startsWith('kpop')) return 'K-pop 셔틀';
  return '기타';
}

const CATEGORY_COLORS: Record<string, string> = {
  'AI 플래너 맞춤형': 'bg-purple-500',
  '전세차량 (Charter)': 'bg-blue-500',
  '공항 픽업': 'bg-emerald-500',
  '콤보 패키지': 'bg-amber-500',
  'K-pop 셔틀': 'bg-pink-500',
  '기타': 'bg-gray-500',
};

function isCancelled(b: BookingDoc): boolean {
  const s = (b.adminStatus || b.status || '').toLowerCase();
  return s === 'canceled' || s === 'cancelled';
}

function formatTrend(curr: number, prev: number): { trend: string; isUp: boolean } {
  if (prev === 0) {
    return { trend: curr > 0 ? '신규' : '0%', isUp: curr > 0 };
  }
  const pct = ((curr - prev) / prev) * 100;
  const isUp = pct >= 0;
  return { trend: `${isUp ? '+' : ''}${pct.toFixed(1)}%`, isUp };
}

export default function AdminAnalytics() {
  const [bookings, setBookings] = useState<BookingDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const yearStart = `${new Date().getFullYear()}-01-01`;
    const q = query(
      collection(db, 'bookings'),
      where('tourDate', '>=', yearStart),
    );
    getDocs(q)
      .then((snap) => {
        const list: BookingDoc[] = [];
        snap.forEach((d) => list.push(d.data() as BookingDoc));
        setBookings(list);
        setLoading(false);
      })
      .catch((err) => {
        console.error('[AdminAnalytics] load error:', err);
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const now = new Date();
  const thisYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevYM = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

  const validBookings = useMemo(() => bookings.filter((b) => !isCancelled(b)), [bookings]);

  // ── KPI ────────────────────────────────────────────────────────────
  const kpis: KpiCard[] = useMemo(() => {
    const thisMonth = validBookings.filter((b) => (b.tourDate || '').startsWith(thisYM));
    const prevMonth = validBookings.filter((b) => (b.tourDate || '').startsWith(prevYM));

    const sumUSD = (arr: BookingDoc[]) => arr.reduce((s, b) => s + parseFloat(String(b.amountUSD || 0)), 0);

    const thisRevUSD = sumUSD(thisMonth);
    const prevRevUSD = sumUSD(prevMonth);
    const thisCount = thisMonth.length;
    const prevCount = prevMonth.length;

    const thisAi = thisMonth.filter((b) => (b.productType || '').startsWith('ai_planner')).length;
    const prevAi = prevMonth.filter((b) => (b.productType || '').startsWith('ai_planner')).length;
    const thisAiPct = thisCount > 0 ? (thisAi / thisCount) * 100 : 0;
    const prevAiPct = prevCount > 0 ? (prevAi / prevCount) * 100 : 0;

    const thisAvg = thisCount > 0 ? thisRevUSD / thisCount : 0;
    const prevAvg = prevCount > 0 ? prevRevUSD / prevCount : 0;

    const revTrend = formatTrend(thisRevUSD, prevRevUSD);
    const cntTrend = formatTrend(thisCount, prevCount);
    const aiTrend = formatTrend(thisAiPct, prevAiPct);
    const avgTrend = formatTrend(thisAvg, prevAvg);

    return [
      {
        label: `이번 달 총 매출`,
        value: `₩${Math.round(thisRevUSD * USD_TO_KRW).toLocaleString('ko-KR')}`,
        trend: revTrend.trend,
        isUp: revTrend.isUp,
        icon: TrendingUp,
        color: 'text-emerald-400',
        bg: 'bg-emerald-400/10',
      },
      {
        label: '이번 달 예약 건수',
        value: `${thisCount}건`,
        trend: cntTrend.trend,
        isUp: cntTrend.isUp,
        icon: Calendar,
        color: 'text-blue-400',
        bg: 'bg-blue-400/10',
      },
      {
        label: 'AI 플래너 비율',
        value: `${thisAiPct.toFixed(1)}%`,
        trend: aiTrend.trend,
        isUp: aiTrend.isUp,
        icon: Activity,
        color: 'text-purple-400',
        bg: 'bg-purple-400/10',
      },
      {
        label: '평균 예약 단가',
        value: `$${thisAvg.toFixed(0)}`,
        trend: avgTrend.trend,
        isUp: avgTrend.isUp,
        icon: Users,
        color: 'text-orange-400',
        bg: 'bg-orange-400/10',
      },
    ];
  }, [validBookings, thisYM, prevYM]);

  // ── Top Tours ──────────────────────────────────────────────────────
  const topTours: TourCount[] = useMemo(() => {
    const thisMonth = validBookings.filter((b) => (b.tourDate || '').startsWith(thisYM));
    const counts = new Map<string, number>();
    thisMonth.forEach((b) => {
      const t = b.productType || 'unknown';
      counts.set(t, (counts.get(t) || 0) + 1);
    });
    const arr: TourCount[] = Array.from(counts.entries())
      .map(([productType, count]) => ({
        productType,
        displayName: PRODUCT_LABELS[productType] || productType,
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    return arr;
  }, [validBookings, thisYM]);

  const topToursMax = topTours[0]?.count || 1;

  // ── Monthly Trend (지난 8개월) ────────────────────────────────────
  const monthlyTrend: MonthBucket[] = useMemo(() => {
    const buckets: MonthBucket[] = [];
    for (let i = 7; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ymKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const monthLabel = `${d.getMonth() + 1}월`;
      buckets.push({ ymKey, monthLabel, count: 0, revenueUSD: 0 });
    }
    validBookings.forEach((b) => {
      const ym = (b.tourDate || '').slice(0, 7);
      const bucket = buckets.find((x) => x.ymKey === ym);
      if (bucket) {
        bucket.count++;
        bucket.revenueUSD += parseFloat(String(b.amountUSD || 0));
      }
    });
    return buckets;
  }, [validBookings, now]);

  const trendMaxCount = Math.max(1, ...monthlyTrend.map((b) => b.count));

  // ── Product Shares ─────────────────────────────────────────────────
  const productShares: ShareSlice[] = useMemo(() => {
    const thisMonth = validBookings.filter((b) => (b.tourDate || '').startsWith(thisYM));
    const cats = new Map<string, number>();
    thisMonth.forEach((b) => {
      const c = categorizeProduct(b.productType || '');
      cats.set(c, (cats.get(c) || 0) + 1);
    });
    const total = thisMonth.length || 1;
    const arr: ShareSlice[] = Array.from(cats.entries())
      .map(([category, count]) => ({
        category,
        color: CATEGORY_COLORS[category] || 'bg-gray-500',
        count,
        percent: Math.round((count / total) * 100),
      }))
      .sort((a, b) => b.count - a.count);
    return arr;
  }, [validBookings, thisYM]);

  const isEmpty = !loading && bookings.length === 0;

  return (
    <div className="min-h-screen bg-[#0a0b14] text-white pt-20 px-4 pb-12 lg:px-8 font-sans">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-[#FBBF24]" />
              통계 및 분석 대시보드
              {loading && <Loader2 className="w-4 h-4 animate-spin text-gray-500" />}
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              {error ? <span className="text-red-400">⚠ {error}</span> : `Firestore 실데이터 · 환율 1 USD = ₩${USD_TO_KRW.toLocaleString()} (고정)`}
            </p>
          </div>
          <div className="flex gap-3">
            <Link to="/admin/calendar" className="px-4 py-2 bg-[#1a1b26] hover:bg-gray-800 border border-gray-800 rounded-lg text-sm font-medium transition-colors text-gray-300 flex items-center gap-2">
              <Calendar className="w-4 h-4" /> 캘린더
            </Link>
            <Link to="/admin/ops" className="px-4 py-2 bg-[#1a1b26] hover:bg-gray-800 border border-gray-800 rounded-lg text-sm font-medium transition-colors text-gray-300 flex items-center gap-2">
              <MapIcon className="w-4 h-4" /> 운영 허브
            </Link>
          </div>
        </div>

        {isEmpty && (
          <div className="bg-[#12131C] border border-gray-800 rounded-2xl p-12 text-center text-gray-400 mb-6">
            <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">올해 예약 데이터가 아직 없습니다.</p>
            <p className="text-sm mt-1">첫 예약이 들어오면 자동으로 차트가 그려집니다.</p>
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {kpis.map((kpi, idx) => (
            <div key={idx} className="bg-[#12131C] border border-gray-800 rounded-2xl p-5 shadow-lg relative overflow-hidden group hover:border-gray-700 transition-colors">
              <div className={`absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-transparent to-white/5 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110`} />
              <div className="flex justify-between items-start mb-4 relative z-10">
                <div className={`p-3 rounded-xl ${kpi.bg}`}>
                  <kpi.icon className={`w-6 h-6 ${kpi.color}`} />
                </div>
                <div className={`flex items-center gap-1 text-sm font-medium px-2 py-1 rounded-full ${kpi.isUp ? 'text-emerald-400 bg-emerald-400/10' : 'text-red-400 bg-red-400/10'}`}>
                  {kpi.isUp ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                  {kpi.trend}
                </div>
              </div>
              <div className="relative z-10">
                <p className="text-gray-400 text-sm font-medium mb-1">{kpi.label}</p>
                <h3 className="text-2xl font-bold text-white">{kpi.value}</h3>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Top Tours */}
          <div className="lg:col-span-2 bg-[#12131C] border border-gray-800 rounded-2xl p-6 shadow-xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <MapIcon className="w-5 h-5 text-blue-400" />
                인기 투어 TOP 5 (이번 달)
              </h2>
              <span className="text-xs text-gray-500">{thisYM}</span>
            </div>
            {topTours.length === 0 ? (
              <div className="text-center py-12 text-gray-500 text-sm">이번 달 예약 없음</div>
            ) : (
              <div className="space-y-5">
                {topTours.map((tour, idx) => {
                  const pct = (tour.count / topToursMax) * 100;
                  return (
                    <div key={idx}>
                      <div className="flex justify-between text-sm mb-2">
                        <span className="font-medium text-gray-200">{idx + 1}. {tour.displayName}</span>
                        <span className="text-gray-400 font-bold">{tour.count}건</span>
                      </div>
                      <div className="w-full bg-[#0a0b14] rounded-full h-2.5 overflow-hidden">
                        <div
                          className="bg-gradient-to-r from-blue-600 to-blue-400 h-2.5 rounded-full transition-all duration-1000 ease-out"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Product Share */}
          <div className="bg-[#12131C] border border-gray-800 rounded-2xl p-6 shadow-xl flex flex-col">
            <h2 className="text-lg font-bold mb-6">상품 유형별 점유율</h2>

            <div className="flex-1 flex flex-col justify-center gap-6">
              {productShares.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">데이터 없음</div>
              ) : (
                <>
                  <div className="space-y-4">
                    {productShares.map((product, idx) => (
                      <div key={idx} className="relative">
                        <div className="flex justify-between text-sm mb-1.5">
                          <span className="text-gray-300 flex items-center gap-2">
                            <span className={`w-3 h-3 rounded-full ${product.color}`}></span>
                            {product.category}
                          </span>
                          <span className="font-bold">{product.percent}%</span>
                        </div>
                        <div className="w-full bg-[#0a0b14] rounded-full h-2">
                          <div className={`h-2 rounded-full ${product.color}`} style={{ width: `${product.percent}%` }}></div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 p-4 bg-purple-500/10 border border-purple-500/20 rounded-xl">
                    <p className="text-sm text-purple-300 font-medium flex items-start gap-2">
                      <Activity className="w-5 h-5 shrink-0" />
                      이번 달 가장 많이 예약된 상품군: <strong>{productShares[0]?.category}</strong> ({productShares[0]?.count}건)
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Monthly Trend Chart */}
          <div className="lg:col-span-3 bg-[#12131C] border border-gray-800 rounded-2xl p-6 shadow-xl">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-lg font-bold">월별 예약 추이 (지난 8개월)</h2>
              <div className="flex gap-2">
                <span className="px-3 py-1 text-xs font-medium bg-[#0a0b14] border border-gray-800 rounded-lg text-gray-400">{now.getFullYear()}년</span>
              </div>
            </div>

            <div className="h-64 flex items-end justify-between gap-2 md:gap-4 px-2 md:px-6 relative">
              {/* Grid Lines */}
              <div className="absolute inset-0 flex flex-col justify-between pointer-events-none pb-8">
                {[100, 75, 50, 25, 0].map((step) => (
                  <div key={step} className="w-full border-b border-gray-800/50 flex items-center">
                    <span className="absolute -left-2 md:left-0 text-[10px] text-gray-600 -translate-y-1/2">{step}%</span>
                  </div>
                ))}
              </div>

              {/* Bars */}
              {monthlyTrend.map((data, idx) => {
                const isCurrent = data.ymKey === thisYM;
                const heightPct = trendMaxCount > 0 ? (data.count / trendMaxCount) * 100 : 0;
                return (
                  <div key={idx} className="relative flex flex-col items-center flex-1 h-full justify-end group z-10">
                    <div className="opacity-0 group-hover:opacity-100 absolute -top-12 bg-gray-800 text-white text-xs py-1 px-2 rounded transition-opacity whitespace-nowrap pointer-events-none">
                      {data.count}건 · ${data.revenueUSD.toFixed(0)}
                    </div>
                    <div
                      className={`w-full max-w-[40px] rounded-t-sm transition-all duration-500 ease-out ${
                        isCurrent ? 'bg-[#FBBF24] shadow-[0_0_15px_rgba(251,191,36,0.3)]' : 'bg-indigo-500/80 hover:bg-indigo-400'
                      }`}
                      style={{ height: `${heightPct}%`, minHeight: data.count > 0 ? '4px' : '0' }}
                    />
                    <span className={`text-xs mt-3 ${isCurrent ? 'text-[#FBBF24] font-bold' : 'text-gray-400'}`}>
                      {data.monthLabel}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
