import {
  Bus, CalendarDays, Car, Check, Eye, Globe2, GripVertical,
  Link as LinkIcon, Lock, Map, MapPin, Navigation, PencilLine, Plus, Route,
  Share2, Sparkles, Train, Utensils, Wand2,
} from 'lucide-react';

type BuilderStop = {
  id: number;
  time: string;
  type: string;
  title: string;
  detail: string;
};

const SAMPLE_STOPS: BuilderStop[] = [
  { id: 1, time: '15:00', type: 'Food', title: 'Hongdae BBQ restaurant', detail: 'Paste a Google/Naver place link or type the name' },
  { id: 2, time: '17:00', type: 'Nearby pick', title: 'Yeonnam-dong cafe street', detail: 'AI suggested because it is close and walkable' },
  { id: 3, time: '19:30', type: 'Show', title: 'Concert venue or address', detail: 'Fixed plan item from the traveler' },
];

const RECOMMENDATIONS = [
  { icon: Utensils, title: 'Nearby food', body: 'Add a dessert cafe within 10 minutes from stop 1.' },
  { icon: Navigation, title: 'Route tip', body: 'Stop 2 to stop 3 is cleaner by subway than taxi at rush hour.' },
  { icon: Sparkles, title: 'Local idea', body: 'Add a photo walk before dinner if the weather is clear.' },
];

const ADD_METHODS = [
  { icon: PencilLine, title: 'Type a place', body: 'Restaurant, hotel, venue, or address' },
  { icon: LinkIcon, title: 'Paste map link', body: 'Google Maps or Naver Map URL' },
  { icon: Sparkles, title: 'Ask AI nearby', body: 'Get ideas beside your fixed route' },
];

const TRANSIT_OPTIONS = [
  { icon: Train, label: 'Subway', meta: '14 min · ₩1,500', active: true },
  { icon: Car, label: 'Taxi', meta: '11 min · ₩9,800', active: false },
  { icon: Bus, label: 'Charter', meta: 'Comfort route', active: false },
];

