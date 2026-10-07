import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOURS, isUngroundedBadgeTag, type Tour } from '@/data/tours';
import {
  BRIEF_REQUIRED_FIELDS,
  HARD_CONSTRAINTS,
  LOCALES,
  PLATFORM_PROFILES,
  SCHEMA_TARGET_PLATFORMS,
  buildCreditsText,
  buildOpenMontageBrief,
  buildOpenMontagePrompt,
  filterClaimText,
  findClaimRisks,
  parsePhotoCredit,
  planTourPhotos,
  renderHardConstraints,
  validateOpenMontageBrief,
} from '../../scripts/lib/openmontage-brief.mjs';
import { UsageError, parseArgs, resolveOutDir } from '../../scripts/export-openmontage-brief.mjs';

// OpenMontage(AGPL, 레포 밖 별도 워크스페이스)에 넘길 투어 영상 brief 생성기 잠금.
// 결정 사항(2026-10): 가격·할인·평점·후기 수 필드 없음, 식이 안전 주장 없음, 다른 언어 폴백 없음,
// 근거 없는 배지 태그 제외, 사진 출처는 파일명 기준 추정 + 불명은 NEEDS REVIEW.
// 절차: docs/MARKETING-OPENMONTAGE-VIDEO-RUNBOOK.md

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC_DIR = join(ROOT, 'public');
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힣]/u;
const HANGUL_RUNS = /[ᄀ-ᇿ㄰-㆏가-힣]+/gu;

type Locale = 'ko' | 'en' | 'ja' | 'zh';
type BriefResult = ReturnType<typeof buildOpenMontageBrief>;

const build = (tour: Tour, locale: Locale, extra: Record<string, unknown> = {}): BriefResult =>
  buildOpenMontageBrief(tour, locale, { isUngroundedBadgeTag, ...extra });

/** brief 에서 영상 문구로 쓰일 수 있는 텍스트 필드만. (사진 credit/title·경로는 출처 표기라 제외) */
function textFields(brief: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const key of ['title', 'hook', 'core_message', 'cta', 'tone', 'style', 'target_audience']) {
    const value = brief[key];
    if (typeof value === 'string') out.push(value);
  }
  for (const kp of (Array.isArray(brief.key_points) ? brief.key_points : []) as string[]) out.push(kp);
  const meta = (brief.metadata || {}) as { stops?: Array<{ name: string; description?: string }> };
  for (const stop of meta.stops || []) {
    out.push(stop.name);
    if (stop.description) out.push(stop.description);
  }
  return out;
}

function sourceStrings(tour: Tour, locale: Locale): string[] {
  const out = [tour.title[locale], tour.summary[locale], tour.description[locale]];
  for (const h of tour.highlights) out.push(h.text[locale]);
  for (const s of tour.stops || []) {
    out.push(s.name[locale]);
    out.push(s.description[locale]);
  }
  return out.filter((s): s is string => typeof s === 'string');
}

function allKeys(value: unknown, acc: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, acc));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      acc.push(k);
      allKeys(v, acc);
    }
  }
  return acc;
}

function allStrings(value: unknown, acc: string[] = []): string[] {
  if (typeof value === 'string') acc.push(value);
  else if (Array.isArray(value)) value.forEach((v) => allStrings(v, acc));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => allStrings(v, acc));
  return acc;
}

function cloneTour(tour: Tour): Tour {
  return JSON.parse(JSON.stringify(tour)) as Tour;
}

