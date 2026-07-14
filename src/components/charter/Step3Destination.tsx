// Step 3: 목적지 선택 — Step1(출발)+Step2(서비스)에 따라 동적 옵션 · i18n
// PR-H: 자유 입력 → AddressAutocomplete (Naver Local Search + 미니 지도 확인 카드).
import { useMemo } from 'react';
import {
  AIRPORT_TRANSFER_PRICES,
  DAILY_TOUR_PRICES,
  KPOP_SHUTTLE,
  DISTANCE_MATRIX,
} from '@/data/charterPricing';
import type { WizardState } from './types';
import { getWizardI18n } from './wizard-i18n';
import { normalizeDestinationToMatrixKey } from './destinationKeyMap';
import { AddressAutocomplete, type AddressResult } from './AddressAutocomplete';
import { charterWaypointsEnabled } from '@/lib/charterRouteKm';
import { translations } from '@/i18n';

const MAX_WAYPOINTS = 5; // TMAP passList 제한

const WP_TEXT: Record<'ko' | 'en' | 'ja' | 'zh', { title: string; hint: string; add: string; stop: string; remove: string; needCoords: string }> = {
  ko: { title: '경유지 (선택)', hint: '가는 길에 들를 곳을 순서대로 추가하세요. 실제 도로 경로로 요금이 계산됩니다.', add: '+ 경유지 추가', stop: '경유지', remove: '삭제', needCoords: '출발지·목적지를 자동완성으로 확정하면 경유지 요금이 반영됩니다.' },
  en: { title: 'Stops (optional)', hint: 'Add places to visit along the way, in order. Fare is calculated by actual road route.', add: '+ Add stop', stop: 'Stop', remove: 'Remove', needCoords: 'Confirm origin & destination via autocomplete to apply stop-based pricing.' },
  ja: { title: '経由地 (任意)', hint: '途中で立ち寄る場所を順番に追加。実際の道路経路で料金計算されます。', add: '+ 経由地を追加', stop: '経由地', remove: '削除', needCoords: '出発地・目的地を確定すると経由地料金が反映されます。' },
  zh: { title: '经停 (可选)', hint: '按顺序添加途中要去的地方。按实际道路路线计费。', add: '+ 添加经停', stop: '经停', remove: '删除', needCoords: '通过自动填充确定出发地和目的地后，将按经停计费。' },
};

interface DestinationOption {
  key: string;
  title: string;
  sub?: string;
}

interface Props {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
  language?: 'ko' | 'en' | 'ja' | 'zh';
}

