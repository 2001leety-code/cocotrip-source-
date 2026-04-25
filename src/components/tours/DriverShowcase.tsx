// DriverShowcase — TourDetailPage에 노출되는 추천 운전기사 카드.
// tour.driverLanguages와 매칭되는 드라이버 우선 정렬, 최대 3명 표시.
import { Star, Languages, Award, Users } from 'lucide-react';
import { DRIVERS } from '@/data/drivers';
import type { Driver } from '@/data/drivers';
import type { I18nString, DriverLanguage } from '@/data/tours';
import type { Language } from '@/i18n';

const DRIVER_LANG_LABEL: Record<DriverLanguage, string> = { en: 'EN', ja: 'JA', zh: 'ZH' };

const SECTION_LABEL: Record<Language, { title: string; sub: string; experience: string; tours: string }> = {
  ko: { title: '추천 운전기사', sub: '예약 시 가능한 기사 중 매칭됩니다', experience: '경력', tours: '누적 투어' },
  en: { title: 'Featured drivers', sub: 'Matched from available pool at booking', experience: 'Experience', tours: 'Tours done' },
  ja: { title: 'おすすめドライバー', sub: '予約時に利用可能なドライバーから割当', experience: '経験', tours: '累計ツアー' },
  zh: { title: '推荐司机', sub: '预订时从可用司机中匹配', experience: '经验', tours: '累计行程' },
};

function txt(field: I18nString, lang: Language): string {
  return field[lang] || field.en || field.ko;
}

interface Props {
  language: Language;
  /** 투어가 요구하는 언어들. 매칭되는 드라이버 우선 표시. */
  preferredLanguages?: DriverLanguage[];
  /** 최대 표시 개수 (default 3). */
  limit?: number;
}

export function DriverShowcase({ language, preferredLanguages = ['en'], limit = 3 }: Props) {
  const labels = SECTION_LABEL[language] || SECTION_LABEL.en;

  // 정렬: preferred languages 충족도 높은 순 → 평점 높은 순
  const ranked = [...DRIVERS].sort((a, b) => {
    const aMatch = preferredLanguages.filter(l => a.languages.includes(l)).length;
    const bMatch = preferredLanguages.filter(l => b.languages.includes(l)).length;
    if (aMatch !== bMatch) return bMatch - aMatch;
    return (b.rating || 0) - (a.rating || 0);
  });
  const visible = ranked.slice(0, limit);

  if (visible.length === 0) return null;

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-[13px] font-black uppercase tracking-[0.08em] text-white/30">{labels.title}</h2>
        <p className="text-[10px] text-white/25">{labels.sub}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {visible.map(d => (
          <DriverCard key={d.id} driver={d} language={language} labels={labels} />
        ))}
      </div>
    </section>
  );
}

function DriverCard({ driver, language, labels }: { driver: Driver; language: Language; labels: { experience: string; tours: string } }) {
  const name = txt(driver.name, language);
  const bio = txt(driver.bio, language);

  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-3"
      style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      <div className="flex items-center gap-3">
        {/* 사진 또는 이니셜 폴백 */}
        {driver.photo ? (
          <img
            src={driver.photo}
            alt={name}
            className="w-14 h-14 rounded-full object-cover shrink-0"
            loading="lazy"
          />
        ) : (
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center shrink-0 text-[14px] font-black text-white"
            style={{ background: 'linear-gradient(135deg, #B668FC, #FF6B9D)' }}
          >
            {driver.initials}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-black text-white truncate">{name}</p>
          {driver.rating && (
            <div className="flex items-center gap-1 mt-0.5">
              <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
              <span className="text-[10px] text-white/55">{driver.rating.toFixed(1)}</span>
              <span
                className="ml-1.5 inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background: 'rgba(140,200,255,0.10)', border: '1px solid rgba(140,200,255,0.20)', color: '#A0CBFF' }}
              >
                <Languages className="w-2.5 h-2.5" />
                {driver.languages.map(l => DRIVER_LANG_LABEL[l]).join('·')}
              </span>
            </div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-white/55 leading-snug line-clamp-3">{bio}</p>

      <div className="flex flex-wrap gap-1">
        {driver.specialties.slice(0, 3).map((s, i) => (
          <span
            key={i}
            className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
            style={{ background: 'rgba(182,104,252,0.08)', color: 'rgba(217,168,255,0.85)', border: '1px solid rgba(182,104,252,0.18)' }}
          >
            {txt(s, language)}
          </span>
        ))}
      </div>

      <div className="mt-auto pt-2 border-t border-white/[0.05] flex items-center justify-between text-[10px] text-white/35">
        <span className="flex items-center gap-1">
          <Award className="w-3 h-3" />
          {driver.experience_years}y {labels.experience}
        </span>
        {driver.toursCompleted && (
          <span className="flex items-center gap-1">
            <Users className="w-3 h-3" />
            {driver.toursCompleted} {labels.tours}
          </span>
        )}
      </div>
    </div>
  );
}
