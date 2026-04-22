/**
 * Hangul → Latin helpers for transit data. ODsay Basic tier returns Korean
 * station and line names only. Instead of paying for the Standard tier just
 * to get English names (~$$$/month, unclear value), we:
 *
 *   1. Keep the Korean name as-is (matches the actual signage on the ground).
 *   2. Add a Latin rendering alongside so foreign travelers can recognize
 *      stops from Google/Naver maps before they arrive.
 *
 * Line-name normalisation: ODsay returns verbose names like "수도권 2호선" or
 * "서울 지하철 5호선". We normalise to "Line 2" / "Line 5" and add i18n.
 *
 * Station romanisation: curated map covers the major tourist/transfer stops
 * where the official English name diverges from a mechanical transliteration
 * (e.g. 동대입구 → "Dongguk Univ.", not "Dongdaeipgu"). Everything else falls
 * through to Revised Romanization of Korean (algorithmic).
 */

// ─── Line name localization ───────────────────────────────────────────────

/**
 * Known non-numbered line display names. Keys are official Korean names
 * (possibly preceded by "수도권" etc. — we strip those). Values are per-language.
 */
const SPECIAL_LINES = {
  '신분당선': { en: 'Shinbundang Line', ja: '新盆唐線', zh: '新盆唐线' },
  '분당선': { en: 'Bundang Line', ja: '盆唐線', zh: '盆唐线' },
  '수인분당선': { en: 'Suin-Bundang Line', ja: '水仁盆唐線', zh: '水仁盆唐线' },
  '경의중앙선': { en: 'Gyeongui-Jungang Line', ja: '京義中央線', zh: '京义中央线' },
  '경춘선': { en: 'Gyeongchun Line', ja: '京春線', zh: '京春线' },
  '공항철도': { en: 'Airport Railroad (AREX)', ja: '空港鉄道', zh: '机场铁道' },
  '인천공항철도': { en: 'Airport Railroad (AREX)', ja: '空港鉄道', zh: '机场铁道' },
  '우이신설선': { en: 'Ui-Sinseol Line', ja: '牛耳新設線', zh: '牛耳新设线' },
  '신림선': { en: 'Sillim Line', ja: '新林線', zh: '新林线' },
  '김포골드라인': { en: 'Gimpo Goldline', ja: '金浦ゴールドライン', zh: '金浦金线' },
  '서해선': { en: 'Seohae Line', ja: '西海線', zh: '西海线' },
  '에버라인': { en: 'Everline', ja: 'エバーライン', zh: '轻轨' },
  '의정부경전철': { en: 'Uijeongbu LRT', ja: '議政府軽電鉄', zh: '议政府轻轨' },
  '인천1호선': { en: 'Incheon Line 1', ja: '仁川1号線', zh: '仁川1号线' },
  '인천2호선': { en: 'Incheon Line 2', ja: '仁川2号線', zh: '仁川2号线' },
  'GTX-A': { en: 'GTX-A', ja: 'GTX-A', zh: 'GTX-A' },
};

/**
 * Normalise ODsay verbose line name to short canonical form + localize.
 * @param {string} rawName e.g. "수도권 2호선", "신분당선", "서울 지하철 5호선"
 * @param {string} lang 'ko' | 'en' | 'ja' | 'zh'
 * @returns {{ ko: string, display: string }}
 */
export function localizeLineName(rawName, lang = 'ko') {
  if (!rawName) return { ko: '', display: '' };
  // Strip common prefixes (수도권, 서울 지하철, 서울 등) — keep the meaningful bit
  const stripped = rawName
    .replace(/^수도권\s*/, '')
    .replace(/^서울\s*지하철\s*/, '')
    .replace(/^서울\s*/, '')
    .trim();

  // Numeric lines: 2호선 → "Line 2"
  const numMatch = stripped.match(/^(\d+)호선$/);
  if (numMatch) {
    const n = numMatch[1];
    const ko = `${n}호선`;
    const byLang = { en: `Line ${n}`, ja: `${n}号線`, zh: `${n}号线`, ko };
    return { ko, display: byLang[lang] || ko };
  }

  // Special lines (exact match after normalisation)
  const key = stripped.replace(/\s+/g, '');
  if (SPECIAL_LINES[key]) {
    return {
      ko: stripped,
      display: SPECIAL_LINES[key][lang] || stripped,
    };
  }

  // Unknown line — keep original
  return { ko: stripped, display: stripped };
}

// ─── Station romanization ─────────────────────────────────────────────────

/**
 * Curated station name overrides where official English name differs from
 * mechanical romanisation (e.g. university names, historical places). Only
 * the station part is included (no "역" suffix). ODsay returns just "강남",
 * "잠실" etc., so that's what we key on.
 *
 * Source: Seoul Metro official English station names.
 * https://www.seoulmetro.co.kr (subway station list, public data)
 */
