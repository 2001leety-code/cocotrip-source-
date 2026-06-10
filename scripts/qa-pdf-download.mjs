/** PDF 다운로드 e2e 검증 — 플랜 페이지를 운영자 테스트 계정으로 열어 PDF 버튼 클릭 → 파일 저장.
 *  사용: node scripts/qa-pdf-download.mjs <planId>
 *  인증: admin SDK customToken → REST signInWithCustomToken → localStorage inject
 *        (tests/visual/plan-detail-mobile.spec.ts P244 패턴 재사용). 비용: 0 (LLM 호출 없음). */
import { readFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import path from 'path';

for (const file of ['.env', '.env.admin.local', '.env.test.local']) {
  try {
    const t = readFileSync(file, 'utf8'); const p = /^([A-Z0-9_]+)\s*=\s*(.*)$/gm; let m;
    while ((m = p.exec(t)) !== null) { const k = m[1]; let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1).replace(/\\n/g, '\n'); if (!process.env[k]) process.env[k] = v; }
  } catch {}
}

const planId = process.argv[2];
if (!planId) { console.log('usage: node scripts/qa-pdf-download.mjs <planId>'); process.exit(1); }

const { initializeApp, cert } = await import('firebase-admin/app');
const { getAuth } = await import('firebase-admin/auth');
const rawKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/^["']|["']$/g, '').replace(/\\n/g, '\n').trim();
const pem = rawKey.match(/-----BEGIN[^-]*-----([^-]+)-----END[^-]*-----/s);
let pk = rawKey;
if (pem) { const b64 = pem[1].replace(/\s+/g, ''); pk = '-----BEGIN PRIVATE KEY-----\n' + (b64.match(/.{1,64}/g) || []).join('\n') + '\n-----END PRIVATE KEY-----\n'; }
initializeApp({ credential: cert({ projectId: (process.env.FIREBASE_PROJECT_ID || '').trim(), clientEmail: (process.env.FIREBASE_CLIENT_EMAIL || '').trim(), privateKey: pk }) });

const ADMIN_EMAIL = '2001leety@gmail.com';
const apiKey = (process.env.VITE_FIREBASE_API_KEY || '').trim();
const uid = (await getAuth().getUserByEmail(ADMIN_EMAIL)).uid;
const customToken = await getAuth().createCustomToken(uid);
const si = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: customToken, returnSecureToken: true }),
});
const auth = await si.json();
if (!auth.idToken) { console.log('auth FAIL', JSON.stringify(auth).slice(0, 200)); process.exit(1); }
console.log('auth OK uid=' + uid.slice(0, 8));

// P244 localStorage 세션 shape
const session = {
  uid, email: ADMIN_EMAIL, emailVerified: true, isAnonymous: false,
  providerData: [{ providerId: 'password', uid: ADMIN_EMAIL, email: ADMIN_EMAIL }],
  stsTokenManager: { refreshToken: auth.refreshToken, accessToken: auth.idToken, expirationTime: Date.now() + 3500 * 1000 },
  createdAt: String(Date.now()), lastLoginAt: String(Date.now()), apiKey, appName: '[DEFAULT]',
};

const dlDir = path.resolve('qa-pdf-out');
mkdirSync(dlDir, { recursive: true });

const puppeteer = (await import('puppeteer-core')).default;
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox'] });
const page = await b.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.evaluateOnNewDocument((s, k) => {
  try {
    localStorage.setItem(`firebase:authUser:${k}:[DEFAULT]`, JSON.stringify(s));
    localStorage.setItem('cocotrip_lang', 'ko'); // ko 플랜 = UI ko -> 자동번역(버튼 disabled) 회피
  } catch {}
}, session, apiKey);
page.on('console', (m) => {
  const t = m.text();
  if (/pdf|canvas|scale|height|cut|band|font|scroll/i.test(t)) console.log('[브라우저]', t.slice(0, 220));
});
const cdp = await page.createCDPSession();
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir, eventsEnabled: true });

