/**
 * GET /api/calculator-distance?origin=X&destination=Y
 *
 * 빠른 견적 페이지(/calculator) 전용 거리 측정 fallback.
 * 매트릭스 lookup이 실패한 경우만 호출 — Naver Geocoding으로 좌표 얻고 Haversine × 1.3 (도로 보정).
 *
 * 입력: origin (string), destination (string) — 한/영 자유 입력
 * 출력: { km: number, originCoord: {lat,lng}, destinationCoord: {lat,lng} }
 *      실패: { error: 'GEOCODING_FAILED', detail?: string }
 *
 * 비용: Naver Geocoding ~$0 (NCP Free $30/월), 호출당 2건. 자유 입력이므로 캐시 효과 낮음.
 */

import { initAdminDb } from './_shared/firebase-admin.js';
import { checkIpRateLimit, getClientIp } from './_shared/ip-rate-limit.js';
// NCP Maps 키 해석 + geocode 호출 SSOT — 키 목록 복제 금지 (mood-route.js:45~ 주석).
import { geocode, resolveNcpKeys } from './_shared/mood-route.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

// 비용 DoS 가드용 — 무인증 + 호출당 Naver Geocoding 2건이라 per-IP rate-limit.
const _rateDb = initAdminDb('calculator-distance');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' };

// Haversine 직선거리 (km) — Earth radius 6371km
function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS);
    return res.end();
  }
  if (req.method !== 'GET') {
    res.writeHead(405, JSON_CORS);
    return res.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
  }

  const origin = (req.query?.origin || '').toString().trim();
  const destination = (req.query?.destination || '').toString().trim();
  if (!origin || !destination) {
    res.writeHead(400, JSON_CORS);
    return res.end(JSON.stringify({ error: 'MISSING_PARAMS' }));
  }

  // 비용 DoS 가드 — 무인증 + 자유입력(캐시 효과 낮음) + 호출당 Naver Geocoding 2건.
  // place-search/recalc-transit/translate-plan 과 동일 per-IP rate-limit (fail-open).
  const rl = await checkIpRateLimit({
    db: _rateDb, ip: getClientIp(req),
    collection: 'calc_distance_rate_limits',
    maxRequests: 30, errorLabel: 'distance lookups',
  });
  if (!rl.ok) {
    res.writeHead(rl.status, { ...JSON_CORS, 'Retry-After': String(rl.retryAfterSec) });
    return res.end(JSON.stringify({ error: 'RATE_LIMITED', detail: rl.error }));
  }

  // 키 해석 = mood-route.resolveNcpKeys (SSOT). 여기서 process.env 를 직접 읽지 않는다.
  //   🔴 2026-07-27 실측 장애: 이 자리에 `NCP_CLIENT_* || NAVER_CLIENT_*` 를 복붙해 두어
  //   **VITE_NAVER_CLIENT_* 가 빠져** 있었다. prod 의 NAVER_CLIENT_* 는 Developers(openapi
  //   검색) 키로 갱신돼 있어 maps.apigw.ntruss.com 에는 401 → 완전한 도로명주소를 넣어도
  //   `GEOCODING_FAILED / status code 401` 로 전멸 (/calculator 거리 fallback 상시 사망).
  const { clientId, clientSecret } = resolveNcpKeys();
  if (!clientId || !clientSecret) {
    res.writeHead(500, JSON_CORS);
    return res.end(JSON.stringify({ error: 'NCP_NOT_CONFIGURED' }));
  }

  try {
    // 두 곳 동시에 geocode — Promise.all로 round-trip 절약
    const [originCoord, destinationCoord] = await Promise.all([
      geocode(origin, clientId, clientSecret),
      geocode(destination, clientId, clientSecret),
    ]);

    if (!originCoord || !destinationCoord) {
      res.writeHead(404, JSON_CORS);
      return res.end(
        JSON.stringify({
          error: 'GEOCODING_FAILED',
          detail: !originCoord ? 'origin' : 'destination',
        }),
      );
    }

    const straightKm = haversineKm(
      originCoord.lat,
      originCoord.lng,
      destinationCoord.lat,
      destinationCoord.lng,
    );
    // 도로 보정 ×1.3 — 한국 평균 직선:도로 비율 (curvature factor).
    const km = Math.round(straightKm * 1.3 * 10) / 10;

    res.writeHead(200, {
      ...JSON_CORS,
      // 동일 입력 1시간 cache — 자유 입력이라 hit률 낮지만 같은 사용자 재입력엔 도움.
      'Cache-Control': 'public, max-age=3600',
    });
    return res.end(
      JSON.stringify({
        km,
        originCoord,
        destinationCoord,
      }),
    );
  } catch (e) {
    console.error('[calculator-distance] error:', e?.message || e);
    res.writeHead(502, JSON_CORS);
    return res.end(
      JSON.stringify({ error: 'GEOCODING_FAILED', detail: e?.message }),
    );
  }
}
