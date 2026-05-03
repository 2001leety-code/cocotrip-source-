// ReportPlanModal — 플랜 신고 (Tier 1-A 학습 루프).
// 2026-05-04: PlanDetailPage 우하단 floating 버튼 → 본 모달 → submit → /api/submit-plan-complaint.
// 5개 reason 라디오 + optional detail textarea + 4-lang.
import { useState } from 'react';
import { X, AlertTriangle, Check, Loader2 } from 'lucide-react';

type Reason = 'wrong_address' | 'closed_restaurant' | 'inefficient_route' | 'wrong_timing' | 'other';

interface Props {
  open: boolean;
  onClose: () => void;
  planId: string;
  userEmail?: string;
  language: 'ko' | 'en' | 'ja' | 'zh';
}

const LABELS: Record<string, {
  title: string;
  subtitle: string;
  reasonLabel: string;
  reasons: Record<Reason, string>;
  detailLabel: string;
  detailPlaceholder: string;
  submitBtn: string;
  submitting: string;
  cancelBtn: string;
  successTitle: string;
  successBody: string;
  closeBtn: string;
  errorPrefix: string;
  duplicateError: string;
}> = {
  ko: {
    title: '플랜 문제 신고',
    subtitle: '잘못된 정보·동선·식당 폐업 등을 알려주세요. 플랜 품질 개선에 사용됩니다.',
    reasonLabel: '문제 유형',
    reasons: {
      wrong_address: '주소가 잘못됨',
      closed_restaurant: '식당/장소 폐업',
      inefficient_route: '동선이 비효율적',
      wrong_timing: '시간 정보 부정확',
      other: '기타',
    },
    detailLabel: '상세 (선택)',
    detailPlaceholder: '예: 2일차 점심 식당이 1년 전 폐업했어요',
    submitBtn: '신고하기',
    submitting: '전송 중...',
    cancelBtn: '취소',
    successTitle: '신고 접수 완료',
    successBody: '소중한 의견 감사합니다. 검토 후 플랜 개선에 반영하겠습니다.',
    closeBtn: '닫기',
    errorPrefix: '오류',
    duplicateError: '이미 24시간 이내에 같은 플랜을 신고하셨어요.',
  },
  en: {
    title: 'Report Plan Issue',
    subtitle: 'Let us know about incorrect info, inefficient route, or closed restaurants. Helps us improve plan quality.',
    reasonLabel: 'Issue type',
    reasons: {
      wrong_address: 'Wrong address',
      closed_restaurant: 'Restaurant/place closed',
      inefficient_route: 'Inefficient route',
      wrong_timing: 'Inaccurate timing',
      other: 'Other',
    },
    detailLabel: 'Details (optional)',
    detailPlaceholder: 'e.g. Day 2 lunch restaurant closed a year ago',
    submitBtn: 'Submit',
    submitting: 'Submitting...',
    cancelBtn: 'Cancel',
    successTitle: 'Report received',
    successBody: 'Thanks for your feedback. We will review and improve.',
    closeBtn: 'Close',
    errorPrefix: 'Error',
    duplicateError: "You've already reported this plan within the last 24 hours.",
  },
  ja: {
    title: 'プラン問題を報告',
    subtitle: '誤った情報・非効率な動線・閉店した店などをお知らせください。プラン品質改善に使われます。',
    reasonLabel: '問題の種類',
    reasons: {
      wrong_address: '住所が間違っている',
      closed_restaurant: '店舗/場所が閉店',
      inefficient_route: '動線が非効率',
      wrong_timing: '時間情報が不正確',
      other: 'その他',
    },
    detailLabel: '詳細 (任意)',
    detailPlaceholder: '例: 2日目のランチのお店は1年前に閉店しました',
    submitBtn: '送信',
    submitting: '送信中...',
    cancelBtn: 'キャンセル',
    successTitle: '報告を受け付けました',
    successBody: 'ご意見ありがとうございます。確認してプラン改善に反映します。',
    closeBtn: '閉じる',
    errorPrefix: 'エラー',
    duplicateError: '24時間以内に同じプランを既に報告されました。',
  },
  zh: {
    title: '报告行程问题',
    subtitle: '请告诉我们错误信息、低效路线或已关闭的餐厅。有助于改进行程质量。',
    reasonLabel: '问题类型',
    reasons: {
      wrong_address: '地址错误',
      closed_restaurant: '餐厅/地点已关闭',
      inefficient_route: '路线低效',
      wrong_timing: '时间信息不准确',
      other: '其他',
    },
    detailLabel: '详细信息 (可选)',
    detailPlaceholder: '例: 第2天午餐餐厅一年前已关闭',
    submitBtn: '提交',
    submitting: '提交中...',
    cancelBtn: '取消',
    successTitle: '报告已接收',
    successBody: '感谢您的反馈。我们将审核并改进。',
    closeBtn: '关闭',
    errorPrefix: '错误',
    duplicateError: '您已在 24 小时内报告过此行程。',
  },
};

export function ReportPlanModal({ open, onClose, planId, userEmail = '', language }: Props) {
  const labels = LABELS[language] || LABELS.en;

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
                {(Object.keys(labels.reasons) as Reason[]).map((r) => (
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
                    <span className="text-sm text-white/85">{labels.reasons[r]}</span>
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
