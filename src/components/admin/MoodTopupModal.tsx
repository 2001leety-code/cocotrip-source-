// 어드민 무드 선불 충전 모달 — /mood 이동 없이 어드민 안에서 바로 충전.
// 잔액 조회 = /api/mood-data, 충전 = /api/mood-topup (기존 API 재사용, 돈 로직 무변경).
// 충전 대상 = 단일 선불 광고사(MOOD). clientId는 서버가 allowlist.clientId로 자동 결정 →
// 운영자는 금액만 입력. 보안 4중벽(토큰·emailVerified·admins·트랜잭션)은 mood-topup에 그대로.
import { useCallback, useEffect, useState } from 'react';
import { X, WalletCards, Loader2, Check, AlertCircle } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface MoodInfo {
  clientId: string;
  name: string;
  balanceKRW: number;
}

function fmtKRW(n: number): string {
  return `₩${Math.round(n).toLocaleString('ko-KR')}`;
}

export function MoodTopupModal({ open, onClose }: Props) {
  const [info, setInfo] = useState<MoodInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const loadBalance = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const res = await authFetch('/api/mood-data');
      const json = await res.json().catch(() => ({}));
      if (!json?.ok) {
        setLoadErr(json?.error || `잔액 조회 실패 (${res.status})`);
        setInfo(null);
        return;
      }
      setInfo({
        clientId: json.data.clientId,
        name: json.data.client?.name || json.data.clientId,
        balanceKRW: Number(json.data.client?.balanceKRW) || 0,
      });
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : '잔액 조회 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  // 모달 열릴 때마다: 상태 초기화 + 현재 잔액 로드
  useEffect(() => {
    if (!open) return;
    setAmount('');
    setNote('');
    setMsg(null);
    void loadBalance();
  }, [open, loadBalance]);

  const submit = useCallback(async () => {
    if (!info?.clientId) return;
    const amt = Number(amount);
    if (!Number.isInteger(amt) || amt <= 0) {
      setMsg({ kind: 'err', text: '충전 금액은 양의 정수(원)여야 합니다.' });
      return;
    }
    setSubmitting(true);
    setMsg(null);
    try {
      const trimmedNote = note.trim().slice(0, 200);
      const res = await authFetch('/api/mood-topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: info.clientId,
          amountKRW: amt,
          ...(trimmedNote ? { note: trimmedNote } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (json?.ok) {
        setMsg({ kind: 'ok', text: `충전 완료 — 잔액 ${fmtKRW(json.data.balanceKRW)}` });
        setAmount('');
        setNote('');
        await loadBalance();
      } else {
        setMsg({ kind: 'err', text: json?.error || `충전 실패 (${res.status})` });
      }
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : '충전 실패' });
    } finally {
      setSubmitting(false);
    }
  }, [info, amount, note, loadBalance]);

  if (!open) return null;

  const amtNum = Number(amount);
  const canSubmit = !!info?.clientId && Number.isInteger(amtNum) && amtNum > 0 && !submitting;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center"
      onClick={onClose}
      translate="no"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-pink-300/25 bg-[#181b22] shadow-[0_18px_60px_rgba(0,0,0,0.4)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <div className="flex items-center gap-2">
            <WalletCards className="h-5 w-5 text-pink-300" />
            <h2 className="text-sm font-bold text-white">무드 선불 잔액 충전</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="flex h-9 w-9 items-center justify-center text-slate-400 transition-colors hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-col gap-4 p-5">
          {/* 현재 잔액 */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <p className="text-xs text-slate-400">현재 잔액{info?.name ? ` · ${info.name}` : ''}</p>
            {loading ? (
              <p className="mt-1 flex items-center gap-2 text-sm text-slate-300">
                <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…
              </p>
            ) : loadErr ? (
              <p className="mt-1 flex items-center gap-2 text-sm text-rose-300">
                <AlertCircle className="h-4 w-4" /> {loadErr}
              </p>
            ) : (
              <p className="mt-1 text-2xl font-black text-white">{fmtKRW(info?.balanceKRW || 0)}</p>
            )}
          </div>

          {/* 충전 금액 */}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-slate-400">충전 금액 (원)</span>
            <input
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="예: 1100000"
              disabled={!info || !!loadErr}
              className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-pink-300/40 focus:outline-none disabled:opacity-50"
            />
          </label>

          {/* 입금 확인 메모 */}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-slate-400">입금 확인 메모 <span className="text-slate-500">(선택)</span></span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
              placeholder="예: 7/3 국민은행 110만원 입금 확인"
              disabled={!info || !!loadErr}
              className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-pink-300/40 focus:outline-none disabled:opacity-50"
            />
          </label>

          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white transition-all hover:brightness-110 disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #EA537E, #7C5CFC)' }}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {submitting ? '충전 중…' : '충전하기'}
          </button>

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
