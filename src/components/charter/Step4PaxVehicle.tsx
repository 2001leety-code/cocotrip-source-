// Step 4: 인원 (어른/아이) + 차종 자동 추천 · i18n
// 2026-06-30: 차종 4종 — staria(프리미엄 비즈니스 캡틴시트) / staria_9(9인승) / sprinter / bus.
//   staria·staria_9 = 즉시결제(가이드 없음), sprinter·bus = 가이드 필수(legalGuideWarn). vip(의전) 선택지 제거.
import { useState } from 'react';
import { Car, Bus, AlertTriangle, Minus, Plus, Users } from 'lucide-react';
import { VEHICLE_TYPES } from '@/data/charterPricing';
import { VEHICLE_GALLERY } from '@/data/vehicleImages';
import type { WizardState, VehicleType } from './types';
import { getWizardI18n } from './wizard-i18n';

// 차종 실차 사진 갤러리 — hero 1장 + 썸네일 클릭 전환. (차종 바뀌면 key 로 리셋)
function VehicleGallery({ images }: { images: string[] }) {
  const [idx, setIdx] = useState(0);
  if (!images.length) return null;
  return (
    <div className="space-y-2">
      <div className="rounded-xl overflow-hidden bg-black/20" style={{ aspectRatio: '4 / 3' }}>
        <img src={images[idx]} alt="" loading="lazy" className="w-full h-full object-cover" />
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {images.map((src, i) => (
          <button key={src} type="button" onClick={() => setIdx(i)}
            className={`shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-all ${
              i === idx ? 'border-[#B668FC]' : 'border-transparent opacity-55 hover:opacity-90'
            }`}>
            <img src={src} alt="" loading="lazy" className="w-full h-full object-cover" />
          </button>
        ))}
      </div>
    </div>
  );
}

function recommendVehicle(pax: number): VehicleType {
  if (pax <= 7)  return 'staria_9';
  if (pax <= 15) return 'sprinter';
  return 'bus';
}

function vehiclePassengerCap(v: VehicleType): number {
  if (v === 'staria') return 6;
  if (v === 'staria_9') return 7;
  if (v === 'sprinter') return 15;
  return 45;
}

// 차종별 고객 탑승 가능 인원 표기. 운전자 포함 좌석 수와 고객 인원을 분리한다.
function vehiclePaxRangeLabel(v: VehicleType, lang: 'ko' | 'en'): string {
  if (v === 'staria_9') return lang === 'ko' ? '1~7인' : '1-7 pax';
  if (v === 'staria')   return lang === 'ko' ? '1~6인' : '1-6 pax';
  if (v === 'sprinter') return lang === 'ko' ? '10~15인' : '10-15 pax';
  return lang === 'ko' ? '16인 이상' : '16+ pax';
}

function vehicleDisplayName(v: VehicleType, lang: 'ko' | 'en'): string {
  if (v === 'staria') return lang === 'ko' ? '프리미엄 비즈니스' : 'Premium Business';
  return VEHICLE_TYPES[v].name[lang];
}

interface Props {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
  language?: 'ko' | 'en' | 'ja' | 'zh';
}

