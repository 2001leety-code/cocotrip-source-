/**
 * P155 (2026-05-22): STATION_COORDS fuzzy match — prod alert 다수
 * (intercity bookend silent fail) 의 root cause.
 *
 * Gemini 가 출력하는 station 이름 변형:
 *   - "김포국제공항 (GMP)" — 괄호 + 공항 코드
 *   - "부산종합버스터미널 (노포)" — 괄호 + 위치
 *   - "부산종합버스터미널(노포)" — 공백 없는 변형
 *   - "신경주역" — 신규 등록 필요 (경주 KTX)
 *   - "GMP" — 코드만
 */
import { describe, it, expect } from 'vitest';
import { lookupStationCoord } from '../../api/_ai_core/agents/RouteAgent.js';

describe('P155 lookupStationCoord fuzzy', () => {
  it('exact match — "서울역"', () => {
    const r = lookupStationCoord('서울역');
    expect(r).not.toBeNull();
    expect(r!.label).toBe('서울역');
  });

  it('신경주역 (경주 KTX) — 신규 등록', () => {
    const r = lookupStationCoord('신경주역');
    expect(r).not.toBeNull();
    expect(r!.lat).toBeGreaterThan(35);
    expect(r!.lat).toBeLessThan(36);
  });

  it('경주고속버스터미널 — 신규 등록', () => {
    const r = lookupStationCoord('경주고속버스터미널');
    expect(r).not.toBeNull();
  });

  it('괄호 suffix 정규화 — "김포국제공항 (GMP)"', () => {
    const r = lookupStationCoord('김포국제공항 (GMP)');
    expect(r).not.toBeNull();
    expect(r!.label).toBe('김포국제공항');
  });

  it('괄호 suffix 정규화 — "김해국제공항 (PUS)"', () => {
    const r = lookupStationCoord('김해국제공항 (PUS)');
    expect(r).not.toBeNull();
    expect(r!.label).toBe('김해국제공항');
  });

  it('괄호 suffix 정규화 — "제주국제공항 (CJU)"', () => {
    const r = lookupStationCoord('제주국제공항 (CJU)');
    expect(r).not.toBeNull();
    expect(r!.label).toBe('제주국제공항');
  });

  it('괄호 + 공백 변형 — "부산종합버스터미널 (노포)"', () => {
    const r = lookupStationCoord('부산종합버스터미널 (노포)');
    expect(r).not.toBeNull();
    expect(r!.label).toBe('부산종합버스터미널');
  });

  it('괄호만 공백없는 변형 — "부산종합버스터미널(노포)"', () => {
    const r = lookupStationCoord('부산종합버스터미널(노포)');
    expect(r).not.toBeNull();
  });

  it('공항 코드만 — "GMP" → 김포국제공항', () => {
    const r = lookupStationCoord('GMP');
    expect(r).not.toBeNull();
    expect(r!.label).toBe('김포국제공항');
  });

  it('미등록 station 은 null', () => {
    const r = lookupStationCoord('서울에이비씨역_2099');
    expect(r).toBeNull();
  });

  it('null / 빈 string graceful', () => {
    expect(lookupStationCoord('')).toBeNull();
    expect(lookupStationCoord(null as any)).toBeNull();
    expect(lookupStationCoord(undefined as any)).toBeNull();
  });
});