export function CourseBuilderShell({ isMobile }: { isMobile: boolean }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_360px]">
      <section
        className="overflow-hidden rounded-[22px]"
        style={{
          background: 'rgba(255,255,255,0.035)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <div
          className="relative h-[220px] sm:h-[310px] overflow-hidden"
          style={{
            background:
              'linear-gradient(135deg, rgba(39,70,124,0.92), rgba(31,19,55,0.92)), radial-gradient(circle at 22% 30%, rgba(182,104,252,0.35), transparent 24%), radial-gradient(circle at 72% 65%, rgba(255,107,157,0.24), transparent 22%)',
          }}
        >
          <div className="absolute inset-0 opacity-35" style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
          }} />
          <div className="absolute left-[18%] top-[24%] flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-lime-300 text-[15px] font-black text-[#101522] shadow-lg">1</span>
            <span className="rounded-full bg-white/90 px-3 py-1 text-[12px] font-black text-[#101522]">Hongdae</span>
          </div>
          <div className="absolute left-[46%] top-[54%] flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-lime-300 text-[15px] font-black text-[#101522] shadow-lg">2</span>
            <span className="rounded-full bg-white/90 px-3 py-1 text-[12px] font-black text-[#101522]">Yeonnam</span>
          </div>
          <div className="absolute left-[68%] top-[34%] flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-lime-300 text-[15px] font-black text-[#101522] shadow-lg">3</span>
            <span className="rounded-full bg-white/90 px-3 py-1 text-[12px] font-black text-[#101522]">Venue</span>
          </div>
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <path d="M23 30 C35 42, 40 46, 49 58 S65 48, 72 38" fill="none" stroke="rgba(190,255,105,0.95)" strokeWidth="1.8" strokeLinecap="round" strokeDasharray="3 2" />
          </svg>
          <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2">
            <div className="rounded-2xl bg-black/45 px-3 py-2 backdrop-blur">
              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-white/50">Route preview</p>
              <p className="text-[13px] font-bold text-white">3 stops · 42 min moving</p>
            </div>
            <div className="flex gap-2">
              <button className="grid h-10 w-10 place-items-center rounded-full bg-white/90 text-[#101522]" type="button" aria-label="Map view">
                <Map className="h-4 w-4" />
              </button>
              <button className="grid h-10 w-10 place-items-center rounded-full bg-white/90 text-[#101522]" type="button" aria-label="Share route">
                <Share2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="p-3.5 sm:p-5">
          <div className="mb-4 flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {['Day 1', 'Day 2', 'Day 3', '+'].map((day, index) => (
              <button
                key={day}
                type="button"
                className={`h-10 shrink-0 rounded-full px-5 text-[13px] font-black ${index === 0 ? 'text-white' : 'text-white/55'}`}
                style={index === 0
                  ? { background: 'rgba(182,104,252,0.22)', border: '1px solid rgba(182,104,252,0.52)' }
                  : { background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                {day}
              </button>
            ))}
          </div>

          <div className="mb-4 grid gap-2 sm:grid-cols-[130px_1fr_120px]">
            <label className="rounded-2xl border border-white/[0.08] bg-white/[0.035] px-3 py-2">
              <span className="text-[10px] font-black uppercase tracking-[0.12em] text-white/40">Date</span>
              <span className="mt-1 flex items-center gap-2 text-[13px] font-bold text-white">
                <CalendarDays className="h-4 w-4 text-[#B668FC]" /> 2026.07.09
              </span>
            </label>
            <label className="rounded-2xl border border-white/[0.08] bg-white/[0.035] px-3 py-2">
              <span className="text-[10px] font-black uppercase tracking-[0.12em] text-white/40">Start from</span>
              <span className="mt-1 flex items-center gap-2 text-[13px] font-bold text-white">
                <MapPin className="h-4 w-4 text-[#B668FC]" /> Myeongdong hotel or address
              </span>
            </label>
            <button className="rounded-2xl text-[12px] font-black text-white" type="button" style={{ background: 'linear-gradient(135deg,#B668FC,#FF6B9D)' }}>
              Optimize
            </button>
          </div>

          <div className="mb-4 grid gap-2 sm:grid-cols-3">
            {ADD_METHODS.map(({ icon: Icon, title, body }) => (
              <button
                key={title}
                type="button"
                className="flex items-center gap-2.5 rounded-2xl p-3 text-left"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <span className="grid h-9 w-9 place-items-center rounded-2xl bg-white/[0.055] text-[#B668FC] shrink-0">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[12px] font-black text-white">{title}</span>
                  <span className="mt-0.5 block text-[10.5px] leading-snug text-white/42">{body}</span>
                </span>
              </button>
            ))}
          </div>

          <div
            className="mb-4 rounded-2xl p-3"
            style={{ background: 'rgba(182,104,252,0.055)', border: '1px solid rgba(182,104,252,0.15)' }}
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-[12px] font-black text-white">Move between stops</p>
              <p className="text-[10px] font-bold text-white/38">placeholder for route engine</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {TRANSIT_OPTIONS.map(({ icon: Icon, label, meta, active }) => (
                <button
                  key={label}
                  type="button"
                  className="flex items-center gap-2 rounded-xl px-3 py-2 text-left"
                  style={active
                    ? { background: 'rgba(182,104,252,0.18)', border: '1px solid rgba(182,104,252,0.36)' }
                    : { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-[#D9A8FF]' : 'text-white/45'}`} />
                  <span className="min-w-0">
                    <span className="block text-[11px] font-black text-white">{label}</span>
                    <span className="block text-[10px] text-white/42">{meta}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2.5">
            {SAMPLE_STOPS.map((stop, index) => (
              <div key={stop.id}>
                <div
                  className="flex gap-3 rounded-2xl p-3"
                  style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  <div className="flex flex-col items-center">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-lime-300 text-[13px] font-black text-[#101522]">{stop.id}</span>
                    <GripVertical className="mt-2 h-4 w-4 text-white/25" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-bold text-white/65">{stop.time}</span>
                      <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-purple-200">{stop.type}</span>
                    </div>
                    <p className="text-[14px] font-black text-white">{stop.title}</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-white/45">{stop.detail}</p>
                  </div>
                  <button type="button" className="self-start rounded-full border border-white/[0.10] px-3 py-1.5 text-[11px] font-bold text-white/65">
                    Edit
                  </button>
                </div>
                {index < SAMPLE_STOPS.length - 1 && (
                  <div className="ml-4 flex items-center gap-2 py-2 text-[11px] font-bold text-white/45">
                    <span className="h-5 w-px bg-white/15" />
                    <Route className="h-3.5 w-3.5 text-[#B668FC]" />
                    <span>Subway 8 min · walk 6 min</span>
                    <button className="text-[#B9A4FF]" type="button">Naver</button>
                    <button className="text-[#B9A4FF]" type="button">Google</button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <button
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/[0.18] bg-white/[0.025] py-3 text-[13px] font-black text-white/70"
            type="button"
          >
            <Plus className="h-4 w-4" /> Add place, address, or map link
          </button>
        </div>
      </section>

      <aside className="space-y-3">
        <div
          className="rounded-[22px] p-4"
          style={{
            background: 'linear-gradient(135deg, rgba(182,104,252,0.10), rgba(255,107,157,0.06))',
            border: '1px solid rgba(182,104,252,0.18)',
          }}
        >
          <div className="mb-3 flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-2xl" style={{ background: 'linear-gradient(135deg,#B668FC,#FF6B9D)' }}>
              <Wand2 className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="text-[14px] font-black text-white">AI route helper</p>
              <p className="text-[11px] text-white/45">Suggestions while you build</p>
            </div>
          </div>
          <div className="space-y-2">
            {RECOMMENDATIONS.map(({ icon: Icon, title, body }) => (
              <button
                key={title}
                type="button"
                className="w-full rounded-2xl p-3 text-left transition hover:bg-white/[0.04]"
                style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <div className="flex gap-2">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#B668FC]" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-black text-white">{title}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-white/48">{body}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className="rounded-full bg-lime-300/15 px-2 py-0.5 text-[10px] font-black text-lime-200">+ Add</span>
                      <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-bold text-white/55">Why?</span>
                      <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-bold text-white/55">Skip</span>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div
          className="rounded-[22px] p-4"
          style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <p className="text-[13px] font-black text-white">Share and publish</p>
          <p className="mt-1 text-[11px] leading-relaxed text-white/45">
            The final page can show the full map, day tabs, editable stops, share link, and Naver/Google route buttons.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className="flex items-center justify-center gap-1.5 rounded-xl border border-white/[0.10] py-2 text-[11px] font-bold text-white/65" type="button">
              <Lock className="h-3.5 w-3.5" /> Private
            </button>
            <button className="flex items-center justify-center gap-1.5 rounded-xl border border-white/[0.10] py-2 text-[11px] font-bold text-white/65" type="button">
              <Globe2 className="h-3.5 w-3.5" /> Public
            </button>
            <button className="flex items-center justify-center gap-1.5 rounded-xl border border-white/[0.10] py-2 text-[11px] font-bold text-white/65" type="button">
              <Eye className="h-3.5 w-3.5" /> Preview
            </button>
            <button className="flex items-center justify-center gap-1.5 rounded-xl py-2 text-[11px] font-black text-white" type="button" style={{ background: 'linear-gradient(135deg,#B668FC,#FF6B9D)' }}>
              <Check className="h-3.5 w-3.5" /> Share
            </button>
          </div>
        </div>
        {isMobile && (
          <p className="text-center text-[10px] leading-relaxed text-white/35">
            Shell only: map, AI suggestions, save, and share APIs are intentionally not connected yet.
          </p>
        )}
      </aside>
    </div>
  );
}