export function Step4PaxVehicle({ state, patch, language = 'en' }: Props) {
  const lang = language === 'ko' ? 'ko' : 'en';
  const i18n = getWizardI18n(language);

  // 어른/아이 분리 — paxCount는 derived (어른+아이)
  const adult = state.adultCount ?? state.paxCount ?? 2;
  const child = state.childCount ?? 0;
  const pax = adult + child;
  const recommended = recommendVehicle(pax);
  const vehicle = state.vehicle ?? recommended;
  const paxCap = vehiclePassengerCap(vehicle);

  // patch wrapper — paxCount를 항상 동기화
  const setAdult = (n: number) => {
    const next = Math.max(1, Math.min(paxCap - child, n));
    patch({ adultCount: next, paxCount: next + child });
  };
  const setChild = (n: number) => {
    const next = Math.max(0, Math.min(paxCap - adult, n));
    patch({ childCount: next, paxCount: adult + next });
  };

  const selectVehicle = (v: VehicleType) => {
    const nextCap = vehiclePassengerCap(v);
    if (pax <= nextCap) {
      patch({ vehicle: v });
      return;
    }
    const nextChild = Math.min(child, Math.max(0, nextCap - 1));
    const nextAdult = Math.max(1, nextCap - nextChild);
    patch({ vehicle: v, adultCount: nextAdult, childCount: nextChild, paxCount: nextAdult + nextChild });
  };

  return (
    <div className="space-y-3 sm:space-y-7">
      <div className="grid gap-1.5 sm:grid-cols-2 sm:gap-3">
        <CounterPanel
          label={i18n.adultLabel}
          value={adult}
          onDecrease={() => setAdult(adult - 1)}
          onIncrease={() => setAdult(adult + 1)}
        />
        <CounterPanel
          label={i18n.childLabel}
          value={child}
          onDecrease={() => setChild(child - 1)}
          onIncrease={() => setChild(child + 1)}
        />
      </div>

      <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-2.5 py-1.5 sm:rounded-2xl sm:p-4">
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#B668FC]/15 text-[#D8C0FF] sm:h-11 sm:w-11 sm:rounded-2xl">
            <Users className="h-3.5 w-3.5 sm:h-5 sm:w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold leading-tight text-white sm:text-sm">{pax} {language === 'ko' ? '명' : 'pax'}</p>
            <p className="truncate text-[9px] leading-relaxed text-white/50 sm:text-xs">{i18n.totalPaxNote(pax, paxCap)}</p>
          </div>
        </div>
        {recommended === vehicle && (
          <span className="shrink-0 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300 sm:px-3 sm:py-1 sm:text-xs">
            {i18n.recommendedTag}
          </span>
        )}
      </div>

      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-white/55 sm:mb-3 sm:text-xs">
          {i18n.vehicleLabel}
        </label>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 sm:gap-3">
          {(['staria_9', 'staria', 'sprinter', 'bus'] as VehicleType[]).map(v => {
            const selected = vehicle === v;
            const name = vehicleDisplayName(v, lang);
            return (
              <button
                key={v}
                type="button"
                onClick={() => selectVehicle(v)}
                className={`group flex min-h-[48px] items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left transition-all sm:min-h-[112px] sm:items-start sm:gap-3 sm:rounded-2xl sm:p-4 ${
                  selected
                    ? 'border-[#B668FC] bg-gradient-to-br from-[#B668FC]/18 to-[#EA537E]/10 shadow-[0_16px_44px_rgba(124,92,252,0.18)]'
                    : 'border-white/10 bg-white/[0.035] hover:border-[#B668FC]/45 hover:bg-white/[0.055]'
                }`}
              >
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg sm:h-11 sm:w-11 sm:rounded-2xl ${
                  selected ? 'bg-white/14 text-white' : 'bg-white/[0.06] text-white/60 group-hover:text-white'
                }`}>
                  {v === 'staria' || v === 'staria_9'
                    ? <Car className="h-3.5 w-3.5 sm:h-5 sm:w-5" />
                    : <Bus className="h-3.5 w-3.5 sm:h-5 sm:w-5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-black leading-tight text-white sm:text-sm">{name}</span>
                  <span className="mt-0.5 block text-[9px] font-semibold text-white/55 sm:mt-1 sm:text-xs">{vehiclePaxRangeLabel(v, lang)}</span>
                  {recommended === v && (
                    <span className="mt-0.5 inline-flex rounded-full bg-emerald-400/10 px-1.5 py-0.5 text-[8px] font-bold text-emerald-300 sm:mt-2 sm:px-2.5 sm:py-1 sm:text-[11px]">
                      {i18n.recommendedTag}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 선택 차종 실차 사진 (staria=7인 갈색 캡틴 / staria_9=9인 검정). key 로 차종 전환 시 리셋. */}
      {VEHICLE_GALLERY[vehicle] && (
        <VehicleGallery key={vehicle} images={VEHICLE_GALLERY[vehicle]!} />
      )}

      {/* sprinter/bus 만 가이드 법적 필수 안내. staria·staria_9(9인승)=가이드 없음 → 미표시. */}
      {(vehicle === 'sprinter' || vehicle === 'bus') && (
        <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/25 rounded-xl px-4 py-4">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-200/85 leading-relaxed">{i18n.legalGuideWarn}</p>
        </div>
      )}
    </div>
  );
}

function CounterPanel({
  label,
  value,
  onDecrease,
  onIncrease,
}: {
  label: string;
  value: number;
  onDecrease: () => void;
  onIncrease: () => void;
}) {
  return (
    <div className="flex min-h-[42px] items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-2.5 py-1.5 sm:block sm:min-h-0 sm:rounded-2xl sm:p-4">
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-white/55 sm:mb-3 sm:text-xs">{label}</label>
      <div className="grid w-[124px] grid-cols-[30px_minmax(0,1fr)_30px] items-center gap-1 sm:w-auto sm:grid-cols-[48px_minmax(0,1fr)_48px] sm:gap-3">
        <button type="button" onClick={onDecrease}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-white/75 transition-colors hover:bg-white/[0.08] sm:h-12 sm:w-12 sm:rounded-2xl">
          <Minus className="h-3.5 w-3.5 sm:h-5 sm:w-5" />
        </button>
        <div className="text-center text-xl font-black leading-none text-white sm:text-4xl">{value}</div>
        <button type="button" onClick={onIncrease}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-white/75 transition-colors hover:bg-white/[0.08] sm:h-12 sm:w-12 sm:rounded-2xl">
          <Plus className="h-3.5 w-3.5 sm:h-5 sm:w-5" />
        </button>
      </div>
    </div>
  );
}
