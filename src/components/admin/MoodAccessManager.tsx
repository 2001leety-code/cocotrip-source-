// 어드민 MOOD 접근·금액 확인 권한 관리 모달.
// 관리자는 서버가 지정한 단일 계정으로 고정하고, 그 외 계정은 직원 소비자/확인 전용으로 관리한다.
// 과거 admins 배열에 잘못 남은 비고정 계정은 이 화면에서 제거만 할 수 있다.
// 운영자 전용 화면이라 한국어 단일. 보안 4중벽(토큰·emailVerified·admins·트랜잭션)은 서버 유지.
import { useCallback, useEffect, useState } from 'react';
import { X, KeyRound, Loader2, Plus, Trash2, ShieldCheck, Eye, BadgeCheck } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';

interface Props {
  open: boolean;
  onClose: () => void;
}

type ListKind = 'emails' | 'admins' | 'settlementApproverEmails';
type AddListKind = Exclude<ListKind, 'admins'>;

interface AllowlistData {
  emails: string[];
  admins: string[];
  settlementApproverEmails: string[];
  clientId: string;
  primaryAdminEmail: string;
  primaryAdminVerified: boolean;
}

// 구버전 API 응답이 잠시 섞여도 빈 관리자 카드가 나오지 않게 하는 표시용 안전값.
const PRIMARY_MOOD_ADMIN_EMAIL_FALLBACK = '2001leety@gmail.com';

export function MoodAccessManager({ open, onClose }: Props) {
  const [data, setData] = useState<AllowlistData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // 추가 폼
  const [newEmail, setNewEmail] = useState('');
  const [newList, setNewList] = useState<AddListKind>('emails');

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
      const reportedPrimaryAdminEmail = typeof json.data?.primaryAdminEmail === 'string'
        ? json.data.primaryAdminEmail.trim().toLowerCase()
        : '';
      setData({
        emails: Array.isArray(json.data?.emails) ? json.data.emails : [],
        admins: Array.isArray(json.data?.admins) ? json.data.admins : [],
        settlementApproverEmails: Array.isArray(json.data?.settlementApproverEmails) ? json.data.settlementApproverEmails : [],
        clientId: json.data?.clientId || '',
        primaryAdminEmail: PRIMARY_MOOD_ADMIN_EMAIL_FALLBACK,
        primaryAdminVerified: reportedPrimaryAdminEmail === PRIMARY_MOOD_ADMIN_EMAIL_FALLBACK,
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
  const editingLocked = !!data && !data.primaryAdminVerified;

  const renderList = (list: ListKind, emails: string[]) => {
    const listLabel = list === 'emails'
      ? '조회·예약 직원'
      : list === 'admins'
        ? '정리 대상 관리자 항목'
        : '금액 확인 전용 직원';
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
                disabled={!!busy || editingLocked}
                aria-label={`${listLabel} ${email} 제거`}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-rose-400/10 hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/70 disabled:opacity-40"
              >
                {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </button>
            </li>
          );
        })}
      </ul>
    );
  };

  const primaryAdminEmail = data?.primaryAdminEmail || '';
  const employeeEmails = data
    ? data.emails.filter((email) => email !== primaryAdminEmail)
    : [];
  const strayAdmins = data
    ? data.admins.filter((email) => email !== primaryAdminEmail)
    : [];

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
            className="flex h-11 w-11 items-center justify-center text-slate-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300/70"
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
              {editingLocked && (
                <p className="rounded-xl border border-amber-300/25 bg-amber-300/[0.08] px-3 py-2 text-xs leading-relaxed text-amber-100" role="alert">
                  서버의 고정 관리자 정보를 확인할 수 없어 편집을 잠갔습니다. 고정 관리자는 {PRIMARY_MOOD_ADMIN_EMAIL_FALLBACK}입니다.
                </p>
              )}

              {/* 직원 소비자 계정 (emails) */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Eye className="h-4 w-4 text-sky-300" />
                  <h3 className="text-xs font-bold text-slate-300">직원 소비자 계정 (조회·예약)</h3>
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-bold text-slate-400">
                    {employeeEmails.length}
                  </span>
                </div>
                {renderList('emails', employeeEmails)}
                <p className="px-1 text-xs leading-relaxed text-slate-400">
                  고정 관리자를 제외한 MOOD 계정의 기본 역할입니다. 조회와 예약만 할 수 있습니다.
                </p>
              </div>

              {/* 고정 관리자 (admins) */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-[#EA537E]" />
                  <h3 className="text-xs font-bold text-slate-300">유일한 고정 관리자 (제안·충전)</h3>
                </div>
                <div className="flex items-center gap-2 rounded-xl border border-[#EA537E]/20 bg-[#EA537E]/[0.06] px-3 py-3">
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-100" title={primaryAdminEmail}>
                    {primaryAdminEmail}
                  </span>
                  <span className="shrink-0 rounded-full bg-[#EA537E]/15 px-2 py-1 text-[11px] font-bold text-rose-200">
                    고정 · 변경 불가
                  </span>
                </div>
                <p className="px-1 text-xs text-slate-400">
                  이 계정만 관리자입니다. 화면에서 추가·교체·삭제할 수 없습니다.
                </p>
                {strayAdmins.length > 0 && (
                  <div className="flex flex-col gap-2 rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-3">
                    <p className="text-xs leading-relaxed text-amber-200">
                      과거 설정에 남은 관리자 항목입니다. 관리자 권한은 없으며 제거해서 정리할 수 있습니다.
                    </p>
                    {renderList('admins', strayAdmins)}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <BadgeCheck className="h-4 w-4 text-violet-300" />
                  <h3 className="text-xs font-bold text-slate-300">직원 금액 확인 전용</h3>
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-bold text-slate-400">
                    {data.settlementApproverEmails.length}
                  </span>
                </div>
                {renderList('settlementApproverEmails', data.settlementApproverEmails)}
                <p className="px-1 text-xs leading-relaxed text-slate-400">
                  직원 소비자 계정에 별도로 부여합니다. 관리자가 제안한 예약 변경·정산 금액을 확인하며 제안·충전 관리자 권한은 없습니다.
                </p>
              </div>
            </>
          ) : null}

          {/* 추가 폼 */}
          <div className="flex flex-col gap-2 border-t border-white/[0.06] pt-4">
            <h3 className="text-xs font-bold text-slate-300">이메일 추가</h3>
            <input
              type="email"
              aria-label="추가할 MOOD 직원 이메일"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitAdd();
              }}
              placeholder="예: staff@example.com"
              disabled={!data || !!loadErr || editingLocked}
              className="min-h-11 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-[#7C5CFC]/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-300/70 disabled:opacity-50"
            />
            <div className="flex items-center gap-2">
              <select
                aria-label="추가할 권한 종류"
                value={newList}
                onChange={(e) => setNewList(e.target.value as AddListKind)}
                disabled={!data || !!loadErr || editingLocked}
                className="min-h-11 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white focus:border-[#7C5CFC]/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-300/70 disabled:opacity-50"
              >
                <option value="emails" className="bg-[#181b22]">직원 소비자 (조회·예약)</option>
                <option value="settlementApproverEmails" className="bg-[#181b22]">직원 금액 확인 전용</option>
              </select>
              <button
                type="button"
                onClick={submitAdd}
                disabled={!data || !!loadErr || editingLocked || !!busy || !newEmail.trim()}
                className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-white transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300/70 disabled:opacity-50"
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
