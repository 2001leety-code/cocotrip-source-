// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { Step3Destination } from '../../src/components/charter/Step3Destination';
import type { WizardState } from '../../src/components/charter/types';
import {
  AIRPORT_TRANSFER_PRICES,
  DAILY_TOUR_PRICES,
  DISTANCE_MATRIX,
  KPOP_SHUTTLE,
} from '../../src/data/charterPricing';
import { matrixDestinationLabel } from '../../src/components/charter/destinationDisplayLabels';

type Language = 'ko' | 'en' | 'ja' | 'zh';

const AIRPORT_TITLES = {
  ja: [
    'ソウル都心（明洞・弘大・鍾路・龍山）',
    '江南・蚕室・松坡',
    '水原・龍仁',
    '加平・南怡島',
    '春川',
    '平昌・龍平・アルペンシア',
    '江陵・束草',
    '釜山（仁川空港直行）',
    '釜山市内（金海空港発）',
    'ソウル都心（金浦空港発）',
    'ソウル江南（金浦空港発）',
    '済州市内（済州空港発）',
  ],
  zh: [
    '首尔市中心（明洞·弘大·钟路·龙山）',
    '江南·蚕室·松坡',
    '水原·龙仁',
    '加平·南怡岛',
    '春川',
    '平昌·龙平·阿尔卑斯',
    '江陵·束草',
    '釜山（仁川机场直达）',
    '釜山市区（金海机场出发）',
    '首尔市中心（金浦机场出发）',
    '首尔江南（金浦机场出发）',
    '济州市区（济州机场出发）',
  ],
} as const;

const DAY_TOUR_TITLES = {
  ja: [
    'ソウル市内ツアー',
    'ソウル近郊ツアー（南怡島・加平・水原）',
    'DMZツアー',
    '江原道日帰りツアー（春川・江陵・束草）',
    'スキーリゾートツアー（龍平・アルペンシア・ハイワン）',
    '慶州・全州ツアー',
    '釜山日帰りツアー',
  ],
  zh: [
    '首尔市区一日游',
    '首尔近郊一日游（南怡岛·加平·水原）',
    'DMZ游',
    '江原道一日游（春川·江陵·束草）',
    '滑雪度假村一日游（龙平·阿尔卑斯·High1）',
    '庆州·全州游',
    '釜山一日游',
  ],
} as const;

const MATRIX_TITLES = {
  ko: {
    GANGNEUNG: '강릉', SOKCHO: '속초', PYEONGCHANG: '평창', BUSAN: '부산',
    GYEONGJU: '경주', JEONJU: '전주', ANDONG: '안동', YEOSU: '여수',
    DAMYANG: '담양', DAEGU: '대구', GAPYEONG: '가평·남이섬', CHUNCHEON: '춘천',
  },
  en: {
    GANGNEUNG: 'Gangneung', SOKCHO: 'Sokcho', PYEONGCHANG: 'Pyeongchang', BUSAN: 'Busan',
    GYEONGJU: 'Gyeongju', JEONJU: 'Jeonju', ANDONG: 'Andong', YEOSU: 'Yeosu',
    DAMYANG: 'Damyang', DAEGU: 'Daegu', GAPYEONG: 'Gapyeong / Nami Island', CHUNCHEON: 'Chuncheon',
  },
  ja: {
    GANGNEUNG: '江陵', SOKCHO: '束草', PYEONGCHANG: '平昌', BUSAN: '釜山',
    GYEONGJU: '慶州', JEONJU: '全州', ANDONG: '安東', YEOSU: '麗水',
    DAMYANG: '潭陽', DAEGU: '大邱', GAPYEONG: '加平・南怡島', CHUNCHEON: '春川',
  },
  zh: {
    GANGNEUNG: '江陵', SOKCHO: '束草', PYEONGCHANG: '平昌', BUSAN: '釜山',
    GYEONGJU: '庆州', JEONJU: '全州', ANDONG: '安东', YEOSU: '丽水',
    DAMYANG: '潭阳', DAEGU: '大邱', GAPYEONG: '加平·南怡岛', CHUNCHEON: '春川',
  },
} as const;

const KPOP_TITLES = {
  ja: [
    'インスパイア・アリーナ',
    '蚕室オリンピック主競技場',
    'KSPO DOME（体操競技場）',
    '高尺スカイドーム',
    '水原ワールドカップ競技場',
  ],
  zh: [
    'INSPIRE综艺馆',
    '蚕室奥林匹克主体育场',
    'KSPO巨蛋（体操竞技场）',
    '高尺天空巨蛋',
    '水原世界杯体育场',
  ],
} as const;

