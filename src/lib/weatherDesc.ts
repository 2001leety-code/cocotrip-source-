// wttr.in 날씨 설명 다국어 헬퍼 (2026-07-17).
// 배경: 홈/마이페이지 날씨 칩이 wttr.in 영어 설명("Partly cloudy")을 그대로 노출 —
// ko/ja/zh 화면에 영어 잔존. wttr.in 은 `?lang=xx` 요청 시 j1 JSON 의
// current_condition[0][`lang_${xx}`][0].value 에 번역 설명을 담아준다.
// 번역 필드가 없거나 요청 실패 시 영어(weatherDesc) 폴백 — 표시 자체는 항상 보장.

/** UI 언어 → wttr.in lang 코드 (en 은 파라미터 불필요). */
export const WTTR_LANG: Record<string, string> = { ko: 'ko', ja: 'ja', zh: 'zh-cn' };

/** wttr.in 요청 URL 에 붙일 lang 쿼리 (en 이면 빈 문자열). */
export function wttrLangParam(language: string): string {
  const code = WTTR_LANG[language];
  return code ? `&lang=${code}` : '';
}

type WttrValue = { value?: string };
type WttrCurrent = Record<string, unknown> & { weatherDesc?: WttrValue[] };

/** current_condition[0] 에서 UI 언어 설명 추출 (없으면 영어 폴백). */
export function pickWeatherDesc(cur: WttrCurrent | undefined | null, language: string): string {
  if (!cur) return '';
  const code = WTTR_LANG[language];
  if (code) {
    const localized = (cur[`lang_${code}`] as WttrValue[] | undefined)?.[0]?.value;
    if (localized) return localized;
  }
  return cur.weatherDesc?.[0]?.value || '';
}

// ── 날씨 아이콘 (2026-07-28) ─────────────────────────────────────────────────
// 🔴 이전에는 호출부가 아이콘을 **기온으로** 골랐다:
//     Number(temp_C) > 20 ? '☀️' : > 10 ? '⛅' : '❄️'
//   그래서 22°C 이슬비에 해가 뜬 아이콘 + "Patchy light drizzle" 설명이 같이 나왔다.
//   아이콘과 설명이 **같은 데이터(weatherCode)** 에서 나오도록 여기로 모은다.
//
// weatherCode = wttr.in(WWO) 표준 코드. 대표값만 매핑하고 나머지는 구간으로 처리한다.
// 참고: 113=맑음, 116=부분 흐림, 119/122=흐림, 143/248/260=안개,
//       176~377 = 비/눈/뇌우 계열.

/** WWO weatherCode → 이모지. 코드가 없거나 모르면 null (호출부가 폴백). */
export function weatherIconFromCode(code: string | number | undefined | null): string | null {
  const c = Number(code);
  if (!Number.isFinite(c)) return null;
  if (c === 113) return '\u2600\ufe0f';                 // ☀️ 맑음
  if (c === 116) return '\u26c5';                        // ⛅ 부분 흐림
  if (c === 119 || c === 122) return '\u2601\ufe0f';     // ☁️ 흐림
  if (c === 143 || c === 248 || c === 260) return '\ud83c\udf2b\ufe0f'; // 🌫️ 안개
  if ([200, 386, 389, 392, 395].includes(c)) return '\u26c8\ufe0f';     // ⛈️ 뇌우
  // 눈·진눈깨비 계열
  if ([179, 182, 185, 227, 230, 281, 284, 311, 314, 317, 320, 323, 326,
    329, 332, 335, 338, 350, 362, 365, 368, 371, 374, 377].includes(c)) {
    return '\ud83c\udf28\ufe0f';                          // 🌨️
  }
  // 그 밖의 176~377 은 비 계열
  if (c >= 176 && c <= 377) return '\ud83c\udf27\ufe0f';  // 🌧️
  return null;
}

/**
 * current_condition[0] → 아이콘. weatherCode 우선, 없으면 설명 텍스트로 추정,
 * 그것도 안 되면 기온 폴백(옛 동작) — 표시 자체는 항상 보장한다.
 */
export function pickWeatherIcon(cur: WttrCurrent | undefined | null): string {
  if (!cur) return '\u26c5';
  const byCode = weatherIconFromCode((cur as { weatherCode?: string | number }).weatherCode);
  if (byCode) return byCode;
  const desc = String(cur.weatherDesc?.[0]?.value || '').toLowerCase();
  if (/thunder/.test(desc)) return '\u26c8\ufe0f';
  if (/snow|sleet|blizzard|ice/.test(desc)) return '\ud83c\udf28\ufe0f';
  if (/rain|drizzle|shower/.test(desc)) return '\ud83c\udf27\ufe0f';
  if (/fog|mist/.test(desc)) return '\ud83c\udf2b\ufe0f';
  if (/overcast|cloud/.test(desc)) return '\u2601\ufe0f';
  if (/sunny|clear/.test(desc)) return '\u2600\ufe0f';
  const t = Number((cur as { temp_C?: string | number }).temp_C);
  if (!Number.isFinite(t)) return '\u26c5';
  return t > 20 ? '\u2600\ufe0f' : t > 10 ? '\u26c5' : '\u2744\ufe0f';
}
