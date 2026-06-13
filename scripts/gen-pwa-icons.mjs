/**
 * PWA 아이콘 생성 — 스플래시(폰 비율)에서 로고 영역을 정사각 크롭 → 192/512 리사이즈.
 * 코코트립(C+비행기), 무드(C×M). jimp(순수 JS, sharp/ImageMagick 불필요).
 *
 * 실행: node scripts/gen-pwa-icons.mjs
 */
import { Jimp } from 'jimp';

// 스플래시 로고 영역(정사각 크롭) — 폰 비율 853x1844 기준 추정. 결과 보고 조정.
const JOBS = [
  {
    src: 'public/splash-cocotrip.png',
    // C+비행기: 상단-중앙. 전체 폭 정사각, 로고 행 중심으로.
    crop: { xFrac: 0.0, wFrac: 1.0, yCenterFrac: 0.465 },
    out: 'public/icons/icon',          // icon-192.png / icon-512.png (코코트립 기본)
  },
  {
    src: 'public/splash-mood.png',
    // C × M: 중앙. 전체 폭 정사각.
    crop: { xFrac: 0.0, wFrac: 1.0, yCenterFrac: 0.50 },
    out: 'public/icons/mood',          // mood-192.png / mood-512.png
  },
];

const SIZES = [512, 192];

for (const job of JOBS) {
  const img = await Jimp.read(job.src);
  const W = img.bitmap.width, H = img.bitmap.height;
  const side = Math.round(W * job.crop.wFrac);
  const x = Math.round(W * job.crop.xFrac);
  let y = Math.round(H * job.crop.yCenterFrac - side / 2);
  y = Math.max(0, Math.min(y, H - side));
  const cropped = img.clone().crop({ x, y, w: side, h: side });
  for (const s of SIZES) {
    const out = cropped.clone().resize({ w: s, h: s });
    await out.write(`${job.out}-${s}.png`);
  }
  console.log(`${job.out}: crop(${x},${y},${side}x${side}) -> ${SIZES.join('/')}`);
}

// favicon (코코트립 192 재사용 축소)
const fav = (await Jimp.read('public/icons/icon-192.png')).resize({ w: 64, h: 64 });
await fav.write('public/favicon.png');
console.log('favicon.png (64) updated');
