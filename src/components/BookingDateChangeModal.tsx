/**
 * 예약 날짜 변경 모달 (2026-10-23, 후속 ②b) — 회원(마이페이지)·게스트(/booking/manage) 공용.
 *
 * 같은 상품·시간대·인원·가격으로 **날짜만** 바꾼다(서버 POST /api/modifyBooking, changes.tourDate).
 *   - 회원 = authFetch(Bearer), 게스트 = manageFetch(본문 manageToken, Bearer 없음).
 *   - requestId 는 모달이 열릴 때 한 번 만들고 재시도에도 같은 값을 보낸다 — 응답이 유실돼도 서버가
 *     같은 요청임을 알아보고(게스트) 새 관리 토큰만 다시 준다. 네트워크 오류면 자동 1회 재시도.
 *   - 선택 범위 = KST 내일 ~ +365일. 실제 가능 여부(24h·만석·휴무)는 서버가 판정하고 코드로 돌려준다.
 */
import { useState } from 'react';
import { CalendarDays, X } from 'lucide-react';
import { translations, type Language, type Translations } from '@/i18n';
import { authFetch } from '@/lib/authFetch';
import { manageFetch } from '@/lib/manageFetch';
import { kstDatePlusDays, newRequestId } from '@/lib/bookingDateChange';

export type DateChangeAuth = { kind: 'member' } | { kind: 'guest'; manageToken: string };

export type DateChangeResult = {
  tourDate: string;
  manageToken?: string;
  emailSent?: boolean;
  recovered?: boolean;
  ignored?: string[];
};

interface Props {
  bookingID: string;
  bookingRef: string;
  currentDate: string;
  tourTime?: string;
  language: Language;
  auth: DateChangeAuth;
  onClose: () => void;
  onSaved: (result: DateChangeResult) => void | Promise<void>;
  /** BOOKING_CHANGED(그 사이 예약이 바뀜) 때 "다시 불러오기" — 없으면 닫기만 한다. */
  onReload?: () => void;
}

type Copy = Translations['bookingDateChange'];

function errorText(copy: Copy, code: string): string {
  switch (code) {
    case 'SLOT_FULL': return copy.bdcErrSlotFull;
    case 'DATE_UNAVAILABLE': return copy.bdcErrDateUnavailable;
    case 'NEW_DATE_TOO_SOON': return copy.bdcErrTooSoon;
    case 'NEW_DATE_TOO_FAR': return copy.bdcErrTooFar;
    case 'SLOT_BINDING_MISSING':
    case 'SLOT_BINDING_MISMATCH': return copy.bdcErrNoSeatRecord;
    case 'MODIFY_WINDOW_CLOSED': return copy.bdcErrWindowClosed;
    case 'MANAGE_LINK_UNAVAILABLE': return copy.bdcErrLinkUnavailable;
    case 'BOOKING_CHANGED': return copy.bdcErrChanged;
    case 'SAME_DATE': return copy.bdcSameDate;
    default: return copy.bdcErrGeneric;
  }
}

export function BookingDateChangeModal({
  bookingID, bookingRef, currentDate, tourTime, language, auth, onClose, onSaved, onReload,
}: Props) {
  const copy = translations[language].bookingDateChange;
  const [date, setDate] = useState('');
  const [requestId] = useState(newRequestId);
  const [submitting, setSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState('');
  const min = kstDatePlusDays(1);
  const max = kstDatePlusDays(365);
  const unchanged = !date || date === currentDate;

  function post(): Promise<Response> {
    const body = { bookingID, changes: { tourDate: date }, requestId };
    if (auth.kind === 'member') {
      return authFetch('/api/modifyBooking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }
    return manageFetch('/api/modifyBooking', { manageToken: auth.manageToken, body });
  }

  async function submit() {
    if (unchanged || submitting) return;
    setSubmitting(true);
    setErrorCode('');
    let retried = false;
    try {
      let res: Response;
      try {
        res = await post();
      } catch {
        // 응답 유실 — 같은 requestId·같은 날짜로 1회 재시도(서버가 이미 반영했으면 복구 응답).
        retried = true;
        res = await post();
      }
      const json = await res.json().catch(() => null);
      const code = json && typeof json.code === 'string' ? json.code : '';
      if (res.ok && json && json.ok && json.data) {
        const d = json.data;
        await onSaved({
          tourDate: typeof d.tourDate === 'string' ? d.tourDate : date,
          manageToken: typeof d.manageToken === 'string' ? d.manageToken : undefined,
          emailSent: d.emailSent === true,
          recovered: d.recovered === true,
          ignored: Array.isArray(d.ignored) ? d.ignored : [],
        });
        return;
      }
      // 회원 재시도에서 SAME_DATE = 첫 요청이 이미 반영됐다(응답만 유실).
      if (retried && auth.kind === 'member' && code === 'SAME_DATE') {
        await onSaved({ tourDate: date, emailSent: false, recovered: true, ignored: [] });
        return;
      }
      setErrorCode(code || 'UNKNOWN');
    } catch {
      setErrorCode('NETWORK');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bdc-title"
        className="w-full max-w-md bg-[#0f1628] rounded-2xl border border-[#7C5CFC]/30 overflow-hidden customer-booking-date-change-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h3 id="bdc-title" className="text-white font-bold flex items-center gap-2">
            <CalendarDays size={16} aria-hidden /> {copy.bdcTitle} · {bookingRef}
          </h3>
          <button type="button" onClick={onClose} aria-label={copy.bdcClose} className="text-white/55 hover:text-white"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3 text-sm">
          <p className="text-white/70">
            {copy.bdcCurrent}: <span className="text-white font-semibold">{[currentDate, tourTime].filter(Boolean).join(' ')}</span>
          </p>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-white/55 mb-1 font-semibold">{copy.bdcNew}</span>
            <input
              type="date"
              value={date}
              min={min}
              max={max}
              onChange={(e) => { setDate(e.target.value); setErrorCode(''); }}
              className="w-full px-3 py-2 rounded-lg border border-white/10 bg-white/[0.03] text-white/85 text-sm outline-none focus:border-[#B668FC]/50"
            />
          </label>
          {date && date === currentDate && <p className="text-amber-300 text-xs">{copy.bdcSameDate}</p>}
          <ul className="list-disc pl-5 text-white/60 text-xs space-y-1">
            <li>{copy.bdcNoteSame}</li>
            <li>{copy.bdcNotePolicy}</li>
            <li>{copy.bdcNoteDeadline}</li>
          </ul>
          {errorCode && (
            <div role="alert" className="text-red-400 text-xs space-y-2">
              <p>⚠ {errorText(copy, errorCode)}</p>
              {errorCode === 'BOOKING_CHANGED' && (
                <button type="button" onClick={() => { (onReload || onClose)(); }} className="underline text-white/80">
                  {copy.bdcReload}
                </button>
              )}
            </div>
          )}
        </div>
        <div className="px-5 py-4 border-t border-white/5 flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-white/10 text-white/60 text-sm">{copy.bdcClose}</button>
          <button
            type="button"
            onClick={() => { void submit(); }}
            disabled={unchanged || submitting}
            className="flex-1 py-2.5 rounded-xl text-white text-sm font-bold disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg, #7C5CFC, #EA537E)' }}
          >
            {submitting ? copy.bdcSubmitting : copy.bdcSubmit}
          </button>
        </div>
      </div>
    </div>
  );
}
