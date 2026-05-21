// ─────────────────────────────────────────────────────────────────────────────
// zone-courses-trend.ts — Trend hints + Rebuild transit 클라이언트
// /api/admin-zone-course-trend-hints + /api/admin-rebuild-zone-course-transit
//
// admin 만 사용. Firebase ID token 필요.
// ─────────────────────────────────────────────────────────────────────────────
import type { User } from 'firebase/auth';
import type { ZoneCourseTransit, ZoneCourseStop } from '@/data/zone_courses/types';

export interface RisingSpotHint {
  spotId: string;
  name: string;
  query?: string;
  link?: string;
  address?: string;
  rating?: number;
  reviewCount?: number;
  rating_delta?: number;
  reviewCount_delta?: number;
  scanned_at?: string;
}

export interface PainpointHint {
  reddit_post_id: string;
  subreddit: string;
  title: string;
  selftext?: string;
  score: number;
  comments_count: number;
  url?: string;
  detected_regions?: string[];
  detected_categories?: string[];
  scanned_at?: string;
}

export interface TrendHintsResponse {
  ok: true;
  data: {
    rising: RisingSpotHint[];
    painpoints: PainpointHint[];
    /** 컬렉션이 존재하지 않거나 인덱스 누락 시 운영자에게 안내. */
    notices: string[];
  };
}

export async function fetchTrendHints(
  user: User,
  opts: { city: string; zone?: string },
): Promise<TrendHintsResponse['data']> {
  const idToken = await user.getIdToken();
  const params = new URLSearchParams({ city: opts.city });
  if (opts.zone) params.set('zone', opts.zone);
  const resp = await fetch(`/api/admin-zone-course-trend-hints?${params.toString()}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || !json.ok) {
    throw new Error(json.error || `HTTP ${resp.status}`);
  }
  return json.data as TrendHintsResponse['data'];
}

export interface RebuildTransitInput {
  blockId: string;
  stops: Array<Pick<ZoneCourseStop, 'order' | 'name' | 'address' | 'lat' | 'lng' | 'stay_min'>>;
}

export interface RebuildTransitResponse {
  ok: true;
  data: {
    transit_matrix: Record<string, ZoneCourseTransit>;
    /** 업데이트된 lat/lng — Naver Geocoding 통과 후만 채워짐. */
    updated_stops?: ZoneCourseStop[];
    notices: string[];
  };
}

export async function rebuildTransit(
  user: User,
  input: RebuildTransitInput,
): Promise<RebuildTransitResponse['data']> {
  const idToken = await user.getIdToken();
  const resp = await fetch('/api/admin-rebuild-zone-course-transit', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || !json.ok) {
    throw new Error(json.error || `HTTP ${resp.status}`);
  }
  return json.data as RebuildTransitResponse['data'];
}
