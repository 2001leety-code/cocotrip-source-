import { useId, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, Loader2, Mail, RefreshCw, Send } from 'lucide-react';

export interface InquiryResponseWorkflow {
  draftStatus?: string | null;
  draftSubject?: string | null;
  draftBody?: string | null;
  draftLanguage?: string | null;
  draftSource?: string | null;
  draftRevision?: number | null;
  draftAttempts?: number | null;
  nextDraftAttemptAtMs?: number | null;
  lastDraftErrorCode?: string | null;
  reviewStatus?: string | null;
  approvedSubject?: string | null;
  approvedBody?: string | null;
  approvedRevision?: number | null;
  deliveryStatus?: string | null;
  deliveryAttempts?: number | null;
  nextDeliveryAttemptAtMs?: number | null;
  lastDeliveryErrorCode?: string | null;
  deliveredAtMs?: number | null;
  policyVersion?: string | null;
}

export interface InquiryResponseActionResult {
  ok?: boolean;
  code?: string;
  workflow?: InquiryResponseWorkflow;
}

export type InquiryResponseDevActionHandler = (
  request: Record<string, unknown> & { inquiryId: string },
) => Promise<InquiryResponseActionResult>;

interface Props {
  inquiryId: string;
  email?: string | null;
  workflow?: InquiryResponseWorkflow | null;
  getIdToken: () => Promise<string>;
  /** DEV 하네스 전용. 운영 빌드에서는 전달돼도 무시하고 인증 API만 사용한다. */
  devActionHandler?: InquiryResponseDevActionHandler;
}

const DELIVERY_LABELS: Record<string, string> = {
  not_sent: '검토 전',
  sending: '발송 확인 중',
  retryable: '안전 재시도 대기',
  sent: '답변 완료',
  outcome_unknown: '실제 발송 여부 확인 필요',
  manual_required: '수동 연락 필요',
};
const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9D86FF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0b14]';

function formatWhen(value?: number | null) {
  return value ? new Date(value).toLocaleString('ko-KR') : '';
}

function resultMessage(code: string) {
  const messages: Record<string, string> = {
    DRAFT_READY: '답변 초안을 준비했습니다. 내용을 확인한 뒤 발송하세요.',
    SENT: '고객 이메일 발송이 확인되었습니다.',
    ALREADY_SENT: '이미 답변 완료된 문의입니다.',
    RETRY_SCHEDULED: '메일을 보내기 전 실패해 안전 재시도를 예약했습니다.',
    OUTCOME_UNKNOWN: '메일 서버에 넘긴 뒤 결과를 확인하지 못했습니다. 메일함에서 실제 발송 여부를 확인하세요.',
    MANUAL_REQUIRED: '자동 이메일을 사용할 수 없습니다. 전화 또는 WhatsApp으로 직접 연락하세요.',
    STALE_DRAFT: '다른 초안이 새로 만들어졌습니다. 화면의 최신 초안을 다시 확인하세요.',
    SEND_IN_PROGRESS: '이미 발송 처리가 진행 중입니다.',
    SENT_CONFIRMED: '실제 발송을 확인해 답변 완료로 기록했습니다.',
    NOT_SENT_CONFIRMED: '실제 발송되지 않은 것으로 기록했습니다. 내용을 확인한 뒤 다시 보낼 수 있습니다.',
    MANUAL_SENT_CONFIRMED: '수동 연락 완료로 기록했습니다.',
    INQUIRY_CLOSED: '이미 종료된 문의라 답변 상태를 바꿀 수 없습니다.',
    MANUAL_NOT_ALLOWED: '자동 발송 가능한 문의입니다. 검토 후 고객 이메일 발송을 사용하세요.',
    NOT_APPROVED: '운영자 승인 본문이 없어 재시도할 수 없습니다.',
    RETRY_NOT_DUE: '안전 재시도 시간이 아직 되지 않았습니다.',
  };
  return messages[code] || `처리 결과: ${code}`;
}

function visibleResponse(workflow?: InquiryResponseWorkflow | null) {
  const approved = workflow?.reviewStatus === 'approved'
    && Boolean(workflow.approvedSubject)
    && Boolean(workflow.approvedBody);
  return {
    subject: approved ? workflow?.approvedSubject || '' : workflow?.draftSubject || '',
    body: approved ? workflow?.approvedBody || '' : workflow?.draftBody || '',
  };
}

