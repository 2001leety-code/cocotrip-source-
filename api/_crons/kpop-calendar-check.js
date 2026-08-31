/**
 * CocoTripKR — K-pop 콘서트 캘린더 소진 감시 (매월 1일 KST 10:00)
 *
 * 배경: `src/data/kpopConcerts.json` 은 손으로 갱신하는 목록이다. 갱신 담당이
 *   코드에 없어서, 마지막 공연 날짜가 지나면 차터 페이지 K-pop 탭이 **아무 안내도 없이
 *   빈 화면**이 된다(조용히 꺼짐). 실제로 2026-07 감사에서 10건 중 7건이 이미 지난
 *   공연이었고 잔여 1건뿐이었다.
 *
 * 이 크론이 하는 일 — AI 0, 외부 API 0, 순수 코드:
 *   1. 프론트와 **같은 JSON**(SSOT)을 읽는다.
 *   2. 아직 안 지난 공연 수 / 마지막 공연 날짜까지 남은 일수를 센다.
 *   3. 부족하면 운영자 텔레그램으로 "공연 목록 갱신하세요" 알림.
 *   4. 넉넉하면 조용히 종료(스팸 금지).
 *
 * 🔴 정직 알림 원칙: JSON 을 못 읽으면 "이상 없음" 으로 위장하지 않고 **에러를 알린다**.
 *   (파일 미포함/경로 문제로 감시견이 죽은 걸 '공연 충분'으로 오인하면 감시 자체가 무의미)
 *
 * 운영자 manual trigger:
 *   GET /api/cron-runner?job=kpop-calendar-check
 *   GET /api/cron-runner?job=kpop-calendar-check&dryRun=1   (알림 안 보내고 결과만)
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyCronRequest } from '../_shared/cron-auth.js';
import { notifyOperatorLong } from '../_shared/operator-alerts.js';
import { captureError } from '../_shared/sentry.js';

export const maxDuration = 30;
export const config = { runtime: 'nodejs' };

/** 잔여 공연이 이 수 미만이면 알림 */
const MIN_UPCOMING = 3;
/** 마지막 공연이 이 일수 안에 끝나면 알림 (목록 고갈 임박) */
const RUNWAY_DAYS = 45;

/** Vercel 번들 cwd 가 상황마다 달라 후보 경로를 순차 시도한다. */
const CANDIDATE_PATHS = [
  join(process.cwd(), 'src', 'data', 'kpopConcerts.json'),
  join(process.cwd(), '..', 'src', 'data', 'kpopConcerts.json'),
  join(process.cwd(), 'var', 'task', 'src', 'data', 'kpopConcerts.json'),
];