describe('OpenMontage brief — 정적 투어 전체 × 4 locale', () => {
  it('정적 투어가 있고 LOCALES 는 ko/en/ja/zh 4개다', () => {
    expect(TOURS.length).toBeGreaterThan(0);
    expect([...LOCALES]).toEqual(['ko', 'en', 'ja', 'zh']);
  });

  for (const tour of TOURS) {
    for (const locale of LOCALES as readonly Locale[]) {
      it(`${tour.slug}/${locale}: 스키마 필수 필드가 다 있거나, 빠진 필드는 명시적 warning 으로 남는다`, () => {
        const r = build(tour, locale);
        for (const field of BRIEF_REQUIRED_FIELDS) {
          if (field in r.brief) continue;
          expect(r.missingRequired).toContain(field);
          expect(r.warnings.some((w: string) => w.includes(`/${locale}]`))).toBe(true);
        }
        if (r.missingRequired.length === 0) {
          expect(validateOpenMontageBrief(r.brief)).toEqual([]);
          expect(r.brief.version).toBe('1.0');
          expect(r.brief.title.length).toBeGreaterThan(0);
          expect(r.brief.key_points.length).toBeGreaterThan(0);
          expect(SCHEMA_TARGET_PLATFORMS).toContain(r.brief.target_platform);
          expect(r.brief.target_duration_seconds).toBe(30);
          expect(r.brief.cta).toBe(`https://cocotripkr.com/tours/${tour.slug}`);
          expect(r.brief.metadata.locale).toBe(locale);
        }
      });
    }
  }
});

