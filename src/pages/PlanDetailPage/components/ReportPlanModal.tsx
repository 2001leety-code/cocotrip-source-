// ReportPlanModal — 플랜 신고 (Tier 1-A 학습 루프).
// 2026-05-04: PlanDetailPage 우하단 floating 버튼 → 본 모달 → submit → /api/submit-plan-complaint.
// 5개 reason 라디오 + optional detail textarea + 4-lang.
// 2026-05-05: 인라인 LABELS dict → 중앙 i18n (planDetail.report) 이전 (Tier 1-A polish).
import { useState } from 'react';
import { X, AlertTriangle, Check, Loader2 } from 'lucide-react';
import { translations, type Language } from '@/i18n';

type Reason = 'wrong_address' | 'closed_restaurant' | 'inefficient_route' | 'wrong_timing' | 'other';

interface Props {
  open: boolean;
  onClose: () => void;
  planId: string;
  userEmail?: string;
  language: Language;
}

const REASON_KEY: Record<Reason, 'reasonWrongAddress' | 'reasonClosedRestaurant' | 'reasonInefficientRoute' | 'reasonWrongTiming' | 'reasonOther'> = {
  wrong_address: 'reasonWrongAddress',
  closed_restaurant: 'reasonClosedRestaurant',
  inefficient_route: 'reasonInefficientRoute',
  wrong_timing: 'reasonWrongTiming',
  other: 'reasonOther',
};

const REASONS: Reason[] = ['wrong_address', 'closed_restaurant', 'inefficient_route', 'wrong_timing', 'other'];

export function ReportPlanModal({ open, onClose, planId, userEmail = '', language }: Props) {
  const safeLang: Language = (['ko', 'en', 'ja', 'zh'] as Language[]).includes(language) ? language : 'en';
  // planDetail.report은 ReportPlanModal 인라인 LABELS 이전 namespace (PR 2026-05-05).
  const labels = translations[safeLang].planDetail.report;

  const [reason, setReason] = useState<Reason | null>(null);
  const [detail, setDetail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!reason) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/submit-plan-complaint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, reason, detail: detail.trim() || undefined, userEmail }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        if (json.code === 'DUPLICATE_REPORT') {
          throw new Error(labels.duplicateError);
        }
        throw new Error(json.error || 'Submit failed');
      }
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setReason(null);
    setDetail('');
    setError(null);
    setSuccess(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full max-w-md bg-gradient-to-b from-[#0f1628] to-[#0a0f1a] rounded-3xl border border-white/10 shadow-2xl p-6">
        {success ? (
          <>
            <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-emerald-500 flex items-center justify-center">
              <Check className="w-7 h-7 text-white" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2 text-center">{labels.successTitle}</h2>
            <p className="text-sm text-white/65 mb-5 text-center leading-relaxed">{labels.successBody}</p>
            <button
              type="button"
              onClick={handleClose}
              className="w-full py-3 rounded-xl text-white font-bold text-sm"
              style={{ background: 'linear-gradient(135deg, #7C5CFC, #EA537E)' }}
            >
              {labels.closeBtn}
            </button>
          </>
        ) : (
          <>
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
                <h2 className="text-lg font-bold text-white">{labels.title}</h2>
              </div>
              <button type="button" onClick={handleClose} className="text-white/40 hover:text-white/80">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-white/55 mb-4 leading-relaxed">{labels.subtitle}</p>

            {/* Reason 라디오 */}
            <div className="mb-4">
              <p className="text-xs font-semibold text-white/70 mb-2 uppercase tracking-wider">{labels.reasonLabel}</p>
              <div className="space-y-1.5">
                {REASONS.map((r) => (
                  <label
                    key={r}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all ${
                      reason === r ? 'bg-[#7C5CFC]/15 border border-[#7C5CFC]/40' : 'bg-white/[0.03] border border-white/5 hover:bg-white/[0.06]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="reason"
                      value={r}
                      checked={reason === r}
                      onChange={() => setReason(r)}
                      className="accent-[#7C5CFC]"
                    />
                    <span className="text-sm text-white/85">{labels[REASON_KEY[r]]}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Detail textarea */}
            <div className="mb-4">
              <p className="text-xs font-semibold text-white/70 mb-2 uppercase tracking-wider">{labels.detailLabel}</p>
              <textarea
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                placeholder={labels.detailPlaceholder}
                rows={3}
                maxLength={1000}
                className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 focus:border-[#7C5CFC]/40 text-sm text-white/85 placeholder:text-white/30 outline-none"
              />
              <p className="text-[10px] text-white/35 mt-1 text-right">{detail.length}/1000</p>
            </div>

            {error && (
              <p className="text-xs text-red-400 mb-3">{labels.errorPrefix}: {error}</p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 py-3 rounded-xl text-white/70 font-semibold text-sm border border-white/10 hover:bg-white/[0.05]"
              >
                {labels.cancelBtn}
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!reason || submitting}
                className="flex-[2] py-3 rounded-xl text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'linear-gradient(135deg, #7C5CFC, #EA537E)' }}
              >
                {submitting ? (<><Loader2 className="w-4 h-4 animate-spin" /> {labels.submitting}</>) : labels.submitBtn}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
