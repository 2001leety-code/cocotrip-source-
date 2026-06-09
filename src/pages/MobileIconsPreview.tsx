import { usePageMeta } from '@/hooks/usePageMeta';

// 커스텀 아이콘 미리보기 (운영자 검토용). public/images/icons/ 의 15종을 다크 테마에 표시.
// 별도 프리뷰 라우트 /preview/icons 에서만 렌더. 라이브 무영향.

const ICONS: { name: string; label: string }[] = [
  { name: 'ai-planner', label: 'AI Planner' },
  { name: 'tours', label: 'Tours' },
  { name: 'charter', label: 'Charter' },
  { name: 'airport', label: 'Airport' },
  { name: 'kpop', label: 'K-pop' },
  { name: 'food', label: 'Food' },
  { name: 'hotel', label: 'Hotel' },
  { name: 'ticket', label: 'Ticket' },
  { name: 'shopping', label: 'Shopping' },
  { name: 'photo', label: 'Photo' },
  { name: 'train', label: 'KTX / Train' },
  { name: 'culture', label: 'Culture' },
  { name: 'translation', label: 'Translation' },
  { name: 'tax-refund', label: 'Tax Refund' },
  { name: 'emergency', label: 'Emergency' },
];

export default function MobileIconsPreview() {
  usePageMeta({
    title: 'Custom Icons Preview',
    description: 'CocoTrip custom icon set preview.',
  });

  return (
    <div className="min-h-screen bg-[#0a0b14] text-white pt-[max(env(safe-area-inset-top),0.75rem)] pb-12 max-w-md mx-auto">
      <header className="px-5 pt-4 pb-1">
        <h1 className="text-xl font-bold">Custom Icons</h1>
        <p className="mt-0.5 text-sm text-white/50">15 icons (purple theme, transparent PNG)</p>
      </header>

      {/* Categories (홈 카테고리 5종) */}
      <section className="px-5 pt-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-purple-300/80">Categories</h2>
        <div className="grid grid-cols-3 gap-2.5">
          {ICONS.slice(0, 6).map((ic) => (
            <IconCard key={ic.name} name={ic.name} label={ic.label} />
          ))}
        </div>
      </section>

      {/* Services / Utilities (나머지) */}
      <section className="px-5 pt-5">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-purple-300/80">Services</h2>
        <div className="grid grid-cols-3 gap-2.5">
          {ICONS.slice(6).map((ic) => (
            <IconCard key={ic.name} name={ic.name} label={ic.label} />
          ))}
        </div>
      </section>

      <p className="px-5 pt-6 text-center text-xs text-white/30">
        public/images/icons/&lt;name&gt;.png
      </p>
    </div>
  );
}

function IconCard({ name, label }: { name: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-2xl bg-white/[0.04] py-3.5">
      <img
        src={`/images/icons/${name}.png`}
        alt={label}
        className="h-16 w-16 object-contain drop-shadow-lg"
        loading="lazy"
      />
      <span className="text-center text-[11px] leading-tight text-white/70">{label}</span>
    </div>
  );
}
