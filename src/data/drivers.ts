// CocoTrip — 운전기사 프로필 (정적 데이터, P2-D 1차 구현)
// 실제 운영진 정보는 사용자 검수 후 갱신 예정.
// 사진은 /public/drivers/ 경로 (현재 placeholder, 사용자 자료 받으면 교체).
import type { I18nString } from './tours';
import type { DriverLanguage } from './tours';

export type Driver = {
  id: string;
  /** 표시명 (i18n). ko에는 한글명 + 영문 병기 또는 영문 single. */
  name: I18nString;
  /** /public 기준 사진 경로. 미설정 시 이니셜 placeholder. */
  photo?: string;
  /** 이니셜 폴백 (예: "JK"). */
  initials: string;
  /** 가능 언어. 'en'은 default 가정이지만 명시 권장. */
  languages: DriverLanguage[];
  /** 운전 경력 연수. */
  experience_years: number;
  /** 전문 분야 — i18n 라벨 배열 (3개 이내 권장). */
  specialties: I18nString[];
  /** 짧은 자기소개 (i18n, 1-2문장). */
  bio: I18nString;
  /** 5점 만점 평점 (옵션). */
  rating?: number;
  /** 누적 투어 횟수 (옵션). */
  toursCompleted?: number;
};

export const DRIVERS: Driver[] = [
  {
    id: 'driver-jk',
    name: { ko: '김재경 (Jake)', en: 'Jake Kim', ja: 'ジェイク·キム', zh: 'Jake 金' },
    initials: 'JK',
    languages: ['en', 'ja'],
    experience_years: 12,
    specialties: [
      { ko: '서울 도심 투어', en: 'Seoul city tours', ja: 'ソウル都心ツアー', zh: '首尔市区游' },
      { ko: 'DMZ·파주', en: 'DMZ & Paju', ja: 'DMZ·坡州', zh: 'DMZ·坡州' },
      { ko: '공항 픽업', en: 'Airport pickups', ja: '空港送迎', zh: '机场接送' },
    ],
    bio: {
      ko: '12년 경력 베테랑. 영어·일본어 능통, 한국 전통문화 가이드 자격증 보유.',
      en: 'Veteran with 12 years of experience. Fluent in English and Japanese. Licensed Korean traditional-culture guide.',
      ja: '12年のベテラン。英語·日本語堪能。韓国伝統文化ガイド資格保有。',
      zh: '12年资深司机。精通英语·日语。持韩国传统文化导游证。',
    },
    rating: 4.9,
    toursCompleted: 580,
  },
  {
    id: 'driver-mh',
    name: { ko: '박민호 (Mike)', en: 'Mike Park', ja: 'マイク·パク', zh: 'Mike 朴' },
    initials: 'MP',
    languages: ['en'],
    experience_years: 8,
    specialties: [
      { ko: '부산·경주 코스', en: 'Busan & Gyeongju', ja: '釜山·慶州', zh: '釜山·庆州' },
      { ko: '강원도 자연 투어', en: 'Gangwon nature tours', ja: '江原道自然ツアー', zh: '江原道自然游' },
      { ko: '미식 투어', en: 'Food tours', ja: 'グルメツアー', zh: '美食游' },
    ],
    bio: {
      ko: '부산 출신, 영남권 로컬 가이드. 전국 도로 연결 베테랑, 미슐랭·로컬 식당 추천 전문.',
      en: 'Busan native specializing in Yeongnam region. Cross-country veteran; expert on Michelin and local-favorite restaurants.',
      ja: '釜山出身、嶺南圏ローカルガイド。全国走行ベテラン、ミシュラン·ローカル店推薦エキスパート。',
      zh: '釜山出身岭南地区本地向导。全国通车资深，米其林·本地餐厅推荐专家。',
    },
    rating: 4.8,
    toursCompleted: 320,
  },
  {
    id: 'driver-sj',
    name: { ko: '이서진 (Sarah)', en: 'Sarah Lee', ja: 'サラ·イ', zh: 'Sarah 李' },
    initials: 'SL',
    languages: ['en', 'zh'],
    experience_years: 6,
    specialties: [
      { ko: 'K-pop·K-드라마 투어', en: 'K-pop / K-drama tours', ja: 'K-POP·K-ドラマツアー', zh: 'K-pop·韩剧游' },
      { ko: '쇼핑·미용 투어', en: 'Shopping & beauty', ja: 'ショッピング·美容', zh: '购物·美容' },
      { ko: '한복·전통 체험', en: 'Hanbok & tradition', ja: '韓服·伝統体験', zh: '韩服·传统体验' },
    ],
    bio: {
      ko: '중국어·영어 가이드. K-pop 콘서트장·드라마 촬영지 통달. 여성 고객 동행 안전 우선.',
      en: 'Bilingual EN/CN guide. Knows K-pop venues and drama-shoot spots inside out. Prioritizes safety for solo-female guests.',
      ja: '中国語·英語対応ガイド。K-POP会場·ドラマロケ地に精通。女性一人客の安全最優先。',
      zh: '中英双语导游。熟知K-pop演出场地和韩剧拍摄地。女性单独客人安全优先。',
    },
    rating: 4.9,
    toursCompleted: 210,
  },
  {
    id: 'driver-tj',
    name: { ko: '정태준 (TJ)', en: 'TJ Jung', ja: 'TJ·ジョン', zh: 'TJ 郑' },
    initials: 'TJ',
    languages: ['en', 'ja', 'zh'],
    experience_years: 15,
    specialties: [
      { ko: '멀티시티 장거리', en: 'Multi-city long-haul', ja: 'マルチシティ長距離', zh: '多城市长途' },
      { ko: 'VIP 의전 투어', en: 'VIP escort tours', ja: 'VIPエスコート', zh: 'VIP陪同游' },
      { ko: '제주 일주', en: 'Jeju island loop', ja: '済州一周', zh: '济州环岛' },
    ],
    bio: {
      ko: '15년 경력 수석 기사. 3개 언어 가능, 사장단·정부 의전 전담 경험.',
      en: 'Senior driver, 15 years. Trilingual; previously assigned to executive and government VIP details.',
      ja: '15年経験のシニアドライバー。3か国語対応、経営者·政府要人VIP担当経験あり。',
      zh: '15年资深司机。三语对应，曾担任高管·政府要员VIP陪同。',
    },
    rating: 5.0,
    toursCompleted: 712,
  },
];

export function getDriversForLanguages(langs: DriverLanguage[]): Driver[] {
  if (!langs || langs.length === 0) return DRIVERS;
  return DRIVERS.filter(d => langs.every(l => d.languages.includes(l)));
}

export function getDriverById(id: string): Driver | undefined {
  return DRIVERS.find(d => d.id === id);
}