describe('가격·평점·식이 — 영상이 가격보다 오래 남는다', () => {
  // Tour 의 priceFrom/priceUnit/currency/rating/reviewCount/reviewSource/entry_fee_krw 계열.
  // (needs_review = 사진 라이선스 확인 플래그, budget_cap_usd = OpenMontage 지출 상한 — 투어 가격 아님)
  const FORBIDDEN_KEY = /price|discount|coupon|rating|review_?count|review_?source|^reviews?$|currency|fee|krw/i;

  it('어떤 투어·locale 출력에도 가격/할인/평점/후기 키가 없다', () => {
    for (const tour of TOURS) {
      for (const locale of LOCALES as readonly Locale[]) {
        const keys = allKeys(build(tour, locale).brief);
        expect(keys.filter((k) => FORBIDDEN_KEY.test(k)), `${tour.slug}/${locale}`).toEqual([]);
      }
    }
  });

  it('통화 표기·금액이 brief 어디에도 없고, 가격이 든 stop tip 은 통째로 빠진다', () => {
    for (const tour of TOURS) {
      for (const locale of LOCALES as readonly Locale[]) {
        const { brief } = build(tour, locale);
        const strings = allStrings(brief);
        expect(strings.filter((s) => /[₩$€£¥￥]|\bUSD\b|\bKRW\b/u.test(s)), `${tour.slug}/${locale}`).toEqual([]);
        const json = JSON.stringify(brief);
        for (const stop of tour.stops || []) {
          const tip = stop.tip?.[locale];
          if (tip) expect(json.includes(tip), `${tour.slug}/${locale} tip leaked`).toBe(false);
        }
      }
    }
  });

  it('영상 문구 필드는 가격·평점·최상급·식이·AI 위험 표현 스캐너를 전부 통과한다', () => {
    for (const tour of TOURS) {
      for (const locale of LOCALES as readonly Locale[]) {
        const { brief } = build(tour, locale);
        for (const text of textFields(brief).filter((t) => t !== brief.tone)) {
          expect(findClaimRisks(text), `${tour.slug}/${locale}: ${text}`).toEqual([]);
        }
      }
    }
  });

  it('원문에 위험 표현을 넣으면 그 항목만 빠지고 warning 이 남는다', () => {
    const tour = cloneTour(TOURS[0]);
    tour.highlights = [
      { icon: 'X', text: { ko: '가', en: 'Only $199 this week', ja: 'あ', zh: '一' } },
      { icon: 'X', text: { ko: '나', en: 'Halal-friendly lunch stop', ja: 'い', zh: '二' } },
      { icon: 'X', text: { ko: '다', en: 'Rated 4.9 stars by guests', ja: 'う', zh: '三' } },
      { icon: 'X', text: { ko: '라', en: "Korea's best night view", ja: 'え', zh: '四' } },
      { icon: 'X', text: { ko: '마', en: 'An AI-planned day', ja: 'お', zh: '五' } },
      { icon: 'X', text: { ko: '바', en: 'Seoul round trip · Tolls incl.', ja: 'か', zh: '六' } },
      { icon: 'X', text: { ko: '사', en: 'Duty-free shops nearby', ja: 'き', zh: '七' } },
    ];
    const r = build(tour, 'en');
    expect(r.brief.key_points).toEqual(['Seoul round trip · Tolls incl.', 'Duty-free shops nearby']);
    const removed = r.warnings.filter((w: string) => w.includes('key_points[') && w.includes('removed'));
    expect(removed).toHaveLength(5);
    expect(removed.join('\n')).toMatch(/price/);
    expect(removed.join('\n')).toMatch(/dietary/);
    expect(removed.join('\n')).toMatch(/rating/);
    expect(removed.join('\n')).toMatch(/superlative/);
    expect(removed.join('\n')).toMatch(/ai_lead/);
  });

  it('문장 단위로만 빼고 나머지 문장은 원래 부호와 함께 남긴다', () => {
    expect(filterClaimText("Explore Seoul's top landmarks in a private van. Tolls and parking all included.").text)
      .toBe('Tolls and parking all included.');
    expect(filterClaimText('朝鮮5大宮殿の最大規模。守門将交代式。').text).toBe('守門将交代式。');
    // 대시 1개 + 꼬리 구만 위험 → 꼬리만 뺀다 (훅의 "장소 나열 — 태그라인" 형태)
    expect(filterClaimText('Drama-famous Nami Island · Soyang River Skywalk — K-drama bucket list').text)
      .toBe('Drama-famous Nami Island · Soyang River Skywalk');
    expect(filterClaimText('Up to 10 guests — the most comfortable van.').text).toBe('Up to 10 guests.');
  });

  it('부분 삭제가 뜻을 바꿀 수 있으면 문장 전체를 뺀다 (왜곡 금지)', () => {
    // 대시 2개: 가운데가 삽입구라 마지막 구를 빼면 "Combine A — made famous by B." 같은 깨진 문장이 된다
    expect(filterClaimText('Combine the island — made famous by a drama — with the iconic stew. Ferry to the island.').text)
      .toBe('Ferry to the island.');
    // 앞 구를 빼면 꼬리가 앞 구에 걸린 한정어로 남는다
    expect(filterClaimText('Free entry — only for visitors wearing hanbok. Guard ceremony at 10:00.').text)
      .toBe('Guard ceremony at 10:00.');
    // 꼬리가 부정·한정이면 그 꼬리만 떼는 것도 과장이다
    expect(filterClaimText('Shuttle included — free on weekdays only.').text).toBe('');
    expect(filterClaimText('Not a vegan meal — contains pork broth.').text).toBe('');
  });

  it('약어 뒤에서 문장을 자르지 않는다 — 중간에 끊긴 문장·스캐너 우회 방지', () => {
    // "Mt." 에서 자르면 "Ride to Mt." 만 남는다
    expect(filterClaimText('Ride to Mt. Namsan for the best view of Seoul. Tolls included.').text).toBe('Tolls included.');
    // "No." / "1 scenic spot" 으로 쪼개지면 둘 다 스캐너를 통과해 "No. 1" 이 그대로 남던 문제
    const r = filterClaimText("Danyang's No. 1 scenic spot. Cable car included.");
    expect(r.text).toBe('Cable car included.');
    expect(findClaimRisks(r.text)).toEqual([]);
  });

  it('filterClaimText 결과는 언제나 스캐너를 통과한다(남으면 필드째 비움)', () => {
    const samples = [
      "Danyang's No. 1 scenic spot.",
      'Gate A. Best seats. Free parking.',
      'Opens 9 a.m. Rated 4.9 stars.',
      'A — B — the best C — D.',
      '최대 규모. 할인 쿠폰 제공.',
      '韩国旅游精华三日行程。第1天：首尔。',
    ];
    for (const s of samples) expect(findClaimRisks(filterClaimText(s).text), s).toEqual([]);
  });

  it('같은 주장의 언어별 동의어도 잡고, 정원·장소 표현은 오탐하지 않는다', () => {
    // ko '정수' / en 'pinnacle' 과 같은 주장: ja '精華'·'エッセンス', zh '精华', en 'essential <고유명사>'
    for (const s of ['新羅仏教美術の精華。', '釜山エッセンス。', '新罗佛教艺术精华。', 'Haeundae — essential Busan.']) {
      expect(findClaimRisks(s).map((x) => x.category), s).toContain('superlative');
    }
    // en 'iconic' 과 같은 주장: zh '标志性' / en "Korea's top beach" 와 같은 주장: '한국 대표'·'韓国代表'·'韩国代表'
    for (const s of ['标志性的岛潭三峰', '한국 대표 해변.', '韓国代表ビーチ。', '韩国代表海滩。']) {
      expect(findClaimRisks(s).map((x) => x.category), s).toContain('superlative');
    }
    expect(findClaimRisks('단양의 대표 명소')).toEqual([]); // 지역 안의 '대표' 는 통과
    expect(findClaimRisks("Korea's top 10 sights").map((x) => x.category)).toContain('superlative');
    // 오탐 방지: zh '最后'(마지막에)·'最多'(최대 N명), "to the top (of)", 정원 '최대 N인'·'最大N名', 예절 문장 "is essential."
    expect(findClaimRisks('最后在统一村享用午餐')).toEqual([]);
    expect(findClaimRisks('专属Sprinter面包车（最多10人）')).toEqual([]);
    expect(findClaimRisks('Cable car or shuttle to the top.')).toEqual([]);
    expect(findClaimRisks('Cable car or shuttle to the top of Namsan.')).toEqual([]);
    expect(findClaimRisks('스프린터 전용 차량 (최대 10인)')).toEqual([]);
    expect(findClaimRisks('専用車両（最大10名）')).toEqual([]);
    expect(findClaimRisks('Residents live here, so quiet visiting is essential.')).toEqual([]);
    expect(findClaimRisks('2 wonderful days')).toEqual([]);
  });
});

