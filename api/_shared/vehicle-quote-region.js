/**
 * 차량 견적 지역-주소 충돌 검증 SSOT.
 * 외부 검색이나 주소 보정 없이, 원문/주소에 실제 있는 알려진 지역 토큰만 다룬다.
 */

const REGION_ALIASES = Object.freeze([
  { key: 'seoul', aliases: ['서울특별시', '서울', 'Seoul Special City', 'Seoul'] },
  { key: 'busan', aliases: ['부산광역시', '부산', 'Busan Metropolitan City', 'Busan'] },
  { key: 'daegu', aliases: ['대구광역시', '대구', 'Daegu Metropolitan City', 'Daegu'] },
  { key: 'incheon', aliases: ['인천광역시', '인천', 'Incheon Metropolitan City', 'Incheon'] },
  { key: 'gwangju', aliases: ['광주광역시', '광주', 'Gwangju Metropolitan City', 'Gwangju'] },
  { key: 'daejeon', aliases: ['대전광역시', '대전', 'Daejeon Metropolitan City', 'Daejeon'] },
  { key: 'ulsan', aliases: ['울산광역시', '울산', 'Ulsan Metropolitan City', 'Ulsan'] },
  { key: 'sejong', aliases: ['세종특별자치시', '세종', 'Sejong Special Self-Governing City', 'Sejong'] },
  {
    key: 'gyeonggi',
    aliases: ['경기도', '경기', 'Gyeonggi-do', 'Gyeonggi Province', 'Gyeonggi', 'Namyangju', 'Guri'],
  },
  {
    key: 'gangwon',
    aliases: ['강원특별자치도', '강원도', '강원', 'Gangwon Special Self-Governing Province', 'Gangwon-do', 'Gangwon'],
  },
  { key: 'chungbuk', aliases: ['충청북도', '충북', 'North Chungcheong Province', 'Chungcheongbuk-do', 'Chungbuk'] },
  { key: 'chungnam', aliases: ['충청남도', '충남', 'South Chungcheong Province', 'Chungcheongnam-do', 'Chungnam'] },
  {
    key: 'jeonbuk',
    aliases: ['전북특별자치도', '전라북도', '전북', 'Jeonbuk State', 'North Jeolla Province', 'Jeollabuk-do', 'Jeonbuk'],
  },
  { key: 'jeonnam', aliases: ['전라남도', '전남', 'South Jeolla Province', 'Jeollanam-do', 'Jeonnam'] },
  { key: 'gyeongbuk', aliases: ['경상북도', '경북', 'North Gyeongsang Province', 'Gyeongsangbuk-do', 'Gyeongbuk'] },
  { key: 'gyeongnam', aliases: ['경상남도', '경남', 'South Gyeongsang Province', 'Gyeongsangnam-do', 'Gyeongnam'] },
  { key: 'jeju', aliases: ['제주특별자치도', '제주도', '제주', 'Jeju Special Self-Governing Province', 'Jeju-do', 'Jeju'] },
]);

function cleanLine(value, maxLength = 300) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function recognizeQuoteRegion(value, options = {}) {
  const text = cleanLine(value, 300);
  if (!text) return null;
  const addressOnly = options.addressOnly === true;
  const comparableText = text.toLocaleLowerCase('en-US');
  for (const region of REGION_ALIASES) {
    for (const alias of region.aliases) {
      const comparableAlias = alias.toLocaleLowerCase('en-US');
      const index = comparableText.indexOf(comparableAlias);
      const englishAlias = /[a-z]/i.test(alias);
      if (index < 0 || (addressOnly && !englishAlias && index !== 0)) continue;
      const previous = text.slice(Math.max(0, index - 1), index);
      const next = text.slice(index + alias.length, index + alias.length + 1);
      if ((previous && !/[\s,():;\-]/.test(previous))
        || (next && !/[\s,():;\-]/.test(next))) continue;
      return { key: region.key, token: text.slice(index, index + alias.length) };
    }
  }
  return null;
}

export function formatQuoteRegionConflictWarning(conflict) {
  return `${conflict.stopOrder}번 장소의 지역 설명(${conflict.sourceRegion})과 명시 주소의 지역(${conflict.addressRegion})이 다릅니다. 명시 주소를 유지했으며 견적 전 최종 확인이 필요합니다.`;
}

/** 현재 일정 stop 자체의 지역 설명과 현재 주소만 비교해 서버 충돌을 만든다. */
export function detectQuoteRegionConflicts(stops) {
  const scheduleStops = Array.isArray(stops) ? stops : [];
  const conflicts = [];

  for (const stop of scheduleStops) {
    if (!stop || typeof stop !== 'object' || Array.isArray(stop)
      || !Number.isSafeInteger(stop.order) || stop.order < 1) continue;
    const sourceRegion = recognizeQuoteRegion(stop.sourceRegion);
    if (!sourceRegion) continue;
    const roadRegion = recognizeQuoteRegion(stop.roadAddress, { addressOnly: true });
    const jibunRegion = recognizeQuoteRegion(stop.jibunAddress, { addressOnly: true });
    const addressRegion = roadRegion || jibunRegion;
    if (!addressRegion || addressRegion.key === sourceRegion.key) continue;
    conflicts.push({
      type: 'REGION_ADDRESS_MISMATCH',
      stopOrder: stop.order,
      sourceRegion: sourceRegion.token,
      addressRegion: addressRegion.token,
      addressField: roadRegion ? 'roadAddress' : 'jibunAddress',
    });
  }
  return conflicts;
}
