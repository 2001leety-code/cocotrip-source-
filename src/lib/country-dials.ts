/**
 * country-dials — 국가번호(dial code) 공유 SSOT.
 *
 * 출처: PhoneSignInModal.tsx (PR #399, 2026-05-13) 의 COUNTRIES / DEFAULT_DIAL_BY_LANG 를
 * 그대로 추출(named export). 로그인 전화인증과 예약폼(BookingInfoForm) 국가번호 드롭다운이
 * 동일 배열을 공유 — 한 곳 갱신으로 두 표면 일치. PhoneSignInModal 동작은 무변경(동일 배열).
 *
 * `dial` 은 E.164 prefix (앞의 + 제외 1~3자리). emoji flag 는 BMP 외 surrogate pair
 * (Windows 글꼴 미지원 시 사각형 표시 가능 — 안전한 fallback, 텍스트엔 영향 없음).
 */

export type DialLang = 'ko' | 'en' | 'ja' | 'zh';

export interface CountryDial {
  code: string;
  dial: string;
  flag: string;
  name: { ko: string; en: string; ja: string; zh: string };
}

// PR #399 (2026-05-13): 국가 select dropdown — CocoTrip 외국인 핵심 타겟 + 주요 국가.
// 정렬 = 동아시아·동남아(자주 쓰는 외국인 타겟) 상위, 이후 서구권. KR 첫번째(국내 회귀 안전).
export const COUNTRIES: ReadonlyArray<CountryDial> = [
  { code: 'KR', dial: '82',  flag: '🇰🇷', name: { ko: '대한민국', en: 'South Korea',  ja: '韓国',     zh: '韩国' } },
  { code: 'JP', dial: '81',  flag: '🇯🇵', name: { ko: '일본',     en: 'Japan',        ja: '日本',     zh: '日本' } },
  { code: 'TW', dial: '886', flag: '🇹🇼', name: { ko: '대만',     en: 'Taiwan',       ja: '台湾',     zh: '台湾' } },
  { code: 'HK', dial: '852', flag: '🇭🇰', name: { ko: '홍콩',     en: 'Hong Kong',    ja: '香港',     zh: '香港' } },
  { code: 'CN', dial: '86',  flag: '🇨🇳', name: { ko: '중국',     en: 'China',        ja: '中国',     zh: '中国' } },
  { code: 'US', dial: '1',   flag: '🇺🇸', name: { ko: '미국',     en: 'United States', ja: 'アメリカ', zh: '美国' } },
  { code: 'SG', dial: '65',  flag: '🇸🇬', name: { ko: '싱가포르', en: 'Singapore',    ja: 'シンガポール', zh: '新加坡' } },
  { code: 'MY', dial: '60',  flag: '🇲🇾', name: { ko: '말레이시아', en: 'Malaysia',    ja: 'マレーシア', zh: '马来西亚' } },
  { code: 'TH', dial: '66',  flag: '🇹🇭', name: { ko: '태국',     en: 'Thailand',     ja: 'タイ',     zh: '泰国' } },
  { code: 'ID', dial: '62',  flag: '🇮🇩', name: { ko: '인도네시아', en: 'Indonesia',   ja: 'インドネシア', zh: '印度尼西亚' } },
  { code: 'VN', dial: '84',  flag: '🇻🇳', name: { ko: '베트남',   en: 'Vietnam',      ja: 'ベトナム', zh: '越南' } },
  { code: 'PH', dial: '63',  flag: '🇵🇭', name: { ko: '필리핀',   en: 'Philippines',  ja: 'フィリピン', zh: '菲律宾' } },
  { code: 'AU', dial: '61',  flag: '🇦🇺', name: { ko: '호주',     en: 'Australia',    ja: 'オーストラリア', zh: '澳大利亚' } },
  { code: 'GB', dial: '44',  flag: '🇬🇧', name: { ko: '영국',     en: 'United Kingdom', ja: 'イギリス', zh: '英国' } },
  { code: 'DE', dial: '49',  flag: '🇩🇪', name: { ko: '독일',     en: 'Germany',      ja: 'ドイツ',   zh: '德国' } },
  { code: 'FR', dial: '33',  flag: '🇫🇷', name: { ko: '프랑스',   en: 'France',       ja: 'フランス', zh: '法国' } },
  { code: 'CA', dial: '1',   flag: '🇨🇦', name: { ko: '캐나다',   en: 'Canada',       ja: 'カナダ',   zh: '加拿大' } },
] as const;