describe('근거 없는 배지 태그 (src/data/tours.ts isUngroundedBadgeTag)', () => {
  it('근거 없는 태그는 빼고 나머지 태그는 순서대로 남긴다 (데이터에서 배지 태그가 사라져도 유지되는 검사)', () => {
    const tour = cloneTour(TOURS[0]);
    tour.tags = ['Popular', 'History', 'Best Value', 'AI-Curated', 'Nature'] as Tour['tags'];
    expect(build(tour, 'en').brief.metadata.tags).toEqual(['History', 'Nature']);
  });

  it('Popular / Best Value / AI-Curated 는 어떤 brief 에도 나오지 않는다', () => {
    for (const tour of TOURS) {
      for (const locale of LOCALES as readonly Locale[]) {
        const { brief } = build(tour, locale);
        expect(brief.metadata.tags.filter((t: string) => isUngroundedBadgeTag(t))).toEqual([]);
        const json = JSON.stringify(brief);
        for (const tag of ['Popular', 'Best Value', 'AI-Curated']) expect(json.includes(tag), `${tour.slug}/${locale}`).toBe(false);
      }
    }
  });

  it('판정 함수를 주입하지 않으면 실행을 거부한다(로직 복제 금지)', () => {
    expect(() => buildOpenMontageBrief(TOURS[0], 'en', {})).toThrow(/isUngroundedBadgeTag/);
  });
});

