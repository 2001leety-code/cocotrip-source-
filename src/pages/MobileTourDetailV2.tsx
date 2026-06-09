import {
  ChevronLeft, Heart, Star, Clock, Users, MapPin, Check,
} from 'lucide-react';
import { usePageMeta } from '@/hooks/usePageMeta';

/**
 * 모바일 v2 투어 상세 - talabat 투어상세 스타일(풀폭 히어로 + sticky 예약 바).
 * (project_cocotrip_mobile_redesign 메모리: 다크 #0a0b14 + 퍼플 절제 + 단색 라인 아이콘.)
 *
 * 자급자족: 모든 데이터 하드코딩(샘플). auth/Firestore/props 불필요.
 * 라우트 연결 + 검증은 메인 작업. 본 파일은 컴포넌트 1개만 정의.
 */

const HIGHLIGHTS = [
  'Gyeongbokgung Palace',
  'Bukchon Hanok Village',
  'Myeongdong shopping',
  'Private vehicle + driver',
];

const REVIEWS = [
  {
    name: 'Emma L.',
    initials: 'EL',
    rating: 5,
    text: 'Our driver was so kind and the palace was breathtaking. Felt completely taken care of all day.',
    gradient: 'from-purple-500 to-pink-500',
  },
  {
    name: 'Kenji T.',
    initials: 'KT',
    rating: 5,
    text: 'Perfect pace, no rushing. Bukchon at golden hour was unforgettable. Highly recommend.',
    gradient: 'from-pink-500 to-purple-500',
  },
  {
    name: 'Sofia M.',
    initials: 'SM',
    rating: 4,
    text: 'Great private tour, very flexible with our schedule. Myeongdong was packed but fun.',
    gradient: 'from-purple-500 to-indigo-500',
  },
];

export default function MobileTourDetailV2() {
  usePageMeta({
    title: 'Seoul City Full-Day Tour',
    description: 'Private full-day Seoul tour - palaces, hanok village & Myeongdong with your own driver.',
  });

  return (
    <div className="min-h-screen bg-[#0a0b14] text-white pb-24 max-w-md mx-auto">
      {/* -- 풀폭 히어로 사진 + 오버레이 컨트롤 -- */}
      <div className="relative h-80 w-full overflow-hidden">
        <img
          src="/region-seoul.jpg"
          alt="Seoul City Full-Day Tour"
          className="absolute inset-0 h-full w-full object-cover"
        />
        {/* 하단 그라데이션 오버레이 (페이지 bg 로 자연스럽게 연결) */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0b14] via-[#0a0b14]/20 to-black/30" />

        {/* 상단 컨트롤: 뒤로가기 / 하트 */}
        <div className="absolute inset-x-0 top-0 flex items-center justify-between px-5 pt-5">
          <button
            type="button"
            aria-label="Back"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm active:scale-95 transition-transform"
          >
            <ChevronLeft size={22} className="text-white" />
          </button>
          <button
            type="button"
            aria-label="Save to favorites"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm active:scale-95 transition-transform"
          >
            <Heart size={20} className="text-white" />
          </button>
        </div>
      </div>

      {/* -- 투어 정보 블록 -- */}
      <section className="-mt-6 relative px-5">
        <h1 className="text-2xl font-bold leading-tight tracking-tight">
          Seoul City Full-Day Tour
        </h1>

        {/* 별점 줄 */}
        <div className="mt-2 flex items-center gap-1.5">
          <Star size={16} className="fill-yellow-400 text-yellow-400" />
          <span className="text-sm font-semibold">4.9</span>
          <span className="text-sm text-white/50">(128 reviews)</span>
        </div>

        {/* 칩 3개 */}
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.07] px-3 py-1.5 text-xs font-medium text-white/80">
            <Clock size={14} className="text-purple-300" /> 8 hours
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.07] px-3 py-1.5 text-xs font-medium text-white/80">
            <Users size={14} className="text-purple-300" /> 1-7 people
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.07] px-3 py-1.5 text-xs font-medium text-white/80">
            <MapPin size={14} className="text-purple-300" /> Seoul
          </span>
        </div>
      </section>

      {/* -- 하이라이트 (What's included) -- */}
      <section className="px-5 pt-7">
        <h2 className="mb-3 text-lg font-bold">What's included</h2>
        <ul className="space-y-3">
          {HIGHLIGHTS.map((item) => (
            <li key={item} className="flex items-center gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-pink-500 shadow-sm shadow-purple-500/30">
                <Check size={15} className="text-white" />
              </span>
              <span className="text-sm text-white/85">{item}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* -- 리뷰 -- */}
      <section className="px-5 pt-7">
        <h2 className="mb-3 text-lg font-bold">Reviews</h2>
        <div className="space-y-3">
          {REVIEWS.map((r) => (
            <div key={r.name} className="rounded-2xl bg-white/[0.05] p-4">
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${r.gradient} text-sm font-bold text-white`}
                >
                  {r.initials}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-tight">{r.name}</p>
                  <div className="mt-0.5 flex items-center gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        size={12}
                        className={
                          i < r.rating
                            ? 'fill-yellow-400 text-yellow-400'
                            : 'fill-white/15 text-white/15'
                        }
                      />
                    ))}
                  </div>
                </div>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-white/70">{r.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* -- sticky 하단 예약 바 -- */}
      <div className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md border-t border-white/10 bg-[#0a0b14]/95 px-5 py-3 backdrop-blur-md">
        <div className="flex items-center justify-between">
          <div className="leading-tight">
            <span className="block text-[11px] text-white/50">from</span>
            <span className="text-2xl font-bold">$129</span>
          </div>
          <button
            type="button"
            className="rounded-full bg-gradient-to-r from-purple-500 to-pink-500 px-8 py-3 text-sm font-semibold shadow-lg shadow-purple-500/30 active:scale-95 transition-transform"
          >
            Book Now
          </button>
        </div>
      </div>
    </div>
  );
}
