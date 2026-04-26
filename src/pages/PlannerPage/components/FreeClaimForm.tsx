// "이미 항공권+호텔 예약했어요 → 무료 AI 플랜" 신청 폼.
// P4 옵션 2 (2026-04-24): WhatsApp 수동 처리에서 Firestore 자동화로 이전.
//
// Flow:
//   1) 이메일 + 항공/호텔 예약번호 + 영수증 1-2장 업로드
//   2) Storage `free_claims/{emailSlug}/...` 에 영수증 저장
//   3) Firestore `pending_free_claims/{auto-id}` 에 status='pending' 저장
//   4) 어드민이 검토 후 무료 플랜 발급 (어드민 UI는 별도)
//
// WhatsApp 보조 링크는 그대로 유지 — 폼이 막히는 경우 폴백.
import { useRef, useState } from 'react';
import { Upload, Check, AlertCircle, Loader2, MessageCircle } from 'lucide-react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import type { PlannerDict } from '../types';

interface Props {
  p: PlannerDict;
  isMobile: boolean;
  initialEmail?: string;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 4;

function emailToSlug(email: string): string {
  return email.toLowerCase().trim().replace(/[^a-z0-9]/g, '_').slice(0, 80);
}

export function FreeClaimForm({ p, isMobile, initialEmail = '' }: Props) {
  const [email, setEmail] = useState(initialEmail);
  const [flightRef, setFlightRef] = useState('');
  const [hotelRef, setHotelRef] = useState('');
  const [tripDates, setTripDates] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fallbackWaUrl = `https://wa.me/821087140611?text=${encodeURIComponent(
    'Hi! I booked my flight and hotel through CocoTrip. Please send me my free AI plan. Email: ' + email
  )}`;

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    const oversize = picked.find(f => f.size > MAX_FILE_BYTES);
    if (oversize) {
      setError((p.optionBClaimErrorFile || 'File "{name}" exceeds 5MB.').replace('{name}', oversize.name));
      return;
    }
    const next = [...files, ...picked].slice(0, MAX_FILES);
    setFiles(next);
    setError(null);
  };

