import type { GuideMeta } from './guideCopy';

/**
 * 가이드 상세 → 다른 가이드 (2026-08-23).
 *
 * 왜 필요한가: 상세 20편에 **글끼리 잇는 링크가 한 개도 없었다**. 목록에서 들어온
 * 크롤러는 글 하나를 읽고 되돌아 나가고, 사람도 그 글에서 멈춘다. 상세끼리 이어야
 * 20편이 서로를 떠받치는 묶음이 된다.
 *
 * 🔴 왜 낱말 겹침(제목·label 토큰 유사도)이 아니라 주제표인가 — 실측했기 때문이다.
 *    label 만 겹쳐 보면 5편이 짝을 하나도 못 찾는다(건강·겨울·단풍·카페·K-pop 본사).
 *    제목 토큰까지 넣고 IDF 로 눌러도 "가을 단풍" ↔ "K-드라마 촬영지" 가 1위로 올라온다
 *    (겹친 낱말이 street·park·seoul 뿐이다). 관계없는 글을 "관련 글" 이라고 부르는 것은
 *    빈 섹션보다 나쁘다 — 읽는 사람에게도, 링크 신호로도 거짓이다.
 *
 * 그래서 주제는 **각 글의 제목·label 에서 사람이 읽어 붙인 분류**다. 새 사실을 지어내지
 * 않는다(글 제목이 말하는 것 이상을 적지 않는다). 새 글이 들어오면 여기 없어서
 * `tests/unit/guide-related.component.test.tsx` 가 빨개진다 — 조용히 빈 섹션이 되지 않는다.
 *
 * 정렬은 완전 결정론이다: 겹친 주제 수 ↓ → 발행일 ↓ → slug ↑. 무작위·시간 의존 없음.
 */

export type GuideTopic =
  | 'food'
  | 'culture'
  | 'kculture'
  | 'season'
  | 'outdoors'
  | 'transport'
  | 'practical'
  | 'seoul'
  | 'region'
  | 'stay';

/** slug → 주제. 값은 그 글의 제목·label 이 이미 말하고 있는 것만 담는다. */
export const GUIDE_TOPICS: Record<string, readonly GuideTopic[]> = {
  'best-temple-stays-in-korea-2026-guide': ['culture', 'stay'],
  'korea-sim-card-vs-esim-vs-pocket-wifi': ['practical'],
  'seoul-k-beauty-shopping-2026-olive': ['seoul'],
  'incheon-to-seoul-late-night-arex-bus-t': ['transport', 'practical'],
  '2026-best-k-drama-filming-locations-in': ['kculture', 'seoul'],
  'how-to-rent-hanbok-explore-seoul': ['culture', 'seoul'],
  'best-seoul-street-food-markets-2026': ['food', 'seoul'],
  'jjimjilbang-2026-your-ultimate-first': ['culture', 'stay'],
  'ultimate-korean-convenience-store-food': ['food', 'practical'],
  '2026-korea-health-guide-pharmacies': ['practical'],
  '2026-korea-winter-guide-skiing-ice': ['season', 'outdoors'],
  'best-autumn-foliage-spots-in-korea-2026': ['season', 'outdoors'],
  '2026-jeju-island-without-car-whats': ['region', 'transport'],
  'best-cherry-blossom-spots-in-korea-2026': ['season', 'outdoors'],
  'gyeongju-koreas-open-air-museum-guide': ['region', 'culture'],
  'seoul-cafe-guide-2026-best': ['food', 'seoul'],
  'how-to-ace-your-first-k-pop-concert-in': ['kculture'],
  'how-weak-won-makes-korea-cheaper-for': ['practical'],
  'how-to-find-halal-food-in-seoul-2026': ['food', 'seoul'],
  'kpop-big-4-hq-tour-seoul-hybe-sm-jyp-yg': ['kculture', 'seoul'],
};

/** 화면에 그리는 최대 개수. 3보다 많으면 본문 끝이 링크 더미가 된다. */
export const RELATED_LIMIT = 3;

/**
 * `slug` 와 주제를 하나 이상 공유하는 글을 최대 `limit` 편.
 *
 * 자기 자신·중복은 나오지 않는다(입력 목록에 같은 slug 가 두 번 있어도 한 번만).
 * 주제표에 없는 slug 로 물으면 빈 배열 — 지어내서 채우지 않는다.
 */
export function pickRelatedGuides(
  slug: string | undefined,
  guides: readonly GuideMeta[],
  limit: number = RELATED_LIMIT,
): GuideMeta[] {
  const own = slug ? GUIDE_TOPICS[slug] : undefined;
  if (!own || own.length === 0) return [];
  const ownTopics = new Set(own);

  const seen = new Set<string>([slug as string]);
  const scored: { guide: GuideMeta; shared: number }[] = [];
  for (const guide of guides) {
    if (seen.has(guide.slug)) continue;
    seen.add(guide.slug);
    const topics = GUIDE_TOPICS[guide.slug];
    if (!topics) continue;
    const shared = topics.filter((topic) => ownTopics.has(topic)).length;
    if (shared > 0) scored.push({ guide, shared });
  }

  scored.sort((a, b) => (
    b.shared - a.shared
    || b.guide.published.localeCompare(a.guide.published)
    || a.guide.slug.localeCompare(b.guide.slug)
  ));

  return scored.slice(0, limit).map((entry) => entry.guide);
}