const BASE = process.env.QA_BASE || 'https://cocotripkr.com';
console.log('open', BASE + '/my-plans/' + planId);
await page.goto(`${BASE}/my-plans/${planId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
try { await page.waitForFunction('window.__pageReady === true', { timeout: 90000 }); console.log('__pageReady'); }
catch { console.log('(__pageReady timeout - 계속 진행)'); }
await new Promise((r) => setTimeout(r, 6000)); // 사진/폰트 settle

// PDF 버튼은 Wrap-up(아웃트로) 슬라이드에만 마운트 — 탭 먼저 클릭.
const tab = await page.evaluate(() => {
  const els = [...document.querySelectorAll('button, [role="tab"], a')];
  const t = els.find((e) => /wrap-?up|마무리|outro/i.test((e.textContent || '').trim()));
  if (t) { t.click(); return (t.textContent || '').trim(); }
  return null;
});
console.log('탭 클릭:', tab || '(못 찾음 - 그래도 시도)');
await new Promise((r) => setTimeout(r, 2500));

// PDF 버튼 폴링 (번역/생성 중 disabled 해제 대기, 최대 90s) + 진단 덤프
let clicked = null;
for (let i = 0; i < 30 && !clicked; i++) {
  clicked = await page.evaluate(() => {
    const els = [...document.querySelectorAll('button, a')];
    const cand = els.filter((e) => /pdf/i.test(e.textContent || ''));
    const btn = cand.find((e) => !e.disabled);
    if (btn) { btn.scrollIntoView(); btn.click(); return (btn.textContent || '').trim().slice(0, 40); }
    window.__pdfBtnDump = cand.map((e) => `${(e.textContent || '').trim().slice(0, 30)}|disabled=${e.disabled}`);
    return null;
  });
  if (!clicked) await new Promise((r) => setTimeout(r, 3000));
}
if (!clicked) {
  const dump = await page.evaluate(() => window.__pdfBtnDump || []);
  console.log('PDF 후보 덤프:', JSON.stringify(dump));
}
if (!clicked) { console.log('PDF 버튼 못 찾음'); await page.screenshot({ path: 'qa-pdf-out/no-button.png' }); await b.close(); process.exit(1); }
console.log('클릭:', clicked, '- 생성 대기(최대 4분)...');

// 생성 중 컨테이너 계측: 섹션 존재 + 높이 변화 (잘림 원인 판별)
(async () => {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const probe = await page.evaluate(() => {
      const divs = [...document.querySelectorAll('body > div')];
      const c = divs.find((d) => (d.style.zIndex === '99997') || (d.style.position === 'absolute' && d.style.width === '800px'));
      if (!c) return null;
      const txt = c.innerText || '';
      return {
        h: c.scrollHeight,
        len: txt.length,
        budget: /예산|Budget/i.test(txt),
        rest: /추천 식당|Restaurants|Recommended/i.test(txt),
        dep: /출국|Departure/i.test(txt),
        last80: txt.slice(-80).replace(/\s+/g, ' '),
      };
    }).catch(() => null);
    if (probe) console.log(`[계측 t+${i * 2}s] h=${probe.h} text=${probe.len} 예산=${probe.budget} 식당=${probe.rest} 출국=${probe.dep} | 끝: ${probe.last80}`);
  }
})();

// 다운로드 폴더 폴링: .pdf 등장 + 5초간 크기 안정
let pdfPath = null;
const t0 = Date.now();
while (Date.now() - t0 < 240000) {
  await new Promise((r) => setTimeout(r, 3000));
  const pdfs = readdirSync(dlDir).filter((f) => f.endsWith('.pdf'));
  if (pdfs.length) {
    const p1 = path.join(dlDir, pdfs[0]); const s1 = statSync(p1).size;
    await new Promise((r) => setTimeout(r, 5000));
    const s2 = statSync(p1).size;
    if (s1 === s2 && s1 > 10000) { pdfPath = p1; break; }
  }
}
if (!pdfPath) {
  console.log('PDF 미생성(4분). 화면/콘솔 캡처');
  await page.screenshot({ path: 'qa-pdf-out/timeout.png', fullPage: false });
  await b.close(); process.exit(1);
}
console.log('PDF 저장:', pdfPath, Math.round(statSync(pdfPath).size / 1024) + 'KB');
await b.close(); process.exit(0);
