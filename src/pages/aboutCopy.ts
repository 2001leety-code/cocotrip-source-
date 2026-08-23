/**
 * /about 문구 (2026-08-23).
 *
 * 이 파일에 **새 사실은 한 줄도 없다.** /about 은 지금까지 화면에 뜻 있는 낱말이 두 개
 * ("About COCOTRIP") 뿐이고 나머지는 브랜드 이미지 4장이었다 — 크롤러가 읽을 본문이
 * 사실상 없었고, 신뢰를 판단하려는 사람에게도 아무 말을 하지 않았다.
 *
 * 그래서 본문은 **이미 검증된 원천 두 곳**에서만 끌어온다:
 *   · `src/sections/home/homeCopy.ts` — 서비스 3종·데이터 근거(FOOD_DB)·안 하는 약속.
 *     그 수치는 `tests/unit/editorial-home-foundation.test.ts` 가 실제 파일에서 다시 세고,
 *     문구는 홈에서 이미 쓰이고 있다.
 *   · `t.footer.*` — 상호·대표·주소·사업자/관광사업자 등록번호·연락처. 이미 전 페이지
 *     하단에 공개되어 있는 값이다.
 *
 * 🔴 여기 있는 것은 그 두 곳을 **잇는 제목뿐**이다. 면허번호·보증·응대시간·가격·자격을
 *    새로 적지 않는다. `tests/unit/about-content.component.test.tsx` 가 금지 문구로 잠근다.
 */

export type AboutLang = 'ko' | 'en' | 'ja' | 'zh';

export interface AboutCopy {
  eyebrow: string;
  /** 이 페이지가 무엇을 담는지에 대한 설명. 회사에 대한 새 주장이 아니다. */
  lede: string;
  limitsHeading: string;
  companyHeading: string;
  companyNote: string;
  readNextHeading: string;
  readNext: { guide: string; regions: string; terms: string; privacy: string; travelTerms: string };
  brandHeading: string;
}

export const ABOUT_COPY: Record<AboutLang, AboutCopy> = {
  en: {
    eyebrow: 'About',
    lede: 'This page states what we run, what our itineraries are built from, what we deliberately do not claim, and the registration details you can check yourself.',
    limitsHeading: 'What we do not claim',
    companyHeading: 'Company details',
    companyNote: 'The same details appear at the foot of every page on this site.',
    readNextHeading: 'Read next',
    readNext: {
      guide: 'Korea travel guides',
      regions: 'Korean regions we cover',
      terms: 'Terms of Service',
      privacy: 'Privacy Policy',
      travelTerms: 'Travel Terms',
    },
    brandHeading: 'Brand story',
  },

  ko: {
    eyebrow: '소개',
    lede: '이 페이지는 우리가 무엇을 운영하는지, 일정이 무엇을 근거로 만들어지는지, 무엇을 일부러 약속하지 않는지, 그리고 직접 확인할 수 있는 등록 정보를 적습니다.',
    limitsHeading: '우리가 약속하지 않는 것',
    companyHeading: '사업자 정보',
    companyNote: '같은 정보가 이 사이트 모든 페이지 하단에 그대로 있습니다.',
    readNextHeading: '이어서 보기',
    readNext: {
      guide: '한국 여행 가이드',
      regions: '우리가 다루는 한국 지역',
      terms: '이용약관',
      privacy: '개인정보처리방침',
      travelTerms: '여행약관',
    },
    brandHeading: '브랜드 스토리',
  },

  ja: {
    eyebrow: '会社紹介',
    lede: 'このページには、私たちが何を運営しているか、旅程が何をもとに作られるか、あえて約束しないことは何か、そしてご自身で確認できる登録情報を記載します。',
    limitsHeading: '約束しないこと',
    companyHeading: '事業者情報',
    companyNote: '同じ情報がこのサイトの全ページ下部にも表示されます。',
    readNextHeading: '次に読む',
    readNext: {
      guide: '韓国旅行ガイド',
      regions: '対応している韓国の地域',
      terms: '利用規約',
      privacy: 'プライバシーポリシー',
      travelTerms: '旅行約款',
    },
    brandHeading: 'ブランドストーリー',
  },

  zh: {
    eyebrow: '关于我们',
    lede: '本页说明我们经营什么、行程依据什么数据生成、我们刻意不作出哪些承诺，以及你可以自行核对的登记信息。',
    limitsHeading: '我们不作出的承诺',
    companyHeading: '企业信息',
    companyNote: '相同信息也显示在本站每个页面的页脚。',
    readNextHeading: '继续阅读',
    readNext: {
      guide: '韩国旅行指南',
      regions: '我们覆盖的韩国地区',
      terms: '服务条款',
      privacy: '隐私政策',
      travelTerms: '旅行条款',
    },
    brandHeading: '品牌故事',
  },
};

export function pickAboutCopy(language: string): AboutCopy {
  return ABOUT_COPY[language as AboutLang] || ABOUT_COPY.en;
}
