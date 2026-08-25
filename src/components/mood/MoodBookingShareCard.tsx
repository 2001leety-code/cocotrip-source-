/**
 * 직원이 화면 캡처해 전달하는 MOOD 예약 공유 카드.
 * 편집 버튼, 직원 이메일, 포털 잔액은 받지도 렌더하지도 않는다.
 */
import { forwardRef, useEffect, useRef, useState } from 'react';
import { CalendarDays, Check, Clock3, Copy, MapPin, Route, UserRound } from 'lucide-react';

import { MoodShareRouteMap } from '@/components/mood/MoodShareRouteMap';
import {
  allocateMoodShareCostByCourse,
  copyMoodBookingShare,
  formatMoodShareDate,
  formatMoodShareKRW,
  formatMoodShareSignedKRW,
  getMoodShareTollPresentation,
  moodSharePayerLabel,
  moodShareStopLabel,
  resolveMoodBookingShareRouteSchedule,
  type MoodBookingShareCostBreakdown,
  type MoodBookingShareData,
} from '@/lib/moodBookingShare';
import {
  formatMoodRouteScheduleClock,
  formatMoodRouteScheduleStopSummary,
  formatMoodRouteWait,
  getMoodRouteWaitMinutes,
} from '@/lib/moodRouteSchedule';

export interface MoodBookingShareCardProps {
  data: MoodBookingShareData;
  className?: string;
}

export interface MoodBookingCopyButtonProps {
  data: MoodBookingShareData;
  className?: string;
  onResult?: (copied: boolean) => void;
}

function hasNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function costNumber(value: number | null | undefined): number {
  return hasNumber(value) ? value : 0;
}

function finalOrExpected(
  expected: MoodBookingShareCostBreakdown,
  finalCost: MoodBookingShareCostBreakdown,
  key: 'baseKRW' | 'distanceSurchargeKRW',
): number {
  return hasNumber(finalCost[key]) ? Number(finalCost[key]) : costNumber(expected[key]);
}

function CostRow({
  label,
  value,
  detail,
  signed = false,
}: {
  label: string;
  value: number;
  detail?: string;
  signed?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-[12px]">
      <div className="min-w-0 text-slate-600">
        <span>{label}</span>
        {detail && <span className="ml-1 text-[10px] text-slate-400">({detail})</span>}
      </div>
      <span className="shrink-0 font-bold tabular-nums text-slate-900">
        {signed ? formatMoodShareSignedKRW(value) : formatMoodShareKRW(value)}
      </span>
    </div>
  );
}

function ExpectedCostPanel({ cost, compact = false }: { cost: MoodBookingShareCostBreakdown; compact?: boolean }) {
  return (
    <section className={`rounded-2xl border border-violet-100 bg-violet-50/70 ${compact ? 'p-3' : 'p-4'}`} aria-label="예약 예상 비용">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-[12px] font-black text-violet-700">예약 예상 비용</h3>
        <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-bold text-violet-500 ring-1 ring-violet-100">예상</span>
      </div>
      <CostRow label="기본요금" value={costNumber(cost.baseKRW)} />
      <CostRow label="거리 추가요금" value={costNumber(cost.distanceSurchargeKRW)} />
      <CostRow
        label="예상 톨비"
        value={costNumber(cost.tollKRW)}
        detail={costNumber(cost.tollKRW) > 0 ? '경로 기준' : '통행료 없는 경로'}
      />
      <div className="mt-1 border-t border-violet-200 pt-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-black text-slate-800">예상 합계</span>
          <span className="text-[17px] font-black tabular-nums text-violet-700">{formatMoodShareKRW(cost.totalKRW)}</span>
        </div>
      </div>
    </section>
  );
}

