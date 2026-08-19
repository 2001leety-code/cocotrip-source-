// @vitest-environment jsdom
/**
 * TourSceneSection — MRT 벤치마킹 P3 (2026-08-19).
 *
 * TourCancellationSection 컴포넌트 테스트와 같은 패리티 패턴 — 렌더된 텍스트를
 * "다시 타이핑한 문자열"이 아니라 tourSceneData.ts 가 export 하는 TOUR_SCENES 객체
 * 참조값과 직접 대조한다. 같은 객체를 참조하니 값이 바뀌어도 테스트가 항상 따라온다.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { TourSceneSection } from '../../src/components/tours/TourSceneSection';
import { TOUR_SCENES } from '../../src/components/tours/tourSceneData';
import type { Language } from '../../src/i18n';

void React;

afterEach(() => cleanup());

const LANGS: Language[] = ['ko', 'en', 'ja', 'zh'];
const TOUR_ID = 'tour-dmz';
const scenes = TOUR_SCENES[TOUR_ID];

describe('TourSceneSection — tourSceneData.ts 와 렌더 패리티', () => {
  it('section#scenes 앵커 타깃으로 렌더된다', () => {
    const { container } = render(<TourSceneSection tourId={TOUR_ID} language="ko" />);
    expect(container.querySelector('section#scenes')).toBeTruthy();
  });

  for (const lang of LANGS) {
    it(`${lang}: SCENE 01~05 키커 5개 + 각 씬의 title/body 가 TOUR_SCENES 값과 동일하게 렌더된다`, () => {
      const { container } = render(<TourSceneSection tourId={TOUR_ID} language={lang} />);
      const text = container.textContent || '';

      for (let i = 1; i <= 5; i++) {
        expect(text).toContain(`SCENE ${String(i).padStart(2, '0')}`);
      }

      for (const scene of scenes) {
        expect(text).toContain(scene.title[lang]);
        expect(text).toContain(scene.body[lang]);
      }
    });
  }

  it('ko 렌더 결과에 ja 본문이 새지 않고, ja 렌더 결과에 ko 본문이 새지 않는다 (크로스 로케일 누출 금지)', () => {
    const { container: koContainer } = render(<TourSceneSection tourId={TOUR_ID} language="ko" />);
    const koText = koContainer.textContent || '';
    for (const scene of scenes) {
      expect(koText).not.toContain(scene.body.ja);
    }
    cleanup();

    const { container: jaContainer } = render(<TourSceneSection tourId={TOUR_ID} language="ja" />);
    const jaText = jaContainer.textContent || '';
    for (const scene of scenes) {
      expect(jaText).not.toContain(scene.body.ko);
    }
  });

  it("tourId='tour-nonexistent' 는 아무것도 렌더하지 않는다 (getTourScenes 빈 배열 → null)", () => {
    const { container } = render(<TourSceneSection tourId="tour-nonexistent" language="ko" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('모든 씬 사진의 alt 가 현재 언어의 씬 제목과 동일하다 (빈 alt 금지)', () => {
    const { container } = render(<TourSceneSection tourId={TOUR_ID} language="en" />);
    const imgs = Array.from(container.querySelectorAll('img'));
    expect(imgs.length).toBe(scenes.length);
    imgs.forEach((img, index) => {
      const alt = img.getAttribute('alt') || '';
      expect(alt.trim()).toBeTruthy();
      expect(alt).toBe(scenes[index].title.en);
    });
  });
});
