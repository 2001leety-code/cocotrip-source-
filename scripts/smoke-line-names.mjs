const { localizeLineName } = await import('../api/_transit_localization.js');
const cases = [
  '수도권 2호선',
  '수도권 9호선(급행)',
  '서울 지하철 5호선',
  '신분당선',
  '수인분당선',
  '수도권 수인.분당선',
  '경의중앙선',
  '공항철도',
  'GTX-A',
];
for (const name of cases) {
  const ko = localizeLineName(name, 'ko');
  const en = localizeLineName(name, 'en');
  const ja = localizeLineName(name, 'ja');
  console.log(`${name.padEnd(20)} → ko:${ko.display.padEnd(10)} en:${en.display.padEnd(22)} ja:${ja.display}`);
}