export default function InquiryResponsePanel(props: Props) {
  const workflow = props.workflow;
  const workflowVersion = [
    workflow?.draftRevision || 0,
    workflow?.reviewStatus || '',
    workflow?.approvedRevision || 0,
    workflow?.deliveryStatus || '',
    workflow?.deliveryAttempts || 0,
    workflow?.deliveredAtMs || 0,
  ].join(':');
  return <InquiryResponsePanelState key={workflowVersion} {...props} />;
}

function InquiryResponsePanelState({ inquiryId, email, workflow, getIdToken, devActionHandler }: Props) {
  const subjectId = useId();
  const bodyId = useId();
  const initialResponse = visibleResponse(workflow);
  const [currentWorkflow, setCurrentWorkflow] = useState<InquiryResponseWorkflow | null>(workflow || null);
  const [subject, setSubject] = useState(initialResponse.subject);
  const [body, setBody] = useState(initialResponse.body);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error' | 'warn'; text: string } | null>(null);

  function applyResultWorkflow(result: InquiryResponseActionResult) {
    if (result.workflow) {
      const nextResponse = visibleResponse(result.workflow);
      setCurrentWorkflow(result.workflow);
      setSubject(nextResponse.subject);
      setBody(nextResponse.body);
      return;
    }
    const deliveryByCode: Record<string, string> = {
      SENT: 'sent',
      ALREADY_SENT: 'sent',
      SENT_CONFIRMED: 'sent',
      MANUAL_SENT_CONFIRMED: 'sent',
      RETRY_SCHEDULED: 'retryable',
      OUTCOME_UNKNOWN: 'outcome_unknown',
      MANUAL_REQUIRED: 'manual_required',
      NOT_SENT_CONFIRMED: 'not_sent',
      SEND_IN_PROGRESS: 'sending',
    };
    const deliveryStatus = deliveryByCode[result.code || ''];
    if (deliveryStatus) {
      setCurrentWorkflow(previous => ({ ...(previous || {}), deliveryStatus }));
    }
  }

  async function callAction(payload: Record<string, unknown>) {
    if (import.meta.env.DEV && devActionHandler) {
      return devActionHandler({ inquiryId, ...payload });
    }
    const token = await getIdToken();
    const response = await fetch('/api/admin-inquiry-response', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inquiryId, ...payload }),
    });
    let data: InquiryResponseActionResult = {};
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok && response.status !== 202) {
      if (data.workflow) applyResultWorkflow(data);
      const error = new Error(resultMessage(data.code || `HTTP_${response.status}`));
      Object.assign(error, { code: data.code });
      throw error;
    }
    return data;
  }

  async function generate() {
    if (busy) return;
    setBusy('generate');
    setNotice(null);
    try {
      const result = await callAction({ action: 'generate' });
      applyResultWorkflow(result);
      setNotice({ kind: 'ok', text: resultMessage(result.code || 'DRAFT_READY') });
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '초안 생성 실패' });
    } finally {
      setBusy('');
    }
  }

  async function sendResponse() {
    if (busy || !currentWorkflow?.draftRevision) return;
    const target = email || '저장된 연락처';
    if (!window.confirm(`${target} 고객에게 이 답변을 발송하시겠습니까?\n\n발송 뒤에는 자동으로 다시 보내지 않습니다.`)) return;
    setBusy('send');
    setNotice(null);
    try {
      const result = await callAction({
        action: 'send',
        expectedDraftRevision: currentWorkflow.draftRevision,
        subject,
        body,
      });
      const code = result.code || 'SENT';
      applyResultWorkflow(result);
      setNotice({ kind: code === 'OUTCOME_UNKNOWN' ? 'warn' : 'ok', text: resultMessage(code) });
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '발송 실패' });
    } finally {
      setBusy('');
    }
  }

  async function retry() {
    if (busy) return;
    setBusy('retry');
    setNotice(null);
    try {
      const result = await callAction({ action: 'retry' });
      applyResultWorkflow(result);
      setNotice({ kind: result.code === 'OUTCOME_UNKNOWN' ? 'warn' : 'ok', text: resultMessage(result.code || 'SENT') });
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '재시도 실패' });
    } finally {
      setBusy('');
    }
  }

  async function resolveOutcome(resolution: 'sent' | 'not_sent') {
    const text = resolution === 'sent'
      ? '보낸편지함에서 이 고객에게 실제 발송된 것을 확인했습니까?'
      : '보낸편지함과 고객 스레드에서 실제 발송되지 않은 것을 확인했습니까?';
    if (!window.confirm(text)) return;
    setBusy('resolve');
    setNotice(null);
    try {
      const result = await callAction({ action: 'resolve-outcome', resolution });
      applyResultWorkflow(result);
      setNotice({ kind: 'ok', text: resultMessage(result.code || '') });
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '확인 저장 실패' });
    } finally {
      setBusy('');
    }
  }

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText([subject, body].filter(Boolean).join('\n\n'));
      setNotice({ kind: 'ok', text: '초안을 복사했습니다.' });
    } catch {
      setNotice({ kind: 'error', text: '클립보드에 복사하지 못했습니다.' });
    }
  }

  async function markManualSent() {
    if (!window.confirm('외부 메일·전화·WhatsApp 등으로 실제 답변을 보낸 뒤에만 완료 처리하세요. 완료했습니까?')) return;
    setBusy('manual');
    try {
      const result = await callAction({ action: 'mark-manual-sent' });
      applyResultWorkflow(result);
      setNotice({ kind: 'ok', text: resultMessage(result.code || '') });
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '완료 기록 실패' });
    } finally {
      setBusy('');
    }
  }

  const delivery = currentWorkflow?.deliveryStatus || (email ? 'not_sent' : 'manual_required');
  const hasDraft = Boolean(subject && body && currentWorkflow?.draftRevision);
  const aiDraft = currentWorkflow?.draftSource === 'ai';
  // 이메일이 없는 수동 연락 문의도 AI 초안을 만들고 다듬어 복사할 수 있어야 한다.
  // 실제 상태 변경은 아래의 명시적 "답변 완료" 확인 버튼에서만 일어난다.
  const locked = ['sent', 'sending', 'retryable', 'outcome_unknown'].includes(delivery);
  const canSendEmail = Boolean(email) && delivery === 'not_sent';
  const canMarkManual = delivery === 'manual_required'
    || (!email && !['sent', 'sending', 'outcome_unknown'].includes(delivery));

  return (
    <section className="mt-4 rounded-xl border border-[#7C5CFC]/25 bg-[#7C5CFC]/[0.06] p-3 sm:p-4" aria-label="문의 답변 준비">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-white">검토용 답변 초안</h3>
            <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${delivery === 'sent' ? 'bg-emerald-500/15 text-emerald-300' : delivery === 'outcome_unknown' ? 'bg-amber-500/15 text-amber-300' : 'bg-white/[0.07] text-white/60'}`}>
              {DELIVERY_LABELS[delivery] || delivery}
            </span>
            {hasDraft && (
              <span className="rounded-full bg-white/[0.06] px-2 py-1 text-[10px] text-white/65">
                {aiDraft ? '이전 AI 초안' : '정책 템플릿'} · {currentWorkflow?.draftLanguage || 'en'}
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] leading-5 text-white/65">
            금액·예약 확정은 자동 생성하지 않습니다. 운영자가 내용을 읽고 발송을 눌러야 고객에게 전송됩니다.
          </p>
        </div>
        <button type="button" onClick={generate} disabled={Boolean(busy) || locked}
          className={`inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-lg border border-[#7C5CFC]/35 bg-[#7C5CFC]/15 px-3 text-xs font-bold text-[#D9CCFF] disabled:opacity-40 ${FOCUS_RING}`}>
          {busy === 'generate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {hasDraft ? '답변 초안 다시 만들기' : '답변 초안 만들기'}
        </button>
      </div>

      {hasDraft ? (
        <div className="mt-4 space-y-3">
          <div>
            <label htmlFor={subjectId} className="mb-1.5 block text-[11px] font-bold text-white/60">이메일 제목</label>
            <input id={subjectId} value={subject} onChange={event => setSubject(event.target.value)} disabled={locked}
              className="min-h-[44px] w-full rounded-lg border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-[#9D86FF] focus:ring-2 focus:ring-[#7C5CFC]/25 disabled:opacity-60" />
          </div>
          <div>
            <label htmlFor={bodyId} className="mb-1.5 block text-[11px] font-bold text-white/60">고객에게 보낼 내용</label>
            <textarea id={bodyId} value={body} onChange={event => setBody(event.target.value)} disabled={locked}
              rows={7} className="w-full resize-y rounded-lg border border-white/10 bg-black/20 px-3 py-3 text-sm leading-6 text-white outline-none focus:border-[#9D86FF] focus:ring-2 focus:ring-[#7C5CFC]/25 disabled:opacity-60" />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button type="button" onClick={copyDraft} disabled={Boolean(busy)}
              className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.05] px-4 text-xs font-bold text-white/70 disabled:opacity-40 ${FOCUS_RING}`}>
              <Copy className="h-4 w-4" /> 초안 복사
            </button>
            {canSendEmail ? (
              <button type="button" onClick={sendResponse} disabled={Boolean(busy)}
                className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-500/20 px-4 text-xs font-bold text-emerald-200 disabled:opacity-40 sm:flex-none ${FOCUS_RING}`}>
                {busy === 'send' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                검토 완료 · 고객 이메일 발송
              </button>
            ) : canMarkManual ? (
              <button type="button" onClick={markManualSent} disabled={Boolean(busy) || delivery === 'sent'}
                className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg bg-amber-500/20 px-4 text-xs font-bold text-amber-200 disabled:opacity-40 sm:flex-none ${FOCUS_RING}`}>
                <CheckCircle2 className="h-4 w-4" /> {email ? '외부 메일·직접 답변 완료' : '전화·WhatsApp 답변 완료'}
              </button>
            ) : null}
            {delivery === 'retryable' && (
              <button type="button" onClick={retry} disabled={Boolean(busy)}
                className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-4 text-xs font-bold text-amber-200 disabled:opacity-40 ${FOCUS_RING}`}>
                <Mail className="h-4 w-4" /> 지금 안전 재시도
              </button>
            )}
          </div>

          {delivery === 'retryable' && currentWorkflow?.nextDeliveryAttemptAtMs && (
            <p className="text-[11px] text-amber-200/70">자동 재시도 예정: {formatWhen(currentWorkflow.nextDeliveryAttemptAtMs)}</p>
          )}
          {delivery === 'outcome_unknown' && (
            <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-3">
              <div className="flex gap-2 text-xs leading-5 text-amber-100">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>메일 서버에 전달한 뒤 응답을 잃었습니다. 중복 발송을 막기 위해 자동 재시도하지 않습니다. 보낸편지함에서 먼저 확인하세요.</p>
              </div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <button type="button" onClick={() => resolveOutcome('sent')} disabled={Boolean(busy)}
                  className={`min-h-[44px] flex-1 rounded-lg bg-emerald-500/20 px-3 text-xs font-bold text-emerald-200 disabled:opacity-40 ${FOCUS_RING}`}>실제 발송됨</button>
                <button type="button" onClick={() => resolveOutcome('not_sent')} disabled={Boolean(busy)}
                  className={`min-h-[44px] flex-1 rounded-lg bg-white/[0.07] px-3 text-xs font-bold text-white/70 disabled:opacity-40 ${FOCUS_RING}`}>실제 발송 안 됨</button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-xs text-white/60">
          아직 답변 초안이 없습니다. 자동 워커가 준비하거나 위 버튼으로 바로 만들 수 있습니다.
        </div>
      )}

      {currentWorkflow?.lastDraftErrorCode && currentWorkflow.draftSource !== 'ai' && (
        <p className="mt-3 break-words text-[11px] text-amber-200/65">AI가 잠시 응답하지 않아 안전 템플릿을 표시했습니다. 코드: {currentWorkflow.lastDraftErrorCode}</p>
      )}
      {notice && (
        <div role={notice.kind === 'error' ? 'alert' : 'status'} aria-live="polite"
          className={`mt-3 rounded-lg px-3 py-2 text-xs ${notice.kind === 'error' ? 'bg-rose-500/10 text-rose-200' : notice.kind === 'warn' ? 'bg-amber-500/10 text-amber-100' : 'bg-emerald-500/10 text-emerald-200'}`}>
          {notice.text}
        </div>
      )}
    </section>
  );
}