describe('locale — 다른 언어로 폴백하지 않는다', () => {
  for (const locale of ['en', 'ja', 'zh'] as const) {
    it(`${locale}: 원문에 한글이 없으면 영상 문구 필드에도 한글이 없다 (있으면 원문 그대로만)`, () => {
      for (const tour of TOURS) {
        const source = sourceStrings(tour, locale);
        const sourceJoined = source.join('\n');
        const { brief } = build(tour, locale);
        for (const text of textFields(brief)) {
          if (!HANGUL.test(text)) continue;
          // 원문(같은 locale)에 이미 있던 한글만 허용
          for (const run of text.match(HANGUL_RUNS) || []) {
            expect(sourceJoined.includes(run), `${tour.slug}/${locale} Hangul leak: ${text}`).toBe(true);
          }
        }
        if (!source.some((s) => HANGUL.test(s))) {
          expect(textFields(brief).filter((t) => HANGUL.test(t)), `${tour.slug}/${locale}`).toEqual([]);
        }
      }
    });
  }

  it('locale 문자열이 없으면 생략 + warning, 다른 언어 값은 끌어오지 않는다', () => {
    const tour = cloneTour(TOURS[0]);
    const koTitle = tour.title.ko;
    const enTitle = tour.title.en;
    (tour.title as Record<string, string>).ja = '';
    (tour.highlights[0].text as Record<string, string>).ja = '';
    const r = build(tour, 'ja');
    expect(r.brief.title).toBeUndefined();
    expect(r.missingRequired).toContain('title');
    expect(r.warnings.some((w: string) => w.includes('title: missing in this locale'))).toBe(true);
    expect(r.warnings.some((w: string) => w.includes('key_points[0] (highlight): missing'))).toBe(true);
    expect(validateOpenMontageBrief(r.brief)).toContain('missing required field: title');
    const json = JSON.stringify(r.brief);
    expect(json.includes(koTitle)).toBe(false);
    expect(json.includes(enTitle)).toBe(false);
  });

  it('잘못된 locale·플랫폼·길이는 예외', () => {
    expect(() => build(TOURS[0], 'fr' as Locale)).toThrow(RangeError);
    expect(() => build(TOURS[0], 'en', { platform: 'linkedin' })).toThrow(RangeError);
    expect(() => build(TOURS[0], 'en', { platform: 'youtube', seconds: 61 })).toThrow(RangeError);
    expect(() => build(TOURS[0], 'en', { seconds: 0 })).toThrow(RangeError);
  });

  it('--platform 은 brief.schema.json 의 target_platform enum 과 OpenMontage media profile 로 매핑된다', () => {
    expect(PLATFORM_PROFILES.instagram).toMatchObject({ target_platform: 'instagram', media_profile: 'instagram_reels' });
    expect(PLATFORM_PROFILES.youtube).toMatchObject({ target_platform: 'youtube', media_profile: 'youtube_shorts' });
    expect(PLATFORM_PROFILES.tiktok).toMatchObject({ target_platform: 'tiktok', media_profile: 'tiktok' });
    for (const p of Object.values(PLATFORM_PROFILES)) expect(SCHEMA_TARGET_PLATFORMS).toContain(p.target_platform);
    expect(build(TOURS[0], 'en', { platform: 'youtube', seconds: 45 }).brief).toMatchObject({
      target_platform: 'youtube',
      target_duration_seconds: 45,
    });
  });
});