function FinalCostPanel({
  expected,
  finalCost,
}: {
  expected: MoodBookingShareCostBreakdown;
  finalCost: MoodBookingShareCostBreakdown;
}) {
  const toll = getMoodShareTollPresentation(expected.tollKRW, finalCost);
  return (
    <section className="rounded-2xl border border-fuchsia-100 bg-gradient-to-br from-white to-fuchsia-50 p-4 shadow-[0_8px_25px_rgba(124,58,237,0.08)]" aria-label="최종 정산 비용">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-[12px] font-black text-fuchsia-700">최종 정산 비용</h3>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold text-emerald-700 ring-1 ring-emerald-100">정산 완료</span>
      </div>
      <CostRow label="기본요금" value={finalOrExpected(expected, finalCost, 'baseKRW')} />
      <CostRow label="거리 추가요금" value={finalOrExpected(expected, finalCost, 'distanceSurchargeKRW')} />
      <CostRow label={toll.label} value={costNumber(finalCost.tollKRW)} detail={toll.detail} />
      {(costNumber(finalCost.adjustmentKRW) !== 0 || String(finalCost.adjustmentReason || '').trim()) && (
        <CostRow
          label="기타 조정"
          value={costNumber(finalCost.adjustmentKRW)}
          detail={String(finalCost.adjustmentReason || '').trim() || '조정 사유 없음'}
          signed
        />
      )}
      <div className="mt-1 border-t border-fuchsia-100 pt-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-black text-slate-800">최종 합계</span>
          <span className="text-[18px] font-black tabular-nums text-fuchsia-700">{formatMoodShareKRW(finalCost.totalKRW)}</span>
        </div>
      </div>
    </section>
  );
}

