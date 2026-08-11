/**
 * Guide copy — Korea Editorial Concierge (2026-08-11).
 *
 * Local 4-language dictionary, same rule `homeCopy.ts` follows: the guide tree
 * is a lazy chunk and `en.json` is eager, so ~40 strings there would spend the
 * remaining margin under the first-paint gate (.size-limit.json) on copy the
 * first paint never shows. Keys still exist in all four languages —
 * `tests/unit/editorial-guide-content.test.ts` fails if one drifts.
 *
 * Article bodies are English-only (they come from our own English blog channel),
 * so every language states that in its own script rather than letting a Korean
 * reader discover it after the click.
 *
 * Nothing here invents a number. `{n}` and `{date}` are filled from real values
 * in `src/content/guides/_index.json`; when a value is absent the line that
 * would have carried it is not rendered at all.
 */

export type GuideLang = 'ko' | 'en' | 'ja' | 'zh';

/** One row of `src/content/guides/_index.json`. `image`/`words` are derived from
 *  the article body by `scripts/sync-blog-guides.lib.mjs`, so a guide with no
 *  picture simply has no `image` key — never an empty string. */
export type GuideMeta = {
  slug: string;
  title: string;
  description: string;
  published: string;
  updated: string;
  labels: string[];
  image?: string;
  words?: number;
};

/** A full article chunk (`src/content/guides/<slug>.json`). */
export type GuideDoc = GuideMeta & { html: string };

/** Reading speed for English prose. The word count is measured from the real
 *  article body; this is the only assumption, and it is a conventional one. */
export const WORDS_PER_MINUTE = 200;

/** Minutes, or `null` when there is no word count to derive them from.
 *  Callers render nothing on `null` — a "0 min read" is a lie with a number in it. */
export function readingMinutes(words: number | undefined): number | null {
  if (!words || words <= 0) return null;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/** `{n}` / `{date}` substitution. Missing keys are left untouched on purpose so
 *  a forgotten placeholder shows up in the render test instead of silently
 *  disappearing from the sentence. */
export function fill(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), template);
}

export interface GuideCopy {
  index: {
    /** Section name. One string does three jobs: the on-screen eyebrow, the
     *  page <title> and the breadcrumb node — so the markup a crawler reads and
     *  the words on screen can never drift apart. */
    title: string;
    heading: string;
    lede: string;
    /** `{n}` guides · last updated `{date}` — both read from the real list. */
    count: string;
    leadKicker: string;
    moreKicker: string;
    read: string;
    empty: { title: string; body: string; cta: string };
  };
  article: {
    back: string;
    updated: string;
    bodyLanguage: string;
    /** Carries `{date}`: prices and timetables move, so the sentence must say
     *  what day the guide was checked. We have no live source to cite. */
    freshness: string;
    loading: string;
    topics: string;
    error: { title: string; body: string; retry: string };
    notFound: { title: string; body: string; cta: string };
  };
  /** Shared by the list and the article — same measurement, same wording. */
  readTime: string;
}

