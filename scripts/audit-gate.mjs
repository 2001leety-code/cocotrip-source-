// 운영 의존성 취약점 게이트 — `npm audit --json --omit=dev` 결과를 판정한다.
//
// 왜 npm audit 의 exit code 를 그냥 안 쓰나:
//   react-router 의 GHSA-qwww-vcr4-c8h2 는 이 레포에 해당되지 않는데(아래 ALLOWLIST 참조)
//   해소 경로가 없어서, exit code 를 그대로 쓰면 게이트가 **영원히 빨간불**이 된다.
//   상시 빨간불은 아무도 안 보는 빨간불이라 게이트가 아니라 소음이다.
//
// 허용은 "무시" 가 아니다: 허용 목록에 없는 high/critical 은 그대로 실패시킨다.
// 같은 패키지의 새 취약점도 GHSA id 가 다르므로 이 목록에 걸리지 않는다.
//
// 사용: node scripts/audit-gate.mjs <audit.json>
// exit 0 = 통과 / 1 = 비허용 high·critical 존재 / 2 = 입력 파손(안전 방향 실패)

import { readFileSync } from 'fs';

/**
 * 해당 없음이 확인된 advisory. 항목마다 세 가지가 있어야 한다 —
 * 왜 해당 없는지 · 왜 올릴 수 없는지 · 언제 지워야 하는지.
 */
const ALLOWLIST = [
  {
    url: 'https://github.com/advisories/GHSA-qwww-vcr4-c8h2',
    // react-router "RSC Mode CSRF Bypass" (high).
    // 해당 없음: advisory 본문이 "unstable RSC APIs 를 쓰는 앱만 영향" 이라고 명시한다.
    //   이 앱은 선언적 BrowserRouter SPA(src/App.tsx)이고 RSC 진입점
    //   (matchRSCServerRequest / createCallServer / unstable_RSC) 사용이 src·api 통틀어 0건.
    // 올릴 수 없음: 패치가 react-router v8.3.0 에만 있다. react-router-dom 은 v8 자체가
    //   없고(최신 7.18.2, v8 은 react-router 단일 패키지로 통합) 7.x 백포트도 없다.
    // 제거 시점: react-router v8 로 이행할 때.
    reason: 'RSC-mode only; this app is a declarative BrowserRouter SPA. Patch exists only in react-router v8.',
  },
  {
    url: 'https://github.com/advisories/GHSA-jmr9-qjv8-65gv',
    // extract-zip "unvalidated symlink path traversal" (high). 2026-08-19 운영자 승인.
    // 해당 없음: extract-zip 은 puppeteer-core→@puppeteer/browsers 가 빌드(프리렌더)
    //   단계에서 구글 배포 브라우저 아카이브를 푸는 데만 실행된다 — 사용자 입력 zip 을
    //   푸는 경로가 없고(src·api 직접 사용 0건 grep 실측), 공격은 악성 zip 을 전제한다.
    //   런타임(서버 함수·손님 트래픽)에는 실리지 않는다.
    // 올릴 수 없음: 패치판이 존재하지 않는다(advisory patched: none, <=2.0.1 전부 해당).
    // 제거 시점: extract-zip 패치판이 나와 @puppeteer/browsers 가 그 판을 물 때.
    reason: 'Build-time only (puppeteer browser archive extraction of Google-published zips); no user-supplied zip path; no patched version exists (<=2.0.1 all affected).',
  },
];

const BLOCKING_SEVERITY = new Set(['high', 'critical']);

/**
 * npm audit --json 출력에서 high/critical advisory 를 중복 없이 뽑는다.
 * @param {object} report
 * @returns {Array<{severity:string,name:string,url:string,title:string}>}
 */
export function collectAdvisories(report) {
  const out = new Map();
  for (const vuln of Object.values(report?.vulnerabilities || {})) {
    for (const via of (vuln?.via || [])) {
      // via 는 문자열(다른 패키지 경유)일 수도 있다 — advisory 객체만 본다.
      if (!via || typeof via !== 'object') continue;
      if (!BLOCKING_SEVERITY.has(via.severity)) continue;
      if (!via.url) continue;
      if (!out.has(via.url)) {
        out.set(via.url, {
          severity: via.severity,
          name: via.name || '?',
          url: via.url,
          title: via.title || '',
        });
      }
    }
  }
  return [...out.values()];
}

/** 허용 목록에 없는 것만 남긴다. */
export function blockingAdvisories(report) {
  const allowed = new Set(ALLOWLIST.map((a) => a.url));
  return collectAdvisories(report).filter((a) => !allowed.has(a.url));
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: node scripts/audit-gate.mjs <audit.json>');
    process.exit(2);
  }
  let report;
  try {
    report = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    // 파손이면 통과시키지 않는다 — 게이트가 조용히 사라지는 게 최악이다.
    console.error(`::error::audit JSON 을 읽지 못했다 (${path}): ${e.message}`);
    process.exit(2);
  }

  const all = collectAdvisories(report);
  const blocking = blockingAdvisories(report);
  const allowedHits = all.length - blocking.length;

  console.log(`운영 의존성 high/critical: ${all.length}건 (허용 ${allowedHits} · 차단 ${blocking.length})`);
  for (const a of all) {
    const mark = blocking.some((b) => b.url === a.url) ? '차단' : '허용';
    console.log(`  [${mark}] ${a.severity}\t${a.name}\t${a.url}`);
  }

  if (blocking.length > 0) {
    console.error(`::error::허용 목록에 없는 high/critical ${blocking.length}건 (운영 의존성)`);
    process.exit(1);
  }
  console.log('운영 의존성 클린 (허용 목록 제외).');
}
