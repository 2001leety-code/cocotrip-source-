// InquiryForm — Bus/VIP 차량 선택 시 노출되는 상담 예약 폼.
// /api/inquiry-submit 으로 POST → Firestore charter_inquiries + 텔레그램 알림.
// 4-lang ko/en/ja/zh.
import { useState } from 'react';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import type { WizardState, VehicleType } from './types';

type Lang = 'ko' | 'en' | 'ja' | 'zh';

interface Strings {
  title: string;
  nameLabel: string;
  emailLabel: string;
  dateLabel: string;
  paxLabel: string;
  vehicleLabel: string;
  detailsLabel: string;
  detailsHint: string;
  phoneLabel: string;
  phoneHint: string;
  submit: string;
  submitting: string;
  successToast: string;
  errorToast: string;
  vehicleBus: string;
  vehicleVip: string;
}

// charterWizard locale 에 키가 없을 때 lang 별 inline fallback. 4-lang 누락 X.
const STRINGS: Record<Lang, Strings> = {
  ko: {
    title: '상담 예약',
    nameLabel: '이름',
    emailLabel: '이메일',
    dateLabel: '행사 일자',
    paxLabel: '인원',
    vehicleLabel: '차량',
    detailsLabel: '행사 내용',
    detailsHint: '200자 이상 권장 — 행사 성격, 픽업/하차 장소, 일정 등',
    phoneLabel: '연락처 (선택)',
    phoneHint: '국제 포맷 (예: +82-10-0000-0000)',
    submit: '문의예약 하기',
    submitting: '전송 중...',
    successToast: '담당자가 답변드릴겁니다',
    errorToast: '전송 실패. 잠시 후 다시 시도해주세요.',
    vehicleBus: '대형버스',
    vehicleVip: '의전 차량',
  },
  en: {
    title: 'Consultation Request',
    nameLabel: 'Name',
    emailLabel: 'Email',
    dateLabel: 'Event Date',
    paxLabel: 'Pax',
    vehicleLabel: 'Vehicle',
    detailsLabel: 'Event Details',
    detailsHint: '200+ chars recommended — event type, pickup/dropoff, schedule',
    phoneLabel: 'Phone (optional)',
    phoneHint: 'International format (e.g. +82-10-0000-0000)',
    submit: 'Submit Inquiry',
    submitting: 'Sending...',
    successToast: 'We will respond shortly',
    errorToast: 'Submission failed. Please try again.',
    vehicleBus: 'Charter Bus',
    vehicleVip: 'VIP Protocol',
  },
  ja: {
    title: '相談予約',
    nameLabel: 'お名前',
    emailLabel: 'メール',
    dateLabel: '行事日',
    paxLabel: '人数',
    vehicleLabel: '車種',
    detailsLabel: '行事内容',
    detailsHint: '200字以上推奨 — 行事の性格、乗降場所、日程など',
    phoneLabel: '連絡先（任意）',
    phoneHint: '国際フォーマット（例：+82-10-0000-0000）',
    submit: '問い合わせる',
    submitting: '送信中...',
    successToast: '担当者がご返答いたします',
    errorToast: '送信失敗。しばらくしてから再試行してください。',
    vehicleBus: '大型バス',
    vehicleVip: 'VIPプロトコル',
  },
  zh: {
    title: '咨询预约',
    nameLabel: '姓名',
    emailLabel: '邮箱',
    dateLabel: '活动日期',
    paxLabel: '人数',
    vehicleLabel: '车辆',
    detailsLabel: '活动内容',
    detailsHint: '建议200字以上 — 活动性质、上下车地点、日程等',
    phoneLabel: '联系电话（选填）',
    phoneHint: '国际格式（例：+82-10-0000-0000）',
    submit: '提交咨询',
    submitting: '发送中...',
    successToast: '工作人员会尽快回复您',
    errorToast: '提交失败。请稍后再试。',
    vehicleBus: '大巴',
    vehicleVip: '礼宾车',
  },
};

interface Props {
  vehicle: Extract<VehicleType, 'bus' | 'vip'>;
  state: WizardState;
  language?: string;
}