const STATION_OVERRIDES = {
  // Line 1
  '서울역': 'Seoul Station', '서울': 'Seoul Station', '시청': 'City Hall',
  '종각': 'Jonggak', '종로3가': 'Jongno 3(sam)-ga', '종로5가': 'Jongno 5(o)-ga',
  '동대문': 'Dongdaemun', '제기동': 'Jegi-dong', '청량리': 'Cheongnyangni',
  '신설동': 'Sinseol-dong', '동묘앞': 'Dongmyo',
  // Line 2
  '을지로입구': 'Euljiro 1(il)-ga', '을지로3가': 'Euljiro 3(sam)-ga', '을지로4가': 'Euljiro 4(sa)-ga',
  '동대문역사문화공원': 'Dongdaemun History & Culture Park', '신당': 'Sindang',
  '상왕십리': 'Sangwangsimni', '왕십리': 'Wangsimni', '한양대': 'Hanyang Univ.',
  '뚝섬': 'Ttukseom', '성수': 'Seongsu', '건대입구': 'Konkuk Univ.',
  '구의': 'Guui', '강변': 'Gangbyeon', '잠실나루': 'Jamsillaru', '잠실': 'Jamsil',
  '잠실새내': 'Jamsilsaenae', '종합운동장': 'Sports Complex', '삼성': 'Samseong',
  '선릉': 'Seolleung', '역삼': 'Yeoksam', '강남': 'Gangnam', '교대': 'Seoul Nat\'l Univ. of Education',
  '서초': 'Seocho', '방배': 'Bangbae', '사당': 'Sadang', '낙성대': 'Nakseongdae',
  '서울대입구': 'Seoul Nat\'l Univ.', '봉천': 'Bongcheon', '신림': 'Sillim',
  '신대방': 'Sindaebang', '구로디지털단지': 'Guro Digital Complex', '대림': 'Daerim',
  '신도림': 'Sindorim', '문래': 'Mullae', '영등포구청': 'Yeongdeungpo-gu Office',
  '당산': 'Dangsan', '합정': 'Hapjeong', '홍대입구': 'Hongik Univ.', '신촌': 'Sinchon',
  '이대': 'Ewha Womans Univ.', '아현': 'Ahyeon', '충정로': 'Chungjeongno',
  // Line 3
  '경복궁': 'Gyeongbokgung', '안국': 'Anguk', '독립문': 'Dongnimmun',
  '무악재': 'Muakjae', '홍제': 'Hongje', '녹번': 'Nokbeon', '불광': 'Bulgwang',
  '연신내': 'Yeonsinnae', '구파발': 'Gupabal', '지축': 'Jichuk',
  '대화': 'Daehwa', '주엽': 'Juyeop', '정발산': 'Jeongbalsan', '마두': 'Madu',
  '백석': 'Baekseok', '대곡': 'Daegok', '화정': 'Hwajeong', '원당': 'Wondang',
  '삼송': 'Samsong', '원흥': 'Wonheung', '서울고속버스터미널': 'Express Bus Terminal',
  '신사': 'Sinsa', '압구정': 'Apgujeong', '옥수': 'Oksu', '금호': 'Geumho',
  '약수': 'Yaksu', '동대입구': 'Dongguk Univ.', '충무로': 'Chungmuro',
  // Line 4
  '명동': 'Myeong-dong', '회현': 'Hoehyeon', '숙대입구': 'Sookmyung Women\'s Univ.',
  '혜화': 'Hyehwa', '한성대입구': 'Hansung Univ.', '성신여대입구': 'Sungshin Women\'s Univ.',
  '길음': 'Gireum', '미아': 'Mia', '수유': 'Suyu', '쌍문': 'Ssangmun',
  '창동': 'Chang-dong', '노원': 'Nowon', '이촌': 'Ichon', '동작': 'Dongjak',
  '남태령': 'Namtaeryeong', '선바위': 'Seonbawi', '과천': 'Gwacheon',
  // Line 5
  '광화문': 'Gwanghwamun', '서대문': 'Seodaemun', '충정로': 'Chungjeongno',
  '애오개': 'Aeogae', '공덕': 'Gongdeok', '마포': 'Mapo', '여의나루': 'Yeouinaru',
  '여의도': 'Yeouido', '신길': 'Singil', '영등포시장': 'Yeongdeungpo Market',
  '목동': 'Mok-dong', '오목교': 'Omokgyo', '김포공항': 'Gimpo Int\'l Airport',
  // Line 6
  '이태원': 'Itaewon', '한강진': 'Hangangjin', '버티고개': 'Beotigogae',
  '상수': 'Sangsu', '망원': 'Mangwon', '마포구청': 'Mapo-gu Office',
  '월드컵경기장': 'World Cup Stadium', '디지털미디어시티': 'Digital Media City',
  // Line 7
  '내방': 'Naebang', '논현': 'Nonhyeon', '청담': 'Cheongdam',
  '강남구청': 'Gangnam-gu Office', '학동': 'Hak-dong', '뚝섬유원지': 'Ttukseom Resort',
  '어린이대공원': 'Children\'s Grand Park', '군자': 'Gunja', '중화': 'Jungnang',
  '상봉': 'Sangbong', '면목': 'Myeonmok', '태릉입구': 'Taereung',
  // Line 8
  '모란': 'Moran', '수진': 'Sujin', '산성': 'Sanseong', '남한산성입구': 'Namhansanseong',
  '단대오거리': 'Dandae-ogeori', '가락시장': 'Garak Market', '복정': 'Bokjeong',
  // Line 9
  '신논현': 'Sinnonhyeon', '언주': 'Eonju', '선정릉': 'Seonjeongneung',
  '봉은사': 'Bongeunsa', '국회의사당': 'National Assembly', '노량진': 'Noryangjin',
  '샛강': 'Saetgang', '당산': 'Dangsan', '선유도': 'Seonyudo', '가양': 'Gayang',
  '등촌': 'Deungchon', '염창': 'Yeomchang',
  // Airport Railroad
  '인천공항1터미널': 'Incheon Int\'l Airport T1', '인천공항2터미널': 'Incheon Int\'l Airport T2',
  '검암': 'Geomam', '계양': 'Gyeyang', '디지털미디어시티': 'DMC',
  // Shinbundang
  '정자': 'Jeongja', '미금': 'Migeum', '동천': 'Dongcheon', '수지구청': 'Suji-gu Office',
  '성복': 'Seongbok', '상현': 'Sanghyeon', '광교': 'Gwanggyo',
  '광교중앙': 'Gwanggyo Jungang', '양재': 'Yangjae', '양재시민의숲': 'Yangjae Citizen\'s Forest',
  // Gyeongui-Jungang
  '용산': 'Yongsan', '옥수': 'Oksu', '응봉': 'Eungbong', '중랑': 'Jungnang',
  '팔당': 'Paldang', '양수': 'Yangsu', '신원': 'Sinwon',
  // Bundang
  '수서': 'Suseo', '복정': 'Bokjeong', '가천대': 'Gachon Univ.',
  // K-Pop / tourist hotspots
  '동대문역사문화공원': 'Dongdaemun History & Culture Park',
  '광화문': 'Gwanghwamun', '경복궁': 'Gyeongbokgung', '안국': 'Anguk',
  '인사동': 'Insadong', '북촌': 'Bukchon', '명동': 'Myeong-dong',
};

