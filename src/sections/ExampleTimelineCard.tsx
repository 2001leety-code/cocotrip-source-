// 광고 랜딩 "지역별 예시 플랜" 전용 타임라인 카드 (2026-06-28).
//   운영자 지적: 기존 "시간|명소|팁" 3컬럼 표는 경쟁사 AI와 똑같이 평범.
//   → 실제 플랜(PlanDetailPage)의 풍부함을 압축 재현:
//      ① 번호핀(①②③) 동선  ② 구간별 교통(지하철 호선/버스/도보/차량 + 소요분)
//      ③ 분단위 시각  ④ 지도 링크(실재 좌표)
//   ⚠️ 실제 PlanDetailPage/StopCard/TransitArrow 코드는 건드리지 않음 — 예시 전용 컴포넌트.
//   "예시" 배지는 상위 섹션(ExampleItinerariesSection)에서 유지.
import { MapPin, Train, Bus, Footprints, Car, Sparkles } from 'lucide-react';
import type { ExamplePlan, ExampleStop, ExampleTransit, ExampleTransitMode, ExamplePlanI18n } from '@/data/example-plans';

type Lang = keyof ExamplePlanI18n;

/** 구간 교통 mode → 아이콘. 실제 플랜 TRANSIT_ICON 매핑과 의미 일치. */
const TRANSIT_ICON: Record<ExampleTransitMode, typeof Train> = {
  subway: Train,
  bus: Bus,
  walk: Footprints,
  car: Car,
  'subway+bus': Train,
};

/** mode 별 강조색(실제 플랜 색감 차용: 지하철=보라, 버스=초록, 도보=앰버, 차량=중립). */
function transitTone(mode: ExampleTransitMode): { text: string; bg: string; border: string; icon: string } {
  switch (mode) {
    case 'bus':
      return { text: 'text-green-300', bg: 'bg-green-500/[0.07]', border: 'border-green-500/20', icon: 'text-green-400' };
    case 'walk':
      return { text: 'text-amber-200', bg: 'bg-amber-400/[0.07]', border: 'border-amber-400/20', icon: 'text-amber-300' };
    case 'car':
      return { text: 'text-[#9FB4D8]', bg: 'bg-white/[0.04]', border: 'border-white/10', icon: 'text-[#9FB4D8]' };
    case 'subway':
    case 'subway+bus':
    default:
      return { text: 'text-[#C9B6FF]', bg: 'bg-[#7C5CFC]/[0.08]', border: 'border-[#7C5CFC]/20', icon: 'text-[#9F7BFF]' };
  }
}

