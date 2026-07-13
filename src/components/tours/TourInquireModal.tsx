// TourInquireModal — 투어 페이지 "맞춤형 투어" 견적 문의 모달.
// CharterInquireModal(플랜 상세) 패턴 복제·개조 — 결제 없음, 상담 접수만.
// POST /api/inquiry-submit (vehicle='tour_custom') → Firestore charter_inquiries + 텔레그램 알림.
// 4-lang ko/en/ja/zh. 모바일 밀도 우선: 입력칸 작게, 2열 배치.
import { useEffect, useState } from 'react';
import { X, Send, Loader2, AlertCircle, Check } from 'lucide-react';
import { trackEvent } from '@/lib/analytics';
import type { Language } from '@/i18n';

type Lang = 'ko' | 'en' | 'ja' | 'zh';

interface Strings {
  title: string;
  subtitle: string;
  nameLabel: string;
  emailLabel: string;
  phoneLabel: string;
  contactHint: string;
  whatsappLabel: string;
  dateLabel: string;
  paxLabel: string;
  regionLabel: string;
  regionUnset: string;
  regionSeoul: string;
  regionBusan: string;
  regionJeju: string;
  regionOther: string;
  themeLabel: string;
  budgetLabel: string;
  budgetUndecided: string;
  detailsLabel: string;
  detailsPlaceholder: string;
  submit: string;
  submitting: string;
  successTitle: string;
  successBody: string;
  close: string;
  errorToast: string;
  optional: string;
}

const STRINGS: Record<Lang, Strings> = {
  ko: {
    title: '맞춤형 투어 문의',
    subtitle: '결제 없이 견적만 받아보세요 — 24시간 내 답변',
    nameLabel: '이름',
    emailLabel: '이메일',
    phoneLabel: '전화',
    contactHint: '이메일 또는 전화 중 하나는 필수',
    whatsappLabel: 'WhatsApp',
    dateLabel: '여행 날짜',
    paxLabel: '인원',
    regionLabel: '원하는 지역',
    regionUnset: '선택 안 함',
    regionSeoul: '서울',
    regionBusan: '부산',
    regionJeju: '제주',
    regionOther: '기타',
    themeLabel: '원하는 테마',
    budgetLabel: '예산',
    budgetUndecided: '미정',
    detailsLabel: '요청사항',
    detailsPlaceholder: '예: 호텔 픽업, 아이 동반, 꼭 가고 싶은 곳 등',
    submit: '문의 보내기',
    submitting: '전송 중...',
    successTitle: '문의가 접수되었습니다',
    successBody: '담당자가 24시간 내에 견적과 함께 답변드립니다.',
    close: '닫기',
    errorToast: '전송 실패. 잠시 후 다시 시도해주세요.',
    optional: '선택',
  },
  en: {
    title: 'Custom Tour Inquiry',
    subtitle: 'No payment needed — get a quote within 24h',
    nameLabel: 'Name',
    emailLabel: 'Email',
    phoneLabel: 'Phone',
    contactHint: 'Email or phone — at least one required',
    whatsappLabel: 'WhatsApp',
    dateLabel: 'Travel date',
    paxLabel: 'Travelers',
    regionLabel: 'Region',
    regionUnset: 'Not decided',
    regionSeoul: 'Seoul',
    regionBusan: 'Busan',
    regionJeju: 'Jeju',
    regionOther: 'Other',
    themeLabel: 'Theme',
    budgetLabel: 'Budget',
    budgetUndecided: 'Undecided',
    detailsLabel: 'Requests',
    detailsPlaceholder: 'e.g. hotel pickup, traveling with kids, must-visit spots',
    submit: 'Send Inquiry',
    submitting: 'Sending...',
    successTitle: 'Inquiry received',
    successBody: 'We will reply with a tailored quote within 24 hours.',
    close: 'Close',
    errorToast: 'Submission failed. Please try again.',
    optional: 'optional',
  },
  ja: {
    title: 'カスタムツアーお問い合わせ',
    subtitle: '決済不要 — 24時間以内にお見積もり',
    nameLabel: 'お名前',
    emailLabel: 'メール',
    phoneLabel: '電話',
    contactHint: 'メールまたは電話のいずれか必須',
    whatsappLabel: 'WhatsApp',
    dateLabel: '旅行日',
    paxLabel: '人数',
    regionLabel: '希望地域',
    regionUnset: '未定',
    regionSeoul: 'ソウル',
    regionBusan: '釜山',
    regionJeju: '済州',
    regionOther: 'その他',
    themeLabel: 'テーマ',
    budgetLabel: '予算',
    budgetUndecided: '未定',
    detailsLabel: 'ご要望',
    detailsPlaceholder: '例：ホテル送迎、子連れ、行きたい場所など',
    submit: '問い合わせる',
    submitting: '送信中...',
    successTitle: 'お問い合わせを受け付けました',
    successBody: '24時間以内にお見積もりと共にご返答いたします。',
    close: '閉じる',
    errorToast: '送信失敗。しばらくしてから再試行してください。',
    optional: '任意',
  },
  zh: {
    title: '定制旅游咨询',
    subtitle: '无需付款 — 24小时内提供报价',
    nameLabel: '姓名',
    emailLabel: '邮箱',
    phoneLabel: '电话',
    contactHint: '邮箱或电话至少填写一项',
    whatsappLabel: 'WhatsApp',
    dateLabel: '出行日期',
    paxLabel: '人数',
    regionLabel: '目的地',
    regionUnset: '未定',
    regionSeoul: '首尔',
    regionBusan: '釜山',
    regionJeju: '济州',
    regionOther: '其他',
    themeLabel: '主题',
    budgetLabel: '预算',
    budgetUndecided: '未定',
    detailsLabel: '需求说明',
    detailsPlaceholder: '例如：酒店接送、携带儿童、必去景点等',
    submit: '提交咨询',
    submitting: '发送中...',
    successTitle: '咨询已提交',
    successBody: '我们将在24小时内回复您的定制报价。',
    close: '关闭',
    errorToast: '提交失败。请稍后再试。',
    optional: '选填',
  },
};

