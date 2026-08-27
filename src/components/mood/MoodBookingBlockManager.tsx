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

function apiErrorMessage(json: Record<string, unknown>, status: number) {
  const code = typeof json.code === 'string' ? json.code : '';
  if (status === 409 || code === 'REVISION_CONFLICT') return '다른 관리자가 먼저 수정했습니다. 최신 설정을 불러온 뒤 다시 시도해 주세요.';
  if (code === 'REQUEST_ID_REUSED') return '같은 요청 번호가 다른 변경에 사용됐습니다. 다시 시도해 주세요.';
  return typeof json.error === 'string' && json.error ? json.error : `차단 설정 저장 실패 (${status})`;
}

export function MoodBookingBlockManager({ availability, onUpdated, onReload }: Props) {
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [savingKey, setSavingKey] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const requestRef = useRef({ signature: '', requestId: '' });

  const nowDate = moodKstDateISO();
  const nowTime = moodKstTimeHHMM();
  const currentStatus = useMemo(
    () => getMoodBookingBlockStatus(nowDate, nowTime, availability),
    [nowDate, nowTime, availability],
  );
  const enabledCount = availability?.rules.filter((rule) => rule.enabled).length || 0;

  const sendMutation = async (
    payload: { action: 'upsert'; rule: MoodBookingBlockRule } | { action: 'delete'; ruleId: string },
    key: string,
  ) => {
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
        setMessage({ kind: 'err', text: apiErrorMessage(json, response.status) });
        return false;
      }
      if (!next) {
        setMessage({ kind: 'err', text: '저장 응답의 차단 설정을 확인할 수 없습니다. 새로고침해 주세요.' });
        return false;
      }
      requestRef.current = { signature: '', requestId: '' };
      onUpdated(next);
      setMessage({ kind: 'ok', text: '예약 차단 설정을 저장했습니다.' });
      return true;
    } catch (error) {
      setMessage({ kind: 'err', text: error instanceof Error ? error.message : '차단 설정 저장에 실패했습니다.' });
      return false;
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

  const toggleRule = async (rule: MoodBookingBlockRule) => {
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
            <button
              type="button"
              onClick={() => { void onReload(); }}
              className="mt-2 min-h-11 rounded-xl border border-white/15 bg-white/5 px-3 text-xs font-black text-white outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
            >
              설정 다시 불러오기
            </button>
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between gap-3 rounded-xl bg-violet-400/10 px-3 py-2.5" role="status">
              <div className="min-w-0">
                <p className="text-xs font-black text-violet-100">지금 {nowDate} {nowTime}</p>
                <p className="mt-0.5 text-[11px] font-semibold text-slate-200">
                  {currentStatus.blocked
                    ? `신규 예약 차단 · ${currentStatus.rule?.reason}`
                    : `신규 예약 가능 · 설정 개정 ${availability.revision}`}
                </p>
              </div>
              {!draft && (
                <button
                  type="button"
                  onClick={() => { setDraft(newRuleDraft()); setDeleteConfirmId(''); setMessage(null); }}
                  className="min-h-11 shrink-0 rounded-xl bg-gradient-to-r from-violet-500 to-pink-500 px-3 text-xs font-black text-white outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
                >
                  + 차단 추가
                </button>
              )}
            </div>
            <p className="mb-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-[11px] font-semibold leading-relaxed text-slate-200">
              기존 확정 예약은 유지됩니다. 신규 예약과 차단된 날짜·시각으로 바꾸는 변경만 막습니다.
            </p>

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
                      onClick={() => { setDraft(draftFromRule(rule)); setDeleteConfirmId(''); setMessage(null); }}
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
                    {([
                      ['full_day', '하루 종일'],
                      ['starts_from', '특정 시각부터'],
                    ] as const).map(([mode, label]) => (
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
