// LodgingBookend — Day 시작/끝의 숙소 출발/복귀 카드.
// 2026-05-08 신규: 사용자 신고 "AI 플랜에 숙소 출발/복귀가 안 보임".
// RouteAgent 가 day.lodging_to_first / day.last_to_lodging 에 ODsay 환승 경로를
// 채워 두면, 이 컴포넌트가 첫 stop 위 / 마지막 stop 아래에 호텔 라벨 + 시간 + 메소드를
// 보여 준다. 호텔/zone anchor 좌표가 없거나 단일 stop day 면 자연스럽게 미노출.
//
// TransitArrow 를 그대로 재사용해서 시각 일관성 유지 — 라벨만 "🏨 숙소" 로 바꿈.
import { Hotel, ArrowDown, Home } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import type { TransitFromPrev } from '@/types/plan';
import { TransitArrow } from './TransitArrow';
import { getPlanDetailDict } from '../types';

export type LodgingBookendVariant = 'depart' | 'return';

interface Props {
  /** RouteAgent attached transit (day.lodging_to_first or day.last_to_lodging). */
  transit: TransitFromPrev | Record<string, unknown> | null | undefined;
  variant: LodgingBookendVariant;
  /** Hotel display name — falls back to "Hotel" / "숙소". */
  lodgingLabel?: string;
  /** Destination/origin stop name shown opposite the hotel label. */
  otherLabel?: string;
}

function LODGING_TEXT(language: string, key: 'departHeading' | 'returnHeading' | 'departLabel' | 'returnLabel' | 'noLodging') {
  const dict: Record<string, Record<string, string>> = {
    ko: {
      departHeading: '숙소에서 출발',
      returnHeading: '숙소로 복귀',
      departLabel: '숙소',
      returnLabel: '숙소',
      noLodging: '숙소 정보를 입력하시면 출발 시간이 정확히 계산됩니다.',
    },
    en: {
      departHeading: 'Depart from your stay',
      returnHeading: 'Return to your stay',
      departLabel: 'Stay',
      returnLabel: 'Stay',
      noLodging: 'Add your hotel address for exact departure time.',
    },
    ja: {
      departHeading: '宿泊先から出発',
      returnHeading: '宿泊先へ戻る',
      departLabel: '宿泊先',
      returnLabel: '宿泊先',
      noLodging: '宿泊先を入力すると正確な出発時刻が計算されます。',
    },
    zh: {
      departHeading: '从住宿出发',
      returnHeading: '返回住宿',
      departLabel: '住宿',
      returnLabel: '住宿',
      noLodging: '填写住宿地址可计算精确出发时间。',
    },
  };
  return dict[language]?.[key] || dict.en[key];
}

export function LodgingBookend({ transit, variant, lodgingLabel, otherLabel }: Props) {
  const { t, language } = useLanguage();
  const pd = getPlanDetailDict(t);

  if (!transit) return null;

  const isDepart = variant === 'depart';
  const heading = LODGING_TEXT(language, isDepart ? 'departHeading' : 'returnHeading');
  const dictLabel = LODGING_TEXT(language, isDepart ? 'departLabel' : 'returnLabel');
  // Fallback chain: explicit prop > i18n dict (planDetail.lodging.label) > builtin
  const stayLabel = lodgingLabel
    || (pd.lodging as Record<string, string> | undefined)?.label
    || dictLabel;
  const Icon = isDepart ? Hotel : Home;

  // 카드 헤더: "🏨 숙소" + 화살표 → otherLabel
  return (
    <div className="my-3">
      <div
        className="rounded-xl border px-3 py-2.5 mb-1"
        style={{
          background: 'linear-gradient(135deg, rgba(124,92,252,0.10), rgba(234,83,126,0.06))',
          borderColor: 'rgba(124,92,252,0.25)',
        }}
      >
        <div className="flex items-center gap-2 mb-1">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)' }}
          >
            <Icon className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-bold uppercase tracking-wider text-[#7C5CFC]/80">
              {heading}
            </p>
            <p className="text-[14px] text-white/75 truncate">
              {isDepart ? (
                <>
                  <span className="font-semibold text-white">{stayLabel}</span>
                  <ArrowDown className="inline w-3 h-3 mx-1 text-white/60" />
                  <span>{otherLabel || ''}</span>
                </>
              ) : (
                <>
                  <span>{otherLabel || ''}</span>
                  <ArrowDown className="inline w-3 h-3 mx-1 text-white/60" />
                  <span className="font-semibold text-white">{stayLabel}</span>
                </>
              )}
            </p>
          </div>
        </div>
      </div>
      {/* TransitArrow 재사용 — ODsay step-by-step 동일 시각. */}
      <TransitArrow transit={transit as TransitFromPrev & Record<string, unknown>} destinationName={isDepart ? otherLabel : stayLabel} />
    </div>
  );
}