// 테마 멀티선택 칩 — value 는 운영자 텔레그램 가독용 영문 고정, 라벨만 4-lang.
const THEME_OPTIONS: Array<{ value: string; label: Record<Lang, string> }> = [
  { value: 'K-pop',    label: { ko: 'K-pop',     en: 'K-pop',    ja: 'K-pop',      zh: 'K-pop' } },
  { value: 'Food',     label: { ko: '음식',      en: 'Food',     ja: 'グルメ',      zh: '美食' } },
  { value: 'History',  label: { ko: '역사·문화', en: 'History',  ja: '歴史・文化',  zh: '历史文化' } },
  { value: 'Nature',   label: { ko: '자연',      en: 'Nature',   ja: '自然',        zh: '自然' } },
  { value: 'Shopping', label: { ko: '쇼핑',      en: 'Shopping', ja: 'ショッピング', zh: '购物' } },
  { value: 'Photo',    label: { ko: '사진 명소', en: 'Photo spots', ja: '写真スポット', zh: '拍照打卡' } },
];

// 동행 유형(운영자 확정 4옵션) — value 영문 고정(텔레그램 규약), 라벨만 4-lang. 위자드 Travel Style 과 동일 셋.
const COMPANION_OPTIONS: Array<{ value: string; label: Record<Lang, string> }> = [
  { value: 'Solo',    label: { ko: '혼자', en: 'Solo',    ja: 'ひとり',   zh: '独自' } },
  { value: 'Couple',  label: { ko: '커플', en: 'Couple',  ja: 'カップル', zh: '情侣' } },
  { value: 'Family',  label: { ko: '가족', en: 'Family',  ja: '家族',     zh: '家庭' } },
  { value: 'Friends', label: { ko: '친구', en: 'Friends', ja: '友達',     zh: '朋友' } },
];

// 기간 — value 영문 고정, 라벨 4-lang.
const DURATION_OPTIONS: Array<{ value: string; label: Record<Lang, string> }> = [
  { value: 'Day trip', label: { ko: '당일',   en: 'Day trip', ja: '日帰り',   zh: '当天' } },
  { value: '2 days',   label: { ko: '1박 2일', en: '2 days',  ja: '1泊2日',   zh: '2天' } },
  { value: '3 days',   label: { ko: '2박 3일', en: '3 days',  ja: '2泊3日',   zh: '3天' } },
  { value: '4-5 days', label: { ko: '3~4박',   en: '4-5 days', ja: '3~4泊',   zh: '4-5天' } },
  { value: '6+ days',  label: { ko: '5일 이상', en: '6+ days', ja: '5日以上', zh: '6天以上' } },
];

const COMPANIONS_LABEL: Record<Lang, string> = { ko: '동행 유형', en: 'Travel Style', ja: '旅行スタイル', zh: '出行方式' };
const DURATION_LABEL: Record<Lang, string> = { ko: '기간', en: 'Duration', ja: '期間', zh: '时长' };

const BUDGET_OPTIONS = ['~$500', '$500-1000', '$1000-3000', '$3000+'] as const;

type RegionValue = '' | 'seoul' | 'busan' | 'jeju' | 'other';

