// useTourRatingAggregates — 전체 투어의 실 후기 집계(평균평점·개수)를 1회 fetch 해서
// 모듈 캐시에 보관. 여러 TourCard 가 각자 호출해도 실제 네트워크는 1번(inflight 공유).
// 소스 = /api/reviews action=aggregate (published 리뷰만) → 가짜 없음, count>0 일 때만 노출.
// key = targetId = 투어 slug (ReviewList/TourDetail 이 targetId 로 slug 사용하는 것과 일치).
import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/authFetch';

export type RatingAgg = { rating: number; count: number };
type AggMap = Record<string, RatingAgg>;

let cache: AggMap | null = null;
let inflight: Promise<AggMap> | null = null;

function loadAggregates(): Promise<AggMap> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  // authFetch = mistake-lint P43 준수(/api 호출은 authFetch). aggregate 는 public 엔드포인트라
  // 비로그인도 헤더 없이 200(리뷰 list 와 동일 무인증) — 익명 방문자도 배지 표시됨.
  inflight = authFetch('/api/reviews', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'aggregate', targetType: 'tour' }),
  })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('agg fetch failed'))))
    .then((d) => {
      const agg = (d?.data?.aggregates || d?.aggregates || {}) as AggMap;
      cache = agg;
      return agg;
    })
    .catch(() => {
      cache = {}; // 실패 = 빈 집계(배지 미노출). 무해.
      return {};
    })
    .finally(() => { inflight = null; });
  return inflight;
}

/** 전체 투어 실후기 집계 맵 { [slug]: {rating, count} }. 로드 전 = 빈 객체. */
export function useTourRatingAggregates(): AggMap {
  const [agg, setAgg] = useState<AggMap>(cache || {});
  useEffect(() => {
    let cancelled = false;
    loadAggregates().then((a) => { if (!cancelled) setAgg(a); });
    return () => { cancelled = true; };
  }, []);
  return agg;
}