export function InquiryForm({ vehicle, state, language }: Props) {
  const lang: Lang =
    language === 'ko' ? 'ko' : language === 'ja' ? 'ja' : language === 'zh' ? 'zh' : 'en';
  const s = STRINGS[lang];

  // 위저드 prefill — 사용자 입력 보존.
  const prefillName = state.customerName ?? '';
  const prefillPhone = state.customerPhone ?? '';
  const prefillDate = state.startDate ?? '';
  const prefillPax = state.paxCount ?? 2;

  const [name, setName] = useState(prefillName);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState(prefillPhone);
  const [eventDate, setEventDate] = useState(prefillDate);
  const [pax, setPax] = useState<number>(prefillPax);
  const [details, setDetails] = useState(state.notes ?? '');
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');

  const valid = name.trim().length >= 2 &&
    /\S+@\S+\.\S+/.test(email) &&
    !!eventDate && pax >= 1 &&
    details.trim().length >= 5;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || status === 'sending') return;
    setStatus('sending');
    setErrorMsg('');
    try {
      const res = await fetch('/api/inquiry-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          eventDate,
          pax,
          vehicle,
          details: details.trim(),
          language: lang,
          // 위저드 컨텍스트 첨부 — 추후 admin 추적/통계용.
          wizardSnapshot: {
            origin: state.origin ?? state.originCustom ?? null,
            service: state.service ?? null,
            destinationKey: state.destinationKey ?? null,
            destinationCustom: state.destinationCustom ?? null,
          },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus('success');
    } catch (err: unknown) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'unknown');
    }
  }

  if (status === 'success') {
    return (
      <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-7 text-center">
        <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
        <p className="text-lg text-emerald-100 font-bold">{s.successToast}</p>
      </div>
    );
  }

  const vehicleDisplay = vehicle === 'bus' ? s.vehicleBus : s.vehicleVip;

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="rounded-2xl border border-[#B668FC]/30 bg-[#B668FC]/5 p-5">
        <h3 className="text-lg font-bold text-white mb-1">{s.title}</h3>
        <p className="text-xs text-white/55">{s.vehicleLabel}: <span className="text-white/85">{vehicleDisplay}</span></p>
      </div>

      <Field label={s.nameLabel} required>
        <input type="text" value={name} onChange={e => setName(e.target.value)}
          className="w-full px-4 py-3 rounded-xl border border-white/12 bg-white/[0.03] text-white/85 text-sm placeholder:text-white/35 outline-none focus:border-[#B668FC]/40" />
      </Field>

      <Field label={s.emailLabel} required>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)}
          className="w-full px-4 py-3 rounded-xl border border-white/12 bg-white/[0.03] text-white/85 text-sm placeholder:text-white/35 outline-none focus:border-[#B668FC]/40" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={s.dateLabel} required>
          <input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-white/12 bg-white/[0.03] text-white/85 text-sm outline-none focus:border-[#B668FC]/40" />
        </Field>
        <Field label={s.paxLabel} required>
          <input type="number" min={1} value={pax} onChange={e => setPax(Math.max(1, Number(e.target.value) || 1))}
            className="w-full px-4 py-3 rounded-xl border border-white/12 bg-white/[0.03] text-white/85 text-sm outline-none focus:border-[#B668FC]/40" />
        </Field>
      </div>

      <Field label={s.detailsLabel} hint={s.detailsHint} required>
        <textarea value={details} onChange={e => setDetails(e.target.value)} rows={5}
          className="w-full px-4 py-3 rounded-xl border border-white/12 bg-white/[0.03] text-white/85 text-sm placeholder:text-white/35 outline-none focus:border-[#B668FC]/40 resize-none" />
      </Field>

      <Field label={s.phoneLabel} hint={s.phoneHint}>
        <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
          placeholder="+82-10-0000-0000"
          className="w-full px-4 py-3 rounded-xl border border-white/12 bg-white/[0.03] text-white/85 text-sm placeholder:text-white/35 outline-none focus:border-[#B668FC]/40" />
      </Field>

      {status === 'error' && (
        <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/25 rounded-xl px-4 py-3">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-200/85">{s.errorToast}{errorMsg ? ` (${errorMsg})` : ''}</p>
        </div>
      )}

      <button type="submit" disabled={!valid || status === 'sending'}
        className="w-full py-3 rounded-xl text-sm font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all"
        style={{ background: 'linear-gradient(135deg, #B668FC, #FF6B9D)' }}>
        {status === 'sending' ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> {s.submitting}</>
        ) : (
          s.submit
        )}
      </button>
    </form>
  );
}

function Field({ label, hint, required, children }: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wider text-white/55 mb-2 font-semibold">
        {label}{required && <span className="text-red-400 ml-1">*</span>}
      </label>
      {children}
      {hint && <p className="mt-2 text-xs text-white/40">{hint}</p>}
    </div>
  );
}