interface Props {
  open: boolean;
  onClose: () => void;
  language?: Language;
  /** 투어 페이지 활성 지역 필터 → 지역 select 프리필. */
  defaultRegion?: RegionValue;
}

const inputCls =
  'w-full px-2.5 py-2 rounded-lg bg-white/[0.04] border border-white/12 text-white/85 text-[13px] placeholder:text-white/30 outline-none focus:border-[#B668FC]/45';

export function TourInquireModal({ open, onClose, language, defaultRegion = '' }: Props) {
  const lang: Lang =
    language === 'ko' ? 'ko' : language === 'ja' ? 'ja' : language === 'zh' ? 'zh' : 'en';
  const s = STRINGS[lang];

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [pax, setPax] = useState<number>(2);
  const [region, setRegion] = useState<RegionValue>(defaultRegion);
  const [themes, setThemes] = useState<Set<string>>(new Set());
  const [companions, setCompanions] = useState<string>('');
  const [duration, setDuration] = useState<string>('');
  const [budget, setBudget] = useState<string>('');
  const [details, setDetails] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  // 모달을 열 때마다: 성공/에러 상태 초기화(안 하면 두 번째 문의가 영구 차단)
  // + 현재 지역 필터를 프리필(useState 초기값만으로는 재오픈 시 반영 안 됨)
  useEffect(() => {
    if (!open) return;
    setStatus('idle');
    setErrorMsg('');
    setRegion(defaultRegion);
  }, [open, defaultRegion]);

  if (!open) return null;

  const emailValid = /\S+@\S+\.\S+/.test(email.trim());
  // 숫자 5자리 이상(구분기호 제외) — 길이만 재면 문자 5자도 연락처로 통과함
  const phoneValid = phone.replace(/\D/g, '').length >= 5;
  const valid = name.trim().length >= 2 && (emailValid || phoneValid) &&
    (!email.trim() || emailValid);

  const toggleTheme = (value: string) => {
    setThemes(prev => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else if (next.size < 5) next.add(value); // 가이드 P7: 관심사 ≤5 상한
      return next;
    });
  };

  const regionLabelOf = (r: RegionValue) =>
    r === 'seoul' ? s.regionSeoul : r === 'busan' ? s.regionBusan :
    r === 'jeju' ? s.regionJeju : r === 'other' ? s.regionOther : '';

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
          whatsapp: whatsapp.trim(),
          eventDate,
          pax,
          vehicle: 'tour_custom',
          details: details.trim(),
          region,
          theme: Array.from(themes).join(', '),
          companions: companions || '',
          duration: duration || '',
          budget: budget || 'undecided',
          language: lang,
          wizardSnapshot: null,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // GA4 추적 — 실패해도 폼 흐름에 영향 없음(trackEvent 내부 no-op 가드).
      trackEvent('tour_custom_inquiry_submit', {
        region: region || 'unset',
        budget: budget || 'undecided',
        theme_count: themes.size,
      });
      setStatus('success');
    } catch (err: unknown) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'unknown');
    }
  }

  return (
    <div
      className="cocotrip-mobile-modal-backdrop fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-3"
      onClick={onClose}
    >
      <div
        className="cocotrip-mobile-inquiry-modal w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-[#B668FC]/25 bg-[#120a1f]"
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] sticky top-0 bg-[#120a1f] z-10">
          <div className="min-w-0">
            <p className="text-[14px] font-bold text-white">{s.title}</p>
            <p className="text-[11px] text-white/50 mt-0.5">{s.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={s.close}
            className="text-white/55 hover:text-white/80 min-h-[40px] min-w-[40px] flex items-center justify-center shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {status === 'success' ? (
          <div className="p-7 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto mb-3">
              <Check className="w-6 h-6 text-emerald-400" />
            </div>
            <p className="text-white font-bold mb-1.5">{s.successTitle}</p>
            <p className="text-white/50 text-[13px]">{s.successBody}</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 px-6 py-2.5 rounded-xl bg-white/10 text-white text-sm hover:bg-white/15 min-h-[40px]"
            >
              {s.close}
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="p-4 space-y-2.5">
            {/* 이름 */}
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-white/55 mb-1 font-semibold">
                {s.nameLabel} <span className="text-red-400">*</span>
              </label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} className={inputCls} />
            </div>

            {/* 이메일 | 전화 — 둘 중 하나 필수 */}
            <div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-white/55 mb-1 font-semibold">
                    {s.emailLabel}
                  </label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-white/55 mb-1 font-semibold">
                    {s.phoneLabel}
                  </label>
                  <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                    placeholder="+82-10-0000-0000" className={inputCls} />
                </div>
              </div>
              <p className="mt-1 text-[10px] text-white/40">{s.contactHint} <span className="text-red-400">*</span></p>
            </div>

            {/* WhatsApp | 여행 날짜 */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-white/55 mb-1 font-semibold">
                  {s.whatsappLabel} <span className="text-white/35 normal-case">({s.optional})</span>
                </label>
                <input type="tel" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-white/55 mb-1 font-semibold">
                  {s.dateLabel}
                </label>
                <input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} className={inputCls} />
              </div>
            </div>

            {/* 인원 | 지역 */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-white/55 mb-1 font-semibold">
                  {s.paxLabel}
                </label>
                <input type="number" min={1} max={999} value={pax}
                  onChange={e => setPax(Math.min(999, Math.max(1, Number(e.target.value) || 1)))} className={inputCls} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-white/55 mb-1 font-semibold">
                  {s.regionLabel}
                </label>
                <select value={region} onChange={e => setRegion(e.target.value as RegionValue)}
                  className={`${inputCls} cursor-pointer`}>
                  <option value="">{s.regionUnset}</option>
                  <option value="seoul">{s.regionSeoul}</option>
                  <option value="busan">{s.regionBusan}</option>
                  <option value="jeju">{s.regionJeju}</option>
                  <option value="other">{s.regionOther}</option>
                </select>
              </div>
            </div>

            {/* 동행 유형(라디오) | 기간(select) — 가이드 P7 */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-white/55 mb-1 font-semibold">
                  {COMPANIONS_LABEL[lang]}
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {COMPANION_OPTIONS.map(opt => {
                    const active = companions === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setCompanions(active ? '' : opt.value)}
                        aria-pressed={active}
                        className="text-[11px] font-semibold px-2.5 py-1.5 rounded-full transition-colors"
                        style={
                          active
                            ? { background: 'rgba(182,104,252,0.18)', border: '1px solid rgba(182,104,252,0.50)', color: '#D0A8FF' }
                            : { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.45)' }
                        }
                      >
                        {opt.label[lang]}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-white/55 mb-1 font-semibold">
                  {DURATION_LABEL[lang]}
                </label>
                <select value={duration} onChange={e => setDuration(e.target.value)}
                  className={`${inputCls} cursor-pointer`}>
                  <option value="">{s.regionUnset}</option>
                  {DURATION_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label[lang]}</option>)}
                </select>
              </div>
            </div>

            {/* 테마 멀티선택 칩 (≤5) */}
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-white/55 mb-1 font-semibold">
                {s.themeLabel} <span className="text-white/35 normal-case">({themes.size}/5)</span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {THEME_OPTIONS.map(opt => {
                  const active = themes.has(opt.value);
                  const atCap = !active && themes.size >= 5;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => toggleTheme(opt.value)}
                      className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-full transition-colors ${atCap ? 'opacity-40' : ''}`}
                      style={
                        active
                          ? { background: 'rgba(182,104,252,0.18)', border: '1px solid rgba(182,104,252,0.50)', color: '#D0A8FF' }
                          : { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.45)' }
                      }
                    >
                      {opt.label[lang]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 예산 */}
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-white/55 mb-1 font-semibold">
                {s.budgetLabel}
              </label>
              <select value={budget} onChange={e => setBudget(e.target.value)}
                className={`${inputCls} cursor-pointer`}>
                <option value="">{s.budgetUndecided}</option>
                {BUDGET_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>

            {/* 요청사항 */}
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-white/55 mb-1 font-semibold">
                {s.detailsLabel} <span className="text-white/35 normal-case">({s.optional})</span>
              </label>
              <textarea rows={3} value={details} onChange={e => setDetails(e.target.value)}
                placeholder={s.detailsPlaceholder}
                className={`${inputCls} resize-none`} />
            </div>

            {/* 지역 프리필 요약 (선택된 경우만, 시각 노이즈 최소) */}
            {region !== '' && (
              <p className="text-[10px] text-white/35">
                {s.regionLabel}: {regionLabelOf(region)}
              </p>
            )}

            {status === 'error' && (
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/25 rounded-lg px-3 py-2.5">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <p className="text-[12px] text-red-200/85">{s.errorToast}{errorMsg ? ` (${errorMsg})` : ''}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={!valid || status === 'sending'}
              className="w-full py-2.5 rounded-xl text-[13px] font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all"
              style={{ background: 'linear-gradient(135deg, #B668FC, #FF6B9D)' }}
            >
              {status === 'sending'
                ? <><Loader2 className="w-4 h-4 animate-spin" /> {s.submitting}</>
                : <><Send className="w-4 h-4" /> {s.submit}</>}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
