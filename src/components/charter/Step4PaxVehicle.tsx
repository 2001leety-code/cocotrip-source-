// Step 4: 인원 (어른/아이) + 차종 자동 추천 · i18n
// 2026-06-30: 차종 4종 — staria(7인승 캡틴시트) / staria_9(9인승) / sprinter / bus.
//   staria·staria_9 = 즉시결제(가이드 없음), sprinter·bus = 가이드 필수(legalGuideWarn). vip(의전) 선택지 제거.
import { useState } from 'react';
import { Car, Bus, AlertTriangle, Minus, Plus } from 'lucide-react';
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
  if (pax <= 7)  return 'staria';
  if (pax <= 9)  return 'staria_9';
  if (pax <= 15) return 'sprinter';
  return 'bus';
}

// 차종별 인원 범위 표기. staria=7인승 / staria_9=9인승 / sprinter=중형 / bus=대형.
function vehiclePaxRangeLabel(v: VehicleType, lang: 'ko' | 'en'): string {
  if (v === 'staria')   return lang === 'ko' ? '1~7인' : '1-7 pax';
  if (v === 'staria_9') return lang === 'ko' ? '8~9인' : '8-9 pax';
  if (v === 'sprinter') return lang === 'ko' ? '10~15인' : '10-15 pax';
  return lang === 'ko' ? '16인 이상' : '16+ pax';
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
  // 차종별 인원 캡 (max_pax 와 동기화): staria 7 / staria_9 9 / sprinter 15 / bus 45.
  const paxCap = vehicle === 'staria' ? 7 : vehicle === 'staria_9' ? 9 : vehicle === 'sprinter' ? 15 : 45;

  // patch wrapper — paxCount를 항상 동기화
  const setAdult = (n: number) => {
    const next = Math.max(1, Math.min(paxCap - child, n));
    patch({ adultCount: next, paxCount: next + child });
  };
  const setChild = (n: number) => {
    const next = Math.max(0, Math.min(paxCap - adult, n));
    patch({ childCount: next, paxCount: adult + next });
  };

  return (
    <div className="space-y-7">
      {/* 어른 카운터 */}
      <div>
        <label className="block text-xs uppercase tracking-wider text-white/55 mb-3 font-semibold">{i18n.adultLabel}</label>
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => setAdult(adult - 1)}
            className="w-12 h-12 rounded-full bg-white/5 hover:bg-white/10 text-white/80 flex items-center justify-center transition-colors">
            <Minus className="w-5 h-5" />
          </button>
          <div className="flex-1 text-center text-3xl font-bold text-white">{adult}</div>
          <button type="button" onClick={() => setAdult(adult + 1)}
            className="w-12 h-12 rounded-full bg-white/5 hover:bg-white/10 text-white/80 flex items-center justify-center transition-colors">
            <Plus className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* 아이 카운터 */}
      <div>
        <label className="block text-xs uppercase tracking-wider text-white/55 mb-3 font-semibold">{i18n.childLabel}</label>
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => setChild(child - 1)}
            className="w-12 h-12 rounded-full bg-white/5 hover:bg-white/10 text-white/80 flex items-center justify-center transition-colors">
            <Minus className="w-5 h-5" />
          </button>
          <div className="flex-1 text-center text-3xl font-bold text-white">{child}</div>
          <button type="button" onClick={() => setChild(child + 1)}
            className="w-12 h-12 rounded-full bg-white/5 hover:bg-white/10 text-white/80 flex items-center justify-center transition-colors">
            <Plus className="w-5 h-5" />
          </button>
        </div>
        <p className="text-xs text-white/55 mt-3">
          {i18n.totalPaxNote(pax, paxCap)}
        </p>
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wider text-white/55 mb-3 font-semibold">
          {i18n.vehicleLabel} {recommended === vehicle && <span className="text-xs text-emerald-400 ml-1">({i18n.recommendedTag})</span>}
        </label>
        {/* 4-옵션: Staria 7인승 / Staria 9인승 / Sprinter / Bus. 모두 VEHICLE_TYPES 에 정보 존재. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(['staria', 'staria_9', 'sprinter', 'bus'] as VehicleType[]).map(v => {
            const selected = vehicle === v;
            const name = VEHICLE_TYPES[v].name[lang];
            return (
              <button
                key={v}
                type="button"
                onClick={() => patch({ vehicle: v })}
                className={`p-4 rounded-xl border text-center transition-all ${
                  selected ? 'border-[#B668FC] bg-[#B668FC]/10' : 'border-white/10 bg-white/[0.04] hover:border-[#B668FC]/40'
                }`}
              >
                {v === 'staria' || v === 'staria_9'
                  ? <Car className="w-6 h-6 mx-auto mb-2" />
                  : <Bus className="w-6 h-6 mx-auto mb-2" />}
                <p className="text-sm font-semibold">{name}</p>
                <p className="text-xs text-white/55 mt-1">{vehiclePaxRangeLabel(v, lang)}</p>
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
