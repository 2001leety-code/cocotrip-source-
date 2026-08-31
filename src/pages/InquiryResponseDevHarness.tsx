import { useRef, useState } from 'react';
import InquiryResponsePanel, {
  type InquiryResponseActionResult,
  type InquiryResponseDevActionHandler,
  type InquiryResponseWorkflow,
} from '@/components/admin/InquiryResponsePanel';
import { RuntimeFlagsView } from '@/components/admin/RuntimeFlagsView';

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9D86FF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0b14]';
const DEMO_EMAIL = 'demo.customer@example.invalid';

const DRAFT: InquiryResponseWorkflow = {
  draftStatus: 'ready',
  draftSubject: 'Your CocoTrip price inquiry',
  draftBody: 'Thanks for your inquiry. We are reviewing the date, route, group size, and vehicle details. When pricing details are needed, a coordinator will verify the final quote before including them in the reply.',
  draftLanguage: 'en',
  draftSource: 'policy_template',
  draftRevision: 1,
  draftAttempts: 1,
  reviewStatus: 'pending_review',
  deliveryStatus: 'not_sent',
  deliveryAttempts: 0,
  policyVersion: 'inquiry-response.v4',
};

function actionName(request: Record<string, unknown>) {
  return typeof request.action === 'string' ? request.action : '';
}

