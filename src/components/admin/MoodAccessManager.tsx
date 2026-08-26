// 어드민 MOOD 접근·금액 확인 권한 관리 모달.
// emails = 조회·예약, admins = 금액 제안/충전, settlementApproverEmails = MOOD 금액 확인.
// 각 이메일 제거 + 하단 추가(list 선택). admins 마지막 1인 제거는 서버가 409 → 그 메시지 표시.
// 운영자 전용 화면이라 한국어 단일. 보안 4중벽(토큰·emailVerified·admins·트랜잭션)은 서버 유지.
import { useCallback, useEffect, useState } from 'react';
import { X, KeyRound, Loader2, Plus, Trash2, ShieldCheck, Eye, BadgeCheck } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';

interface Props {
  open: boolean;
  onClose: () => void;
}

type ListKind = 'emails' | 'admins' | 'settlementApproverEmails';

interface AllowlistData {
  emails: string[];
  admins: string[];
  settlementApproverEmails: string[];
  clientId: string;
}

export function MoodAccessManager({ open, onClose }: Props) {
  const [data, setData] = useState<AllowlistData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // 추가 폼
  const [newEmail, setNewEmail] = useState('');
  const [newList, setNewList] = useState<ListKind>('emails');

  // 진행 중인 작업(중복 클릭 방지) — 'add' | 'remove:<list>:<email>'
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const res = await authFetch('/api/mood-allowlist-admin');
      const json = await res.json().catch(() => ({}));
      if (!json?.ok) {
        setLoadErr(json?.error || `목록 조회 실패 (${res.status})`);
        setData(null);
        return;
      }
      setData({
        emails: Array.isArray(json.data?.emails) ? json.data.emails : [],
        admins: Array.isArray(json.data?.admins) ? json.data.admins : [],
        settlementApproverEmails: Array.isArray(json.data?.settlementApproverEmails) ? json.data.settlementApproverEmails : [],
        clientId: json.data?.clientId || '',
      });
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : '목록 조회 실패');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // 모달 열릴 때마다 최신 목록 로드
  useEffect(() => {
    if (!open) return;
    const loadTimer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(loadTimer);
  }, [open, load]);

  const close = useCallback(() => {
    setNewEmail('');
    setNewList('emails');
    setMsg(null);
    onClose();
  }, [onClose]);

  const mutate = useCallback(
    async (action: 'add' | 'remove', list: ListKind, email: string) => {
      const key = action === 'add' ? 'add' : `remove:${list}:${email}`;
      setBusy(key);
      setMsg(null);
      try {
        const res = await authFetch('/api/mood-allowlist-admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, list, email }),
        });
        const json = await res.json().catch(() => ({}));
        if (json?.ok) {
          if (action === 'add') {
            setMsg({ kind: 'ok', text: `추가 완료 — ${email}` });
            setNewEmail('');
          } else {
            setMsg({ kind: 'ok', text: `제거 완료 — ${email}` });
          }
          await load();
        } else {
          // admins 마지막 1인 제거 = 409, 그 서버 메시지 그대로 표시.
          setMsg({ kind: 'err', text: json?.error || `실패 (${res.status})` });
        }
      } catch (e) {
        setMsg({ kind: 'err', text: e instanceof Error ? e.message : '요청 실패' });
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const submitAdd = useCallback(() => {
    const email = newEmail.trim().toLowerCase();
    if (!email) {
      setMsg({ kind: 'err', text: '이메일을 입력하세요.' });
      return;
    }
    void mutate('add', newList, email);
  }, [newEmail, newList, mutate]);

  if (!open) return null;

  const addBusy = busy === 'add';

  const renderList = (list: ListKind, emails: string[]) => {
    const listLabel = list === 'emails'
      ? '조회·예약 직원'
      : list === 'admins'
        ? '금액 제안 운영자'
        : 'MOOD 금액 확인 담당자';
    if (emails.length === 0) {
      return <p className="px-1 py-2 text-xs text-slate-500">등록된 이메일이 없습니다.</p>;
    }
    return (
      <ul className="flex flex-col gap-1.5">
        {emails.map((email) => {
          const removeKey = `remove:${list}:${email}`;
          const removing = busy === removeKey;
          return (
            <li
              key={email}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-slate-200" title={email}>
                {email}
              </span>
              <button
                type="button"
                onClick={() => void mutate('remove', list, email)}
                disabled={!!busy}
                aria-label={`${listLabel} ${email} 제거`}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-rose-400/10 hover:text-rose-300 disabled:opacity-40"
              >
                {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </button>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div
      className="mood-surface fixed inset-0 z-[120] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center"
      onClick={close}
      translate="no"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mood-access-title"
    >
      <div
        className="flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl border border-purple-300/20 bg-[#181b22] shadow-[0_18px_60px_rgba(0,0,0,0.4)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-[#7C5CFC]" />
            <h2 id="mood-access-title" className="text-sm font-bold text-white">MOOD 접근 관리</h2>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="닫기"
            className="flex h-11 w-11 items-center justify-center text-slate-400 transition-colors hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-col gap-5 overflow-y-auto p-5">
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-slate-300">
              <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…
            </p>
          ) : loadErr ? (
            <p className="rounded-xl border border-rose-400/25 bg-rose-400/[0.08] px-3 py-2 text-sm text-rose-200">
              {loadErr}
            </p>
          ) : data ? (
            <>
              {/* 조회·예약 가능 (emails) */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Eye className="h-4 w-4 text-sky-300" />
                  <h3 className="text-xs font-bold text-slate-300">조회·예약 가능 (직원)</h3>
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-bold text-slate-400">
                    {data.emails.length}
                  </span>
                </div>
                {renderList('emails', data.emails)}
              </div>

              {/* 충전·금액 제안 (admins) */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-[#EA537E]" />
                  <h3 className="text-xs font-bold text-slate-300">충전·금액 제안 (운영자)</h3>
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-bold text-slate-400">
                    {data.admins.length}
                  </span>
                </div>
                {renderList('admins', data.admins)}
                <p className="px-1 text-xs text-slate-500">
                  운영자는 최소 1명 유지됩니다 (마지막 1인 제거 불가).
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <BadgeCheck className="h-4 w-4 text-violet-300" />
                  <h3 className="text-xs font-bold text-slate-300">MOOD 금액 확인 담당자</h3>
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-bold text-slate-400">
                    {data.settlementApproverEmails.length}
                  </span>
                </div>
                {renderList('settlementApproverEmails', data.settlementApproverEmails)}
                <p className="px-1 text-xs leading-relaxed text-slate-500">
                  두 MOOD 계정 모두 등록할 수 있습니다. 운영자와는 권한을 겹칠 수 없어, 제안한 사람이 스스로 확정하지 못합니다.
                </p>
              </div>
            </>
          ) : null}

          {/* 추가 폼 */}
          <div className="flex flex-col gap-2 border-t border-white/[0.06] pt-4">
            <h3 className="text-xs font-bold text-slate-300">이메일 추가</h3>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitAdd();
              }}
              placeholder="예: staff@example.com"
              disabled={!data || !!loadErr}
              className="min-h-11 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-[#7C5CFC]/50 focus:outline-none disabled:opacity-50"
            />
            <div className="flex items-center gap-2">
              <select
                value={newList}
                onChange={(e) => setNewList(e.target.value as ListKind)}
                disabled={!data || !!loadErr}
                className="min-h-11 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white focus:border-[#7C5CFC]/50 focus:outline-none disabled:opacity-50"
              >
                <option value="emails" className="bg-[#181b22]">조회·예약 (직원)</option>
                <option value="admins" className="bg-[#181b22]">금액 제안·충전 (운영자)</option>
                <option value="settlementApproverEmails" className="bg-[#181b22]">MOOD 금액 확인</option>
              </select>
              <button
                type="button"
                onClick={submitAdd}
                disabled={!data || !!loadErr || !!busy || !newEmail.trim()}
                className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-white transition-all hover:brightness-110 disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #EA537E, #7C5CFC)' }}
              >
                {addBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {addBusy ? '추가 중…' : '추가'}
              </button>
            </div>
          </div>

          {msg && (
            <p className={`text-center text-sm ${msg.kind === 'ok' ? 'text-emerald-300' : 'text-rose-300'}`}>
              {msg.text}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
