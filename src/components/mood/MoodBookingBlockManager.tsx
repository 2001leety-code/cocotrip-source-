import { useMemo, useRef, useState } from 'react';
import { authFetch } from '@/lib/authFetch';
import {
  formatMoodBookingRuleSummary,
  getMoodBookingBlockStatus,
  moodKstDateISO,
  moodKstTimeHHMM,
  parseMoodBookingAvailability,
  type MoodBookingAvailability,
  type MoodBookingBlockMode,
  type MoodBookingBlockRule,
  type MoodBookingOpenException,
} from '@/lib/moodBookingAvailability';

interface Props {
  availability: MoodBookingAvailability | null;
  onUpdated: (availability: MoodBookingAvailability) => void;
  onReload: () => Promise<void> | void;
}

interface RuleDraft {
  isNew: boolean;
  id: string;
  enabled: boolean;
  startDate: string;
  endDate: string;
  weekdays: number[];
  mode: MoodBookingBlockMode;
  startTime: string;
  reason: string;
}

interface OpenDateDraft {
  id: string;
  mode: 'one_day' | 'range';
  startDate: string;
  endDate: string;
  reason: string;
}

type MutationPayload =
  | { action: 'upsert'; rule: MoodBookingBlockRule }
  | { action: 'delete'; ruleId: string }
  | { action: 'upsert_exception'; exception: { id: string; enabled: boolean; startDate: string; endDate: string; reason: string } }
  | { action: 'delete_exception'; exceptionId: string }
  | { action: 'set_all_enabled'; enabled: boolean }
  | { action: 'initialize' };

const WEEKDAYS = [
  { value: 0, label: '일' },
  { value: 1, label: '월' },
  { value: 2, label: '화' },
  { value: 3, label: '수' },
  { value: 4, label: '목' },
  { value: 5, label: '금' },
  { value: 6, label: '토' },
];