function loadConcerts() {
  const tried = [];
  for (const p of CANDIDATE_PATHS) {
    try {
      const raw = readFileSync(p, 'utf8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('JSON 최상위가 배열이 아님');
      return { concerts: parsed, path: p, tried };
    } catch (e) {
      tried.push(`${p} → ${e.code || e.message}`);
    }
  }
  const err = new Error('kpopConcerts.json 을 읽지 못함');
  err.tried = tried;
  throw err;
}

/**
 * KST 기준 오늘 00:00 의 **실제** epoch(ms).
 *
 * ⚠️ `Date.UTC(kstY, kstM, kstD)` 로 쓰면 안 된다 — KST 달력일을 UTC 자정에 찍은 가짜 epoch 라
 *   실제 KST 자정보다 9시간 뒤다. 비교 상대인 `endOfConcertMs()` 는 실제 epoch 라서,
 *   한 비교식 안에 시계 두 개가 섞인다. 지금 답이 맞는 건 "그 날 23:59:59" 가 만드는
 *   여유가 그 9시간을 우연히 상쇄해서일 뿐 — 종료 시각 표현을 바꾸는 순간 당일 공연이 사라진다.
 *
 * 프론트 `src/data/kpopConcerts.ts` 의 동명 함수와 **같은 식**이다
 * (이 모듈은 node:fs 를 물고 있어 프론트 번들로 가져올 수 없다 — api↔src 는 서로 import 하지 않는다).
 * 두 벌이 갈라지면 `tests/unit/kpop-kst-epoch.test.ts` 가 잡는다.
 */
export function todayKstMs() {
  const kstWall = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return Date.parse(`${kstWall.toISOString().slice(0, 10)}T00:00:00+09:00`);
}

/** 공연 종료 시각 = 마지막 날짜 23:59:59 KST 의 실제 epoch. 날짜가 없거나 깨졌으면 NaN. */
function endOfConcertMs(c) {
  const dates = Array.isArray(c?.dates) ? c.dates : [];
  const last = dates[dates.length - 1];
  return last ? Date.parse(`${last}T23:59:59+09:00`) : NaN;
}

/** 아직 안 끝난 공연만 (마지막 날짜가 오늘 이후). 테스트에서 임계값 검증용으로 export. */
export function splitByDate(concerts, todayMs) {
  const upcoming = [];
  const past = [];
  for (const c of concerts) {
    const lastMs = endOfConcertMs(c);
    if (!Number.isFinite(lastMs)) { past.push({ ...c, _badDate: true }); continue; }
    (lastMs >= todayMs ? upcoming : past).push(c);
  }
  return { upcoming, past };
}

export const kpopCalendarTask = async (dryRun = false) => {
  try {
    const { concerts, path } = loadConcerts();
    const todayMs = todayKstMs();
    const { upcoming, past } = splitByDate(concerts, todayMs);

    const lastMs = upcoming.reduce((max, c) => {
      const d = endOfConcertMs(c);
      return Number.isFinite(d) && d > max ? d : max;
    }, 0);
    // todayMs 도 lastMs 도 실제 epoch — 차이는 순수 경과시간이고, 마지막 날 23:59:59 는
    // 그 날의 끝이라 floor 하면 KST 달력일 차이가 그대로 나온다 (오늘 끝나면 0일).
    const runwayDays = lastMs ? Math.floor((lastMs - todayMs) / 86400000) : 0;

    const badDates = past.filter(c => c._badDate).map(c => c.id);
    const needsUpdate = upcoming.length < MIN_UPCOMING || runwayDays < RUNWAY_DAYS || badDates.length > 0;

    const result = {
      total: concerts.length,
      upcoming: upcoming.length,
      past: past.length,
      runwayDays,
      badDates,
      needsUpdate,
      sourcePath: path,
    };

    if (!needsUpdate) {
      console.log('[kpop-calendar] 여유 있음 — 알림 생략', result);
      return { statusCode: 200, body: { ok: true, notified: false, ...result } };
    }

    const lines = [
      '🎤 <b>K-pop 공연 목록 갱신 필요</b>',
      '',
      `• 남은 공연: <b>${upcoming.length}건</b> (기준 ${MIN_UPCOMING}건)`,
      `• 마지막 공연까지: <b>${runwayDays}일</b> (기준 ${RUNWAY_DAYS}일)`,
      `• 지난 공연: ${past.length}건`,
    ];
    if (badDates.length) lines.push(`• ⚠️ 날짜 형식 오류: ${badDates.join(', ')}`);
    lines.push(
      '',
      '남은 공연이 0건이 되면 차터 페이지 K-pop 탭이 <b>빈 화면</b>이 됩니다.',
      '갱신 파일: <code>src/data/kpopConcerts.json</code> (프론트·크론 공용 SSOT)',
    );
    if (upcoming.length) {
      lines.push('', '<b>현재 남은 공연</b>');
      for (const c of upcoming.slice(0, 10)) {
        lines.push(`· ${c.dateDisplayKo || c.dateDisplay} — ${c.artist} @ ${c.venueKo || c.venue}`);
      }
    }

    if (dryRun) {
      return { statusCode: 200, body: { ok: true, dryRun: true, message: lines.join('\n'), ...result } };
    }

    const sent = await notifyOperatorLong('todo', lines.join('\n'));
    return { statusCode: 200, body: { ok: true, notified: !!sent?.ok, ...result } };
  } catch (err) {
    console.error('[kpop-calendar] 오류:', err.message, err.tried || '');
    try { await captureError(err, { route: 'cron/kpop-calendar-check' }); } catch {}

    // 🔴 조용히 성공한 척 금지 — 감시견이 죽은 사실 자체를 운영자에게 알린다.
    if (!dryRun) {
      try {
        await notifyOperatorLong('todo', [
          '🎤⚠️ <b>K-pop 공연 감시 실패</b>',
          '',
          `공연 목록 파일을 읽지 못했습니다: ${err.message}`,
          '이 상태에서는 "공연 소진" 을 감지할 수 없습니다.',
          ...(err.tried ? ['', '시도한 경로:', ...err.tried.map(t => `· ${t}`)] : []),
        ].join('\n'));
      } catch { /* 알림까지 실패하면 로그·Sentry 로만 */ }
    }
    return { statusCode: 500, body: { ok: false, error: err.message, tried: err.tried || null } };
  }
};

export default async function vercelHandler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = await verifyCronRequest(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, code: 'AUTH_REQUIRED', error: auth.error });
  }

  try {
    const dryRun = req.query?.dryRun === '1' || req.query?.dryRun === 'true';
    const r = await kpopCalendarTask(dryRun);
    return res.status(r.statusCode || 200).json(r.body);
  } catch (e) {
    console.error('[kpop-calendar] handler error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