function renderStep3(
  language: Language,
  state: Partial<WizardState>,
  patch = vi.fn(),
) {
  const view = render(
    <Step3Destination
      state={state as WizardState}
      patch={patch}
      language={language}
    />,
  );
  const cards = Array.from(view.container.querySelectorAll('button'));
  const titles = cards.map((card) => card.querySelector('p')?.textContent || '');
  return { ...view, cards, titles, patch };
}

describe('/charter Step3 목적지 카드 — 가격 자료와 표시 언어 분리', () => {
  it.each(['ko', 'en'] as const)('%s: 기존 공항 목적지 이름과 카드 수를 그대로 쓴다', (language) => {
    const { titles, cards, unmount } = renderStep3(language, {
      origin: 'ICN',
      service: 'airport_transfer',
    });
    const source = Object.values(AIRPORT_TRANSFER_PRICES).map((item) => item[language]);
    expect(titles).toEqual(source);
    expect(cards).toHaveLength(Object.keys(AIRPORT_TRANSFER_PRICES).length);
    unmount();
  });

  it.each(['ja', 'zh'] as const)('%s: 공항 목적지 12개가 영어 원문 대신 현지어다', (language) => {
    const { titles, cards, unmount } = renderStep3(language, {
      origin: 'ICN',
      service: 'airport_transfer',
    });
    expect(titles).toEqual(AIRPORT_TITLES[language]);
    expect(cards).toHaveLength(Object.keys(AIRPORT_TRANSFER_PRICES).length);
    for (const item of Object.values(AIRPORT_TRANSFER_PRICES)) {
      expect(titles).not.toContain(item.en);
    }
    unmount();
  });

  it.each(['ja', 'zh'] as const)('%s: 당일 투어 7개가 영어 원문 대신 현지어다', (language) => {
    const { titles, cards, unmount } = renderStep3(language, {
      origin: 'SEL_METRO',
      service: 'day_tour',
    });
    expect(titles).toEqual(DAY_TOUR_TITLES[language]);
    expect(cards).toHaveLength(Object.keys(DAILY_TOUR_PRICES).length);
    for (const item of Object.values(DAILY_TOUR_PRICES)) {
      expect(titles).not.toContain(item.en);
    }
    unmount();
  });

  it.each(['ko', 'en', 'ja', 'zh'] as const)('%s: 장거리 매트릭스 키가 코드 그대로 노출되지 않는다', (language) => {
    const { titles, cards, unmount } = renderStep3(language, {
      origin: 'SEL_METRO',
      service: 'multi_day',
    });
    const matrixKeys = Object.entries(DISTANCE_MATRIX)
      .filter(([key, value]) => key.startsWith('SEL_METRO→') && ((value as { km?: number }).km || 0) >= 100)
      .map(([key]) => key.split('→')[1]);
    expect(titles).toEqual(matrixKeys.map((key) => MATRIX_TITLES[language][key as keyof typeof MATRIX_TITLES.ko]));
    expect(cards).toHaveLength(matrixKeys.length);
    for (const key of matrixKeys) expect(titles).not.toContain(key);
    unmount();
  });

  it.each(['ko', 'en', 'ja', 'zh'] as const)('%s: 현재 거리표의 모든 목적지 키에 표시 이름이 있다', (language) => {
    const destinationKeys = new Set(
      Object.keys(DISTANCE_MATRIX)
        .filter((key) => key.includes('→'))
        .map((key) => key.split('→')[1]),
    );
    for (const key of destinationKeys) {
      expect(matrixDestinationLabel(key, language)).not.toBe(key);
    }
  });

  it.each(['ja', 'zh'] as const)('%s: 공연장 이름과 위치가 영어 원문으로 되돌아가지 않는다', (language) => {
    const { titles, container, unmount } = renderStep3(language, {
      origin: 'SEL_METRO',
      service: 'kpop_shuttle',
    });
    const text = container.textContent || '';
    expect(titles).toEqual(KPOP_TITLES[language]);
    for (const venue of KPOP_SHUTTLE.venues) {
      expect(text).not.toContain(venue.nameEn);
      expect(text).not.toContain(venue.locationEn);
    }
    unmount();
  });

  it('현지화된 긴 이름은 두 줄까지 보이고 선택 키는 가격 자료의 원래 key다', () => {
    const patch = vi.fn();
    const { cards, patch: patchSpy, unmount } = renderStep3('ja', {
      origin: 'ICN',
      service: 'airport_transfer',
    }, patch);
    const title = cards[0].querySelector('p');
    expect(title?.className).toContain('line-clamp-2');
    expect(title?.className).not.toContain('truncate');
    expect(cards[0]).toHaveAttribute('aria-pressed', 'false');
    expect(cards[0]).toHaveAttribute('data-destination-key', 'seoul-central');
    fireEvent.click(cards[0]);
    expect(patchSpy).toHaveBeenCalledWith(expect.objectContaining({
      destinationKey: 'seoul-central',
    }));
    unmount();
  });
});