// Revised Romanization tables (Korean Ministry of Culture, 2000)
const RR_INITIAL = ['g','kk','n','d','tt','r','m','b','pp','s','ss','','j','jj','ch','k','t','p','h'];
const RR_MEDIAL = ['a','ae','ya','yae','eo','e','yeo','ye','o','wa','wae','oe','yo','u','wo','we','wi','yu','eu','ui','i'];
const RR_FINAL = ['','k','k','ks','n','nj','nh','t','l','lk','lm','lp','ls','lt','lp','lh','m','p','ps','t','ss','ng','t','t','k','t','p','h'];

/**
 * Mechanical Revised Romanization fallback for station names not in the
 * curated map. Uppercases first letter. Not perfect (doesn't handle
 * consonant assimilation across syllables) but gives recognisable output.
 */
function romanizeHangulMechanical(str) {
  if (!str) return '';
  let out = '';
  for (const ch of str) {
    const code = ch.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) {
      const idx = code - 0xAC00;
      const initial = Math.floor(idx / 588);
      const medial = Math.floor((idx % 588) / 28);
      const finalC = idx % 28;
      out += RR_INITIAL[initial] + RR_MEDIAL[medial] + RR_FINAL[finalC];
    } else {
      out += ch;
    }
  }
  return out ? out.charAt(0).toUpperCase() + out.slice(1) : '';
}

/**
 * Romanize a station or stop name. ODsay may pass names with "역" suffix
 * ("강남역") or without ("강남") — we strip and append station/stop suffix
 * appropriately based on context. For bus stop names (comma-separated,
 * trailing direction words) we pass through unchanged since there's no
 * reliable official English mapping.
 *
 * @param {string} koreanName Raw Korean name from ODsay
 * @param {string} lang Target language ('ko' returns null — caller should use raw)
 * @returns {string|null} Romanized name, or null if not translatable
 */
export function romanizeStation(koreanName, lang = 'en') {
  if (!koreanName || lang === 'ko') return null;

  // Trim trailing "역" (subway) to match override keys, remember to add back
  const hasStationSuffix = koreanName.endsWith('역');
  const base = hasStationSuffix ? koreanName.slice(0, -1) : koreanName;

  // Also handle ODsay bus-stop convention: "강남역.강남대로" → strip after first dot
  const primaryPart = base.split(/[.(]/)[0].trim();

  if (STATION_OVERRIDES[primaryPart]) {
    return STATION_OVERRIDES[primaryPart];
  }

  // Mechanical fallback
  const mech = romanizeHangulMechanical(primaryPart);
  return mech || null;
}

/**
 * Shorthand: produce the display text a client should render.
 * - lang='ko' → raw Korean
 * - other   → "강남 (Gangnam)"
 */
export function formatStationBilingual(koreanName, lang = 'ko') {
  if (!koreanName) return '';
  if (lang === 'ko') return koreanName;
  const romanized = romanizeStation(koreanName, lang);
  return romanized ? `${koreanName} (${romanized})` : koreanName;
}
