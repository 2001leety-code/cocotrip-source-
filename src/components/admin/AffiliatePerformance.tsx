/**
 * 관리자 매출판 — 제휴 노출 → 클릭 성과. (2026-08-02)
 *
 * PostHog 에 이미 쌓이고 있는 affiliate_impression / affiliate_click 두 이벤트만 읽는다.
 * 새로 수집하는 값도, 새 공개 쓰기 API 도 없다. 인증은 기존 관리자 토큰 그대로.
 */
import { useEffect, useState } from 'react';
import { Eye, Info, Loader2, MousePointerClick, Percent } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';

interface AffiliateBucket {
  key: string;
  impressions: number;
  clicks: number;
  ctr: number;
}

interface AffiliateResponse {
  days: number;
  summary: { impressions: number; clicks: number; ctr: number };
  byProduct: AffiliateBucket[];
  byPlacement: AffiliateBucket[];
  byLanguage: AffiliateBucket[];
  generatedAt: string;
}

const cardStyle = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.10)',
};

/** 표 한 벌의 열 폭 — 헤더와 행이 어긋나지 않게 한 곳에서만 정의한다. */
const GRID_COLS = 'grid-cols-[minmax(0,1fr)_72px_60px_56px]';

const PRODUCT_LABELS: Record<string, string> = {
  esim: 'eSIM',
  hotel: '호텔',
  flight: '항공',
  train: '기차',
  carRental: '렌터카',
  attraction: '관광지',
};

const PLACEMENT_LABELS: Record<string, string> = {
  home_hero_cards: '홈 핵심 카드',
  home_trip_essentials: '홈 여행 준비',
  plan_pretrip: '플랜 여행 준비',
  plan_stop: '플랜 장소 카드',
  plan_outro: '플랜 마지막',
  tour_detail: '투어 상세',
  tours_list: '투어 목록',
  wizard_zone_recommender: '플래너 지역 추천',
};

const LANGUAGE_LABELS: Record<string, string> = {
  en: '영어', ko: '한국어', ja: '일본어', zh: '중국어',
};

/** 내부 키를 운영자가 바로 이해할 수 있는 표시명으로 바꾼다. */
function displayLabel(key: string, labels: Record<string, string>) {
  return labels[key] || key.replaceAll('_', ' ');
}

/** 제휴 노출·클릭 한 행. */
function PerformanceRow({ bucket, labels }: { bucket: AffiliateBucket; labels: Record<string, string> }) {
  return (
    <div className={`grid ${GRID_COLS} items-center gap-2 border-t border-white/[0.06] py-2.5 text-[11px]`}>
      <span className="truncate font-semibold text-white/80">{displayLabel(bucket.key, labels)}</span>
      <span className="text-right tabular-nums text-white/55">{bucket.impressions.toLocaleString()}</span>
      <span className="text-right tabular-nums text-white/80">{bucket.clicks.toLocaleString()}</span>
      <span className="text-right tabular-nums font-bold text-[#CFA8F5]">{bucket.ctr.toFixed(1)}%</span>
    </div>
  );
}

/** 차원 하나(상품·위치·언어)의 표 한 벌. */
function PerformanceTable(
  { title, rows, labels }: { title: string; rows: AffiliateBucket[]; labels: Record<string, string> },
) {
  return (
    <div>
      <div className={`grid ${GRID_COLS} gap-2 pb-2 text-[9px] font-bold uppercase tracking-wider text-white/45`}>
        <span>{title}</span><span className="text-right">노출</span><span className="text-right">클릭</span><span className="text-right">CTR</span>
      </div>
      {rows.slice(0, 8).map((bucket) => <PerformanceRow key={bucket.key} bucket={bucket} labels={labels} />)}
    </div>
  );
}

/** PostHog 실데이터로 제휴 노출→클릭 성과를 관리자 매출판에 표시한다. */
export function AffiliatePerformance({ days }: { days: number }) {
  const [data, setData] = useState<AffiliateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // authFetch 가 로그인 상태를 알아서 처리한다 — 여기서 user 를 기다리며
    // 로딩 표시에 갇히지 않도록(토큰이 없으면 서버가 401 을 주고 그대로 오류로 보인다).
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await authFetch(`/api/admin-posthog-affiliate?days=${days}`);
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.ok) throw new Error(body?.error || `HTTP ${response.status}`);
        if (!cancelled) setData(body.data as AffiliateResponse);
      } catch (loadError) {
        if (!cancelled) {
          setData(null);
          setError(loadError instanceof Error ? loadError.message : '제휴 성과 조회 실패');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [days]);

  return (
    <section className="rounded-2xl p-5" style={cardStyle} aria-labelledby="affiliate-performance-title">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="affiliate-performance-title" className="text-[14px] font-bold text-white">제휴 링크 성과</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-white/60">운영 도메인(cocotripkr.com)에서 동의한 사용자만 집계 · 최근 {days}일</p>
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-[#CFA8F5]" aria-label="불러오는 중" />}
      </div>

      {error && <p className="rounded-xl border border-red-400/25 bg-red-400/10 px-3 py-2 text-[11px] text-red-200" role="alert">{error}</p>}

      {data && (
        <>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: '노출', value: data.summary.impressions.toLocaleString(), icon: Eye },
              { label: '클릭', value: data.summary.clicks.toLocaleString(), icon: MousePointerClick },
              { label: '클릭률', value: `${data.summary.ctr.toFixed(1)}%`, icon: Percent },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
                <Icon className="mb-2 h-4 w-4 text-[#CFA8F5]" aria-hidden="true" />
                <p className="text-[10px] font-semibold text-white/60">{label}</p>
                <p className="mt-0.5 text-[18px] font-black tabular-nums text-white">{value}</p>
              </div>
            ))}
          </div>

          {data.summary.impressions === 0 && data.summary.clicks === 0 ? (
            <p className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-4 text-center text-[11px] text-white/60">
              이 기간에는 운영 사이트의 제휴 노출·클릭 데이터가 없습니다.
            </p>
          ) : (
            <div className="mt-5 grid gap-5 lg:grid-cols-3">
              <PerformanceTable title="상품" rows={data.byProduct} labels={PRODUCT_LABELS} />
              <PerformanceTable title="노출 위치" rows={data.byPlacement} labels={PLACEMENT_LABELS} />
              <PerformanceTable title="언어" rows={data.byLanguage || []} labels={LANGUAGE_LABELS} />
            </div>
          )}

          <div className="mt-4 flex items-start gap-2 rounded-xl border border-blue-300/15 bg-blue-300/[0.05] px-3 py-2.5 text-[10px] leading-relaxed text-white/60">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-200" aria-hidden="true" />
            <span>이 화면은 CocoTrip 안의 노출과 클릭까지만 보여줍니다. 실제 제휴 예약·수수료는 파트너사 보고서와 대조해야 확정됩니다.</span>
          </div>
        </>
      )}
    </section>
  );
}