describe('사진 출처 파서 (KTO 파일명 규칙)', () => {
  // 아래 문자열 케이스는 public/ 의 실제 파일명 형식을 본뜬 것이다. 특정 파일의 존재에는 기대지 않고
  // (사진 교체·삭제로 깨지지 않게), 대신 지금 public/ 에 있는 Type*_ 파일 전부가 파싱되는지를 성질로 잠근다.
  it('public/ 루트의 Type[1-4]_ 파일은 전부 KOGL 로 파싱된다(제목·크레딧·6자리 id)', () => {
    const typeFiles = readdirSync(PUBLIC_DIR).filter((f) => /^Type[1-4]_.*\.(?:jpe?g|png|webp)$/i.test(f));
    for (const f of typeFiles) {
      const c = parsePhotoCredit(`/${f}`);
      expect(c.provenance, f).toBe('kogl');
      expect(c.title, f).toBeTruthy();
      expect(c.credit, f).toBeTruthy();
      expect(c.kto_id, f).toMatch(/^[A-Za-z0-9]{6}$/);
    }
  });

  it('제목 괄호·크레딧 쉼표가 있어도 제목/크레딧/id 를 정확히 가른다', () => {
    expect(parsePhotoCredit('/Type1_대릉원(천마총)_한국관광공사, 엠엠피 김진규_651iea(1).jpg')).toMatchObject({
      provenance: 'kogl', kogl_type: 1, title: '대릉원(천마총)', credit: '한국관광공사, 엠엠피 김진규', kto_id: '651iea', needs_review: false,
    });
    expect(parsePhotoCredit('/Type1_광안대교, 도시를 품다_최영근_XA2xTa(1).jpg')).toMatchObject({
      title: '광안대교, 도시를 품다', credit: '최영근', kto_id: 'XA2xTa',
    });
    expect(parsePhotoCredit('/Type1_불국사_두드림_z0WAPa.jpg')).toMatchObject({ title: '불국사', credit: '두드림', kto_id: 'z0WAPa' });
  });

  it('공공누리 제2~4유형(상업 금지·변경 금지)은 NEEDS REVIEW', () => {
    for (const type of [2, 3, 4]) {
      expect(parsePhotoCredit(`/Type${type}_장소_작가_abcdef.jpg`)).toMatchObject({ provenance: 'kogl', kogl_type: type, needs_review: true });
    }
  });

  it('id_제목.webp 재인코딩본은 원본이 있으면 크레딧을 복원하고, 없으면 NEEDS REVIEW', () => {
    expect(parsePhotoCredit('/JnR5Ie_경복궁(1).webp')).toMatchObject({ provenance: 'kto_id_only', kto_id: 'JnR5Ie', needs_review: true });
    expect(parsePhotoCredit('/1uA0qa_반포대교(1).webp', { knownFiles: ['Type1_반포대교_한국관광공사 이범수_1uA0qa(1).jpg'] })).toMatchObject({
      provenance: 'kogl', credit: '한국관광공사 이범수', recovered_from: 'Type1_반포대교_한국관광공사 이범수_1uA0qa(1).jpg', needs_review: false,
    });
  });

  it('출처를 알 수 없는 사진은 unknown + NEEDS REVIEW', () => {
    expect(parsePhotoCredit('/tourists/people-seoul-bukchon.webp')).toMatchObject({ provenance: 'unknown', needs_review: true });
    expect(parsePhotoCredit('/서울/서울 (1).jpg')).toMatchObject({ provenance: 'unknown', needs_review: true });
  });
});

describe('사진 복사 계획', () => {
  it('원격 URL·상대/상위 경로·누락 파일은 복사 대상에서 빠지고 이유가 남는다', () => {
    const tour = cloneTour(TOURS[0]);
    tour.stops = [];
    tour.thumbnail = '/Type1_불국사_두드림_z0WAPa.jpg';
    tour.images = ['https://firebasestorage.example/x.jpg', '../secret.jpg', '/a/../b.jpg', '/missing.jpg', '/서울/서울 (1).jpg'];
    const { photos, skipped } = planTourPhotos(tour, { missing: ['/missing.jpg'] });
    expect(photos.map((p: { source: string }) => p.source)).toEqual(['/Type1_불국사_두드림_z0WAPa.jpg', '/서울/서울 (1).jpg']);
    expect(skipped).toEqual([
      { source: 'https://firebasestorage.example/x.jpg', reason: 'remote_url_not_copied' },
      { source: '../secret.jpg', reason: 'unsafe_or_relative_path' },
      { source: '/a/../b.jpg', reason: 'unsafe_or_relative_path' },
      { source: '/missing.jpg', reason: 'missing_local_file' },
    ]);
  });

  it('복사본 파일명은 ASCII 만 쓰고, 모든 실제 투어 사진이 public/ 에 있다', () => {
    for (const tour of TOURS) {
      const { photos } = planTourPhotos(tour);
      for (const p of photos) {
        expect(p.file).toMatch(/^photos\/\d{2}-(?:stop-\d+|cover|gallery)\.[a-z0-9]+$/);
        expect(existsSync(join(PUBLIC_DIR, p.source)), p.source).toBe(true);
      }
    }
  });

  it('KTO 제목 매칭 연결은 정류지 한국어 명칭과 정규화 후 완전히 같을 때만 생긴다', () => {
    const norm = (s: string) => s.normalize('NFC').replace(/[\s·・()（）[\]—–\-_,.]/gu, '').toLowerCase();
    for (const tour of TOURS) {
      const { brief } = build(tour, 'ko');
      for (const stop of brief.metadata.stops) {
        if (stop.photo_link !== 'kto_title_match') continue;
        const photo = brief.metadata.photos.find((p: { file: string }) => p.file === stop.photo);
        const ko = (tour.stops || [])[stop.order - 1].name.ko;
        const wanted = [norm(ko), norm(ko.replace(/^[^—–]+[—–]\s*/u, ''))];
        expect(wanted, `${tour.slug} stop ${stop.order}`).toContain(norm(photo.title));
      }
    }
    // 부분 일치('경주' ⊂ '경주 한정식')로는 연결하지 않는다
    const tour = cloneTour(TOURS[0]);
    tour.stops = [{ ...tour.stops![0], photo: undefined, name: { ko: '경주 한정식', en: 'Lunch', ja: '昼食', zh: '午餐' } }];
    tour.images = ['/Type1_경주_작가_abcdef.jpg'];
    tour.thumbnail = '/Type1_경주_작가_abcdef.jpg';
    const r = build(tour, 'en');
    expect(r.brief.metadata.stops[0].photo).toBeUndefined();
  });
});

