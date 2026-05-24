// AdminCoupons — 운영자 쿠폰 발행 UI (B9-3, batch 9 fix 2026-05-09)
// 한국어 admin 정책 — 인라인 한국어, i18n 키 X, 사용자 미노출.
// 모바일 친화 — full-width form, 좌측 ArrowLeft 홈 링크.
//
// 기능: 사용자 검색(이메일 또는 uid) + 쿠폰 종류 선택 + 발행 버튼 + 결과 표시
// 백엔드: /api/admin-issue-coupon (verifyAdminToken)
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Tag, CheckCircle, AlertCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

type CouponType = 'percent' | 'fixed';

interface IssuedCoupon {
  couponId: string;
  targetUid: string;
  targetEmail: string;
  type: CouponType;
  value: number;
  currency: string;
  label: string;
  expiresAt: number;
}

// 빠른 발행 프리셋 — 운영자가 가장 자주 쓰는 조합.
const PRESETS: Array<{
  key: string;
  label: string;
  type: CouponType;
  value: number;
  currency?: 'USD' | 'KRW';
  color: string;
}> = [
  { key: 'percent-5',  label: '5% OFF',    type: 'percent', value: 5,  color: 'border-purple-500/40 bg-purple-500/10 text-purple-200' },
  { key: 'percent-10', label: '10% OFF',   type: 'percent', value: 10, color: 'border-blue-500/40 bg-blue-500/10 text-blue-200' },
  { key: 'percent-15', label: '15% OFF',   type: 'percent', value: 15, color: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200' },
  // 2026-05-13 PR #389: fixed-USD ($5/$10 OFF) 신규 발급 차단 — 환율 drift 로 redeem 시 KRW 환산 불일치 위험.
  // 운영자 정책 (5/5 PR #270 후): Trip Coins = percent type 로 통일. 기존 발급된 fixed-USD 쿠폰은
  // api/applyPromoCode.js 의 fixed-USD 처리 로직이 유지되어 redeem 가능 (사용자 컴플레인 0). 신규 발급만 차단.
  // KRW fixed (₩50,000) 는 환율 영향 없으므로 유지.
  { key: 'fixed-50',   label: '₩50,000 OFF', type: 'fixed', value: 50000, currency: 'KRW', color: 'border-pink-500/40 bg-pink-500/10 text-pink-200' },
];

function AdminCoupons() {
  const { user } = useAuth();
  const [target, setTarget] = useState('');  // email or uid
  const [presetKey, setPresetKey] = useState<string>('percent-5');
  const [expiryDays, setExpiryDays] = useState<number>(90);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedCoupon[]>([]);

  const selectedPreset = PRESETS.find(p => p.key === presetKey) || PRESETS[0];

  async function handleIssue() {
    if (!target.trim()) {
      setError('이메일 또는 UID 를 입력하세요.');
      return;
    }
    if (!user) {
      setError('admin 인증 필요 — 로그인 후 다시 시도하세요.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const isEmail = target.includes('@');
      const body: Record<string, unknown> = {
        type: selectedPreset.type,
        value: selectedPreset.value,
        expiryDays,
      };
      if (selectedPreset.type === 'fixed') {
        body.currency = selectedPreset.currency || 'USD';
      }
      if (isEmail) body.targetEmail = target.trim();
      else body.targetUid = target.trim();

      const res = await fetch('/api/admin-issue-coupon', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      const data = json.data as IssuedCoupon;
      setIssued(prev => [data, ...prev].slice(0, 10));
      setTarget('');  // 다음 발행 위해 비움
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to issue coupon');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0412] text-white pb-24">
      <header className="sticky top-0 z-20 bg-[#0a0412]/95 backdrop-blur border-b border-white/[0.06]">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link to="/admin" className="p-2 rounded-lg hover:bg-white/[0.05]" title="어드민으로">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <h1 className="text-base font-bold flex items-center gap-2">
            <Tag className="w-4 h-4 text-[#B668FC]" />
            쿠폰 발행
          </h1>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 space-y-4">
          <div>
            <label className="text-xs uppercase tracking-wider text-white/55 font-semibold mb-1.5 block">
              대상 사용자 (이메일 또는 UID)
            </label>
            <input
              type="text"
              value={target}
              onChange={e => setTarget(e.target.value)}
              placeholder="user@example.com 또는 abc123uid"
              className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-sm focus:border-[#B668FC]/50 focus:outline-none"
              disabled={submitting}
            />
            <p className="text-[11px] text-white/45 mt-1">
              이메일 입력 시 users 컬렉션에서 자동 검색. UID 직접 입력 시 즉시 발행.
            </p>
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-white/55 font-semibold mb-1.5 block">
              쿠폰 종류 (프리셋)
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {PRESETS.map(p => {
                const selected = p.key === presetKey;
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setPresetKey(p.key)}
                    className={`px-3 py-2 rounded-xl border text-sm font-bold transition-all ${
                      selected ? p.color : 'border-white/10 bg-white/[0.03] text-white/60 hover:border-white/25'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-white/55 font-semibold mb-1.5 block">
              만료 기간 (일)
            </label>
            <input
              type="number"
              min={1}
              max={3650}
              value={expiryDays}
              onChange={e => setExpiryDays(Math.max(1, Math.min(3650, Number(e.target.value) || 90)))}
              className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-sm focus:border-[#B668FC]/50 focus:outline-none"
              disabled={submitting}
            />
            <p className="text-[11px] text-white/45 mt-1">기본 90일. 최대 10년 (3650일).</p>
          </div>

          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-200">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="button"
            onClick={handleIssue}
            disabled={submitting || !target.trim()}
            className="w-full py-3 rounded-xl bg-[#B668FC] hover:bg-[#A558E8] disabled:opacity-40 disabled:cursor-not-allowed text-sm font-bold text-white transition-colors"
          >
            {submitting ? '발행 중...' : `${selectedPreset.label} 발행`}
          </button>
        </div>

        {issued.length > 0 && (
          <div>
            <h2 className="text-sm font-bold text-white/85 mb-3">최근 발행 이력 (이번 세션)</h2>
            <div className="space-y-2">
              {issued.map((c) => {
                const expDate = new Date(c.expiresAt).toLocaleDateString();
                return (
                  <div
                    key={c.couponId}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-emerald-500/[0.06] border border-emerald-500/20"
                  >
                    <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-white/85 truncate">
                        <span className="font-bold">{c.label}</span>
                        <span className="text-white/55"> → {c.targetEmail}</span>
                      </p>
                      <p className="text-[10.5px] text-white/45 mt-0.5">
                        만료 {expDate} · couponId {c.couponId.slice(0, 12)}…
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <p className="text-[11px] text-white/35 leading-snug">
          ⓘ 모든 발행 이력은 Firestore <code className="text-white/55">admin_issued_coupons</code>{' '}
          컬렉션에 자동 기록됨 (감사용). 어드민 본인 (운영자) 계정에 발행한 쿠폰은
          isUsed 마킹 skip 정책으로 무제한 사용 가능.
        </p>
      </div>
    </div>
  );
}

export default AdminCoupons;