export function Step3Destination({ state, patch, language = 'en' }: Props) {
  const lang: 'ko' | 'en' = language === 'ko' ? 'ko' : 'en';
  const i18n = getWizardI18n(language);
  // PR-H: AddressAutocomplete i18n
  const aacText = (translations[language] as unknown as {
    addressAutocomplete?: { destinationLabel: string; placeholderHint: string };
  }).addressAutocomplete ?? { destinationLabel: 'Destination', placeholderHint: 'Try: Lotte Hotel Myeongdong' };

  const confirmedDest: AddressResult | undefined =
    typeof state.destLat === 'number' && typeof state.destLng === 'number' && state.destName
      ? {
          name: state.destName,
          address: state.destAddress ?? '',
          lat: state.destLat,
          lng: state.destLng,
          category: state.destCategory,
        }
      : undefined;

  const options: DestinationOption[] = useMemo(() => {
    const list: DestinationOption[] = [];

    if (state.service === 'airport_transfer') {
      if (state.origin === 'ICN') {
        for (const [key, dest] of Object.entries(AIRPORT_TRANSFER_PRICES)) {
          const d = dest as { ko: string; en: string; priceKRW: number; durationMin: number };
          list.push({
            key,
            title: lang === 'ko' ? d.ko : d.en,
            sub: `₩${d.priceKRW.toLocaleString('ko-KR')} · ~${d.durationMin}${i18n.minutesUnit}`,
          });
        }
      } else if (state.origin) {
        const matrix = DISTANCE_MATRIX as Record<string, { km?: number; hours?: number; priceKRW?: number }>;
        for (const k of Object.keys(matrix)) {
          if (k === 'comment') continue;
          if (!k.startsWith(`${state.origin}→`)) continue;
          const v = matrix[k];
          const destKey = k.split('→')[1];
          list.push({
            key: destKey,
            title: destKey,
            sub: v.priceKRW ? `₩${v.priceKRW.toLocaleString('ko-KR')} · ${v.km}km` : `${v.km}km · ~${v.hours}h`,
          });
        }
      }
    } else if (state.service === 'day_tour') {
      for (const [key, tour] of Object.entries(DAILY_TOUR_PRICES)) {
        const t = tour as { ko: string; en: string; priceKRW: number; hours: number };
        list.push({ key, title: lang === 'ko' ? t.ko : t.en, sub: `₩${t.priceKRW.toLocaleString('ko-KR')} · ${t.hours}h` });
      }
    } else if (state.service === 'multi_day') {
      const matrix = DISTANCE_MATRIX as Record<string, { km?: number; hours?: number; priceKRW?: number }>;
      for (const k of Object.keys(matrix)) {
        if (k === 'comment') continue;
        if (!k.startsWith(`${state.origin ?? 'SEL_METRO'}→`)) continue;
        const v = matrix[k];
        if ((v.km ?? 0) < 100) continue;
        const destKey = k.split('→')[1];
        list.push({ key: destKey, title: destKey, sub: `${v.km}km · ~${v.hours}h` });
      }
    } else if (state.service === 'transfer') {
      // 도시간 transfer — 매트릭스 도착 도시 (multi_day 와 동일하되 거리 하한 없음: 짧은 도시간 이동도 허용).
      const matrix = DISTANCE_MATRIX as Record<string, { km?: number; hours?: number; priceKRW?: number }>;
      for (const k of Object.keys(matrix)) {
        if (k === 'comment') continue;
        if (!k.startsWith(`${state.origin ?? 'SEL_METRO'}→`)) continue;
        const v = matrix[k];
        const destKey = k.split('→')[1];
        list.push({ key: destKey, title: destKey, sub: `${v.km}km · ~${v.hours}h` });
      }
    } else if (state.service === 'kpop_shuttle') {
      for (const venue of KPOP_SHUTTLE.venues) {
        list.push({ key: venue.name, title: lang === 'ko' ? venue.name : venue.nameEn, sub: lang === 'ko' ? venue.location : venue.locationEn });
      }
    }
    return list;
  }, [state.service, state.origin, lang, i18n.minutesUnit]);

  return (
    <div className="space-y-2.5 sm:space-y-5">
      {options.length === 0 && (
        <p className="text-sm text-white/55 py-4">{i18n.selectOriginFirst}</p>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
        {options.map(opt => {
          const selected = state.destinationKey === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => patch({
                destinationKey: opt.key,
                destinationCustom: undefined,
                // 권역 카드 선택 시 자유입력 좌표 reset.
                destLat: undefined, destLng: undefined,
                destAddress: undefined, destName: undefined, destCategory: undefined,
              })}
              className={`min-h-[48px] rounded-xl border px-2.5 py-1.5 text-left transition-all sm:min-h-[92px] sm:rounded-2xl sm:p-4 ${
                selected
                  ? 'border-[#B668FC] bg-gradient-to-br from-[#B668FC]/18 to-[#FF6B9D]/10 shadow-[0_16px_40px_rgba(124,92,252,0.14)]'
                  : 'border-white/10 bg-white/[0.035] hover:border-[#B668FC]/40 hover:bg-white/[0.055]'
              }`}
            >
              <p className="truncate text-xs font-bold text-white/90 sm:text-[15px]">{opt.title}</p>
              {opt.sub && <p className="mt-0.5 text-[9px] leading-relaxed text-white/55 sm:mt-2 sm:text-xs">{opt.sub}</p>}
            </button>
          );
        })}
      </div>

      <div className="space-y-2.5 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3 sm:space-y-3 sm:p-4">
        {/* PR-H: 자유 입력 → AddressAutocomplete. 자동완성 클릭한 결과만 허용 — 좌표 보유. */}
        <AddressAutocomplete
          id="charter-dest-autocomplete"
          label={i18n.destCustomLabel || aacText.destinationLabel}
          placeholder={aacText.placeholderHint}
          language={language}
          value={confirmedDest}
          onChange={(coord) => {
            if (!coord) {
              patch({
                destLat: undefined, destLng: undefined,
                destAddress: undefined, destName: undefined, destCategory: undefined,
                destinationKey: undefined, destinationCustom: undefined,
              });
              return;
            }
            // 매트릭스 매핑 시도 — 좌표는 유지하되 destinationKey 도 채워서 권역 가격 적용 가능.
            const matched = normalizeDestinationToMatrixKey(coord.name) ||
              normalizeDestinationToMatrixKey(coord.address);
            patch({
              destinationKey: matched ?? undefined,
              destinationCustom: coord.address || coord.name,
              destinationCustomMatched: matched ?? undefined,
              destLat: coord.lat,
              destLng: coord.lng,
              destAddress: coord.address,
              destName: coord.name,
              destCategory: coord.category,
            });
          }}
        />
        {/* 자동완성 매칭 시 — 권역 가격 적용 안내 */}
        {confirmedDest && state.destinationCustomMatched && (
          <p className="text-xs text-emerald-300">
            ✓ {i18n.destCustomMatched(state.destinationCustomMatched)}
          </p>
        )}
        {confirmedDest && !state.destinationCustomMatched && (
          <p className="text-xs text-amber-300">
            ⚠ {i18n.destCustomUnmatched}
          </p>
        )}
      </div>

      {/* FEATURE_CHARTER_WAYPOINTS: 경유지 입력 — transfer/multi_day 만. 플래그 OFF 시 미노출(무영향). */}
      {charterWaypointsEnabled() && (state.service === 'transfer' || state.service === 'multi_day') && (
        <WaypointsSection state={state} patch={patch} language={language} />
      )}

      {/* batch 9 fix (B9-1+B9-2, 2026-05-09): 픽업 시각 select 블록은 Step 5
          날짜 input 아래로 이동 + 30분 단위 select → 자유 입력 (type="time").
          야간 할증 자동 계산도 Step 5 onChange 에서. */}
    </div>
  );
}