export const GUIDE_COPY: Record<GuideLang, GuideCopy> = {
  en: {
    index: {
      title: 'Korea Travel Guides',
      heading: 'Korea, checked on the ground and written down.',
      lede: 'The routes, fares and access notes we use when we write itineraries — published as they are, one subject at a time.',
      count: '{n} guides · last updated {date}',
      leadKicker: 'Latest',
      moreKicker: 'More guides',
      read: 'Read',
      empty: {
        title: 'No guides published yet',
        body: 'We publish a guide once we have checked it. In the meantime the planner writes an itinerary from your own dates.',
        cta: 'Open the Trip Planner',
      },
    },
    article: {
      back: 'All guides',
      updated: 'Updated {date}',
      bodyLanguage: 'Article language: English',
      freshness: 'Fares, opening hours and prices change. This guide reflects what we checked on {date} — confirm with the operator before you go.',
      loading: 'Loading this guide',
      topics: 'Topics',
      error: {
        title: 'This guide did not load',
        body: 'The connection dropped before the article arrived. Nothing is wrong with the guide itself.',
        retry: 'Try again',
      },
      notFound: {
        title: 'Guide not found',
        body: 'This guide may have moved. The full list is one step away.',
        cta: 'All guides',
      },
    },
    readTime: '{n} min read',
  },

  ko: {
    index: {
      title: '한국 여행 가이드',
      heading: '현지에서 확인한 한국, 그대로 적었습니다.',
      lede: '일정을 짤 때 쓰는 동선·요금·이용 정보를 주제별로 하나씩 그대로 공개합니다.',
      count: '{n}편 · 최근 갱신 {date}',
      leadKicker: '최신',
      moreKicker: '다른 가이드',
      read: '읽기',
      empty: {
        title: '아직 공개된 가이드가 없어요',
        body: '확인이 끝난 글부터 올립니다. 그동안은 여행 플래너가 날짜에 맞춰 일정을 써드려요.',
        cta: '여행 플래너 열기',
      },
    },
    article: {
      back: '전체 가이드',
      updated: '{date} 갱신',
      bodyLanguage: '본문 언어: 영어',
      freshness: '요금·운영시간·가격은 바뀝니다. 이 글은 {date} 기준으로 확인한 내용이니 출발 전에 운영처에서 다시 확인하세요.',
      loading: '가이드를 불러오는 중',
      topics: '주제',
      error: {
        title: '가이드를 불러오지 못했어요',
        body: '글이 도착하기 전에 연결이 끊겼어요. 글 자체에는 문제가 없습니다.',
        retry: '다시 시도',
      },
      notFound: {
        title: '가이드를 찾을 수 없어요',
        body: '이동됐을 수 있어요. 전체 목록에서 바로 찾을 수 있습니다.',
        cta: '전체 가이드',
      },
    },
    readTime: '읽는 데 {n}분',
  },

  ja: {
    index: {
      title: '韓国旅行ガイド',
      heading: '現地で確かめた韓国を、そのまま書いています。',
      lede: '旅程を組むときに使う移動・料金・利用情報を、テーマごとにそのまま公開します。',
      count: '{n}本 · 最終更新 {date}',
      leadKicker: '最新',
      moreKicker: 'ほかのガイド',
      read: '読む',
      empty: {
        title: 'まだ公開中のガイドがありません',
        body: '確認できた記事から順に公開します。その間は旅行プランナーがご希望の日程で旅程を作成します。',
        cta: '旅行プランナーを開く',
      },
    },
    article: {
      back: 'ガイド一覧',
      updated: '{date} 更新',
      bodyLanguage: '記事の言語: 英語',
      freshness: '料金・営業時間・価格は変わります。本記事は{date}時点で確認した内容です。出発前に運営元でご確認ください。',
      loading: 'ガイドを読み込んでいます',
      topics: 'トピック',
      error: {
        title: 'ガイドを読み込めませんでした',
        body: '記事が届く前に接続が切れました。記事そのものに問題はありません。',
        retry: '再試行',
      },
      notFound: {
        title: 'ガイドが見つかりません',
        body: '移動した可能性があります。一覧からすぐにお探しいただけます。',
        cta: 'ガイド一覧',
      },
    },
    readTime: '読むのに約{n}分',
  },

  zh: {
    index: {
      title: '韩国旅行指南',
      heading: '在当地核实过的韩国，如实写下来。',
      lede: '我们编排行程时使用的路线、票价与实用信息，按主题逐篇原样公开。',
      count: '{n}篇 · 最近更新 {date}',
      leadKicker: '最新',
      moreKicker: '更多指南',
      read: '阅读',
      empty: {
        title: '目前还没有已发布的指南',
        body: '核实完成的文章会陆续发布。在此期间，行程规划可按你的日期生成行程。',
        cta: '打开行程规划',
      },
    },
    article: {
      back: '全部指南',
      updated: '{date} 更新',
      bodyLanguage: '正文语言：英语',
      freshness: '票价、营业时间与价格会变动。本文为{date}核实的内容，出行前请向运营方确认。',
      loading: '正在载入指南',
      topics: '主题',
      error: {
        title: '未能载入该指南',
        body: '文章送达前连接中断，指南本身没有问题。',
        retry: '重试',
      },
      notFound: {
        title: '未找到该指南',
        body: '内容可能已移动，可从全部指南中查找。',
        cta: '全部指南',
      },
    },
    readTime: '阅读约{n}分钟',
  },
};

export function pickGuideCopy(language: string): GuideCopy {
  return GUIDE_COPY[language as GuideLang] || GUIDE_COPY.en;
}