describe('prompt.md / CREDITS.txt', () => {
  const tour = TOURS.find((t) => t.slug === 'gyeongju-day-tour') || TOURS[0];

  for (const locale of LOCALES as readonly Locale[]) {
    it(`${locale}: 하드 제약 전부 + 예산 + 승인 게이트가 들어간다`, () => {
      const r = build(tour, locale, { budgetUsd: 2.5 });
      const prompt = buildOpenMontagePrompt(r.brief);
      for (const line of renderHardConstraints(2.5)) expect(prompt).toContain(line);
      expect(renderHardConstraints(2.5)).toHaveLength(HARD_CONSTRAINTS.length);
      expect(prompt).toContain('$2.50 USD');
      expect(prompt).toContain('Ask me before every paid API call');
      expect(prompt).toContain('Do not generate AI images or AI video of real places or real people');
      expect(prompt).toContain('Use only the real photos supplied');
      expect(prompt).toContain('must come from brief.json');
      expect(prompt).toMatch(/Do not mention prices/);
      expect(prompt).toMatch(/superlatives/);
      expect(prompt).toMatch(/halal, vegan, vegetarian, allergy-safe/);
      expect(prompt).toContain('Do not lead with "AI"');
      expect(prompt).toContain('Burn in');
      expect(prompt).toContain('`hybrid` pipeline');
      expect(prompt).toContain(`media profile \`${r.brief.metadata.media_profile}\``);
      expect(prompt).toContain('wait for my explicit approval');
      expect(prompt).toContain('Do not upload or publish anything');
      expect(prompt).toContain(`cocotripkr.com/tours/${tour.slug}`);
      expect(prompt.includes('?'.repeat(2))).toBe(false); // pre-commit 모지바케 가드와 같은 기준
    });
  }

  it('CREDITS.txt: KOGL 사진은 엔드카드 줄, 출처 불명은 NEEDS REVIEW 로 갈린다', () => {
    const r = build(tour, 'en');
    const credits = buildCreditsText(r);
    expect(credits).toContain('== END CARD');
    expect(credits).toContain('== NEEDS REVIEW');
    for (const p of r.photos) {
      expect(credits).toContain(p.file);
      if (p.provenance === 'kogl' && !p.needs_review) {
        expect(credits).toContain(`Photo: ${p.credit} (${p.title}) / Korea Tourism Organization, KOGL Type ${p.kogl_type}`);
      }
    }
    const reviewSection = credits.split('== NEEDS REVIEW')[1].split('== All copied photos')[0];
    for (const p of r.photos.filter((x: { needs_review: boolean }) => x.needs_review)) expect(reviewSection).toContain(p.source);
  });
});

