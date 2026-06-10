import { usePageMeta } from '@/hooks/usePageMeta';

// 커스텀 아이콘 미리보기 (운영자 검토용). public/images/icons/ 의 47종을 다크 테마에 표시.
// 별도 프리뷰 라우트 /preview/icons 에서만 렌더. 라이브 무영향.

type Icon = { name: string; label: string };

const CATEGORIES: Icon[] = [
  { name: 'ai-planner', label: 'AI Planner' },
  { name: 'tours', label: 'Tours' },
  { name: 'charter', label: 'Charter' },
  { name: 'airport', label: 'Airport' },
  { name: 'kpop', label: 'K-pop' },
];

const ACTIVITIES: Icon[] = [
  { name: 'bike', label: 'Bike (Ttareungi)' },
  { name: 'trekking', label: 'Trekking' },
  { name: 'running', label: 'Running' },
];

const PLACES: Icon[] = [
  { name: 'palace', label: 'Palace' },
  { name: 'market', label: 'Market' },
  { name: 'nature', label: 'Mountain' },
  { name: 'island', label: 'Island / Jeju' },
  { name: 'beach', label: 'Beach' },
  { name: 'nightview', label: 'Night View' },
  { name: 'themepark', label: 'Theme Park' },
  { name: 'temple', label: 'Temple' },
  { name: 'hanok', label: 'Hanok' },
  { name: 'han-river', label: 'Han River' },
];

const SERVICES: Icon[] = [
  { name: 'food', label: 'Food' },
  { name: 'hotel', label: 'Hotel' },
  { name: 'ticket', label: 'Ticket' },
  { name: 'shopping', label: 'Shopping' },
  { name: 'photo', label: 'Photo' },
  { name: 'train', label: 'KTX / Train' },
  { name: 'subway', label: 'Subway' },
  { name: 'transit-card', label: 'T-money' },
  { name: 'culture', label: 'Culture' },
  { name: 'translation', label: 'Translation' },
  { name: 'tax-refund', label: 'Tax Refund' },
  { name: 'emergency', label: 'Emergency' },
  { name: 'weather', label: 'Weather' },
  { name: 'currency', label: 'Currency' },
  { name: 'esim', label: 'eSIM' },
  { name: 'beauty', label: 'K-Beauty' },
  { name: 'cafe', label: 'Cafe' },
];

// 예약·지원 12종 (2026-06-10 추가) — 결제/예약 플로우 + 고객지원용.
const BOOKING: Icon[] = [
  { name: 'taxi', label: 'Taxi' },
  { name: 'luggage', label: 'Luggage Storage' },
  { name: 'coupon', label: 'Coupon' },
  { name: 'review', label: 'Review' },
  { name: 'calendar', label: 'Calendar' },
  { name: 'group', label: 'Group / Travelers' },
  { name: 'chat', label: 'Chat' },
  { name: 'support', label: 'Support' },
  { name: 'driver', label: 'Driver' },
  { name: 'payment', label: 'Payment' },
  { name: 'passport', label: 'Passport' },
  { name: 'pharmacy', label: 'Pharmacy' },
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
        <p className="mt-0.5 text-sm text-white/50">47 icons (purple theme, transparent PNG)</p>
      </header>

      <IconSection title="Categories" icons={CATEGORIES} />
      <IconSection title="Activities" icons={ACTIVITIES} />
      <IconSection title="Places" icons={PLACES} />
      <IconSection title="Services" icons={SERVICES} />
      <IconSection title="Booking & Support" icons={BOOKING} />

      <p className="px-5 pt-6 text-center text-xs text-white/30">
        public/images/icons/&lt;name&gt;.png
      </p>
    </div>
  );
}

function IconSection({ title, icons }: { title: string; icons: Icon[] }) {
  return (
    <section className="px-5 pt-4">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-purple-300/80">
        {title} <span className="text-white/30">({icons.length})</span>
      </h2>
      <div className="grid grid-cols-3 gap-2.5">
        {icons.map((ic) => (
          <IconCard key={ic.name} name={ic.name} label={ic.label} />
        ))}
      </div>
    </section>
  );
}

function IconCard({ name, label }: Icon) {
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
