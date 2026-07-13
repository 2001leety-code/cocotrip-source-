// BookingStatusTimeline — 가이드 P10 "Booking Status 타임라인".
// 실 b.status(CONFIRMED/MODIFIED/CANCELED/COMPLETED)만으로 단계 시각화.
// 정직 원칙: 조작된 시각·미래 단계 추정 없음. CANCELED 는 선형 타임라인 대신 단일 상태.
import type { Language } from '@/i18n';

const TOUR_DAY: Record<Language, string> = {
  en: 'Tour Day',
  ko: '투어 당일',
  ja: 'ツアー当日',
  zh: '旅游当天',
};

export function BookingStatusTimeline({
  status,
  language,
  labels,
}: {
  status: string;
  language: Language;
  labels: { confirmed: string; completed: string; canceled: string };
}) {
  if (status === 'CANCELED') {
    return (
      <div className="flex items-center gap-2 py-1">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
        <span className="text-[12px] font-bold text-red-300">{labels.canceled}</span>
      </div>
    );
  }

  const steps = [labels.confirmed, TOUR_DAY[language] || TOUR_DAY.en, labels.completed];
  // COMPLETED = 3단계 전부 완료. 그 외(CONFIRMED/MODIFIED) = 확정만 완료·투어예정.
  const activeIdx = status === 'COMPLETED' ? 2 : 0;

  return (
    <div className="flex items-center py-1" aria-label="booking status timeline">
      {steps.map((label, i) => {
        const done = i <= activeIdx;
        return (
          <div
            key={i}
            className="flex items-center"
            style={{ flex: i < steps.length - 1 ? 1 : '0 0 auto' }}
          >
            <div className="flex flex-col items-center">
              <span className={`h-2.5 w-2.5 rounded-full ${done ? 'bg-emerald-400' : 'bg-white/20'}`} />
              <span className={`mt-1 whitespace-nowrap text-[9px] font-semibold ${done ? 'text-emerald-300' : 'text-white/40'}`}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span className={`mx-1 h-px flex-1 ${i < activeIdx ? 'bg-emerald-400/50' : 'bg-white/15'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