function makeRequestId(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function newRuleDraft(): RuleDraft {
  const today = moodKstDateISO();
  return {
    isNew: true,
    id: makeRequestId('mood-block-rule'),
    enabled: true,
    startDate: today,
    endDate: today,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    mode: 'full_day',
    startTime: '18:00',
    reason: '',
  };
}

function newOpenDateDraft(): OpenDateDraft {
  const today = moodKstDateISO();
  return {
    id: makeRequestId('mood-open-date'),
    mode: 'one_day',
    startDate: today,
    endDate: today,
    reason: '',
  };
}

function draftFromRule(rule: MoodBookingBlockRule): RuleDraft {
  return {
    isNew: false,
    ...rule,
    weekdays: [...rule.weekdays],
    startTime: rule.startTime || '18:00',
  };
}

function ruleFromDraft(draft: RuleDraft): MoodBookingBlockRule {
  return {
    id: draft.id,
    enabled: draft.enabled,
    startDate: draft.startDate,
    endDate: draft.endDate,
    weekdays: [...draft.weekdays].sort((left, right) => left - right),
    mode: draft.mode,
    startTime: draft.mode === 'starts_from' ? draft.startTime : null,
    reason: draft.reason.trim(),
  };
}

function isoDateValue(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.getTime();
}

// 한국 달력의 startDate~endDate는 양끝을 모두 포함(inclusive)하며, exclusive 종료일로 해석하지 않는다.
function isValidOpenDateDraft(draft: OpenDateDraft): boolean {
  const start = isoDateValue(draft.startDate);
  const endDate = draft.mode === 'one_day' ? draft.startDate : draft.endDate;
  const end = isoDateValue(endDate);
  if (start === null || end === null || start > end) return false;
  const dayCount = Math.floor((end - start) / (24 * 60 * 60 * 1000)) + 1;
  return dayCount <= 366 && Boolean(draft.reason.trim()) && draft.reason.trim().length <= 500;
}

function displayDate(value: string): string {
  return `${Number(value.slice(5, 7))}월 ${Number(value.slice(8, 10))}일`;
}

function formatExceptionDateRange(exception: MoodBookingOpenException): string {
  return exception.startDate === exception.endDate
    ? displayDate(exception.startDate)
    : `${displayDate(exception.startDate)}~${displayDate(exception.endDate)}`;
}

function apiErrorMessage(json: Record<string, unknown>, status: number) {
  const error = typeof json.error === 'string' ? json.error : typeof json.code === 'string' ? json.code : '';
  if (error === 'BOOKING_BLOCK_EXCEPTION_NO_MATCH') return '선택한 날짜에 적용되는 차단 규칙이 없습니다. 날짜를 다시 확인해 주세요.';
  if (error === 'BOOKING_BLOCK_EXCEPTION_NOT_FOUND') return '이미 삭제된 열린 날짜입니다. 최신 설정을 확인해 주세요.';
  if (error === 'REVISION_CONFLICT') return '다른 관리자의 최신 변경을 캘린더에 반영했습니다. 내용을 확인한 뒤 다시 시도해 주세요.';
  if (error === 'BOOKING_BLOCK_RULE_LIMIT') return '예약 차단 규칙은 최대 50개까지 저장할 수 있습니다. 기존 규칙을 정리한 뒤 다시 시도해 주세요.';
  if (error === 'BOOKING_BLOCK_EXCEPTION_LIMIT') return '열린 날짜는 최대 100개까지 저장할 수 있습니다. 지난 항목을 정리한 뒤 다시 시도해 주세요.';
  if (error === 'IDEMPOTENCY_CONFLICT') return '같은 요청 번호에 다른 변경 내용이 들어왔습니다. 화면을 새로 불러온 뒤 다시 시도해 주세요.';
  if (error === 'IDEMPOTENCY_RESPONSE_MISSING') return '이전 변경 결과를 확인할 수 없습니다. 화면을 새로 불러온 뒤 현재 상태를 확인해 주세요.';
  if (error === 'INVALID_BOOKING_AVAILABILITY_CONFIG') return '저장된 예약 차단 설정에 문제가 있어 변경할 수 없습니다. 설정 점검이 필요합니다.';
  if (error === 'BOOKING_AVAILABILITY_ALREADY_INITIALIZED') return '예약 차단 설정이 이미 생성되어 있습니다. 최신 설정을 다시 불러와 주세요.';
  if (error === 'BOOKING_AVAILABILITY_REPAIR_REQUIRED') return '기존 설정이 손상되어 자동으로 덮어쓸 수 없습니다. 관리자 점검이 필요합니다.';
  if (error === 'REQUEST_ID_REUSED') return '같은 요청 번호가 다른 변경에 사용됐습니다. 다시 시도해 주세요.';
  return error || `차단 설정 저장 실패 (${status})`;
}

export function MoodBookingBlockManager({ availability, onUpdated, onReload }: Props) {
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [openDateDraft, setOpenDateDraft] = useState<OpenDateDraft | null>(null);
  const [savingKey, setSavingKey] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState('');
  const [releaseAllConfirm, setReleaseAllConfirm] = useState(false);
  const [initializeConfirm, setInitializeConfirm] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const requestRef = useRef({ signature: '', requestId: '' });

  const nowDate = moodKstDateISO();
  const nowTime = moodKstTimeHHMM();
  const currentStatus = useMemo(
    () => getMoodBookingBlockStatus(nowDate, nowTime, availability),
    [nowDate, nowTime, availability],
  );
  const enabledCount = availability?.rules.filter((rule) => rule.enabled).length || 0;

  const sendMutation = async (payload: MutationPayload, key: string) => {
    if (!availability || savingKey) return false;
    const bodyWithoutRequest = { ...payload, expectedRevision: availability.revision };
    const signature = JSON.stringify(bodyWithoutRequest);
    if (requestRef.current.signature !== signature) {
      requestRef.current = { signature, requestId: makeRequestId('mood-block') };
    }
    setSavingKey(key);
    setMessage(null);
    try {
      const response = await authFetch('/api/mood-booking-blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...bodyWithoutRequest, requestId: requestRef.current.requestId }),
      });
      const json = await response.json().catch(() => ({})) as Record<string, unknown>;
      const data = json.data && typeof json.data === 'object' ? json.data as Record<string, unknown> : {};
      const next = parseMoodBookingAvailability(data.bookingAvailability);
      if (!response.ok || json.ok !== true) {
        if ((response.status === 409 || json.error === 'REVISION_CONFLICT' || json.code === 'REVISION_CONFLICT') && next) onUpdated(next);
        setMessage({ kind: 'err', text: apiErrorMessage(json, response.status) });
        return false;
      }
      if (!next) {
        setMessage({ kind: 'err', text: '저장 응답의 차단 설정을 확인할 수 없습니다. 새로고침해 주세요.' });
        return false;
      }
      requestRef.current = { signature: '', requestId: '' };
      onUpdated(next);
      // 성공 응답을 먼저 즉시 반영한 뒤 서버 정본을 한 번 더 확인한다.
      // 열려 있던 다른 탭/오래된 화면의 상태가 남아도 캘린더 배지가 즉시 정리된다.
      await onReload();
      setMessage({ kind: 'ok', text: '캘린더 반영 완료' });
      return true;
    } catch (error) {
      setMessage({ kind: 'err', text: error instanceof Error ? error.message : '차단 설정 저장에 실패했습니다.' });
      return false;
    } finally {
      setSavingKey('');
    }
  };

  const initializeAvailability = async () => {
    if (savingKey) return;
    if (!initializeConfirm) {
      setInitializeConfirm(true);
      setMessage(null);
      return;
    }
    const signature = JSON.stringify({ action: 'initialize', expectedRevision: 0 });
    if (requestRef.current.signature !== signature) {
      requestRef.current = { signature, requestId: makeRequestId('mood-block') };
    }
    setSavingKey('initialize');
    setMessage(null);
    try {
      const response = await authFetch('/api/mood-booking-blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'initialize',
          expectedRevision: 0,
          requestId: requestRef.current.requestId,
        }),
      });
      const json = await response.json().catch(() => ({})) as Record<string, unknown>;
      const data = json.data && typeof json.data === 'object' ? json.data as Record<string, unknown> : {};
      const next = parseMoodBookingAvailability(data.bookingAvailability);
      if (!response.ok || json.ok !== true || !next) {
        setMessage({ kind: 'err', text: apiErrorMessage(json, response.status) });
        return;
      }
      requestRef.current = { signature: '', requestId: '' };
      setInitializeConfirm(false);
      onUpdated(next);
      await onReload();
      setMessage({ kind: 'ok', text: '빈 예약 차단 설정을 만들고 캘린더에 반영했습니다.' });
    } catch (error) {
      setMessage({ kind: 'err', text: error instanceof Error ? error.message : '예약 차단 설정 초기화에 실패했습니다.' });
    } finally {
      setSavingKey('');
    }
  };

  const saveDraft = async () => {
    if (!draft || !availability) return;
    const rule = ruleFromDraft(draft);
    const valid = parseMoodBookingAvailability({ schemaVersion: 1, revision: availability.revision, rules: [rule] });
    if (!valid) {
      setMessage({ kind: 'err', text: '기간·요일·차단 시각·사유를 모두 확인해 주세요.' });
      return;
    }
    if (await sendMutation({ action: 'upsert', rule }, `save-${rule.id}`)) setDraft(null);
  };

  const saveOpenDate = async () => {
    if (!openDateDraft || !availability) return;
    if (!isValidOpenDateDraft(openDateDraft)) {
      setMessage({ kind: 'err', text: '열 날짜·기간과 사유를 확인해 주세요. 기간은 양끝을 포함해 최대 366일입니다.' });
      return;
    }
    const endDate = openDateDraft.mode === 'one_day' ? openDateDraft.startDate : openDateDraft.endDate;
    const success = await sendMutation({
      action: 'upsert_exception',
      exception: {
        id: openDateDraft.id,
        enabled: true,
        startDate: openDateDraft.startDate,
        endDate,
        reason: openDateDraft.reason.trim(),
      },
    }, `open-${openDateDraft.id}`);
    if (success) setOpenDateDraft(null);
  };

  const toggleRule = async (rule: MoodBookingBlockRule) => {
    setReleaseAllConfirm(false);
    await sendMutation({ action: 'upsert', rule: { ...rule, enabled: !rule.enabled } }, `toggle-${rule.id}`);
  };

  const deleteRule = async (ruleId: string) => {
    if (deleteConfirmId !== ruleId) {
      setDeleteConfirmId(ruleId);
      setMessage({ kind: 'err', text: '삭제할 규칙이 맞으면 삭제 확인을 한 번 더 눌러 주세요.' });
      return;
    }
    if (await sendMutation({ action: 'delete', ruleId }, `delete-${ruleId}`)) {
      setDeleteConfirmId('');
      if (draft?.id === ruleId) setDraft(null);
    }
  };

  const deleteException = async (exceptionId: string) => {
    await sendMutation({ action: 'delete_exception', exceptionId }, `close-${exceptionId}`);
  };

  const setEveryRuleEnabled = async (enabled: boolean) => {
    if (!enabled && !releaseAllConfirm) {
      setReleaseAllConfirm(true);
      setMessage(null);
      return;
    }
    if (await sendMutation({ action: 'set_all_enabled', enabled }, enabled ? 'enable-all' : 'disable-all')) {
      setReleaseAllConfirm(false);
      setDraft(null);
    }
  };

  return (
    <details aria-label="예약 차단 관리" className="group rounded-2xl border border-violet-400/20 bg-slate-950/55">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-violet-300">
        <span className="min-w-0">
          <span className="block text-sm font-black text-white">예약 차단 관리</span>
          <span className="block truncate text-[11px] font-semibold text-slate-300">
            {availability
              ? currentStatus.blocked
                ? `현재 차단 중 · ${currentStatus.rule?.reason}`
                : `현재 예약 가능 · 사용 중인 규칙 ${enabledCount}개`
              : '설정을 확인할 수 없어 신규 예약 잠김'}
          </span>
        </span>
        <span className="shrink-0 text-xs font-black text-violet-200 group-open:hidden">열기</span>
        <span className="hidden shrink-0 text-xs font-black text-violet-200 group-open:inline">접기</span>
      </summary>

      <div className="border-t border-white/10 px-3 pb-3 pt-3">
        {!availability ? (
          <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3" role="alert">
            <p className="text-xs font-bold text-rose-100">차단 설정을 안전하게 읽지 못했습니다. 신규 예약은 자동으로 잠겨 있습니다.</p>
            <p className="mt-1 text-[11px] leading-relaxed text-rose-100/80">
              설정 문서가 없는 경우에만 빈 설정을 직접 만들 수 있습니다. 과거 날짜 차단은 자동으로 복원되지 않습니다.
            </p>
            <button
              type="button"
              onClick={() => { void onReload(); }}
              className="mt-2 min-h-11 rounded-xl border border-white/15 bg-white/5 px-3 text-xs font-black text-white outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
            >
              설정 다시 불러오기
            </button>
            <button
              type="button"
              disabled={Boolean(savingKey)}
              onClick={() => { void initializeAvailability(); }}
              className="mt-2 min-h-11 w-full rounded-xl border border-emerald-300/30 bg-emerald-500/10 px-3 text-xs font-black text-emerald-100 outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:opacity-40"
            >
              {savingKey === 'initialize'
                ? '빈 설정 만드는 중…'
                : initializeConfirm
                  ? '빈 설정 생성 확인'
                  : '빈 예약 차단 설정 만들기'}
            </button>
            {initializeConfirm && !savingKey && (
              <button
                type="button"
                onClick={() => setInitializeConfirm(false)}
                className="mt-1 min-h-11 w-full rounded-xl px-3 text-xs font-bold text-slate-300 outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
              >
                취소
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="mb-3 rounded-xl bg-violet-400/10 px-3 py-2.5" role="status">
              <p className="text-xs font-black text-violet-100">지금 {nowDate} {nowTime}</p>
              <p className="mt-0.5 text-[11px] font-semibold text-slate-200">
                {currentStatus.blocked
                  ? `신규 예약 차단 · ${currentStatus.rule?.reason}`
                  : `신규 예약 가능 · 설정 개정 ${availability.revision}`}
              </p>
            </div>

            <p className="mb-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-[11px] font-semibold leading-relaxed text-slate-200">
              아래 설정은 신규 예약에만 적용됩니다. 기존 확정 예약은 그대로 유지됩니다.
            </p>

            <div className="mb-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={Boolean(savingKey)}
                onClick={() => {
                  setOpenDateDraft(openDateDraft ? null : newOpenDateDraft());
                  setDraft(null);
                  setDeleteConfirmId('');
                  setMessage(null);
                }}
                className="min-h-11 rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-3 text-xs font-black text-emerald-100 outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:opacity-40"
              >
                {openDateDraft ? '날짜 열기 닫기' : '+ 날짜 열기'}
              </button>
              {!draft && (
                <button
                  type="button"
                  disabled={Boolean(savingKey)}
                  onClick={() => { setDraft(newRuleDraft()); setOpenDateDraft(null); setDeleteConfirmId(''); setMessage(null); }}
                  className="min-h-11 rounded-xl bg-gradient-to-r from-violet-500 to-pink-500 px-3 text-xs font-black text-white outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-40"
                >
                  + 차단 추가
                </button>
              )}
            </div>

            {openDateDraft && (
              <section className="mb-3 rounded-xl border border-emerald-300/25 bg-emerald-400/[0.07] p-3" aria-label="차단 날짜 열기">
                <h3 className="text-sm font-black text-white">날짜 열기</h3>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-300">규칙을 나누지 않고 선택한 날짜만 예약 가능하게 엽니다.</p>

                <fieldset className="mt-3">
                  <legend className="text-xs font-bold text-slate-200">열기 범위</legend>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    {([['one_day', '하루만'], ['range', '기간']] as const).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={openDateDraft.mode === mode}
                        onClick={() => setOpenDateDraft({
                          ...openDateDraft,
                          mode,
                          endDate: mode === 'one_day' ? openDateDraft.startDate : openDateDraft.endDate,
                        })}
                        className={`min-h-11 rounded-xl border px-3 text-xs font-black outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 ${openDateDraft.mode === mode ? 'border-emerald-300/50 bg-emerald-500 text-white' : 'border-white/15 bg-white/5 text-slate-300'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <div className={`mt-3 grid gap-2 ${openDateDraft.mode === 'range' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  <label className="text-xs font-bold text-slate-200">
                    {openDateDraft.mode === 'range' ? '시작일' : '열 날짜'}
                    <input
                      type="date"
                      value={openDateDraft.startDate}
                      onChange={(event) => setOpenDateDraft({
                        ...openDateDraft,
                        startDate: event.target.value,
                        endDate: openDateDraft.mode === 'one_day' ? event.target.value : openDateDraft.endDate,
                      })}
                      className="mt-1 min-h-11 w-full rounded-xl border border-white/15 bg-slate-950/70 px-2 text-xs text-white outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                    />
                  </label>
                  {openDateDraft.mode === 'range' && (
                    <label className="text-xs font-bold text-slate-200">
                      종료일
                      <input
                        type="date"
                        value={openDateDraft.endDate}
                        min={openDateDraft.startDate}
                        onChange={(event) => setOpenDateDraft({ ...openDateDraft, endDate: event.target.value })}
                        className="mt-1 min-h-11 w-full rounded-xl border border-white/15 bg-slate-950/70 px-2 text-xs text-white outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                      />
                    </label>
                  )}
                </div>

                <label className="mt-3 block text-xs font-bold text-slate-200">
                  여는 사유
                  <textarea
                    value={openDateDraft.reason}
                    onChange={(event) => setOpenDateDraft({ ...openDateDraft, reason: event.target.value })}
                    rows={2}
                    maxLength={500}
                    placeholder="예: 해당 날짜 예약 가능"
                    className="mt-1 min-h-20 w-full resize-y rounded-xl border border-white/15 bg-slate-950/70 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-emerald-300"
                  />
                </label>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={Boolean(savingKey)}
                    onClick={() => setOpenDateDraft(null)}
                    className="min-h-11 rounded-xl border border-white/15 bg-white/5 px-3 text-xs font-black text-slate-200 outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-40"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(savingKey)}
                    onClick={() => { void saveOpenDate(); }}
                    className="min-h-11 rounded-xl bg-emerald-500 px-3 text-xs font-black text-white outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:opacity-40"
                  >
                    {savingKey.startsWith('open-') ? '저장 중…' : '이 날짜 열기'}
                  </button>
                </div>
              </section>
            )}

            {availability.exceptions.length > 0 && (
              <section className="mb-3" aria-label="열린 날짜 목록">
                <h3 className="mb-2 text-xs font-black text-emerald-100">열린 날짜</h3>
                <div className="space-y-2">
                  {availability.exceptions.map((exception) => (
                    <article key={exception.id} className={`rounded-xl border p-3 ${exception.enabled ? 'border-emerald-300/25 bg-emerald-400/[0.07]' : 'border-white/10 bg-white/[0.035] opacity-65'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-black text-white">
                            {exception.enabled ? '열린 날짜' : '꺼진 열린 날짜'} · {formatExceptionDateRange(exception)}
                          </p>
                          <p className="mt-1 break-words text-[11px] leading-relaxed text-slate-300">
                            기간 내 모든 차단 규칙보다 우선 · {exception.reason}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={Boolean(savingKey)}
                          onClick={() => { void deleteException(exception.id); }}
                          className="min-h-11 shrink-0 rounded-xl border border-rose-300/25 bg-rose-500/10 px-3 text-[11px] font-black text-rose-100 outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:opacity-40"
                        >
                          {savingKey === `close-${exception.id}` ? '반영 중…' : exception.enabled ? '다시 차단' : '기록 삭제'}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {availability.rules.length > 0 && (
              <section className="mb-3 rounded-xl border border-white/10 bg-white/[0.035] p-3" aria-label="전체 차단 상태">
                {enabledCount > 0 ? (
                  <>
                    <p className="text-xs font-black text-white">전체 차단을 잠시 풀어야 하나요?</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-300">모든 규칙을 한 번에 끕니다. 기존 확정 예약에는 영향이 없습니다.</p>
                    <button
                      type="button"
                      disabled={Boolean(savingKey)}
                      onClick={() => { void setEveryRuleEnabled(false); }}
                      className={`mt-2 min-h-11 w-full rounded-xl border px-3 text-xs font-black outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:opacity-40 ${releaseAllConfirm ? 'border-rose-300/45 bg-rose-500/20 text-rose-100' : 'border-white/15 bg-white/5 text-slate-100'}`}
                    >
                      {savingKey === 'disable-all' ? '전체 해제 중…' : releaseAllConfirm ? '모든 차단 해제 확인' : '모든 차단 해제'}
                    </button>
                    {releaseAllConfirm && (
                      <button
                        type="button"
                        disabled={Boolean(savingKey)}
                        onClick={() => setReleaseAllConfirm(false)}
                        className="mt-1 min-h-11 w-full rounded-xl px-3 text-xs font-bold text-slate-300 outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-40"
                      >
                        취소
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-xs font-black text-emerald-100">모든 차단 규칙이 꺼져 있습니다.</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-300">아래 버튼은 이전 상태 복원이 아니라, 꺼진 규칙을 포함한 모든 규칙을 다시 켭니다.</p>
                    <button
                      type="button"
                      disabled={Boolean(savingKey)}
                      onClick={() => { void setEveryRuleEnabled(true); }}
                      className="mt-2 min-h-11 w-full rounded-xl bg-gradient-to-r from-violet-500 to-pink-500 px-3 text-xs font-black text-white outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-40"
                    >
                      {savingKey === 'enable-all' ? '다시 켜는 중…' : '모든 규칙 다시 켜기'}
                    </button>
                  </>
                )}
              </section>
            )}

            <div className="space-y-2" aria-label="예약 차단 규칙 목록">
              {availability.rules.length === 0 && !draft && (
                <p className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-xs text-slate-300">등록된 차단 규칙이 없습니다.</p>
              )}
              {availability.rules.map((rule) => (
                <article key={rule.id} className={`rounded-xl border border-white/10 bg-white/[0.045] p-3 ${rule.enabled ? '' : 'opacity-60'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-black text-white">{formatMoodBookingRuleSummary(rule)}</p>
                      <p className="mt-1 break-words text-[11px] leading-relaxed text-slate-300">사유 · {rule.reason}</p>
                    </div>
                    <button
                      type="button"
                      aria-label={`${formatMoodBookingRuleSummary(rule)} ${rule.enabled ? '사용 중지' : '사용 시작'}`}
                      aria-pressed={rule.enabled}
                      disabled={Boolean(savingKey)}
                      onClick={() => { void toggleRule(rule); }}
                      className="min-h-11 shrink-0 rounded-xl border border-white/15 bg-white/5 px-3 text-[11px] font-black text-white outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-40"
                    >
                      {savingKey === `toggle-${rule.id}` ? '저장 중…' : rule.enabled ? '사용 중' : '꺼짐'}
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={Boolean(savingKey)}
                      onClick={() => { setDraft(draftFromRule(rule)); setOpenDateDraft(null); setDeleteConfirmId(''); setMessage(null); }}
                      className="min-h-11 rounded-xl border border-violet-300/25 bg-violet-400/10 px-3 text-xs font-black text-violet-100 outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-40"
                    >
                      수정
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(savingKey)}
                      onClick={() => { void deleteRule(rule.id); }}
                      className="min-h-11 rounded-xl border border-rose-300/25 bg-rose-500/10 px-3 text-xs font-black text-rose-100 outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:opacity-40"
                    >
                      {savingKey === `delete-${rule.id}` ? '삭제 중…' : deleteConfirmId === rule.id ? '삭제 확인' : '삭제'}
                    </button>
                  </div>
                </article>
              ))}
            </div>

            {draft && (
              <section className="mt-3 rounded-xl border border-violet-300/25 bg-violet-400/[0.07] p-3" aria-label={draft.isNew ? '예약 차단 규칙 추가' : '예약 차단 규칙 수정'}>
                <h3 className="text-sm font-black text-white">{draft.isNew ? '새 차단 규칙' : '차단 규칙 수정'}</h3>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <label className="text-xs font-bold text-slate-200">
                    시작일
                    <input
                      type="date"
                      value={draft.startDate}
                      onChange={(event) => setDraft({ ...draft, startDate: event.target.value })}
                      className="mt-1 min-h-11 w-full rounded-xl border border-white/15 bg-slate-950/70 px-2 text-xs text-white outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
                    />
                  </label>
                  <label className="text-xs font-bold text-slate-200">
                    종료일
                    <input
                      type="date"
                      value={draft.endDate}
                      min={draft.startDate}
                      onChange={(event) => setDraft({ ...draft, endDate: event.target.value })}
                      className="mt-1 min-h-11 w-full rounded-xl border border-white/15 bg-slate-950/70 px-2 text-xs text-white outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
                    />
                  </label>
                </div>

                <fieldset className="mt-3">
                  <legend className="text-xs font-bold text-slate-200">차단 요일</legend>
                  <div className="mt-1 grid grid-cols-4 gap-1">
                    {WEEKDAYS.map((weekday) => {
                      const selected = draft.weekdays.includes(weekday.value);
                      return (
                        <button
                          key={weekday.value}
                          type="button"
                          aria-pressed={selected}
                          aria-label={`${weekday.label}요일 ${selected ? '선택됨' : '선택 안 됨'}`}
                          onClick={() => setDraft({
                            ...draft,
                            weekdays: selected
                              ? draft.weekdays.filter((day) => day !== weekday.value)
                              : [...draft.weekdays, weekday.value],
                          })}
                          className={`min-h-11 rounded-lg border text-xs font-black outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${selected ? 'border-violet-300/50 bg-violet-500 text-white' : 'border-white/15 bg-white/5 text-slate-300'}`}
                        >
                          {weekday.label}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <fieldset className="mt-3">
                  <legend className="text-xs font-bold text-slate-200">차단 범위</legend>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    {([['full_day', '하루 종일'], ['starts_from', '특정 시각부터']] as const).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={draft.mode === mode}
                        onClick={() => setDraft({ ...draft, mode })}
                        className={`min-h-11 rounded-xl border px-2 text-xs font-black outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${draft.mode === mode ? 'border-violet-300/50 bg-violet-500 text-white' : 'border-white/15 bg-white/5 text-slate-300'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </fieldset>

                {draft.mode === 'starts_from' && (
                  <label className="mt-3 block text-xs font-bold text-slate-200">
                    차단 시작 시각
                    <input
                      type="time"
                      value={draft.startTime}
                      onChange={(event) => setDraft({ ...draft, startTime: event.target.value })}
                      className="mt-1 min-h-11 w-full rounded-xl border border-white/15 bg-slate-950/70 px-3 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
                    />
                  </label>
                )}

                <label className="mt-3 block text-xs font-bold text-slate-200">
                  차단 사유
                  <textarea
                    value={draft.reason}
                    onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
                    rows={2}
                    maxLength={500}
                    placeholder="예: 행사 운영으로 배차 불가"
                    className="mt-1 min-h-20 w-full resize-y rounded-xl border border-white/15 bg-slate-950/70 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-violet-300"
                  />
                </label>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={Boolean(savingKey)}
                    onClick={() => setDraft(null)}
                    className="min-h-11 rounded-xl border border-white/15 bg-white/5 px-3 text-xs font-black text-slate-200 outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-40"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(savingKey)}
                    onClick={() => { void saveDraft(); }}
                    className="min-h-11 rounded-xl bg-gradient-to-r from-violet-500 to-pink-500 px-3 text-xs font-black text-white outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-40"
                  >
                    {savingKey.startsWith('save-') ? '저장 중…' : '규칙 저장'}
                  </button>
                </div>
              </section>
            )}
          </>
        )}

        {message && (
          <p
            className={`mt-3 rounded-xl border px-3 py-2.5 text-xs font-bold ${message.kind === 'ok' ? 'border-emerald-300/25 bg-emerald-400/10 text-emerald-100' : 'border-rose-300/25 bg-rose-500/10 text-rose-100'}`}
            role={message.kind === 'ok' ? 'status' : 'alert'}
            aria-live="polite"
          >
            {message.text}
          </p>
        )}
      </div>
    </details>
  );
}
