#!/usr/bin/env node
/**
 * Standalone verification for api/translate-plan.js transit translation.
 * Calls the handler with a mock itinerary (Gangnam -> Jamsil subway leg +
 * one bus leg) and asserts the output contains lineJa/fromJa/wayJa and
 * translatorVersion: 2.
 *
 * Usage: node scripts/verify-translate.mjs [ja|zh]
 * Cost: ~$0.001 per run (1 Gemini Flash call).
 *
 * .mjs because the handler is now ESM (root package.json type:module).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { default: handler } = await import('../api/translate-plan.js');

const targetLang = process.argv[2] || 'ja';

const mockItinerary = {
  tour_title: '서울 2박 3일 미식 투어',
  days: [
    {
      theme: '강남·잠실 둘러보기',
      stops: [
        {
          display_name: 'Gangnam Station Area',
          name: '강남역',
          tip: '지하상가에서 기념품 쇼핑 추천',
        },
        {
          display_name: 'Lotte World Tower',
          name: '롯데월드타워',
          tip: '전망대는 예약 필수',
          transit_from_prev: {
            method: 'subway',
            est_min: 18,
            est_fare_krw: 1400,
            source: 'odsay',
            steps_detail: [
              {
                mode: 'subway',
                line: '수도권 2호선',
                lineKo: '2호선',
                lineEn: 'Line 2',
                from: '강남',
                fromRoman: 'Gangnam',
                to: '잠실',
                toRoman: 'Jamsil',
                way: '잠실',
                wayRoman: 'Jamsil',
                duration: 18,
                stationCount: 6,
                fromStationInfo: {
                  transferLines: [
                    { lineKo: '9호선', lineEn: 'Line 9', stationID: 1009 },
                    { lineKo: '신분당선', lineEn: 'Shinbundang Line', stationID: 1100 },
                  ],
                },
              },
              {
                mode: 'bus',
                busNo: '360',
                busType: '간선',
                from: '잠실역 1번출구',
                to: '롯데월드타워 앞',
                duration: 5,
                stationCount: 2,
              },
            ],
          },
        },
      ],
    },
  ],
};

const mockReq = { method: 'POST', body: { plan: mockItinerary, targetLang } };
const mockRes = {
  _status: null,
  _json: null,
  status(code) { this._status = code; return this; },
  json(payload) { this._json = payload; return this; },
};

(async () => {
  console.log(`\n[verify] target language: ${targetLang}\n`);
  const t0 = Date.now();
  await handler(mockReq, mockRes);
  const elapsed = Date.now() - t0;

  const res = mockRes._json;
  if (!res?.ok) {
    console.error(`[verify] FAIL: handler returned error: ${res?.error}`);
    process.exit(1);
  }

  const translated = res.data?.translated;
  const step = translated?.days?.[0]?.stops?.[1]?.transit_from_prev?.steps_detail?.[0];
  const busStep = translated?.days?.[0]?.stops?.[1]?.transit_from_prev?.steps_detail?.[1];
  const suffix = targetLang === 'ja' ? 'Ja' : targetLang === 'zh' ? 'Zh' : '';
  const transferLine = step?.fromStationInfo?.transferLines?.[0];

  console.log('─── translated.days[0].stops[0].display_name (descriptive):');
  console.log(`    ${translated?.days?.[0]?.stops?.[0]?.display_name}`);
  console.log(`─── translated.days[0].stops[0].name (Korean preserved):`);
  console.log(`    ${translated?.days?.[0]?.stops?.[0]?.name}`);
  console.log(`─── subway step translations (suffix=${suffix}):`);
  console.log(`    lineKo       : ${step?.lineKo}`);
  console.log(`    line${suffix}       : ${step?.[`line${suffix}`]}`);
  console.log(`    from (ko)    : ${step?.from}`);
  console.log(`    from${suffix}       : ${step?.[`from${suffix}`]}`);
  console.log(`    to${suffix}         : ${step?.[`to${suffix}`]}`);
  console.log(`    way${suffix}        : ${step?.[`way${suffix}`]}`);
  console.log(`─── transferLine[0]:`);
  console.log(`    lineKo       : ${transferLine?.lineKo}`);
  console.log(`    lineKo${suffix}     : ${transferLine?.[`lineKo${suffix}`]}`);
  console.log(`─── bus step translations:`);
  console.log(`    from${suffix}       : ${busStep?.[`from${suffix}`]}`);
  console.log(`    to${suffix}         : ${busStep?.[`to${suffix}`]}`);
  console.log(`    busType${suffix}    : ${busStep?.[`busType${suffix}`]}`);
  console.log(`─── translatorVersion: ${res.data?.translatorVersion}`);
  console.log(`─── stats: ${JSON.stringify(res.data?.stats)}`);
  console.log(`─── elapsed: ${elapsed}ms`);

  const assertions = [
    ['translatorVersion is 2', res.data?.translatorVersion === 2],
    ['lineKo preserved',       step?.lineKo === '2호선'],
    ['from (ko) preserved',    step?.from === '강남'],
    [`line${suffix} populated`, !!step?.[`line${suffix}`]],
    [`from${suffix} populated`, !!step?.[`from${suffix}`]],
    [`to${suffix} populated`,   !!step?.[`to${suffix}`]],
    [`way${suffix} populated`,  !!step?.[`way${suffix}`]],
    [`transferLine lineKo${suffix} populated`, !!transferLine?.[`lineKo${suffix}`]],
    [`bus from${suffix} populated`, !!busStep?.[`from${suffix}`]],
    [`bus busType${suffix} populated`, !!busStep?.[`busType${suffix}`]],
    ['stop name (Korean) preserved', translated?.days?.[0]?.stops?.[0]?.name === '강남역'],
  ];

  let failed = 0;
  console.log('\n─── assertions:');
  for (const [label, ok] of assertions) {
    console.log(`    ${ok ? '✓' : '✗'} ${label}`);
    if (!ok) failed++;
  }
  console.log('');
  if (failed > 0) {
    console.error(`[verify] FAIL: ${failed}/${assertions.length} assertions failed`);
    process.exit(1);
  }
  console.log(`[verify] OK: ${assertions.length}/${assertions.length} assertions passed`);
})().catch(err => {
  console.error('[verify] FATAL:', err);
  process.exit(1);
});