function TransitSegment({ transit, lang }: { transit: ExampleTransit; lang: Lang }) {
  const tone = transitTone(transit.mode);
  const Icon = TRANSIT_ICON[transit.mode] || Car;
  return (
    <div className="relative pl-5 py-1">
      {/* 구간을 잇는 점선 느낌 — 타임라인 선 위에 교통 칩 */}
      <div className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 border ${tone.bg} ${tone.border}`}>
        <Icon className={`w-3.5 h-3.5 shrink-0 ${tone.icon}`} aria-hidden />
        <span className={`text-[11.5px] font-medium leading-tight ${tone.text}`}>{transit.label[lang]}</span>
      </div>
    </div>
  );
}

function StopRow({ stop, index, lang }: { stop: ExampleStop; index: number; lang: Lang }) {
  const name = stop.name[lang];
  const tip = stop.tip[lang];
  // 실재 좌표로 지도 링크 — 명소명 검색보다 정확(핀 일치).
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}`;
  return (
    <div className="relative pl-9">
      {/* 번호 핀 — 실제 플랜 지도의 번호 마커를 타임라인에 재현 */}
      <span
        className="absolute left-0 top-1 w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold text-white shadow-[0_0_10px_rgba(124,92,252,0.45)]"
        style={{ background: 'linear-gradient(135deg, #7C5CFC, #EA537E)' }}
        aria-hidden
      >
        {index + 1}
      </span>
      <div className="bg-white/[0.04] rounded-xl px-3.5 py-2.5 border border-white/[0.08]">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-bold shrink-0 text-[#B668FC]">{stop.time}</span>
          <span className="font-bold text-white text-[14px] flex-1 leading-tight">{name}</span>
          <a
            href={mapUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 inline-flex items-center gap-0.5 text-[11px] font-medium text-[#B668FC] hover:opacity-80 transition-opacity"
            aria-label={`${name} map`}
          >
            <MapPin className="w-3 h-3" aria-hidden />
          </a>
        </div>
        {tip && <p className="text-[12px] text-white/60 mt-1 leading-relaxed">{tip}</p>}
      </div>
    </div>
  );
}

const HEAD: Record<Lang, { theme: string; narrative: string; routeNote: string }> = {
  ko: { theme: '테마', narrative: '한 줄 소개', routeNote: '구간별 교통 · 실재 좌표 포함' },
  en: { theme: 'Theme', narrative: 'In a nutshell', routeNote: 'Segment-by-segment transit · real coordinates' },
  ja: { theme: 'テーマ', narrative: '一言紹介', routeNote: '区間ごとの交通 · 実在の座標つき' },
  zh: { theme: '主题', narrative: '一句话介绍', routeNote: '逐段交通 · 含真实坐标' },
};

export function ExampleTimelineCard({ plan, lang }: { plan: ExamplePlan; lang: Lang }) {
  const H = HEAD[lang];
  const themes = plan.themes[lang];

  return (
    <div className="h-full bg-gradient-to-br from-[#1a0f14] to-[#0a1628] rounded-2xl p-5 border border-[#7C5CFC]/30 shadow-[0_0_20px_rgba(124,92,252,0.18)]">
      {/* 헤더 */}
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="w-4 h-4 text-[#7C5CFC]" aria-hidden />
        <span className="text-[12px] font-bold text-[#FF6B9D]">
          {H.theme}: {themes.join(', ')}
        </span>
      </div>

      {/* 내러티브 */}
      <div className="text-[12.5px] text-white/80 leading-relaxed mb-3 bg-white/5 p-3 rounded-xl border border-white/10">
        <strong className="text-white block mb-1 text-[11px] uppercase tracking-wide opacity-70">{H.narrative}</strong>
        {plan.narrative[lang]}
      </div>

      {/* 동선 안내 한 줄 — "실제 플랜처럼" 차별점 명시 */}
      <p className="text-[11px] text-[#9FB4D8] mb-3 flex items-center gap-1.5">
        <Train className="w-3 h-3 text-[#9F7BFF]" aria-hidden />
        {H.routeNote}
      </p>

      {/* 타임라인 + 구간 교통 */}
      <div className="relative">
        {/* 세로 타임라인 선 */}
        <div
          className="absolute left-[13px] top-3 bottom-3 w-px bg-gradient-to-b from-[#7C5CFC]/60 via-[#B668FC]/40 to-[#EA537E]/30"
          aria-hidden
        />
        <ol className="space-y-1 list-none">
          {plan.stops.map((stop, i) => (
            <li key={i} className="list-none">
              {/* 이전 stop → 이 stop 구간 교통(첫 stop 제외) */}
              {stop.transit && <TransitSegment transit={stop.transit} lang={lang} />}
              <StopRow stop={stop} index={i} lang={lang} />
            </li>
          ))}
        </ol>
      </div>

      {/* 총 정거장 수 작은 푸터 */}
      <p className="text-[10.5px] text-white/40 mt-3 text-right">
        {plan.stops.length}
        {lang === 'ko' ? '곳 · 1일차' : lang === 'ja' ? 'ヶ所 · 1日目' : lang === 'zh' ? '处 · 第1天' : ' stops · Day 1'}
      </p>
    </div>
  );
}