// FEATURE_CHARTER_WAYPOINTS: 경유지 입력 섹션. AddressAutocomplete 로 좌표 확정한 경유지만 state.waypoints 에
//   순서대로 저장. 최대 5(TMAP passList). origin/dest 좌표가 확정돼야 실제 요금 반영(useCharterRouteKm 가 판정).
function WaypointsSection({ state, patch, language = 'en' }: Props) {
  const t = WP_TEXT[language] ?? WP_TEXT.en;
  const waypoints = state.waypoints ?? [];
  const hasEndpoints = typeof state.originLat === 'number' && typeof state.originLng === 'number'
    && typeof state.destLat === 'number' && typeof state.destLng === 'number';

  const updateAt = (idx: number, coord: AddressResult | null) => {
    const next = [...waypoints];
    if (!coord) next.splice(idx, 1);
    else next[idx] = { lat: coord.lat, lng: coord.lng, name: coord.name, address: coord.address };
    patch({ waypoints: next.length ? next : undefined });
  };
  const addAt = (coord: AddressResult | null) => {
    if (!coord || waypoints.length >= MAX_WAYPOINTS) return;
    patch({ waypoints: [...waypoints, { lat: coord.lat, lng: coord.lng, name: coord.name, address: coord.address }] });
  };

  return (
    <div className="space-y-2.5 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3 sm:space-y-3 sm:p-4">
      <div>
        <p className="text-sm font-bold text-white/85">{t.title}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-white/50">{t.hint}</p>
      </div>

      {waypoints.map((wp, idx) => (
        <div key={idx} className="flex items-start gap-2">
          <span className="mt-2 shrink-0 text-[11px] font-semibold text-[#B668FC]">{t.stop} {idx + 1}</span>
          <div className="min-w-0 flex-1">
            <AddressAutocomplete
              id={`charter-waypoint-${idx}`}
              label=""
              placeholder={t.stop}
              language={language}
              value={{ name: wp.name ?? '', address: wp.address ?? '', lat: wp.lat, lng: wp.lng }}
              onChange={(coord) => updateAt(idx, coord)}
            />
          </div>
          <button
            type="button"
            onClick={() => updateAt(idx, null)}
            aria-label={t.remove}
            className="mt-1 shrink-0 rounded-lg border border-white/10 px-2 py-1 text-xs text-white/55 hover:border-red-400/40 hover:text-red-300"
          >
            ×
          </button>
        </div>
      ))}

      {waypoints.length < MAX_WAYPOINTS && (
        <AddressAutocomplete
          id={`charter-waypoint-add-${waypoints.length}`}
          label=""
          placeholder={t.add}
          language={language}
          value={undefined}
          onChange={addAt}
        />
      )}

      {waypoints.length > 0 && !hasEndpoints && (
        <p className="text-[11px] text-amber-300/85">⚠ {t.needCoords}</p>
      )}
    </div>
  );
}