  const removeFile = (idx: number) => setFiles(files.filter((_, i) => i !== idx));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes('@')) {
      setError(p.optionBClaimErrorEmail || 'Please enter a valid email.');
      return;
    }
    if (!flightRef.trim() && !hotelRef.trim() && files.length === 0) {
      setError(p.optionBClaimErrorMissing || 'Please provide at least one booking reference or receipt.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const slug = emailToSlug(email);
      const uploaded: { name: string; url: string; size: number }[] = [];
      for (const file of files) {
        const path = `free_claims/${slug}/${Date.now()}_${file.name.replace(/[^\w.\-]/g, '_')}`;
        const r = storageRef(storage, path);
        await uploadBytes(r, file, { contentType: file.type });
        const url = await getDownloadURL(r);
        uploaded.push({ name: file.name, url, size: file.size });
      }
      await addDoc(collection(db, 'pending_free_claims'), {
        email: email.trim(),
        flightRef: flightRef.trim() || null,
        hotelRef: hotelRef.trim() || null,
        tripDates: tripDates.trim() || null,
        receipts: uploaded,
        status: 'pending',
        source: 'planner_option_b',
        createdAt: serverTimestamp(),
      });
      setSubmitted(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : (p.optionBClaimErrorSubmit || 'Submission failed');
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="text-center py-6">
        <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto mb-3">
          <Check className="w-7 h-7 text-emerald-400" />
        </div>
        <p className="text-white font-bold text-base mb-2">{p.optionBClaimSubmittedTitle || 'Claim received'}</p>
        <p className="text-white/50 text-sm max-w-xs mx-auto">
          {p.optionBClaimSubmittedDesc || "We'll verify your booking and email your free plan within 24 hours."}
        </p>
      </div>
    );
  }

  const accentColor = isMobile ? '#B668FC' : '#7C5CFC';
  const focusRing = isMobile ? 'focus:border-[#B668FC] focus:ring-1 focus:ring-[#B668FC]' : 'focus:border-[#7C5CFC] focus:ring-1 focus:ring-[#7C5CFC]';

  return (
    <form onSubmit={handleSubmit} className="text-left space-y-3">
      <div>
        <label className="block text-[11px] uppercase tracking-wider text-white/55 mb-1">{p.optionBClaimEmailLabel || 'Email *'}</label>
        <input
          type="email" required value={email} onChange={e => setEmail(e.target.value)}
          placeholder={p.emailPlaceholder}
          className={`w-full px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-white placeholder-white/40 outline-none transition-all ${focusRing}`}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-white/55 mb-1">{p.optionBClaimFlightPnr || 'Flight PNR'}</label>
          <input
            type="text" value={flightRef} onChange={e => setFlightRef(e.target.value)}
            placeholder={p.optionBClaimFlightPnrPh || 'e.g. ABC123'}
            className={`w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/20 text-white placeholder-white/30 text-sm outline-none transition-all ${focusRing}`}
          />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-white/55 mb-1">{p.optionBClaimHotelRef || 'Hotel ref'}</label>
          <input
            type="text" value={hotelRef} onChange={e => setHotelRef(e.target.value)}
            placeholder={p.optionBClaimHotelRefPh || 'Booking #'}
            className={`w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/20 text-white placeholder-white/30 text-sm outline-none transition-all ${focusRing}`}
          />
        </div>
      </div>

      <div>
        <label className="block text-[11px] uppercase tracking-wider text-white/55 mb-1">{p.optionBClaimTripDates || 'Trip dates'}</label>
        <input
          type="text" value={tripDates} onChange={e => setTripDates(e.target.value)}
          placeholder={p.optionBClaimTripDatesPh || 'e.g. 2026-05-12 ~ 2026-05-18'}
          className={`w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/20 text-white placeholder-white/30 text-sm outline-none transition-all ${focusRing}`}
        />
      </div>

      <div>
        <label className="block text-[11px] uppercase tracking-wider text-white/55 mb-1">
          {p.optionBClaimReceipts || `Receipt screenshots (max ${MAX_FILES}, 5MB each)`}
        </label>
        <input
          ref={fileInputRef}
          type="file" multiple accept="image/*,application/pdf" onChange={onPickFiles}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={files.length >= MAX_FILES}
          className="w-full py-3 rounded-xl border border-dashed border-white/25 text-white/60 text-sm hover:bg-white/5 transition-all flex items-center justify-center gap-2 disabled:opacity-40"
        >
          <Upload className="w-4 h-4" />
          {files.length === 0
            ? (p.optionBClaimUpload || 'Upload receipts')
            : (p.optionBClaimUploadMore || 'Add more ({n}/{m})').replace('{n}', String(files.length)).replace('{m}', String(MAX_FILES))}
        </button>
        {files.length > 0 && (
          <ul className="mt-2 space-y-1">
            {files.map((f, i) => (
              <li key={i} className="text-[11px] text-white/50 flex items-center justify-between bg-white/5 rounded-lg px-3 py-1.5">
                <span className="truncate">{f.name}</span>
                <button type="button" onClick={() => removeFile(i)} className="text-white/55 hover:text-white/60 ml-2">×</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 text-rose-300 text-xs bg-rose-500/10 border border-rose-500/30 rounded-lg p-3">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="submit" disabled={submitting}
        className="w-full py-3.5 rounded-xl text-white font-bold text-sm transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
        style={{ background: `linear-gradient(135deg, ${accentColor}, #EA537E)` }}
      >
        {submitting
          ? <><Loader2 className="w-4 h-4 animate-spin" /> {p.optionBClaimSubmitting || 'Submitting…'}</>
          : (p.optionBClaimSubmit || 'Submit claim')}
      </button>

      <a
        href={fallbackWaUrl} target="_blank" rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-white/50 text-xs hover:text-white/80 transition-all border border-white/10"
      >
        <MessageCircle className="w-3.5 h-3.5" />
        {p.optionBClaimWhatsAppFallback || 'Or send via WhatsApp instead'}
      </a>
    </form>
  );
}
