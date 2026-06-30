/**
 * gen-country-dials.mjs — 전세계 국가번호(dial) 데이터 생성기 (빌드타임, 라이브러리 0).
 *
 * 출력: src/lib/country-dials.data.ts 의 RAW_COUNTRIES 배열 (~200국).
 *   각 항목 { code: ISO3166-1 alpha-2, dial: 국가번호(+없이), name: { ko, en, ja, zh } }.
 *
 * 4언어 국가명 = Node 내장 Intl.DisplayNames (full ICU, 수동 타이핑 0). ja/zh 도 ICU 가
 *   제공하므로 fallback 불필요하나, 누락 시 name.en 로 안전 폴백.
 * dial 매핑 = ITU-T E.164 + ISO3166 (vetted static map, 아래 DIALS).
 *
 * 실행: node scripts/gen-country-dials.mjs   (Node 18+ full-ICU 필요. 본 repo Node 22 full ICU 확인됨)
 * 재생성 검증: 생성 후 git diff 0 이면 데이터 무변경. dial 추가/수정 시 DIALS 만 갱신.
 *
 * 데이터에 flag emoji 안 박음 — country-dials.ts 의 flagOf(code) 헬퍼가 ISO2 에서 파생.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ISO3166-1 alpha-2 → E.164 국가번호(앞 + 제외). ITU-T 국가코드 기준.
// 정렬: 표시 순서와 무관(런타임 localeCompare 정렬). 한국 타겟 + 전세계 주권국/주요 영토.
const DIALS = {
  AD: '376', AE: '971', AF: '93', AG: '1268', AI: '1264', AL: '355', AM: '374',
  AO: '244', AR: '54', AS: '1684', AT: '43', AU: '61', AW: '297', AX: '358',
  AZ: '994', BA: '387', BB: '1246', BD: '880', BE: '32', BF: '226', BG: '359',
  BH: '973', BI: '257', BJ: '229', BL: '590', BM: '1441', BN: '673', BO: '591',
  BQ: '599', BR: '55', BS: '1242', BT: '975', BW: '267', BY: '375', BZ: '501',
  CA: '1', CD: '243', CF: '236', CG: '242', CH: '41', CI: '225', CK: '682',
  CL: '56', CM: '237', CN: '86', CO: '57', CR: '506', CU: '53', CV: '238',
  CW: '599', CY: '357', CZ: '420', DE: '49', DJ: '253', DK: '45', DM: '1767',
  DO: '1809', DZ: '213', EC: '593', EE: '372', EG: '20', ER: '291', ES: '34',
  ET: '251', FI: '358', FJ: '679', FK: '500', FM: '691', FO: '298', FR: '33',
  GA: '241', GB: '44', GD: '1473', GE: '995', GF: '594', GG: '44', GH: '233',
  GI: '350', GL: '299', GM: '220', GN: '224', GP: '590', GQ: '240', GR: '30',
  GT: '502', GU: '1671', GW: '245', GY: '592', HK: '852', HN: '504', HR: '385',
  HT: '509', HU: '36', ID: '62', IE: '353', IL: '972', IM: '44', IN: '91',
  IO: '246', IQ: '964', IR: '98', IS: '354', IT: '39', JE: '44', JM: '1876',
  JO: '962', JP: '81', KE: '254', KG: '996', KH: '855', KI: '686', KM: '269',
  KN: '1869', KP: '850', KR: '82', KW: '965', KY: '1345', KZ: '7', LA: '856',
  LB: '961', LC: '1758', LI: '423', LK: '94', LR: '231', LS: '266', LT: '370',
  LU: '352', LV: '371', LY: '218', MA: '212', MC: '377', MD: '373', ME: '382',
  MF: '590', MG: '261', MH: '692', MK: '389', ML: '223', MM: '95', MN: '976',
  MO: '853', MP: '1670', MQ: '596', MR: '222', MS: '1664', MT: '356', MU: '230',
  MV: '960', MW: '265', MX: '52', MY: '60', MZ: '258', NA: '264', NC: '687',
  NE: '227', NF: '672', NG: '234', NI: '505', NL: '31', NO: '47', NP: '977',
  NR: '674', NU: '683', NZ: '64', OM: '968', PA: '507', PE: '51', PF: '689',
  PG: '675', PH: '63', PK: '92', PL: '48', PM: '508', PR: '1787', PS: '970',
  PT: '351', PW: '680', PY: '595', QA: '974', RE: '262', RO: '40', RS: '381',
  RU: '7', RW: '250', SA: '966', SB: '677', SC: '248', SD: '249', SE: '46',
  SG: '65', SH: '290', SI: '386', SJ: '47', SK: '421', SL: '232', SM: '378',
  SN: '221', SO: '252', SR: '597', SS: '211', ST: '239', SV: '503', SX: '1721',
  SY: '963', SZ: '268', TC: '1649', TD: '235', TG: '228', TH: '66', TJ: '992',
  TK: '690', TL: '670', TM: '993', TN: '216', TO: '676', TR: '90', TT: '1868',
  TV: '688', TW: '886', TZ: '255', UA: '380', UG: '256', US: '1', UY: '598',
  UZ: '998', VA: '379', VC: '1784', VE: '58', VG: '1284', VI: '1340', VN: '84',
  VU: '678', WF: '681', WS: '685', YE: '967', YT: '262', ZA: '27', ZM: '260',
  ZW: '263',
};

const LANGS = ['ko', 'en', 'ja', 'zh'];
const dn = Object.fromEntries(
  LANGS.map((l) => [l, new Intl.DisplayNames([l], { type: 'region', fallback: 'none' })]),
);
const dnEn = dn.en;

const rows = Object.keys(DIALS)
  .sort()
  .map((code) => {
    const en = dnEn.of(code) || code;
    const name = {};
    for (const l of LANGS) {
      name[l] = dn[l].of(code) || en;
    }
    return { code, dial: DIALS[code], name };
  });

const body = rows
  .map((r) => {
    const n = r.name;
    const esc = (s) => JSON.stringify(s);
    return '  { code: ' + esc(r.code) + ', dial: ' + esc(r.dial) + ', name: { ko: ' + esc(n.ko) + ', en: ' + esc(n.en) + ', ja: ' + esc(n.ja) + ', zh: ' + esc(n.zh) + ' } },';
  })
  .join('\n');

const out = '/**\n' +
' * country-dials.data — 전세계 국가번호 데이터 (~' + rows.length + '국). 자동 생성, 직접 수정 금지.\n' +
' *\n' +
' * 생성기: scripts/gen-country-dials.mjs (ITU-T E.164 dial + Node Intl.DisplayNames 4언어명).\n' +
' * 갱신: dial 추가/수정 → 생성기 DIALS 갱신 → node scripts/gen-country-dials.mjs.\n' +
' *\n' +
' * lazy import 전용 — country-dials.ts 에서만 import (eager entry 번들 보호, check:size 게이트).\n' +
' *   flag emoji 는 데이터에 없음 — flagOf(code) 헬퍼가 ISO2 에서 파생.\n' +
' */\n' +
"import type { CountryDial } from './country-dials';\n\n" +
'export const RAW_COUNTRIES: ReadonlyArray<CountryDial> = [\n' +
body + '\n' +
'];\n';

const target = resolve(__dirname, '..', 'src', 'lib', 'country-dials.data.ts');
writeFileSync(target, out, 'utf8');
console.log('[gen-country-dials] wrote ' + rows.length + ' countries -> ' + target);
