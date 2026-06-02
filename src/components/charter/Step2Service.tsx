// Step 2: 서비스 유형 선택 (4지선다) — i18n 사전 기반
import { Plane, MapIcon, Mountain, Music2, ArrowLeftRight } from 'lucide-react';
import type { WizardState, ServiceMode } from './types';
import { getWizardI18n } from './wizard-i18n';

interface Props {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
  language?: 'ko' | 'en' | 'ja' | 'zh';
}

export function Step2Service({ state, patch, language = 'en' }: Props) {
  const i18n = getWizardI18n(language ?? 'en');
  // 도시간 transfer 타일은 VITE_FEATURE_TRANSFER_CHECKOUT ON 일 때만 노출 (OFF=기존 4지선다 byte-identical).
  const transferOn = import.meta.env.VITE_FEATURE_TRANSFER_CHECKOUT === 'true';
  const OPTIONS: Array<{ id: ServiceMode; title: string; desc: string; Icon: typeof Plane }> = [
    { id: 'airport_transfer', title: i18n.svcAirport,  desc: i18n.svcAirportDesc,  Icon: Plane },
    { id: 'day_tour',         title: i18n.svcDayTour,  desc: i18n.svcDayTourDesc,  Icon: MapIcon },
    { id: 'multi_day',        title: i18n.svcMultiDay, desc: i18n.svcMultiDayDesc, Icon: Mountain },
    { id: 'kpop_shuttle',     title: i18n.svcKpop,     desc: i18n.svcKpopDesc,     Icon: Music2 },
    ...(transferOn ? [{ id: 'transfer' as ServiceMode, title: i18n.svcTransfer, desc: i18n.svcTransferDesc, Icon: ArrowLeftRight }] : []),
  ];
  return (
    <div className="grid grid-cols-2 gap-3">
      {OPTIONS.map(opt => {
        const selected = state.service === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => patch({ service: opt.id })}
            className={`flex flex-col items-start p-4 rounded-xl border text-left transition-all ${
              selected
                ? 'border-[#B668FC] bg-gradient-to-br from-[#B668FC]/15 to-[#FF6B9D]/10'
                : 'border-white/10 bg-white/[0.04] hover:border-[#B668FC]/40'
            }`}
          >
            <opt.Icon className={`w-5 h-5 mb-2 ${selected ? 'text-[#B668FC]' : 'text-white/50'}`} />
            <p className={`text-sm font-semibold ${selected ? 'text-white' : 'text-white/80'}`}>{opt.title}</p>
            <p className="text-[11px] text-white/55 mt-1 leading-snug">{opt.desc}</p>
          </button>
        );
      })}
    </div>
  );
}
