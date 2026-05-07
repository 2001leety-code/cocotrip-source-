// Step 4: 인원 (어른/아이) + 차종 자동 추천 · i18n
// 2026-05-07: vip(의전 차량) 추가 — bus 와 동일하게 즉시 결제 X, 상담 폼 진행.
import { Car, Bus, Crown, AlertTriangle, Minus, Plus } from 'lucide-react';
import { VEHICLE_TYPES } from '@/data/charterPricing';
import type { WizardState, VehicleType } from './types';
import { getWizardI18n } from './wizard-i18n';

function recommendVehicle(pax: number): VehicleType {
  if (pax <= 8)  return 'staria';
  if (pax <= 15) return 'sprinter';
  return 'bus';
}

// 차종별 인원 범위 표기 (vip 는 인원 무관 행사 의전).
function vehiclePaxRangeLabel(v: VehicleType, lang: 'ko' | 'en'): string {
  if (v === 'staria') return lang === 'ko' ? '1~7인' : '1-7 pax';
  if (v === 'sprinter') return lang === 'ko' ? '8~15인' : '8-15 pax';
  if (v === 'bus') return lang === 'ko' ? '16인 이상' : '16+ pax';
  return lang === 'ko' ? '의전 (행사 협의)' : 'Protocol (inquiry)';
}

// vip 라벨/설명 — i18n locale 키가 없을 때 lang 별 fallback.
function vipLabel(lang: 'ko' | 'en' | 'ja' | 'zh'): { name: string; desc: string } {
  if (lang === 'ko') return { name: '의전 차량', desc: '행사 의전용 — 협의' };
  if (lang === 'ja') return { name: 'VIPプロトコル', desc: '行事用VIP — 要相談' };
  if (lang === 'zh') return { name: '礼宾车', desc: '活动礼宾 — 需协商' };
  return { name: 'VIP Protocol', desc: 'Event protocol — Inquiry only' };
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
  // vip 는 행사 의전이라 인원 캡 무관 (사용자가 자유롭게 입력 — 협의 진행).
  const paxCap = vehicle === 'staria' ? 8 : vehicle === 'sprinter' ? 15 : vehicle === 'bus' ? 45 : 99;
  const langCode: 'ko' | 'en' | 'ja' | 'zh' =
    language === 'ko' ? 'ko' : language === 'ja' ? 'ja' : language === 'zh' ? 'zh' : 'en';
  const vip = vipLabel(langCode);

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
        {/* 4-옵션: Staria / Sprinter / Bus / VIP. vip 는 정보가 VEHICLE_TYPES 에 없어 fallback. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(['staria', 'sprinter', 'bus', 'vip'] as VehicleType[]).map(v => {
            const selected = vehicle === v;
            const isVip = v === 'vip';
            const name = isVip ? vip.name : VEHICLE_TYPES[v as 'staria' | 'sprinter' | 'bus'].name[lang];
            return (
              <button
                key={v}
                type="button"
                onClick={() => patch({ vehicle: v })}
                className={`p-4 rounded-xl border text-center transition-all ${
                  selected ? 'border-[#B668FC] bg-[#B668FC]/10' : 'border-white/10 bg-white/[0.04] hover:border-[#B668FC]/40'
                }`}
              >
                {v === 'staria' ? <Car className="w-6 h-6 mx-auto mb-2" /> :
                 v === 'vip' ? <Crown className="w-6 h-6 mx-auto mb-2" /> :
                 <Bus className="w-6 h-6 mx-auto mb-2" />}
                <p className="text-sm font-semibold">{name}</p>
                <p className="text-xs text-white/55 mt-1">{vehiclePaxRangeLabel(v, lang)}</p>
              </button>
            );
          })}
        </div>
      </div>

      {(vehicle === 'sprinter' || vehicle === 'bus') && (
        <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/25 rounded-xl px-4 py-4">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-200/85 leading-relaxed">{i18n.legalGuideWarn}</p>
        </div>
      )}

      {vehicle === 'vip' && (
        <div className="flex items-start gap-3 bg-[#B668FC]/10 border border-[#B668FC]/25 rounded-xl px-4 py-4">
          <Crown className="w-5 h-5 text-[#B668FC] shrink-0 mt-0.5" />
          <p className="text-sm text-white/80 leading-relaxed">{vip.desc}</p>
        </div>
      )}
    </div>
  );
}
