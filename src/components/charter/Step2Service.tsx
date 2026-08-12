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
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
      {OPTIONS.map(opt => {
        const selected = state.service === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            data-testid="charter-service-card"
            data-service={opt.id}
            onClick={() => patch({ service: opt.id })}
            className={`group flex min-h-[48px] items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left transition-all sm:min-h-[118px] sm:items-start sm:gap-4 sm:rounded-2xl sm:p-4 ${
              selected
                ? 'border-[#B668FC] bg-gradient-to-br from-[#B668FC]/18 to-[#FF6B9D]/10 shadow-[0_16px_40px_rgba(124,92,252,0.16)]'
                : 'border-white/10 bg-white/[0.035] hover:border-[#B668FC]/40 hover:bg-white/[0.055]'
            }`}
          >
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border sm:h-11 sm:w-11 sm:rounded-2xl ${
              selected ? 'border-[#B668FC]/35 bg-[#B668FC]/20 text-[#D8C0FF]' : 'border-white/10 bg-white/[0.035] text-white/45 group-hover:text-white/70'
            }`}>
              <opt.Icon className="h-3.5 w-3.5 sm:h-5 sm:w-5" />
            </span>
            <span className="min-w-0 pt-0.5">
              <span className={`block text-xs font-bold leading-tight sm:text-[15px] ${selected ? 'text-white' : 'text-white/82'}`}>{opt.title}</span>
              <span className="mt-0.5 block truncate text-[9px] leading-relaxed text-white/55 sm:mt-2 sm:line-clamp-2 sm:text-xs">{opt.desc}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
