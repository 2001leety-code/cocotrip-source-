// P3-B in-app charter inquiry modal — alternative to the WhatsApp prefill
// in CharterBanner. Submits to Firestore `charter_inquiries` so the user
// (and admin) can track status without leaving the plan.
//
// Out of scope here (deferred):
//   - MyPlans status widget
//   - Admin approval UI
//   - PayPal integration on approval
import { useState } from 'react';
import { X, Send, Loader2, AlertCircle, Check } from 'lucide-react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { PlanDay, PlanDocument } from '../../types';

interface Props {
  open: boolean;
  onClose: () => void;
  plan: PlanDocument | undefined;
  days: PlanDay[];
  recommendedTour: string;
  quotedKRW: number;
  hours: number;
  planId: string;
}

export function CharterInquireModal({ open, onClose, plan, days, recommendedTour, quotedKRW, hours, planId }: Props) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  if (!open) return null;

  const input = plan?.input || {};
  const dayCount = days.length;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes('@')) { setError('Please enter a valid email.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      await addDoc(collection(db, 'charter_inquiries'), {
        email: email.trim(),
        name: name.trim() || null,
        phone: phone.trim() || null,
        notes: notes.trim() || null,
        planId: planId || null,
        recommendedTour,
        quotedKRW,
        hours,
        startDate: input.startDate || null,
        pax: input.adults || input.pax || null,
        dayCount,
        itinerarySummary: days.slice(0, 7).map((d, i) => ({
          day: d.day || i + 1,
          theme: d.theme || '',
          stopCount: (d.stops || []).length,
        })),
        status: 'pending',
        source: 'plan_detail_charter_banner',
        createdAt: serverTimestamp(),
      });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-3" onClick={onClose}>
      <div className="bg-[#0f1117] border border-cyan-500/25 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] sticky top-0 bg-[#0f1117] z-10">
          <div>
            <p className="text-white font-bold">Charter Quote Request</p>
            <p className="text-[11px] text-white/40 mt-0.5">{recommendedTour} · ₩{quotedKRW.toLocaleString()} / {hours}h</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80"><X className="w-5 h-5" /></button>
        </div>

        {submitted ? (
          <div className="p-8 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto mb-3">
              <Check className="w-7 h-7 text-emerald-400" />
            </div>
            <p className="text-white font-bold mb-2">Request received</p>
            <p className="text-white/50 text-sm">We'll email you a confirmed quote within 24 hours.</p>
            <button onClick={onClose} className="mt-5 px-6 py-2.5 rounded-xl bg-white/10 text-white text-sm hover:bg-white/15">Close</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-3">
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-white/40 mb-1">Email *</label>
              <input
                type="email" required value={email} onChange={e => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/15 text-white text-sm outline-none focus:border-cyan-400"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-white/40 mb-1">Name</label>
                <input
                  type="text" value={name} onChange={e => setName(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/15 text-white text-sm outline-none focus:border-cyan-400"
                />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-white/40 mb-1">Phone / WhatsApp</label>
                <input
                  type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/15 text-white text-sm outline-none focus:border-cyan-400"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-white/40 mb-1">Notes (pickup point, special requests)</label>
              <textarea
                rows={3} value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="e.g. pickup from Lotte Hotel at 8:30, baby seat needed"
                className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/15 text-white text-sm outline-none focus:border-cyan-400 resize-none"
              />
            </div>
            <div className="text-[11px] text-white/40 bg-white/[0.03] border border-white/[0.06] rounded-lg p-3">
              Your trip context (planId · {dayCount} day{dayCount === 1 ? '' : 's'} · start {input.startDate || '—'} · {input.adults || input.pax || '?'} pax)
              will be sent automatically so we can quote without back-and-forth.
            </div>
            {error && (
              <div className="flex items-start gap-2 text-rose-300 text-xs bg-rose-500/10 border border-rose-500/30 rounded-lg p-3">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            <button
              type="submit" disabled={submitting}
              className="w-full py-3 rounded-xl text-white font-bold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg,#06b6d4,#3b82f6)' }}
            >
              {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> : <><Send className="w-4 h-4" /> Submit request</>}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
