/** foodIndex 좌표 vs city 태그 불일치 감사 — 무료. "서울 모스크가 busan" 류 오태깅 정량화. */
import { readFileSync } from 'fs';
const fi = JSON.parse(readFileSync('./api/_food_index.json', 'utf8'));
const arr = Array.isArray(fi) ? fi : (fi.restaurants || fi.data || Object.values(fi).find(Array.isArray) || []);

// 도시별 대략 중심 좌표 (lat,lng) + 허용 반경(도, ~1도=111km).
const CITY = {
  seoul: [37.55, 126.99], busan: [35.16, 129.07], jeju: [33.45, 126.55], incheon: [37.45, 126.70],
  daegu: [35.87, 128.60], gyeongju: [35.84, 129.21], jeonju: [35.82, 127.15], gwangju: [35.15, 126.85],
  daejeon: [36.35, 127.38], gangneung: [37.75, 128.90], sokcho: [38.20, 128.59], suwon: [37.26, 127.03],
  changwon: [35.23, 128.68], ulsan: [35.54, 129.31], pohang: [36.02, 129.36], chuncheon: [37.88, 127.73],
  andong: [36.57, 128.73], yeosu: [34.76, 127.66], tongyeong: [34.85, 128.43], geoje: [34.88, 128.62],
  wonju: [37.34, 127.92], cheongju: [36.64, 127.49], gunsan: [35.97, 126.74], mokpo: [34.81, 126.39],
};
const dist = (la1, lo1, la2, lo2) => { const dla = (la1 - la2) * 111, dlo = (lo1 - lo2) * 88; return Math.sqrt(dla * dla + dlo * dlo); }; // km 근사
const THRESH_KM = 60; // 같은 도시권 최대 반경 (광역시·근교 포함). 이 이상이면 오태깅 의심.

const mis = [];
let checked = 0;
for (const r of arr) {
  const city = String(r.city || '').toLowerCase().trim();
  const c = CITY[city]; if (!c) continue;
  const lat = Number(r.lat), lng = Number(r.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
  checked++;
  const dkm = dist(lat, lng, c[0], c[1]);
  if (dkm > THRESH_KM) mis.push({ name: r.name || r.name_ko, city, dkm: Math.round(dkm), lat, lng, cuisine: r.type || r.category || r.cuisine });
}
console.log(`좌표 보유 entry ${checked}개 검사 / 불일치(>${THRESH_KM}km) ${mis.length}개\n`);
const byCity = {};
for (const m of mis) byCity[m.city] = (byCity[m.city] || 0) + 1;
console.log('=== 도시별 오태깅 의심 ==='); for (const [k, v] of Object.entries(byCity).sort((a, b) => b[1] - a[1])) console.log(`  ${v}x ${k}`);
console.log('\n=== 상위 25 (먼 순) ===');
mis.sort((a, b) => b.dkm - a.dkm).slice(0, 25).forEach((m) => console.log(`  ${m.dkm}km | city=${m.city} | ${m.name} (${m.cuisine}) [${m.lat},${m.lng}]`));
