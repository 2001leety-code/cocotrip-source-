#!/usr/bin/env node
// IndexNow 제출 — sitemap 의 색인 대상 URL 을 Bing·Naver 등(IndexNow 연합)에 알린다.
// Google 은 IndexNow 미지원 — Google 색인은 Search Console(운영자 소유권 확인) 경로뿐.
// 키는 비밀이 아니다: 프로토콜상 https://cocotripkr.com/<key>.txt 로 공개 호스팅되어야
// 소유 증명이 된다 (https://www.indexnow.org/documentation).
// 사용: node scripts/submit-indexnow.mjs   (배포 후 실행 — 키 파일이 운영에 있어야 함)

const HOST = 'cocotripkr.com';
const KEY = '1172e78a17cfaf98f51a23726cd729ac'; // public/<KEY>.txt 와 반드시 일치

const sitemapRes = await fetch(`https://${HOST}/sitemap.xml`);
if (!sitemapRes.ok) throw new Error(`sitemap fetch ${sitemapRes.status}`);
const xml = await sitemapRes.text();
const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
if (urls.length === 0) throw new Error('sitemap has no <loc> entries');

// 키 파일이 운영에 실제로 있는지 먼저 확인 — 없으면 제출해도 검증 실패로 무시된다.
const keyRes = await fetch(`https://${HOST}/${KEY}.txt`);
const keyBody = (await keyRes.text()).trim();
if (!keyRes.ok || keyBody !== KEY) {
  throw new Error(`key file check failed: HTTP ${keyRes.status}, body="${keyBody.slice(0, 40)}" — 배포 전이면 배포 후 다시 실행`);
}

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: HOST, key: KEY, urlList: urls }),
});
console.log(`submitted ${urls.length} URLs → HTTP ${res.status} ${res.statusText}`);
if (!res.ok) console.log(await res.text());