/** ref는 복사 버튼을 뺀 실제 캡처 영역(article)을 가리킨다. */
export const MoodBookingShareCard = forwardRef<HTMLElement, MoodBookingShareCardProps>(function MoodBookingShareCard(
  { data, className = '' },
  ref,
) {
  const expected = data.costs.expected;
  const finalCost = data.phase === 'final' ? data.costs.final || null : null;
  const activeTotal = finalCost ? finalCost.totalKRW : expected.totalKRW;
  const route = data.route || {};
  const stops = (data.stops || []).filter((stop) => String(stop.address || '').trim());
  const resolvedSchedule = resolveMoodBookingShareRouteSchedule(data, stops);
  const distribution = allocateMoodShareCostByCourse(activeTotal, stops);
  const influencer = String(data.influencerName || '').trim() || '미입력';
  const duration = hasNumber(data.durationHours) ? ` · ${data.durationHours}시간` : '';
  const routeSummary = [
    hasNumber(route.km) ? `${route.km.toLocaleString('ko-KR')}km` : '',
    hasNumber(route.durationMin) ? `약 ${Math.round(route.durationMin)}분` : '',
  ].filter(Boolean).join(' · ');

  return (
    <article
      ref={ref}
      data-testid="mood-booking-share-card"
      data-share-phase={finalCost ? 'final' : 'expected'}
      className={`mx-auto w-full max-w-[430px] overflow-hidden rounded-[26px] bg-[#fbfaff] text-slate-900 shadow-[0_22px_60px_rgba(76,29,149,0.18)] ring-1 ring-violet-100 ${className}`}
    >
      <header className="relative overflow-hidden bg-gradient-to-br from-violet-700 via-violet-600 to-fuchsia-500 px-5 pb-5 pt-5 text-white">
        <div className="absolute -right-10 -top-14 h-36 w-36 rounded-full bg-white/10" aria-hidden="true" />
        <div className="absolute -bottom-20 -left-12 h-40 w-40 rounded-full bg-fuchsia-300/10" aria-hidden="true" />
        <div className="relative flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black tracking-[0.24em] text-white/75">MOOD</p>
            <h2 className="mt-1 text-[20px] font-black tracking-tight">
              {finalCost ? '이동 정산 안내' : '이동 예약 안내'}
            </h2>
          </div>
          <span className="rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-bold ring-1 ring-white/25">
            {finalCost ? '최종' : '예상'}
          </span>
        </div>
        <p className="relative mt-4 text-[10px] font-semibold text-white/70">예약번호</p>
        <p className="relative mt-0.5 break-all text-[13px] font-black tracking-wide">{data.bookingRef || '-'}</p>
      </header>

      <div className="space-y-4 p-4 sm:p-5">
        <section className="grid grid-cols-2 gap-2.5 rounded-2xl border border-slate-100 bg-white p-3.5 shadow-sm" aria-label="예약 기본 정보">
          <div className="col-span-2 flex items-start gap-2.5">
            <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" aria-hidden="true" />
            <div>
              <p className="text-[9px] font-bold text-slate-400">예약 일시</p>
              <p className="mt-0.5 text-[12px] font-black text-slate-800">
                {formatMoodShareDate(data.date)} · {data.startTime || '-'}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-fuchsia-500" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-[9px] font-bold text-slate-400">탑승 인플루언서</p>
              <p className={`mt-0.5 truncate text-[12px] font-black ${influencer === '미입력' ? 'text-amber-600' : 'text-slate-800'}`}>{influencer}</p>
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-[9px] font-bold text-slate-400">서비스</p>
              <p className="mt-0.5 truncate text-[12px] font-black text-slate-800">{data.serviceLabel || '-'}{duration}</p>
            </div>
          </div>
        </section>

        <section aria-label="이동 동선">
          <div className="mb-2 flex items-center justify-between gap-3 px-0.5">
            <div className="flex items-center gap-1.5">
              <Route className="h-4 w-4 text-violet-600" aria-hidden="true" />
              <h3 className="text-[12px] font-black text-slate-800">이동 동선</h3>
            </div>
            {routeSummary && <p className="text-[10px] font-bold tabular-nums text-violet-600">{routeSummary}</p>}
          </div>
          <MoodShareRouteMap stops={stops} route={data.route} />

          {resolvedSchedule && resolvedSchedule.addresses.length > 1 && (
            <section
              className="mt-3 rounded-2xl border border-violet-100 bg-violet-50/60 p-3"
              aria-label="전체 차량 일정"
            >
              <h4 className="text-[12px] font-black text-violet-700">전체 차량 일정</h4>
              <div className="mt-2 space-y-2">
                {resolvedSchedule.addresses.slice(0, -1).map((fromAddress, index) => {
                  const toAddress = resolvedSchedule.addresses[index + 1];
                  const from = resolvedSchedule.routeSchedule[index];
                  const to = resolvedSchedule.routeSchedule[index + 1];
                  const waitMinutes = index + 1 < resolvedSchedule.addresses.length - 1
                    ? getMoodRouteWaitMinutes(to)
                    : null;
                  return (
                    <div key={`${fromAddress}-${toAddress}-${index}`} className="rounded-xl bg-white px-3 py-2.5 ring-1 ring-violet-100">
                      <p className="text-[10px] font-black text-violet-600">{index + 1}구간</p>
                      <p className="mt-1 break-words text-[12px] font-bold leading-relaxed text-slate-800">
                        {fromAddress}<span className="sr-only">에서</span> <span className="text-violet-500" aria-hidden="true">→</span> {toAddress}
                      </p>
                      <p className="mt-1 text-[11px] font-bold tabular-nums text-slate-600">
                        출발 {formatMoodRouteScheduleClock(from.pickupTime)} · 도착 {formatMoodRouteScheduleClock(to.arrivalTime)}
                      </p>
                      {(waitMinutes !== null || to.pickupTime) && index + 1 < resolvedSchedule.addresses.length - 1 && (
                        <p className="mt-1 text-[11px] font-black tabular-nums text-fuchsia-700">
                          {waitMinutes !== null ? `대기 ${formatMoodRouteWait(waitMinutes)}` : ''}
                          {waitMinutes !== null && to.pickupTime ? ' · ' : ''}
                          {to.pickupTime ? `재출발(픽업) ${to.pickupTime}` : ''}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <ol className="mt-3 space-y-0 rounded-2xl border border-slate-100 bg-white px-3.5 py-2 shadow-sm">
            {distribution.courseCount ? distribution.courses.map((course, index) => {
              const stop = course.stop;
              const label = String(stop.label || '').trim() || moodShareStopLabel(index, stops.length);
              const influencerLabel = moodSharePayerLabel('influencer', data.influencerName);
              const scheduleSummary = resolvedSchedule
                ? formatMoodRouteScheduleStopSummary(resolvedSchedule.routeSchedule[index], index, stops.length)
                : String(stop.time || '').trim();
              return (
                <li key={`${stop.address}-${index}`} className="relative flex gap-3 py-2.5">
                  {index < stops.length - 1 && <span className="absolute left-[13px] top-8 h-[calc(100%-18px)] w-px bg-violet-200" aria-hidden="true" />}
                  <span className="relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-500 text-[11px] font-black text-white ring-2 ring-white">
                    {index + 1}
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-black text-violet-600">{label}</span>
                      {scheduleSummary && <span className="text-[9px] font-bold text-slate-500">{scheduleSummary}</span>}
                    </div>
                    <p className="mt-0.5 break-words text-[11px] font-bold leading-relaxed text-slate-700">{stop.address}</p>
                    <div className="mt-1.5 grid gap-1 text-[9px] font-black">
                      <span className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-700 ring-1 ring-violet-100">
                        MOOD {course.moodPercentage}% · {formatMoodShareKRW(course.moodKRW)}
                      </span>
                      <span className="rounded-full bg-fuchsia-50 px-2 py-0.5 text-fuchsia-700 ring-1 ring-fuchsia-100">
                        {influencerLabel} {course.influencerPercentage}% · {formatMoodShareKRW(course.influencerKRW)}
                      </span>
                    </div>
                  </div>
                </li>
              );
            }) : (
              <li className="flex items-center gap-2 py-3 text-[11px] text-slate-500">
                <MapPin className="h-4 w-4 text-violet-400" aria-hidden="true" />
                저장된 주소가 없습니다.
              </li>
            )}
          </ol>
        </section>

        <div className="space-y-2.5">
          <ExpectedCostPanel cost={expected} compact={!!finalCost} />
          {finalCost && <FinalCostPanel expected={expected} finalCost={finalCost} />}
        </div>

        {distribution.courseCount > 0 && (
        <section className="rounded-2xl bg-slate-900 p-4 text-white" aria-label={`${finalCost ? '최종' : '예상'} 코스별 비용 분담`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-black">{finalCost ? '최종' : '예상'} 코스별 비용 분담</p>
              <p className="mt-0.5 text-[9px] text-white/55">
                전체 {formatMoodShareKRW(distribution.totalKRW)} ÷ {distribution.courseCount}코스
              </p>
            </div>
            <span className="rounded-full bg-white/10 px-2 py-1 text-[9px] font-black text-fuchsia-200">
              기본 {formatMoodShareKRW(distribution.basePerCourseKRW)}/코스
            </span>
          </div>
          {distribution.remainderKRW > 0 && (
            <p className="mt-2 text-[9px] text-amber-200">
              원 단위 나머지 {formatMoodShareKRW(distribution.remainderKRW)}은 마지막 코스에 반영했습니다.
            </p>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-white/[0.07] p-2.5">
              <p className="text-[9px] font-bold text-white/50">MOOD 부담 합계</p>
              <p className="mt-1 text-[15px] font-black tabular-nums">{formatMoodShareKRW(distribution.mood.totalKRW)}</p>
            </div>
            <div className="rounded-xl bg-white/[0.07] p-2.5">
              <p className="truncate text-[9px] font-bold text-white/50">
                {moodSharePayerLabel('influencer', data.influencerName)} 부담 합계
              </p>
              <p className="mt-1 text-[15px] font-black tabular-nums">{formatMoodShareKRW(distribution.influencer.totalKRW)}</p>
            </div>
          </div>
        </section>
        )}

        {data.note && (
          <section className="rounded-2xl border border-amber-100 bg-amber-50 p-3.5" aria-label="전달 메모">
            <p className="text-[10px] font-black text-amber-700">전달 메모</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-[11px] font-semibold leading-relaxed text-slate-700">{String(data.note).trim()}</p>
          </section>
        )}

        <p className="px-1 text-center text-[9px] leading-relaxed text-slate-400">
          실제 운행 상황에 따라 동선과 톨비, 최종 금액이 달라질 수 있습니다.
        </p>
      </div>
    </article>
  );
});

MoodBookingShareCard.displayName = 'MoodBookingShareCard';

/** 캡처 카드 바깥에 두는 상세 문구 복사 버튼. */
export function MoodBookingCopyButton({ data, className = '', onResult }: MoodBookingCopyButtonProps) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const resetTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimer.current) window.clearTimeout(resetTimer.current);
  }, []);

  const handleCopy = async () => {
    const copied = await copyMoodBookingShare(data);
    setStatus(copied ? 'copied' : 'failed');
    onResult?.(copied);
    if (resetTimer.current) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setStatus('idle'), 2200);
  };

  return (
    <button
      type="button"
      onClick={() => { void handleCopy(); }}
      className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-black transition-colors ${
        status === 'failed'
          ? 'bg-red-50 text-red-700 ring-1 ring-red-200'
          : status === 'copied'
            ? 'bg-emerald-600 text-white'
            : 'bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white hover:from-violet-700 hover:to-fuchsia-600'
      } ${className}`}
    >
      {status === 'copied' ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
      {status === 'copied' ? '상세 내용 복사 완료' : status === 'failed' ? '복사 실패 · 다시 눌러 주세요' : '상세 내용 복사'}
    </button>
  );
}

export default MoodBookingShareCard;
