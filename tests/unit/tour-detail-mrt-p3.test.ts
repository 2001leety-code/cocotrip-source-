/**
 * MRT 벤치마킹 P3 — 투어 상세 페이지 "SCENE 01~05" 매거진 에디토리얼 섹션
 * (2026-08-19). TourDetailPage 는 Firebase(useTour)를 물고 있어 이 레포의 기존 관례대로
 * (tour-detail-mrt-p1.test.ts) 렌더 대신 소스 문자열로 배선을 확인한다. 실제 렌더 문구
 * 대조는 컴포넌트 단위 테스트(tour-scene-section.component.test.tsx)에서 한다.
 *
 * (b)(c) 사진 grounding — tourSceneData.ts 의 모든 photo 는 (1) src/data/tours.ts 원본
 * 문자열에 리터럴로 존재해야 하고(허구 경로 금지) (2) 같은 투어 레코드 안에서만
 * 존재해야 하며(다른 투어 사진 도용 금지) (3) public/ 아래 실제 파일이어야 한다
 * (깨진 이미지가 프로덕션에 배포되는 사고 방지).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { TOUR_SCENES, getTourScenes } from '../../src/components/tours/tourSceneData';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(path.resolve(repoRoot, rel), 'utf8');

const toursSrc = read('src/data/tours.ts');
const sceneDataSrc = read('src/components/tours/tourSceneData.ts');
const sectionSrc = read('src/components/tours/TourSceneSection.tsx');
const pageSrc = read('src/pages/TourDetailPage.tsx');
const cssSrc = read('src/styles/editorial-tour-detail.css');
const copySrc = read('src/pages/tourDetailEditorialCopy.ts');

const TOUR_IDS = ['tour-dmz', 'tour-seoul-city', 'tour-gyeongju'] as const;
const LANGS = ['ko', 'en', 'ja', 'zh'] as const;

// tours.ts 의 해당 투어 레코드 슬라이스 — `id: 'tour-xxx'` 부터 다음 레코드의
// 최상위 `{` (2-space indent, tours.ts 레코드 관례) 직전까지.
function tourRecordSlice(id: string): string {
  const idIdx = toursSrc.indexOf(`id: '${id}'`);
  expect(idIdx, `${id} 를 src/data/tours.ts 에서 찾지 못했다`).toBeGreaterThan(-1);
  const rest = toursSrc.slice(idIdx);
  const nextRecordOffset = rest.search(/\n {2}\{\n/);
  const end = nextRecordOffset === -1 ? toursSrc.length : idIdx + nextRecordOffset;
  return toursSrc.slice(idIdx, end);
}

// 씬 수는 "사진이 실제 그 장소인 것"만 채운 결과 — 경주는 석굴암·동궁 실사진이
// 레포에 없어 4개다. 늘리려면 진짜 사진을 먼저 넣어라(다른 장소 사진 재사용 금지).
// 2026-08-22: 서울도 5 → 4. "인사동·익선동" 장면이 쓰던 '/서울/서울 (1).jpg' 가
// 실제로는 북촌한옥마을 사진이어서(바로 위 북촌 장면과 같은 동네) 장면을 삭제했다.
// public/ 에 인사동·익선동 실사진이 없다 — 경주와 같은 원칙으로 채우지 않고 비운다.
const SCENE_COUNTS: Record<string, number> = {
  'tour-dmz': 5,
  'tour-seoul-city': 4,
  'tour-gyeongju': 4,
};

describe('TOUR_SCENES 데이터 형태 — 3개 투어, 4개 언어 채움', () => {
  it('정확히 3개 투어 id 만 갖는다', () => {
    expect(Object.keys(TOUR_SCENES).sort()).toEqual([...TOUR_IDS].sort());
  });

  for (const id of TOUR_IDS) {
    it(`${id}: 씬 수가 잠금값과 같다`, () => {
      expect(TOUR_SCENES[id]).toHaveLength(SCENE_COUNTS[id]);
    });

    it(`${id}: 모든 씬의 title/body 가 4개 언어 전부 비어있지 않다`, () => {
      for (const scene of TOUR_SCENES[id]) {
        for (const lang of LANGS) {
          expect(scene.title[lang]?.trim(), `${id} title.${lang}`).toBeTruthy();
          expect(scene.body[lang]?.trim(), `${id} body.${lang}`).toBeTruthy();
        }
      }
    });

    it(`${id}: 씬 photo 경로가 서로 겹치지 않는다`, () => {
      const photos = TOUR_SCENES[id].map((scene) => scene.photo);
      expect(new Set(photos).size).toBe(photos.length);
    });
  }
});

describe('사진 grounding — tours.ts 원본 + 같은 투어 레코드 안에서만', () => {
  for (const id of TOUR_IDS) {
    const recordSlice = tourRecordSlice(id);

    for (const scene of TOUR_SCENES[id]) {
      it(`${id}: ${scene.photo} 가 tours.ts 원본에 리터럴로 존재한다`, () => {
        expect(toursSrc).toContain(scene.photo);
      });

      it(`${id}: ${scene.photo} 가 이 투어 레코드(images[] 또는 stops[].photo) 안에 있다`, () => {
        expect(recordSlice, `${scene.photo} 가 ${id} 레코드 슬라이스 안에 없다 (다른 투어 사진 도용 의심)`).toContain(
          scene.photo,
        );
      });
    }
  }
});

describe('사진 파일 실존 — public/ 아래 실제 파일', () => {
  for (const id of TOUR_IDS) {
    for (const scene of TOUR_SCENES[id]) {
      it(`${id}: ${scene.photo} 파일이 public/ 아래 존재한다`, () => {
        expect(existsSync(path.join(repoRoot, 'public', scene.photo)), scene.photo).toBe(true);
      });
    }
  }
});

describe('무근거 마케팅 문구 금지 (특가/인기/베스트/popular/best/deal)', () => {
  const BANNED = [/특가/, /인기/, /베스트/, /\bpopular\b/i, /\bbest\b/i, /\bdeal\b/i];

  const surfaces = [
    { name: 'tourSceneData.ts', src: sceneDataSrc },
    { name: 'TourSceneSection.tsx', src: sectionSrc },
    {
      name: 'tourDetailEditorialCopy.ts (scenesLabel)',
      src: (copySrc.match(/scenesLabel:\s*'[^']*'/g) || []).join('\n'),
    },
  ];

  for (const { name, src } of surfaces) {
    for (const pattern of BANNED) {
      it(`${name} 은 ${pattern} 를 포함하지 않는다`, () => {
        expect(src).not.toMatch(pattern);
      });
    }
  }
});

describe('배선 잠금 — TourDetailPage.tsx', () => {
  it('TourSceneSection 과 getTourScenes 를 import 한다', () => {
    expect(pageSrc).toContain("import { TourSceneSection } from '@/components/tours/TourSceneSection'");
    expect(pageSrc).toContain("import { getTourScenes } from '@/components/tours/tourSceneData'");
  });

  it('<TourSceneSection 렌더는 세부 일정(itinerary) 다음, TourCancellationSection 앞에 온다', () => {
    const itineraryIdx = pageSrc.indexOf('id="itinerary"');
    const sceneIdx = pageSrc.indexOf('<TourSceneSection');
    const cancellationIdx = pageSrc.indexOf('<TourCancellationSection');
    expect(itineraryIdx).toBeGreaterThan(-1);
    expect(sceneIdx).toBeGreaterThan(-1);
    expect(cancellationIdx).toBeGreaterThan(-1);
    expect(sceneIdx).toBeGreaterThan(itineraryIdx);
    expect(sceneIdx).toBeLessThan(cancellationIdx);
  });

  it('sectionTabs 는 getTourScenes 로 게이팅된 scenes 항목을 조건부로 포함한다', () => {
    expect(pageSrc).toMatch(/getTourScenes\(tour\.id\)\.length > 0 \? \{ id: 'scenes', label: copy\.scenesLabel \} : null/);
  });

  it('scenesLabel 이 tourDetailEditorialCopy.ts 4개 언어 객체 전부에 있다', () => {
    const matches = copySrc.match(/scenesLabel:\s*'[^']+'/g) || [];
    expect(matches).toHaveLength(4);
  });
});

describe('CSS 잠금 — editorial-tour-detail.css', () => {
  it('.tour-detail-scene-section 블록에 scroll-margin-top 이 있다', () => {
    const blockMatch = cssSrc.match(/\.tour-detail-scene-section\s*\{[^}]*\}/);
    expect(blockMatch, '.tour-detail-scene-section 블록을 찾지 못했다').toBeTruthy();
    expect(blockMatch![0]).toMatch(/scroll-margin-top\s*:\s*\d+px/);
  });
});

describe('getTourScenes — 존재하지 않는 투어', () => {
  it("getTourScenes('nonexistent') 는 빈 배열을 반환한다", () => {
    expect(getTourScenes('nonexistent')).toEqual([]);
  });
});