describe('CLI 인자 (scripts/export-openmontage-brief.mjs)', () => {
  it('기본값: 4개 locale, instagram, 30초, $1 예산, outputs/openmontage-briefs', () => {
    expect(parseArgs(['--tour', 'gyeongju-day-tour'])).toMatchObject({
      tours: ['gyeongju-day-tour'], locales: ['ko', 'en', 'ja', 'zh'], platform: 'instagram', seconds: 30, budgetUsd: 1,
      out: 'outputs/openmontage-briefs',
    });
    expect(parseArgs(['--all', '--locale=en,ko', '--platform', 'tiktok', '--seconds', '45'])).toMatchObject({
      all: true, locales: ['en', 'ko'], platform: 'tiktok', seconds: 45,
    });
  });

  it('잘못된 인자는 UsageError', () => {
    const bad = [
      [],
      ['--tour', 'a', '--all'],
      ['--tour', 'a', '--locale', 'fr'],
      ['--tour', 'a', '--platform', 'linkedin'],
      ['--tour', 'a', '--platform', 'youtube', '--seconds', '61'],
      ['--tour', 'a', '--seconds', 'abc'],
      ['--tour', 'a', '--budget', '-1'],
      ['--tour', 'a', '--budget', '100'],
      ['--tour'],
      ['--tour', 'a', '--bogus'],
    ];
    for (const argv of bad) expect(() => parseArgs(argv), argv.join(' ')).toThrow(UsageError);
  });

  it('출력 폴더를 배포 대상(public/src/api/dist) 안에 두지 못한다', () => {
    for (const d of ['public/x', 'src/x', 'api', 'dist/y']) {
      expect(() => resolveOutDir(d, ROOT), d).toThrow(UsageError);
    }
    expect(resolveOutDir('outputs/openmontage-briefs', ROOT)).toBe(join(ROOT, 'outputs', 'openmontage-briefs'));
    expect(() => resolveOutDir('outputs/../public/x', ROOT)).toThrow(UsageError);
  });

  it.skipIf(process.platform === 'win32')('심볼릭 링크로 배포 대상·레포 루트를 가리켜도 거부한다', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'om-out-guard-'));
    const pub = join(tmp, 'pub');
    const repo = join(tmp, 'repo');
    try {
      symlinkSync(PUBLIC_DIR, pub, 'dir');
      symlinkSync(ROOT, repo, 'dir');
      for (const p of [pub, join(pub, 'x'), join(repo, 'src', 'x'), join(repo, 'dist', 'y'), repo]) {
        expect(() => resolveOutDir(p, tmp), p).toThrow(UsageError);
      }
      expect(resolveOutDir(join(repo, 'outputs', 'x'), tmp)).toBe(join(repo, 'outputs', 'x'));
      expect(resolveOutDir(join(tmp, 'plain'), tmp)).toBe(join(tmp, 'plain'));
    } finally {
      // 링크 자체만 지운다(unlink 는 대상 디렉터리를 따라가지 않는다). 재귀 삭제는 쓰지 않는다.
      for (const link of [pub, repo]) {
        try {
          unlinkSync(link);
        } catch {
          /* 만들기 전에 실패했으면 없음 */
        }
      }
      rmdirSync(tmp);
    }
  });

  const runCli = (args: string[]) => spawnSync(process.execPath, [join(ROOT, 'scripts', 'export-openmontage-brief.mjs'), ...args], {
    encoding: 'utf8',
    cwd: ROOT,
    timeout: 30000, // spawnSync 는 이벤트 루프를 막아 vitest timeout 이 못 끊는다
  });

  it('잘못된 인자로 실행하면 exit 2 + 한/영 사용법 (Vite 로드 전에 끝난다)', () => {
    const r = runCli(['--locale', 'fr']);
    expect(r.status).toBe(2);
    expect(`${r.stdout}${r.stderr}`).toContain('사용법 / Usage');
  });

  it('--help 는 exit 0 + 사용법', () => {
    const r = runCli(['--help']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('사용법 / Usage');
  });
});
