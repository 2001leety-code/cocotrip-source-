/**
 * PR-C (2026-06-01): 차터 도착 HERO 가격+구간 표시 회귀 슈트.
 *
 * 배경: 도착 가이드 "짐 많음" charter HERO 에 가격이 0 (/charter 딥링크만). RouteAgent 가
 * 이미 공항→호텔 시간 + 공항픽업 가격 SSOT(airport_transfer_prices)를 보유 → HERO 에
 * "공항 → 호텔 · est_min · ₩price" + prefill 딥링크 노출.
 *
 * 🔴 가격 오노출 = 신뢰 치명. 검증 핵심:
 *   1) region → 공항픽업 요금 lookup 이 SSOT(airport_transfer_prices) 값과 정확히 일치
 *   2) 미매핑 region → null (가격 숨김 — 임의 추정 금지)
 *   3) FEATURE_CHARTER_HERO_PRICE OFF → charter 반환에 가격/구간 필드 부재 (현재 동작 byte-identical)
 *   4) 플래그 ON → est_price_krw/from/to/est_min + prefill cta_link 채움, 미매핑이면 가격 필드만 생략
 *   5) 추천 *판단*(heavyLoad)은 새 인자와 무관하게 불변
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  pickRecommendedTransport,
  airportTransferPriceKRW,
} from '../../api/_ai_core/agents/RouteAgent.js';

const ROOT = resolve(__dirname, '../..');
// SSOT 값을 테스트가 직접 읽어 비교 → 가격 숫자 하드코딩 회피(값은 pricing_spec.json 단일 출처).
const SPEC = JSON.parse(readFileSync(resolve(ROOT, 'api/_pricing_spec.json'), 'utf8'));
const ATP = SPEC.airport_transfer_prices as Record<string, { priceKRW: number }>;

// "짐 많음" = heavyLoad 트리거 입력 (large>=3).
const HEAVY = { arrivalTimeHHMM: '14:00', luggage: { large: 3, medium: 0 }, paxCount: 2 };
// 가벼운 짐 = charter 아닌 표준 추천 (필드 무관).
const LIGHT = { arrivalTimeHHMM: '14:00', luggage: { large: 0, medium: 1 }, paxCount: 2 };

describe('PR-C airportTransferPriceKRW — region → 공항픽업 요금 SSOT lookup', () => {
  it('매핑된 region 은 SSOT(airport_transfer_prices) 값과 정확히 일치', () => {
    // region 키 → 기대 zone 키 (코드의 REGION_TO_AIRPORT_TRANSFER_ZONE 와 동일 매핑)
    expect(airportTransferPriceKRW('seoul')).toBe(ATP['seoul-central'].priceKRW);
    expect(airportTransferPriceKRW('incheon')).toBe(ATP['seoul-central'].priceKRW);
    expect(airportTransferPriceKRW('busan')).toBe(ATP['busan'].priceKRW);
    expect(airportTransferPriceKRW('jeju')).toBe(ATP['jeju-metro'].priceKRW);
    expect(airportTransferPriceKRW('gangneung')).toBe(ATP['gangneung-sokcho'].priceKRW);
    expect(airportTransferPriceKRW('sokcho')).toBe(ATP['gangneung-sokcho'].priceKRW);
    expect(airportTransferPriceKRW('suwon')).toBe(ATP['suwon-yongin'].priceKRW);
    expect(airportTransferPriceKRW('chuncheon')).toBe(ATP['chuncheon'].priceKRW);
  });

  it('대소문자 무관 (region 정규화 lowercase)', () => {
    expect(airportTransferPriceKRW('Seoul')).toBe(ATP['seoul-central'].priceKRW);
    expect(airportTransferPriceKRW('BUSAN')).toBe(ATP['busan'].priceKRW);
  });

  it('미매핑 region 은 null (가격 숨김 — 임의 추정/근사 금지)', () => {
    // airport_transfer_prices 에 대응 zone 이 없는 region 들.
    expect(airportTransferPriceKRW('gwangju')).toBeNull();
    expect(airportTransferPriceKRW('daejeon')).toBeNull();
    expect(airportTransferPriceKRW('ulsan')).toBeNull();
    expect(airportTransferPriceKRW('yeosu')).toBeNull();
    expect(airportTransferPriceKRW('gyeongju')).toBeNull();
    expect(airportTransferPriceKRW('jeonju')).toBeNull();
    expect(airportTransferPriceKRW('andong')).toBeNull();
  });

  it('빈/누락 region 은 null', () => {
    expect(airportTransferPriceKRW('')).toBeNull();
    expect(airportTransferPriceKRW(null as unknown as string)).toBeNull();
    expect(airportTransferPriceKRW(undefined as unknown as string)).toBeNull();
  });
});

describe('PR-C pickRecommendedTransport — FEATURE_CHARTER_HERO_PRICE 플래그', () => {
  const prev = process.env.FEATURE_CHARTER_HERO_PRICE;
  beforeEach(() => { delete process.env.FEATURE_CHARTER_HERO_PRICE; });
  afterEach(() => {
    if (prev === undefined) delete process.env.FEATURE_CHARTER_HERO_PRICE;
    else process.env.FEATURE_CHARTER_HERO_PRICE = prev;
  });

  it('플래그 OFF (미설정) → charter 반환에 가격/구간 필드 부재 + cta_link 기본 /charter (현재 동작)', () => {
    const rec = pickRecommendedTransport({
      ...HEAVY, region: 'seoul', airportKey: 'ICN', fromLabel: 'Incheon Airport', toLabel: '명동', estMin: 70,
    });
    expect(rec.key).toBe('cocotrip_charter');
    expect(rec.cta_link).toBe('/charter');
    expect(rec).not.toHaveProperty('est_price_krw');
    expect(rec).not.toHaveProperty('from');
    expect(rec).not.toHaveProperty('to');
    expect(rec).not.toHaveProperty('est_min');
  });

  it('플래그 OFF + 값 무관 — 컨텍스트 인자 전혀 안 줘도 기존과 동일', () => {
    const rec = pickRecommendedTransport(HEAVY);
    expect(rec).toEqual({
      key: 'cocotrip_charter',
      reason_ko: '한국 택시는 캐리어 1개만 가능 — 짐이 많아 코코트립 전용 차량을 추천합니다 (기사가 모든 짐 적재)',
      reason_en: 'Korean taxis can only fit 1 suitcase — book a CocoTrip charter; your driver loads all luggage',
      reason_ja: '韓国のタクシーはスーツケース1個のみ — 荷物が多い方は専用車両を推奨（ドライバーが全荷物を積載）',
      reason_zh: '韩国出租车只能放1个行李箱 — 行李较多请预订CocoTrip包车（司机协助装载所有行李）',
      cta_link: '/charter',
    });
  });

  it('플래그 ON + 매핑 region → est_price_krw(SSOT)/from/to/est_min + prefill cta_link', () => {
    process.env.FEATURE_CHARTER_HERO_PRICE = 'true';
    const rec = pickRecommendedTransport({
      ...HEAVY, region: 'seoul', airportKey: 'ICN', fromLabel: 'Incheon Airport', toLabel: '명동', estMin: 70,
    });
    expect(rec.key).toBe('cocotrip_charter');
    expect(rec.est_price_krw).toBe(ATP['seoul-central'].priceKRW);
    expect(rec.from).toBe('Incheon Airport');
    expect(rec.to).toBe('명동');
    expect(rec.est_min).toBe(70);
    // prefill 딥링크: service/origin/destinationKey/pax 포함.
    expect(rec.cta_link).toContain('/charter?');
    expect(rec.cta_link).toContain('service=airport_transfer');
    expect(rec.cta_link).toContain('origin=ICN');
    expect(rec.cta_link).toContain('destinationKey=seoul');
    expect(rec.cta_link).toContain('pax=2');
  });

  it('플래그 ON + 미매핑 region → 가격 필드만 생략(null 숨김), from/to/est_min/딥링크는 유지', () => {
    process.env.FEATURE_CHARTER_HERO_PRICE = 'true';
    const rec = pickRecommendedTransport({
      ...HEAVY, region: 'gwangju', airportKey: 'KWJ', fromLabel: 'Gwangju Airport', toLabel: '광주 도심', estMin: 40,
    });
    expect(rec.key).toBe('cocotrip_charter');
    expect(rec).not.toHaveProperty('est_price_krw'); // 🔴 미매핑 → 가격 미노출
    expect(rec.from).toBe('Gwangju Airport');
    expect(rec.to).toBe('광주 도심');
    expect(rec.est_min).toBe(40);
    expect(rec.cta_link).toContain('destinationKey=gwangju');
  });

  it('플래그 ON 이라도 heavyLoad 아니면(가벼운 짐) charter 아님 — 가격 필드 미추가', () => {
    process.env.FEATURE_CHARTER_HERO_PRICE = 'true';
    const rec = pickRecommendedTransport({
      ...LIGHT, region: 'seoul', airportKey: 'ICN', fromLabel: 'Incheon Airport', toLabel: '명동', estMin: 70,
    });
    expect(rec.key).not.toBe('cocotrip_charter');
    expect(rec).not.toHaveProperty('est_price_krw');
  });

  it('추천 판단(heavyLoad)은 새 컨텍스트 인자와 무관 — region 유무로 key 안 바뀜', () => {
    process.env.FEATURE_CHARTER_HERO_PRICE = 'true';
    const withCtx = pickRecommendedTransport({ ...HEAVY, region: 'busan', airportKey: 'PUS' });
    const noCtx = pickRecommendedTransport(HEAVY);
    expect(withCtx.key).toBe('cocotrip_charter');
    expect(noCtx.key).toBe('cocotrip_charter');
  });
});
