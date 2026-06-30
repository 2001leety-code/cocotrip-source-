/**
 * country-dials — 국가번호(dial code) 공유 SSOT.
 *
 * COUNTRIES = 전세계 ~239국 (src/lib/country-dials.data.ts, 빌드타임 생성 — ITU-T E.164 dial +
 *   Node Intl.DisplayNames 4언어명). 로그인 전화인증(PhoneSignInModal)·예약폼(BookingInfoForm)·
 *   국가번호 picker(CountryDialPicker)가 동일 배열 공유 — 한 곳 갱신으로 모든 표면 일치.
 *
 * flag emoji 는 데이터에 없음 — flagOf(code) 로 ISO2 → regional indicator surrogate pair 파생
 *   (Windows 글꼴 미지원 시 사각형 표시 = 안전 fallback, 텍스트엔 영향 없음).
 *
 * ⚠️ 번들: 데이터 배열(country-dials.data.ts)은 이 모듈을 통해서만 노출 — import 처(BookingInfoForm/
 *   PhoneSignInModal/CountryDialPicker)가 모두 lazy chunk 라 eager entry 번들에 안 샘(check:size 게이트).
 */
import { RAW_COUNTRIES } from './country-dials.data';

export type DialLang = 'ko' | 'en' | 'ja' | 'zh';

export interface CountryDial {
  code: string;
  dial: string;
  name: { ko: string; en: string; ja: string; zh: string };
}

// 전세계 국가 배열 (data 파일에서 그대로 노출). KR/US/CA(+1)/TW/JP/CN 등 핵심 포함.
export const COUNTRIES: ReadonlyArray<CountryDial> = RAW_COUNTRIES;

// 자주 찾는 dial (picker 상단 고정) — 한국 타겟 외국인 분포: KR/US·CA/JP/CN/TW/HK/VN/TH.
//   '1' 은 US/CA 공유 → findCountryByDial 첫 일치(CA 알파벳순 우선이나 picker 는 dial 매칭이라 무관).
export const PINNED_DIALS: ReadonlyArray<string> = ['82', '1', '81', '86', '886', '852', '84', '66'];

// 언어 → default 국가 dial code (사용자 진입 시 자동 선택).
// CocoTrip 외국인 VIP 투어 타겟 분포 기반.
export const DEFAULT_DIAL_BY_LANG: Record<DialLang, string> = {
  ko: '82',
  ja: '81',
  zh: '86', // 중국 본토 우선 (대만/홍콩 별도 선택)
  en: '1',  // 미국 default — 영어권 사용자
};

/**
 * ISO3166-1 alpha-2 국가코드 → flag emoji (regional indicator symbols).
 * 데이터에 flag 를 박지 않고 code 에서 파생 — 단일 출처(SSOT), 데이터 경량.
 * 잘못된/2자 아닌 코드는 그대로 반환(안전).
 */
export function flagOf(code: string): string {
  const cc = (code || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return code || '';
  return cc.replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

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
 *
 * ⚠️ 200국 확장 함정 (P-pattern, country-dials 설계 §5):
 *   공백 없는 raw 의 무공백 분기는 최장 3자리(3→2→1)만 검사 → 4자리 dial(예 BS '1242',
 *   US 와 prefix '1' 공유)은 무공백 시 dial='1' 로 오추정 가능. 단 *실제 emit 은 항상
 *   composePhoneValue 로 "+{dial} {national}"(공백 1개) → spaceMatch 분기가 1~4자리 정확 매칭.
 *   위험 = 외부에서 들어온 공백 없는 구 raw resume 시 dial *표시*만 틀어짐(결제/연락 무해 —
 *   전체 숫자는 동일, 게이트 isValidInternationalPhone 무영향). spaceMatch 우선 유지로 정상 emit 안전.
 */
export function parsePhoneValue(raw: string): { dial: string; national: string } {
  if (typeof raw !== 'string' || raw.trim() === '') return { dial: '', national: '' };
  const trimmed = raw.trim();
  if (trimmed.startsWith('+')) {
    // '+' 뒤 전체 숫자
    const digits = trimmed.slice(1).replace(/\D/g, '');
    // 공백/구분자 기준으로 dial 추출 시도 ("+82 10..." 형태가 가장 흔함). 1~4자리(4자리 dial 정확).
    const spaceMatch = trimmed.match(/^\+\s*(\d{1,4})[\s\-().]/);
    if (spaceMatch) {
      const cand = spaceMatch[1];
      if (findCountryByDial(cand)) {
        return { dial: cand, national: digits.slice(cand.length) };
      }
    }
    // 구분자 없음 → 알려진 dial 최장(3→2→1자리) 우선 일치. (4자리 dial 은 위 spaceMatch 로만 정확.)
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
