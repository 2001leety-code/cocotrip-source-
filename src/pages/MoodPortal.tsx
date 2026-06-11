/**
 * MoodPortal — MOOD B2B 선불 예약 포털 (숨은 /mood 모듈)
 *
 * 운영자 MOOD brand consulting (매니저업) 이 광고사에 시급 매니저/차량 제공.
 * 광고사가 선불 충전 후 예약마다 잔액 차감.
 *
 * 🔒 고객 노출 금지: 공개 네비/링크/프리렌더에 절대 추가 안 함. 접근은
 *    로그인 + mood_config/allowlist 게이트로만. 비-allowlist 사용자는 "접근 권한 없음".
 *
 * 모바일 퍼스트 (운영자가 모바일로 더 많이 씀). 한 화면: 잔액 카드 / 예약 폼 /
 * 공유 캘린더 / (admin) 충전. 디자인: dark navy + purple/pink gradient.
 *
 * 인증: Firebase auth + ID 토큰을 authFetch 가 Authorization: Bearer 로 첨부.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { signInWithGoogle } from '@/lib/firebase';
import { authFetch } from '@/lib/authFetch';
import {
  MOOD_RATES,
  MOOD_MAX_DURATION_HOURS,
  estimateMoodAmountKRW,
  formatKRW,
  type MoodServiceType,
} from '@/lib/moodPricing';

// ── 디자인 토큰 (DESIGN.md: dark navy + purple/pink gradient) ──────────
const C = {
  bgGradient: 'linear-gradient(160deg, #0a0412 0%, #0d0618 55%, #080210 100%)',
  card: 'rgba(15,18,32,0.92)',
  cardBorder: '1px solid rgba(124,92,252,0.16)',
  accent: 'linear-gradient(135deg, #7C5CFC, #EA537E)',
  accentSolid: '#B668FC',
  text: '#ffffff',
  textDim: 'rgba(255,255,255,0.55)',
  danger: '#f87171',
  inputBg: 'rgba(124,92,252,0.06)',
  inputBorder: '1px solid rgba(124,92,252,0.18)',
};

interface MoodBooking {
  id: string;
  date: string;
  startTime: string;
  durationHours: number;
  serviceType: MoodServiceType;
  amountKRW: number;
  status: string;
  createdByEmail: string;
  createdAt: number;
}

interface MoodData {
  clientId: string;
  client: { name: string; balanceKRW: number };
  bookings: MoodBooking[];
  isAdmin: boolean;
}

const SERVICE_LABEL: Record<MoodServiceType, string> = {
  vehicle: '차량',
  manager: '매니저',
};

function todayISO(): string {
  const d = new Date();
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return tz.toISOString().slice(0, 10);
}

export default function MoodPortal() {
  const { user, loading } = useAuth();

  const [data, setData] = useState<MoodData | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  // 예약 폼 상태
  const [date, setDate] = useState(todayISO());
  const [startTime, setStartTime] = useState('10:00');
  const [durationHours, setDurationHours] = useState(2);
  const [serviceType, setServiceType] = useState<MoodServiceType>('manager');
  const [submitting, setSubmitting] = useState(false);
  const [formMsg, setFormMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // 충전 폼 상태 (admin)
  const [topupClientId, setTopupClientId] = useState('');
  const [topupAmount, setTopupAmount] = useState('');
  const [topupSubmitting, setTopupSubmitting] = useState(false);
  const [topupMsg, setTopupMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const estimate = useMemo(
    () => estimateMoodAmountKRW(serviceType, durationHours),
    [serviceType, durationHours],
  );

  const loadData = useCallback(async (clientId?: string) => {
    setDataLoading(true);
    setDataError(null);
    try {
      const qs = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
      const res = await authFetch(`/api/mood-data${qs}`);
      const json = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setForbidden(true);
        setData(null);
        return;
      }
      if (!json?.ok) {
        setDataError(json?.error || `조회 실패 (${res.status})`);
        return;
      }
      setForbidden(false);
      setData(json.data as MoodData);
      if (json.data?.clientId && !topupClientId) setTopupClientId(json.data.clientId);
    } catch (e) {
      setDataError(e instanceof Error ? e.message : '조회 실패');
    } finally {
      setDataLoading(false);
    }
  }, [topupClientId]);

  useEffect(() => {
    if (user) loadData();
  }, [user, loadData]);

  const handleBook = useCallback(async () => {
    if (!data) return;
    setSubmitting(true);
    setFormMsg(null);
    try {
      const res = await authFetch('/api/mood-book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: data.clientId,
          date,
          startTime,
          durationHours,
          serviceType,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (json?.ok) {
        setFormMsg({ kind: 'ok', text: `예약 완료 — ${formatKRW(json.data.amountKRW)} 차감, 잔액 ${formatKRW(json.data.balanceKRW)}` });
        await loadData(data.clientId);
      } else if (json?.error === 'INSUFFICIENT_BALANCE') {
        setFormMsg({ kind: 'err', text: `잔액 부족 — 필요 ${formatKRW(json.amountKRW)}, 잔액 ${formatKRW(json.balanceKRW)}` });
      } else {
        setFormMsg({ kind: 'err', text: json?.error || `예약 실패 (${res.status})` });
      }
    } catch (e) {
      setFormMsg({ kind: 'err', text: e instanceof Error ? e.message : '예약 실패' });
    } finally {
      setSubmitting(false);
    }
  }, [data, date, startTime, durationHours, serviceType, loadData]);

  const handleTopup = useCallback(async () => {
    setTopupSubmitting(true);
    setTopupMsg(null);
    try {
      const res = await authFetch('/api/mood-topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: topupClientId.trim(), amountKRW: Number(topupAmount) }),
      });
      const json = await res.json().catch(() => ({}));
      if (json?.ok) {
        setTopupMsg({ kind: 'ok', text: `충전 완료 — 잔액 ${formatKRW(json.data.balanceKRW)}` });
        setTopupAmount('');
        await loadData(data?.clientId);
      } else {
        setTopupMsg({ kind: 'err', text: json?.error || `충전 실패 (${res.status})` });
      }
    } catch (e) {
      setTopupMsg({ kind: 'err', text: e instanceof Error ? e.message : '충전 실패' });
    } finally {
      setTopupSubmitting(false);
    }
  }, [topupClientId, topupAmount, data, loadData]);

  // ── 로딩 / 미로그인 / 권한없음 게이트 ─────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: C.bgGradient }}>
        <div className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor: C.accentSolid, borderTopColor: 'transparent' }} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: C.bgGradient }}>
        <div className="w-full max-w-sm rounded-2xl p-8 text-center" style={{ background: C.card, border: C.cardBorder }}>
          <h1 className="text-xl font-bold mb-2" style={{ color: C.text }}>MOOD 포털</h1>
          <p className="text-sm mb-6" style={{ color: C.textDim }}>로그인이 필요합니다.</p>
          <button
            onClick={() => { void signInWithGoogle(); }}
            className="w-full py-3.5 rounded-xl font-bold transition-all hover:scale-[1.02]"
            style={{ background: '#fff', color: '#1a1a2e' }}
          >
            구글로 로그인
          </button>
        </div>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: C.bgGradient }}>
        <div className="w-full max-w-sm rounded-2xl p-8 text-center" style={{ background: C.card, border: C.cardBorder }}>
          <h1 className="text-xl font-bold mb-2" style={{ color: C.text }}>접근 권한 없음</h1>
          <p className="text-sm" style={{ color: C.textDim }}>
            이 포털은 승인된 사용자만 이용할 수 있습니다.<br />
            ({user.email})
          </p>
        </div>
      </div>
    );
  }

  const balance = data?.client.balanceKRW || 0;
  const lowBalance = balance < estimate;

  return (
    <div className="min-h-screen px-4 py-6" style={{ background: C.bgGradient }}>
      <div className="mx-auto w-full max-w-md flex flex-col gap-5">
        {/* 헤더 */}
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold" style={{ color: C.text }}>
            MOOD <span style={{ color: C.accentSolid }}>예약 포털</span>
          </h1>
          {data && <span className="text-xs" style={{ color: C.textDim }}>{data.client.name}</span>}
        </div>

        {/* 잔액 카드 */}
        <div className="rounded-2xl p-6" style={{ background: C.card, border: C.cardBorder }}>
          <p className="text-xs mb-1.5" style={{ color: C.textDim }}>선불 잔액</p>
          <p
            className="text-3xl font-extrabold tracking-tight"
            style={{ color: balance < 0 || (estimate > 0 && balance < estimate) ? C.danger : C.text }}
          >
            {dataLoading && !data ? '…' : formatKRW(balance)}
          </p>
          {dataError && <p className="text-xs mt-2" style={{ color: C.danger }}>{dataError}</p>}
        </div>

        {/* 예약 폼 */}
        <div className="rounded-2xl p-5 flex flex-col gap-4" style={{ background: C.card, border: C.cardBorder }}>
          <h2 className="text-sm font-bold" style={{ color: C.text }}>예약하기</h2>

          {/* 서비스 토글 */}
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(MOOD_RATES) as MoodServiceType[]).map((st) => {
              const active = serviceType === st;
              return (
                <button
                  key={st}
                  onClick={() => setServiceType(st)}
                  className="py-3 rounded-xl text-sm font-semibold transition-all"
                  style={{
                    background: active ? C.accent : C.inputBg,
                    color: active ? '#fff' : C.textDim,
                    border: active ? '1px solid transparent' : C.inputBorder,
                  }}
                >
                  {SERVICE_LABEL[st]}
                  <span className="block text-[11px] font-normal mt-0.5 opacity-80">
                    {formatKRW(MOOD_RATES[st])}/시간
                  </span>
                </button>
              );
            })}
          </div>

          {/* 날짜 */}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs" style={{ color: C.textDim }}>날짜</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-xl px-3 py-2.5 text-sm"
              style={{ background: C.inputBg, border: C.inputBorder, color: C.text, colorScheme: 'dark' }}
            />
          </label>

          {/* 시작 시각 */}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs" style={{ color: C.textDim }}>시작 시각</span>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="rounded-xl px-3 py-2.5 text-sm"
              style={{ background: C.inputBg, border: C.inputBorder, color: C.text, colorScheme: 'dark' }}
            />
          </label>

          {/* 시간 (duration) */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs" style={{ color: C.textDim }}>이용 시간</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setDurationHours((h) => Math.max(1, h - 1))}
                className="w-10 h-10 rounded-xl text-lg font-bold shrink-0"
                style={{ background: C.inputBg, border: C.inputBorder, color: C.text }}
                aria-label="시간 감소"
              >
                −
              </button>
              <input
                type="number"
                min={1}
                max={MOOD_MAX_DURATION_HOURS}
                value={durationHours}
                onChange={(e) => {
                  const v = Math.round(Number(e.target.value));
                  if (Number.isFinite(v)) setDurationHours(Math.min(MOOD_MAX_DURATION_HOURS, Math.max(1, v)));
                }}
                className="flex-1 text-center rounded-xl px-3 py-2.5 text-sm"
                style={{ background: C.inputBg, border: C.inputBorder, color: C.text }}
              />
              <span className="text-sm shrink-0" style={{ color: C.textDim }}>시간</span>
              <button
                onClick={() => setDurationHours((h) => Math.min(MOOD_MAX_DURATION_HOURS, h + 1))}
                className="w-10 h-10 rounded-xl text-lg font-bold shrink-0"
                style={{ background: C.inputBg, border: C.inputBorder, color: C.text }}
                aria-label="시간 증가"
              >
                +
              </button>
            </div>
          </div>

          {/* 예상 금액 */}
          <div className="flex items-center justify-between px-1">
            <span className="text-xs" style={{ color: C.textDim }}>예상 금액</span>
            <span className="text-lg font-bold" style={{ color: lowBalance ? C.danger : C.accentSolid }}>
              {formatKRW(estimate)}
            </span>
          </div>

          <button
            onClick={() => { void handleBook(); }}
            disabled={submitting || !data}
            className="w-full py-3.5 rounded-xl font-bold transition-all hover:scale-[1.01] disabled:opacity-50"
            style={{ background: C.accent, color: '#fff' }}
          >
            {submitting ? '예약 중…' : '예약하기'}
          </button>

          {formMsg && (
            <p className="text-xs text-center" style={{ color: formMsg.kind === 'ok' ? '#6ee7b7' : C.danger }}>
              {formMsg.text}
            </p>
          )}
        </div>

        {/* 공유 캘린더 (이번 달 예약) */}
        <div className="rounded-2xl p-5" style={{ background: C.card, border: C.cardBorder }}>
          <h2 className="text-sm font-bold mb-3" style={{ color: C.text }}>예약 현황</h2>
          {!data || data.bookings.length === 0 ? (
            <p className="text-xs" style={{ color: C.textDim }}>예약 내역이 없습니다.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.bookings.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between rounded-xl px-3 py-2.5"
                  style={{ background: C.inputBg, border: C.inputBorder }}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold" style={{ color: C.text }}>
                      {b.date} · {b.startTime}
                    </p>
                    <p className="text-[11px] truncate" style={{ color: C.textDim }}>
                      {SERVICE_LABEL[b.serviceType] || b.serviceType} {b.durationHours}시간 · {b.createdByEmail}
                    </p>
                  </div>
                  <span className="text-sm font-bold shrink-0 ml-2" style={{ color: C.accentSolid }}>
                    {formatKRW(b.amountKRW)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 충전 (admin 전용) */}
        {data?.isAdmin && (
          <div className="rounded-2xl p-5 flex flex-col gap-3" style={{ background: C.card, border: '1px solid rgba(234,83,126,0.25)' }}>
            <h2 className="text-sm font-bold" style={{ color: C.text }}>잔액 충전 <span className="text-[11px] font-normal" style={{ color: C.textDim }}>(운영자)</span></h2>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs" style={{ color: C.textDim }}>clientId</span>
              <input
                value={topupClientId}
                onChange={(e) => setTopupClientId(e.target.value)}
                className="rounded-xl px-3 py-2.5 text-sm"
                style={{ background: C.inputBg, border: C.inputBorder, color: C.text }}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs" style={{ color: C.textDim }}>충전 금액 (원)</span>
              <input
                type="number"
                min={1}
                value={topupAmount}
                onChange={(e) => setTopupAmount(e.target.value)}
                placeholder="예: 1000000"
                className="rounded-xl px-3 py-2.5 text-sm"
                style={{ background: C.inputBg, border: C.inputBorder, color: C.text }}
              />
            </label>
            <button
              onClick={() => { void handleTopup(); }}
              disabled={topupSubmitting || !topupClientId.trim() || !(Number(topupAmount) > 0)}
              className="w-full py-3 rounded-xl font-bold transition-all hover:scale-[1.01] disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #EA537E, #7C5CFC)', color: '#fff' }}
            >
              {topupSubmitting ? '충전 중…' : '충전하기'}
            </button>
            {topupMsg && (
              <p className="text-xs text-center" style={{ color: topupMsg.kind === 'ok' ? '#6ee7b7' : C.danger }}>
                {topupMsg.text}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
