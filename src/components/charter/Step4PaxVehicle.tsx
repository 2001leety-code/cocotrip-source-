// Step 4: 인원 (어른/아이) + 차종 자동 추천 · i18n
import { Car, Bus, AlertTriangle, Minus, Plus } from 'lucide-react';
import { VEHICLE_TYPES } from '@/data/charterPricing';
import type { WizardState, VehicleType } from './types';
import { getWizardI18n } from './wizard-i18n';

function recommendVehicle(pax: number): VehicleType {
  if (pax <= 8)  return 'staria';
  if (pax <= 15) return 'sprinter';
  return 'bus';
}

// 차종별 인원 범위 표기
function vehiclePaxRangeLabel(v: VehicleType, lang: 'ko' | 'en'): string {
  if (v === 'staria') return lang === 'ko' ? '1~8인' : '1-8 pax';
  if (v === 'sprinter') return lang === 'ko' ? '9~15인' : '9-15 pax';
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
  const paxCap = vehicle === 'staria' ? 8 : vehicle === 'sprinter' ? 15 : 45;

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
    <div className="space-y-5">
      {/* 어른 카운터 */}
      <div>
        <label className="block text-[11px] uppercase tracking-wider text-white/55 mb-2">{i18n.adultLabel}</label>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setAdult(adult - 1)}
            className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 text-white/70 flex items-center justify-center">
            <Minus className="w-4 h-4" />
          </button>
          <div className="flex-1 text-center text-2xl font-bold text-white">{adult}</div>
          <button type="button" onClick={() => setAdult(adult + 1)}
            className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 text-white/70 flex items-center justify-center">
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 아이 카운터 */}
      <div>
        <label className="block text-[11px] uppercase tracking-wider text-white/55 mb-2">{i18n.childLabel}</label>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setChild(child - 1)}
            className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 text-white/70 flex items-center justify-center">
            <Minus className="w-4 h-4" />
          </button>
          <div className="flex-1 text-center text-2xl font-bold text-white">{child}</div>
          <button type="button" onClick={() => setChild(child + 1)}
            className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 text-white/70 flex items-center justify-center">
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[11px] text-white/55 mt-2">
          {i18n.totalPaxNote(pax, paxCap)}
        </p>
      </div>

      <div>
        <label className="block text-[11px] uppercase tracking-wider text-white/55 mb-2">
          {i18n.vehicleLabel} {recommended === vehicle && <span className="text-[10px] text-emerald-400 ml-1">({i18n.recommendedTag})</span>}
        </label>
        <div className="grid grid-cols-3 gap-3">
          {(['staria', 'sprinter', 'bus'] as VehicleType[]).map(v => {
            const info = VEHICLE_TYPES[v];
            const selected = vehicle === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => patch({ vehicle: v })}
                className={`p-3 rounded-xl border text-center transition-all ${
                  selected ? 'border-[#B668FC] bg-[#B668FC]/10' : 'border-white/10 bg-white/[0.04] hover:border-[#B668FC]/40'
                }`}
              >
                {v === 'staria' ? <Car className="w-5 h-5 mx-auto mb-1" /> : <Bus className="w-5 h-5 mx-auto mb-1" />}
                <p className="text-xs font-semibold">{info.name[lang]}</p>
                <p className="text-[10px] text-white/55 mt-1">{vehiclePaxRangeLabel(v, lang)}</p>
              </button>
            );
          })}
        </div>
      </div>

      {(vehicle === 'sprinter' || vehicle === 'bus') && (
        <div className="flex items-start gap-2.5 bg-amber-500/10 border border-amber-500/25 rounded-xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-200/80 leading-relaxed">{i18n.legalGuideWarn}</p>
        </div>
      )}
    </div>
  );
}
