import { describe, expect, it } from 'vitest';
import { TOURS, type Tour } from '../../src/data/tours';

type Locale = keyof Tour['summary'];

const locales: Locale[] = ['ko', 'en', 'ja', 'zh'];

const routePhrases: Record<string, Record<Locale, string[]>> = {
  'tour-ganghwa': {
    ko: ['전등사', '강화 인삼', '광성보', '동막해변'],
    en: ['Jeondeungsa', 'Ganghwa ginseng', 'Gwangseongbo', 'Dongmak Beach'],
    ja: ['伝燈寺', '江華人参', '広城堡', '東幕海辺'],
    zh: ['传灯寺', '江华人参', '广城堡', '东幕海边'],
  },
  'tour-dmz': {
    ko: ['임진각', '제3땅굴', '도라산 전망대', '도라산역', '통일촌'],
    en: ['Imjingak', '3rd Tunnel', 'Dorasan Observatory', 'Dorasan Station', 'Unification Village'],
    ja: ['臨津閣', '第3トンネル', '都羅山展望台', '都羅山駅', '統一村'],
    zh: ['临津阁', '第三隧道', '都罗山观景台', '都罗山站', '统一村'],
  },
  'tour-gyeongju': {
    ko: ['불국사', '석굴암', '경주 한정식', '대릉원', '동궁과 월지'],
    en: ['Bulguksa', 'Seokguram', 'Gyeongju Hanjeongsik', 'Daereungwon', 'Donggung Palace & Wolji Pond'],
    ja: ['仏国寺', '石窟庵', '慶州韓定食', '大陵苑', '東宮と月池'],
    zh: ['佛国寺', '石窟庵', '庆州韩定食', '大陵苑', '东宫与月池'],
  },
  'tour-busan-day': {
    ko: ['감천문화마을', '자갈치시장', '용두산공원', '광안리', '해운대'],
    en: ['Gamcheon', 'Jagalchi Market', 'Yongdusan Park', 'Gwangalli', 'Haeundae'],
    ja: ['甘川文化村', 'チャガルチ市場', '龍頭山公園', '広安里', '海雲台'],
    zh: ['甘川文化村', '札嘎其市场', '龙头山公园', '广安里', '海云台'],
  },
};

const obsoletePhrases: Record<string, Record<Locale, RegExp>> = {
  'tour-ganghwa': {
    ko: /마니산|참성단|차이나타운|갯벌\s*체험/i,
    en: /manisan|chinatown|tidal\s*flat\s*experience/i,
    ja: /摩尼山|参聖壇|チャイナタウン|干潟体験/i,
    zh: /摩尼山|参圣坛|唐人街|滩涂体验/i,
  },
  'tour-dmz': {
    ko: /판문점|공동경비구역|\bJSA\b/i,
    en: /panmunjom|joint\s*security\s*area|\bJSA\b/i,
    ja: /板門店|共同警備区域|\bJSA\b/i,
    zh: /板门店|联合安全区|\bJSA\b/i,
  },
  'tour-gyeongju': {
    ko: /첨성대|황리단길/i,
    en: /cheomseongdae|hwangridangil/i,
    ja: /瞻星台|黄理団キル/i,
    zh: /瞻星台|皇理团街/i,
  },
  'tour-busan-day': {
    ko: /태종대|새벽/i,
    en: /taejongdae|dawn/i,
    ja: /太宗台|夜明け/i,
    zh: /太宗台|黎明/i,
  },
};

function tourById(id: string): Tour {
  const tour = TOURS.find((candidate) => candidate.id === id);
  expect(tour, `${id} tour missing`).toBeDefined();
  return tour as Tour;
}

function catalogText(tour: Tour, locale: Locale): string {
  return [
    tour.summary[locale],
    tour.description[locale],
    ...tour.highlights.map((highlight) => highlight.text[locale]),
  ].join(' ');
}

describe('tour catalog copy matches the published stop itinerary', () => {
  for (const [tourId, localizedRoutes] of Object.entries(routePhrases)) {
    it(`${tourId} summary follows the current stop order in all four languages`, () => {
      const tour = tourById(tourId);

      for (const locale of locales) {
        const summary = tour.summary[locale];
        const stopNames = (tour.stops || []).map((stop) => stop.name[locale].toLocaleLowerCase());
        expect(stopNames, `${tourId}.${locale} published stop count changed`).toHaveLength(
          localizedRoutes[locale].length,
        );
        let priorIndex = -1;

        for (const [stopIndex, phrase] of localizedRoutes[locale].entries()) {
          expect(
            stopNames[stopIndex],
            `${tourId}.${locale} stop ${stopIndex + 1} does not match ${phrase}`,
          ).toContain(phrase.toLocaleLowerCase());

          const phraseIndex = summary.indexOf(phrase);
          expect(phraseIndex, `${tourId}.${locale} summary missing ${phrase}`).toBeGreaterThan(priorIndex);
          priorIndex = phraseIndex;
        }
      }
    });

    it(`${tourId} summary, description and highlights omit unpublished stops`, () => {
      const tour = tourById(tourId);

      for (const locale of locales) {
        const text = catalogText(tour, locale);
        expect(text, `${tourId}.${locale} still advertises an unpublished stop`).not.toMatch(
          obsoletePhrases[tourId][locale],
        );

        for (const phrase of localizedRoutes[locale]) {
          expect(text, `${tourId}.${locale} missing current stop ${phrase}`).toContain(phrase);
        }
      }
    });
  }
});
