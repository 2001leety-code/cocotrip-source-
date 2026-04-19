/**
 * POST /api/recalc-transit
 *
 * Recalculates transit_from_prev for _stale segments only.
 * Called after user edits (add/delete/reorder stops) to refresh
 * transit data without regenerating the entire plan.
 *
 * Body: { planId: string, dayIndex: number, token?: string }
 * Auth: ownerUid match OR accessToken match
 *
 * Flow:
 *   1. Read plan from Firestore
 *   2. Find _stale transit segments in the specified day
 *   3. For each stale pair: re-geocode if needed, call ODsay + Naver
 *   4. Re-stitch times from the first stale index onward
 *   5. Clear _stale flags
 *   6. Write updated day back to Firestore
 *   7. Return { ok: true, recalculated: N }
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import axios from 'axios';
import { searchTransitRoute, formatTransitSummary } from './_odsay_helper.js';

// ── Firebase Admin (reuse singleton) ──
if (!getApps().length) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (raw) {
    try { initializeApp({ credential: cert(JSON.parse(raw)) }); }
    catch (e) { initializeApp(); }
  } else {
    initializeApp();
  }
}
const db = getFirestore();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { planId, dayIndex, token } = req.body || {};
  if (!planId || dayIndex === undefined || dayIndex === null) {
    return res.status(400).json({ error: 'planId and dayIndex are required' });
  }

  try {
    // 1. Read plan
    const snap = await db.collection('plans').doc(planId).get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'Plan not found' });
    }
    const plan = snap.data();

    // Auth check: owner or token
    const authHeader = req.headers.authorization || '';
    const uid = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const isOwner = uid && plan.uid === uid;
    const hasToken = plan.accessToken && plan.accessToken === token;
    const isGuest = !plan.uid;
    if (!isOwner && !hasToken && !isGuest) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // 2. Get the specific day
    const days = (plan.itinerary && plan.itinerary.days) || [];
    if (dayIndex < 0 || dayIndex >= days.length) {
      return res.status(400).json({ error: 'Invalid dayIndex' });
    }

    const day = JSON.parse(JSON.stringify(days[dayIndex])); // deep clone
    const stops = day.stops || [];

    // Find stale indices
    const staleIndices = [];
    for (let i = 0; i < stops.length; i++) {
      if (stops[i].transit_from_prev && stops[i].transit_from_prev._stale) {
        staleIndices.push(i);
      }
    }

    if (staleIndices.length === 0) {
      return res.status(200).json({ ok: true, recalculated: 0, message: 'No stale transits' });
    }

    console.log(`[recalc-transit] Plan ${planId} Day ${dayIndex}: ${staleIndices.length} stale segment(s)`);

    const clientId = (process.env.NAVER_CLIENT_ID || '').trim();
    const clientSecret = (process.env.NAVER_CLIENT_SECRET || '').trim();

    // 3. Geocode stops that lack coordinates
    for (const stop of stops) {
      if (stop.lat && stop.lng) continue;
      if (!clientId || !clientSecret) continue;

      const name = stop.name || stop.display_name || '';
      const address = stop.address || '';
      const queries = [address, name].filter(Boolean);

      for (const query of queries) {
        try {
          const geoRes = await axios.get('https://maps.apigw.ntruss.com/map-geocode/v2/geocode', {
            params: { query },
            headers: {
              'X-NCP-APIGW-API-KEY-ID': clientId,
              'X-NCP-APIGW-API-KEY': clientSecret,
            },
            timeout: 5000,
          });
          if (geoRes.status === 200 && geoRes.data.addresses && geoRes.data.addresses.length > 0) {
            stop.lng = parseFloat(geoRes.data.addresses[0].x);
            stop.lat = parseFloat(geoRes.data.addresses[0].y);
            stop._geocoded = true;
            break;
          }
        } catch (e) {
          console.warn(`[recalc-transit] Geocode failed for "${query}":`, e.message);
        }
      }
    }

    // 4. Recalculate transit for each stale segment
    let recalculated = 0;
    const BUFFER_MIN = 5;

    for (const idx of staleIndices) {
      if (idx === 0) {
        // First stop has no prev -- just clear stale
        if (stops[0].transit_from_prev) {
          delete stops[0].transit_from_prev._stale;
        }
        continue;
      }

      const prev = stops[idx - 1];
      const curr = stops[idx];

      if (prev.lat && prev.lng && curr.lat && curr.lng) {
        // Parallel: Naver Driving + ODsay Transit
        const [naverResult, odsayResult] = await Promise.allSettled([
          (clientId && clientSecret) ? axios.get('https://maps.apigw.ntruss.com/map-direction/v1/driving', {
            params: {
              start: `${prev.lng},${prev.lat}`,
              goal: `${curr.lng},${curr.lat}`,
              option: 'traoptimal',
            },
            headers: {
              'X-NCP-APIGW-API-KEY-ID': clientId,
              'X-NCP-APIGW-API-KEY': clientSecret,
            },
            timeout: 5000,
          }) : Promise.reject(new Error('no credentials')),
          searchTransitRoute(prev.lng, prev.lat, curr.lng, curr.lat),
        ]);

        let durationMin = 25;
        let drivingMin = null;

        if (naverResult.status === 'fulfilled' && naverResult.value && naverResult.value.data && naverResult.value.data.code === 0) {
          const summary = naverResult.value.data.route.traoptimal[0].summary;
          durationMin = Math.floor(summary.duration / 60000);
          drivingMin = durationMin;
        }

        if (odsayResult.status === 'fulfilled' && odsayResult.value) {
          const pt = formatTransitSummary(odsayResult.value);
          if (pt && pt.method !== 'walk') {
            curr.transit_from_prev = {
              method: pt.method || 'subway',
              instruction_en: pt.summary || '',
              step_by_step: (pt.steps || []).map(s => s.description),
              est_min: pt.duration || durationMin,
              est_fare_krw: pt.fare || 0,
              source: 'odsay',
            };
          } else if (pt && pt.method === 'walk') {
            curr.transit_from_prev = {
              method: 'walk',
              instruction_en: pt.summary || `Walk ${durationMin} min`,
              step_by_step: [],
              est_min: pt.duration || durationMin,
              est_fare_krw: 0,
              source: 'odsay',
            };
          } else {
            curr.transit_from_prev = {
              method: 'car',
              instruction_en: '',
              step_by_step: [],
              est_min: drivingMin || durationMin,
              est_fare_krw: 0,
              source: 'naver_fallback',
            };
          }
        } else {
          curr.transit_from_prev = {
            method: 'car',
            instruction_en: '',
            step_by_step: [],
            est_min: drivingMin || durationMin,
            est_fare_krw: 0,
            source: 'naver_fallback',
          };
        }
      }

      // Clear stale flag
      if (curr.transit_from_prev) {
        delete curr.transit_from_prev._stale;
      }
      recalculated++;
    }

    // 5. Re-stitch times from earliest stale index onward
    const stitchFrom = Math.max(1, Math.min(...staleIndices));
    if (stops[stitchFrom - 1] && stops[stitchFrom - 1].start_time) {
      let currentMin = parseTime(stops[stitchFrom - 1].start_time);
      for (let i = stitchFrom; i < stops.length; i++) {
        const prevStay = stops[i - 1].stay_min || 60;
        const transitMin = (stops[i].transit_from_prev && stops[i].transit_from_prev.est_min) || 25;
        currentMin += prevStay + transitMin + BUFFER_MIN;
        stops[i].start_time = formatTime(currentMin);
      }
    }

    // 6. Write back to Firestore
    day.stops = stops;
    const updatedDays = [...days];
    updatedDays[dayIndex] = day;

    await db.collection('plans').doc(planId).update({
      'itinerary.days': updatedDays,
      lastTransitRecalcAt: Date.now(),
    });

    console.log(`[recalc-transit] Done. Recalculated ${recalculated} segment(s)`);
    return res.status(200).json({ ok: true, recalculated });

  } catch (err) {
    console.error('[recalc-transit] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function parseTime(timeStr) {
  const [h, m] = (timeStr || '09:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function formatTime(totalMin) {
  const h = Math.floor(totalMin / 60) % 24;
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
