/**
 * Guide copy — Korea Editorial Concierge (2026-08-11).
 *
 * Local 4-language dictionary, same rule `homeCopy.ts` follows: the guide tree
 * is a lazy chunk and `en.json` is eager, so ~40 strings there would spend the
 * remaining margin under the first-paint gate (.size-limit.json) on copy the
 * first paint never shows. Keys still exist in all four languages —
 * `tests/unit/editorial-guide-content.test.ts` fails if one drifts.
 *
 * Article bodies are English-only (they come from our own English guide
 * archive), so every language states that in its own script rather than letting
 * a Korean reader discover it after the click.
 *
 * Nothing here invents a number. `{n}` and `{date}` are filled from real values
 * in `src/content/guides/_index.json`; when a value is absent the line that
 * would have carried it is not rendered at all.
 *
 * Nothing here invents a *source* either. The only origin the code has is the
 * CocoTrip English guide archive collected by `scripts/sync-blog-guides.mjs`
 * from the cocotripkr.blogspot.com public feed, and the published/updated dates
 * that feed carries. There is no visit log, no live fare lookup and no record of
 * anyone confirming a price on location — so the copy names the archive and the
 * update date, and claims nothing beyond them.
 * `tests/unit/editorial-guide-content.test.ts` fails on the claim, in any of the
 * four languages.
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
  /** Brain projection only. Legacy Blogger JSON files predate this field. */
  contentSha256?: string;
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
    /** Where the text came from, on screen. Our own English guide archive is the
     *  whole of it — naming it is the only sourcing claim the code can back. */
    source: string;
    /** Carries `{date}`: prices and timetables move, so the sentence says the day
     *  the article was last updated — the one date we hold — and sends the reader
     *  to the official operator. Never "what we checked". */
    freshness: string;
    loading: string;
    topics: string;
    /** 다른 글로 잇는 섹션의 이름표. 관계를 주장하는 문장이 아니라 제목 한 줄이다. */
    related: string;
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
      heading: 'Routes, fares and access notes for Korea, by subject.',
      lede: 'Organised from the CocoTrip English guide archive — one subject per article, each carrying the date it was last updated.',
      count: '{n} guides · last updated {date}',
      leadKicker: 'Latest',
      moreKicker: 'More guides',
      read: 'Read',
      empty: {
        title: 'No guides published yet',
        body: 'Nothing has been published to the archive yet. In the meantime the planner writes an itinerary from your own dates.',
        cta: 'Open the Trip Planner',
      },
    },
    article: {
      back: 'All guides',
      updated: 'Updated {date}',
      bodyLanguage: 'Article language: English',
      source: 'Source: CocoTrip English guide archive',
      freshness: 'This article was last updated on {date}. Fares, opening hours and prices change — confirm with the official operator before you travel.',
      loading: 'Loading this guide',
      topics: 'Topics',
      related: 'Related guides',
      error: {
        title: 'This guide did not load',
        body: 'Check your connection and try again.',
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
      heading: '주제별로 정리한 한국 동선·요금·이용 정보.',
      lede: '코코트립 영문 가이드 아카이브에서 정리했습니다. 한 편에 한 주제, 각 글에 마지막 갱신일을 함께 적습니다.',
      count: '{n}편 · 최근 갱신 {date}',
      leadKicker: '최신',
      moreKicker: '다른 가이드',
      read: '읽기',
      empty: {
        title: '아직 공개된 가이드가 없어요',
        body: '아카이브에 올라온 글이 아직 없습니다. 그동안은 여행 플래너가 날짜에 맞춰 일정을 써드려요.',
        cta: '여행 플래너 열기',
      },
    },
    article: {
      back: '전체 가이드',
      updated: '{date} 갱신',
      bodyLanguage: '본문 언어: 영어',
      source: '출처: 코코트립 영문 가이드 아카이브',
      freshness: '이 글은 {date}에 마지막으로 갱신됐습니다. 요금·운영시간·가격은 바뀔 수 있으니 출발 전에 공식 운영처에서 확인하세요.',
      loading: '가이드를 불러오는 중',
      topics: '주제',
      related: '관련 가이드',
      error: {
        title: '가이드를 불러오지 못했어요',
        body: '연결 상태를 확인한 뒤 다시 시도해 주세요.',
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
      heading: 'テーマ別に整理した、韓国の移動・料金・利用情報。',
      lede: 'ココトリップ英語ガイドアーカイブから整理しています。1記事につき1テーマ、各記事に最終更新日を表示します。',
      count: '{n}本 · 最終更新 {date}',
      leadKicker: '最新',
      moreKicker: 'ほかのガイド',
      read: '読む',
      empty: {
        title: 'まだ公開中のガイドがありません',
        body: 'アーカイブに公開済みの記事がまだありません。その間は旅行プランナーがご希望の日程で旅程を作成します。',
        cta: '旅行プランナーを開く',
      },
    },
    article: {
      back: 'ガイド一覧',
      updated: '{date} 更新',
      bodyLanguage: '記事の言語: 英語',
      source: '出典: ココトリップ英語ガイドアーカイブ',
      freshness: 'この記事の最終更新は{date}です。料金・営業時間・価格は変わることがあります。ご出発前に公式の運営元でご確認ください。',
      loading: 'ガイドを読み込んでいます',
      topics: 'トピック',
      related: '関連ガイド',
      error: {
        title: 'ガイドを読み込めませんでした',
        body: '接続を確認して、もう一度お試しください。',
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
      heading: '按主题整理的韩国路线、票价与实用信息。',
      lede: '整理自 CocoTrip 英文指南存档。一篇一个主题，并标注最后更新日期。',
      count: '{n}篇 · 最近更新 {date}',
      leadKicker: '最新',
      moreKicker: '更多指南',
      read: '阅读',
      empty: {
        title: '目前还没有已发布的指南',
        body: '存档中还没有已发布的文章。在此期间，行程规划可按你的日期生成行程。',
        cta: '打开行程规划',
      },
    },
    article: {
      back: '全部指南',
      updated: '{date} 更新',
      bodyLanguage: '正文语言：英语',
      source: '来源：CocoTrip 英文指南存档',
      freshness: '本文最后更新于{date}。票价、营业时间与价格可能变动，出行前请向官方运营方确认。',
      loading: '正在载入指南',
      topics: '主题',
      related: '相关指南',
      error: {
        title: '未能载入该指南',
        body: '请检查网络连接后重试。',
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