// 언어 → default 국가 dial code (사용자 진입 시 자동 선택).
// CocoTrip 외국인 VIP 투어 타겟 분포 기반.
export const DEFAULT_DIAL_BY_LANG: Record<DialLang, string> = {
  ko: '82',
  ja: '81',
  zh: '86', // 중국 본토 우선 (대만/홍콩 별도 선택)
  en: '1',  // 미국 default — 영어권 사용자
};

/**
 * dial code 로 국가 1개 찾기. dial 은 1:1 이 아님(US/CA 둘 다 '1') → 첫 일치 반환.
 * 드롭다운 value 가 dial 이므로 표시·매칭엔 충분.
 */
export function findCountryByDial(dial: string): CountryDial | undefined {
  return COUNTRIES.find((c) => c.dial === dial);
}

/**
 * 전화 입력값을 dial + nationalNumber 로 역파싱 (BookingInfoForm 마운트/prop변경 resume 용).
 *
 * 케이스:
 *  - "+82 1012345678" / "+82-10-1234-5678" → { dial:'82', national:'1012345678' }
 *  - "+11234567890"  (공백 없음)           → 알려진 dial prefix 최장일치 → { dial:'1', national:'234567890' }
 *  - "01012345678"   (구 raw, + 없음)       → { dial:'', national:'01012345678' }  ← 호출처가 fallbackDial 적용
 *  - ""                                     → { dial:'', national:'' }
 *
 * 반환 national 은 숫자만(구분자 제거). dial 미검출 시 dial='' (호출처가 기본 dial 유지).
 */
export function parsePhoneValue(raw: string): { dial: string; national: string } {
  if (typeof raw !== 'string' || raw.trim() === '') return { dial: '', national: '' };
  const trimmed = raw.trim();
  if (trimmed.startsWith('+')) {
    // '+' 뒤 전체 숫자
    const digits = trimmed.slice(1).replace(/\D/g, '');
    // 공백/구분자 기준으로 dial 추출 시도 ("+82 10..." 형태가 가장 흔함)
    const spaceMatch = trimmed.match(/^\+\s*(\d{1,4})[\s\-().]/);
    if (spaceMatch) {
      const cand = spaceMatch[1];
      if (findCountryByDial(cand)) {
        return { dial: cand, national: digits.slice(cand.length) };
      }
    }
    // 구분자 없음 → 알려진 dial 최장(3→2→1자리) 우선 일치
    for (const len of [3, 2, 1]) {
      const cand = digits.slice(0, len);
      if (findCountryByDial(cand)) {
        return { dial: cand, national: digits.slice(len) };
      }
    }
    // 알려진 dial 미일치 → 전체를 national 로 (호출처 fallbackDial 유지)
    return { dial: '', national: digits };
  }
  // '+' 없음 = 구 raw(국내형) → dial 미상, 숫자만 반환
  return { dial: '', national: trimmed.replace(/\D/g, '') };
}

/**
 * national 입력에서 dial 합성 전 정규화 — 숫자만 + 선행 0 제거(국내형 010→10).
 * 사용자가 national 칸에 dial 을 또 친 경우(이중 prefix) 도 strip.
 * @param national 사용자가 입력한 번호 칸 raw
 * @param dial 선택된 국가번호(+ 없는 숫자, 예 '82')
 */
export function normalizeNationalNumber(national: string, dial: string): string {
  let n = (national || '').replace(/\D/g, '');
  // 사용자가 national 칸에 "+82..." 또는 "82..." 로 dial 을 중복 입력 → 1회 strip (이중 prefix 방지).
  if (dial && n.startsWith(dial) && n.length > dial.length) {
    n = n.slice(dial.length);
  }
  // 국제 표준에서 가입자번호 선행 0 제외 (한국 010→10, 일본 090→90).
  n = n.replace(/^0+/, '');
  return n;
}

/**
 * dial + national → emit 합성값 "+{dial} {national}" (공백 딱 1개).
 * national 은 normalizeNationalNumber 로 정규화된 값을 받음.
 * national 이 비면 "+{dial}" (게이트 isValidInternationalPhone 는 8자리 미만이라 미통과 = 의도).
 */
export function composePhoneValue(dial: string, national: string): string {
  const n = (national || '').replace(/\D/g, '');
  if (!n) return `+${dial}`;
  return `+${dial} ${n}`;
}