export default function InquiryResponseDevHarness() {
  const backendWorkflow = useRef<InquiryResponseWorkflow | null>(null);
  const [panelKey, setPanelKey] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [autoAckEnabled, setAutoAckEnabled] = useState(false);

  const record = (code: string) => {
    setHistory((current) => [...current, code]);
  };

  const handleAction: InquiryResponseDevActionHandler = async (request) => {
    const action = actionName(request);
    let result: InquiryResponseActionResult;

    if (action === 'generate') {
      backendWorkflow.current = { ...DRAFT };
      result = { ok: true, code: 'DRAFT_READY', workflow: backendWorkflow.current };
    } else if (action === 'send') {
      const subject = typeof request.subject === 'string' ? request.subject : DRAFT.draftSubject || '';
      const body = typeof request.body === 'string' ? request.body : DRAFT.draftBody || '';
      backendWorkflow.current = {
        ...(backendWorkflow.current || DRAFT),
        reviewStatus: 'approved',
        approvedSubject: subject,
        approvedBody: body,
        approvedRevision: DRAFT.draftRevision,
        deliveryStatus: 'retryable',
        deliveryAttempts: 1,
        nextDeliveryAttemptAtMs: Date.now() + 60_000,
        lastDeliveryErrorCode: 'DEV_PRE_SEND_FAILURE',
      };
      result = { ok: false, code: 'RETRY_SCHEDULED', workflow: backendWorkflow.current };
    } else if (action === 'retry') {
      backendWorkflow.current = {
        ...(backendWorkflow.current || DRAFT),
        deliveryStatus: 'outcome_unknown',
        deliveryAttempts: 2,
        nextDeliveryAttemptAtMs: null,
        lastDeliveryErrorCode: 'DEV_SMTP_OUTCOME_UNKNOWN',
      };
      result = { ok: false, code: 'OUTCOME_UNKNOWN', workflow: backendWorkflow.current };
    } else if (action === 'resolve-outcome' && request.resolution === 'sent') {
      backendWorkflow.current = {
        ...(backendWorkflow.current || DRAFT),
        deliveryStatus: 'sent',
        deliveredAtMs: Date.now(),
      };
      result = { ok: true, code: 'SENT_CONFIRMED', workflow: backendWorkflow.current };
    } else if (action === 'resolve-outcome') {
      backendWorkflow.current = {
        ...(backendWorkflow.current || DRAFT),
        deliveryStatus: 'not_sent',
        nextDeliveryAttemptAtMs: null,
        lastDeliveryErrorCode: null,
      };
      result = { ok: true, code: 'NOT_SENT_CONFIRMED', workflow: backendWorkflow.current };
    } else {
      result = { ok: false, code: 'DEV_UNSUPPORTED_ACTION', workflow: backendWorkflow.current || undefined };
    }

    record(result.code || 'UNKNOWN');
    return result;
  };

  const reset = () => {
    backendWorkflow.current = null;
    setHistory([]);
    setAutoAckEnabled(false);
    setPanelKey((current) => current + 1);
  };

  return (
    <main className="min-h-screen bg-[#0a0b14] px-3 py-5 text-white sm:px-6 sm:py-8" aria-labelledby="inquiry-harness-title">
      <div className="mx-auto w-full max-w-3xl">
        <header className="rounded-xl border border-white/10 bg-white/[0.04] p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#D9CCFF]">DEV 전용 · 외부 전송 없음</p>
              <h1 id="inquiry-harness-title" className="mt-1 text-xl font-black tracking-tight sm:text-2xl">문의 답변 패널 실물 검증</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/70">
                실제 운영 컴포넌트를 쓰되, 아래 조작은 가짜 상태만 바꿉니다. 인증·메일·고객 API를 호출하지 않습니다.
              </p>
            </div>
            <button
              type="button"
              onClick={reset}
              className={`min-h-[44px] shrink-0 rounded-lg border border-white/15 bg-white/[0.07] px-4 text-sm font-bold text-white hover:bg-white/10 ${FOCUS_RING}`}
            >
              처음부터 다시
            </button>
          </div>
          <div className="mt-4 grid gap-3 text-xs leading-5 text-white/70 sm:grid-cols-2">
            <div className="rounded-lg bg-black/20 p-3">
              <p className="font-bold text-white">가짜 문의</p>
              <p className="mt-1 break-all">{DEMO_EMAIL}</p>
              <p>종류: 가격 문의 · 저장 데이터 없음</p>
            </div>
            <ol className="list-decimal space-y-1 rounded-lg bg-black/20 py-3 pl-8 pr-3" aria-label="검증 순서">
              <li>답변 초안 만들기</li>
              <li>검토 완료 · 고객 이메일 발송</li>
              <li>지금 안전 재시도</li>
              <li>발송 여부 확인 선택</li>
            </ol>
          </div>
        </header>

        <section className="mt-4" aria-label="문의 자동화 설정 미리보기">
          <RuntimeFlagsView
            flags={{ inquiry_auto_ack_enabled: autoAckEnabled }}
            schema={{
              inquiry_auto_ack_enabled: {
                label: '문의 자동 접수확인',
                desc: '정확한 안전 기준을 모두 통과한 새 문의에만 접수 확인 메일 발송',
                default: false,
              },
            }}
            onlyKeys={['inquiry_auto_ack_enabled']}
            onRequestToggle={(_key, value) => setAutoAckEnabled(value)}
          />
          <p className="mt-2 text-[11px] leading-5 text-amber-200/75">
            DEV 미리보기입니다. 이 버튼은 화면 상태만 바꾸며 메일·운영 설정을 변경하지 않습니다.
          </p>
        </section>

        <InquiryResponsePanel
          key={panelKey}
          inquiryId="dev-inquiry-price-001"
          email={DEMO_EMAIL}
          ackWorkflow={{
            deliveryStatus: 'sent',
            deliveryAttempts: 1,
            deliveredAtMs: Date.UTC(2026, 7, 31, 6, 0, 0),
          }}
          getIdToken={async () => { throw new Error('DEV 하네스에서 인증을 요청하면 안 됩니다.'); }}
          devActionHandler={handleAction}
        />

        <section className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] p-4" aria-labelledby="dev-action-history">
          <h2 id="dev-action-history" className="text-sm font-bold">가짜 처리 기록</h2>
          {history.length ? (
            <ol className="mt-2 flex flex-wrap gap-2" aria-live="polite">
              {history.map((code, index) => (
                <li key={`${code}-${index}`} className="rounded-full bg-white/[0.07] px-3 py-1.5 text-xs text-white/75">
                  {index + 1}. {code}
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-xs leading-5 text-white/65" role="status">아직 실행한 가짜 동작이 없습니다.</p>
          )}
        </section>
      </div>
    </main>
  );
}
