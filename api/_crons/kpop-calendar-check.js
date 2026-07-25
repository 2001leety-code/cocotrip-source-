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

/** KST 기준 오늘 00:00 의 ms epoch */
function todayKstMs() {
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate());
}

/** 아직 안 끝난 공연만 (마지막 날짜가 오늘 이후). 테스트에서 임계값 검증용으로 export. */
export function splitByDate(concerts, todayMs) {
  const upcoming = [];
  const past = [];
  for (const c of concerts) {
    const dates = Array.isArray(c?.dates) ? c.dates : [];
    const last = dates[dates.length - 1];
    const lastMs = last ? Date.parse(`${last}T23:59:59+09:00`) : NaN;
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
      const d = Date.parse(`${c.dates[c.dates.length - 1]}T23:59:59+09:00`);
      return Number.isFinite(d) && d > max ? d : max;
    }, 0);
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

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const token = req.query?.token || req.headers['x-cron-token'];
    const isVercelCron = !!req.headers['x-vercel-cron'] || !!req.headers['x-vercel-cron-signature'];
    if (!isVercelCron && token !== cronSecret) {
      return res.status(401).json({ ok: false, error: 'Unauthorized cron' });
    }
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
