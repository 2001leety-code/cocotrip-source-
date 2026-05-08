// TourBookingDialog — 투어 상세 CTA 클릭 시 인원수·날짜·언어·addon 선택 + PayPal 직진입.
// productType 매핑 있으면 (대부분) PayPalBookingButton, 없으면 (multicity-3d) charter 페이지 redirect.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarPicker } from '@/components/ui/calendar';
import { Calendar, Users, Languages, Plus, Minus, Check, Phone, MapPin, MessageCircle, FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import pricingSpec from '@/data/pricing_spec.json';
import { getTourProductType, getTourPriceKRW } from '@/data/tours';
import { checkAvailability, REASON_LABELS } from '@/data/tour-availability';
import { fetchMonthAvailability, type AvailabilityEntry } from '@/lib/tour-availability-store';
import { PayPalBookingButton } from '@/components/PayPalBookingButton';
import { useAuth } from '@/hooks/useAuth';
import type { Tour, DriverLanguage } from '@/data/tours';
import { translations, type Language } from '@/i18n';

/** Reusable text input row used in Step 2. Keeps the dialog body lean and
 *  ensures every field has the same focus/error treatment + label style. */
function ContactField({
  icon, label, placeholder, value, onChange, type = 'text', compact = false,
}: {
  icon: React.ReactNode;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  compact?: boolean;
}) {
  return (
    <div>
      <label className={`flex items-center gap-1.5 text-[${compact ? 10 : 11}px] text-white/55 uppercase tracking-wider mb-1.5`}>
        {icon}{label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full px-3 py-2 rounded-xl text-[${compact ? 12 : 13}px] focus:outline-none`}
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.10)',
          color: 'white',
        }}
      />
    </div>
  );
}

function isoFromDate(d: Date | undefined): string {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 투어 날짜가 12h cutoff 이내인지 검사 (픽업 시각 09:00 KST 기본).
 * 오늘 날짜를 포함해 12h 이내 출발은 서버에서 차단되므로 UI에서도 비활성.
 */
function isTourDateClosed(iso: string): boolean {
  if (!iso) return false;
  const departure = new Date(`${iso}T09:00:00+09:00`);
  if (isNaN(departure.getTime())) return false;
  const hoursLeft = (departure.getTime() - Date.now()) / 3_600_000;
  return hoursLeft <= 12;
}

function dateFromIso(iso: string): Date | undefined {
  if (!iso) return undefined;
  return new Date(iso + 'T00:00:00');
}

type AddonItem = {
  id: string;
  labels: { ko: string; en: string; ja: string; zh: string };
  priceKRW: number;
  unit: 'per_trip' | 'per_person' | 'per_day';
  applies_to: ('tour' | 'charter' | 'airport_transfer')[];
};

const ADDONS: AddonItem[] = ((pricingSpec as { addons?: { items?: AddonItem[] } }).addons?.items || []) as AddonItem[];

function formatKRW(n: number): string {
  return `₩${Math.round(n).toLocaleString('ko-KR')}`;
}

// batch 9 fix (B9-5, 2026-05-09): addon 가격이 투어별로 다르게 계산될 수 있도록
// addons 인자 받음. attraction_pass 는 tour.stops 합산값으로 동적 override.
function computeAddonTotal(selectedIds: Set<string>, pax: number, days: number, addons: AddonItem[]): number {
  let total = 0;
  for (const a of addons) {
    if (!selectedIds.has(a.id)) continue;
    if (a.unit === 'per_person') total += a.priceKRW * pax;
    else if (a.unit === 'per_day') total += a.priceKRW * days;
    else total += a.priceKRW;
  }
  return total;
}

const I18N: Record<Language, {
  title: string; pax: string; date: string; lang: string; addons: string;
  priceBase: string; priceAddons: string; priceTotal: string;
  cancel: string; submit: string; pickDate: string;
  // Step 2 contact fields
  step1Title: string; step2Title: string;
  next: string; back: string;
  phone: string; phonePh: string;
  pickup: string; pickupPh: string;
  whatsapp: string; whatsappPh: string;
  line: string; linePh: string;
  memo: string; memoPh: string;
  required: string; missingFields: string;
}> = {
  ko: { title: '투어 예약', pax: '인원수', date: '투어 날짜', lang: '기사 언어', addons: '추가 옵션',
        priceBase: '기본', priceAddons: '추가옵션', priceTotal: '총액 (예상)',
        cancel: '취소', submit: '결제 페이지로 이동', pickDate: '날짜 선택',
        step1Title: '1단계 — 옵션 선택', step2Title: '2단계 — 연락처·픽업',
        next: '다음', back: '이전',
        phone: '휴대폰 번호', phonePh: '예: +82 10 1234 5678',
        pickup: '픽업 호텔/주소', pickupPh: '예: 명동 롯데호텔, 종로구 ○○○',
        whatsapp: 'WhatsApp ID', whatsappPh: '+82 10 1234 5678',
        line: 'LINE ID', linePh: 'cocotrip_user',
        memo: '특별 요청 / 메모', memoPh: '알레르기, 아동 동반, 접근성 등',
        required: '필수', missingFields: '필수 항목을 모두 입력해주세요' },
  en: { title: 'Book This Tour', pax: 'Passengers', date: 'Tour date', lang: 'Driver language', addons: 'Add-ons',
        priceBase: 'Base', priceAddons: 'Add-ons', priceTotal: 'Estimated total',
        cancel: 'Cancel', submit: 'Continue to payment', pickDate: 'Select date',
        step1Title: 'Step 1 — Options', step2Title: 'Step 2 — Contact & Pickup',
        next: 'Next', back: 'Back',
        phone: 'Mobile number', phonePh: 'e.g. +1 555 123 4567',
        pickup: 'Pickup hotel / address', pickupPh: 'e.g. Lotte Hotel Myeongdong',
        whatsapp: 'WhatsApp ID', whatsappPh: '+1 555 123 4567',
        line: 'LINE ID', linePh: 'cocotrip_user',
        memo: 'Special requests / notes', memoPh: 'Allergies, kids, accessibility, etc.',
        required: 'required', missingFields: 'Please fill in all required fields' },
  ja: { title: 'ツアー予約', pax: '人数', date: 'ツアー日', lang: 'ドライバー言語', addons: '追加オプション',
        priceBase: '基本', priceAddons: 'オプション', priceTotal: '合計（予想）',
        cancel: 'キャンセル', submit: '決済ページへ', pickDate: '日付を選択',
        step1Title: 'ステップ 1 — オプション', step2Title: 'ステップ 2 — 連絡先・ピックアップ',
        next: '次へ', back: '戻る',
        phone: '携帯番号', phonePh: '例: +81 90 1234 5678',
        pickup: 'ピックアップホテル / 住所', pickupPh: '例: 明洞ロッテホテル',
        whatsapp: 'WhatsApp ID', whatsappPh: '+81 90 1234 5678',
        line: 'LINE ID', linePh: 'cocotrip_user',
        memo: '特別なリクエスト / メモ', memoPh: 'アレルギー、お子様連れ、バリアフリーなど',
        required: '必須', missingFields: '必須項目をすべて入力してください' },
  zh: { title: '预订旅游', pax: '人数', date: '旅游日期', lang: '司机语言', addons: '附加选项',
        priceBase: '基本', priceAddons: '附加选项', priceTotal: '估计总额',
        cancel: '取消', submit: '继续到付款页', pickDate: '选择日期',
        step1Title: '第 1 步 — 选项', step2Title: '第 2 步 — 联系方式·接送',
        next: '下一步', back: '上一步',
        phone: '手机号码', phonePh: '例: +86 138 1234 5678',
        pickup: '接送酒店 / 地址', pickupPh: '例: 明洞乐天酒店',
        whatsapp: 'WhatsApp ID', whatsappPh: '+86 138 1234 5678',
        line: 'LINE ID', linePh: 'cocotrip_user',
        memo: '特别要求 / 备注', memoPh: '过敏、儿童同行、无障碍需求等',
        required: '必填', missingFields: '请填写所有必填项' },
};

const DRIVER_LANG_LABELS: Record<DriverLanguage, Record<Language, string>> = {
  en: { ko: '영어', en: 'English',  ja: '英語', zh: '英语' },
  ja: { ko: '일본어', en: 'Japanese', ja: '日本語', zh: '日语' },
  zh: { ko: '중국어', en: 'Chinese',  ja: '中国語', zh: '中文' },
};

interface Props {
  tour: Tour;
  language: Language;
  trigger: React.ReactNode;
}

export function TourBookingDialog({ tour, language, trigger }: Props) {
  const labels = I18N[language] || I18N.en;
  const auth = useAuth();
  const userEmail = auth?.user?.email || '';
  const availableLangs: DriverLanguage[] = (tour.driverLanguages && tour.driverLanguages.length > 0)
    ? tour.driverLanguages
    : (['en'] as DriverLanguage[]);

  const [pax, setPax] = useState<number>(2);
  const [date, setDate] = useState<string>('');
  const [driverLang, setDriverLang] = useState<DriverLanguage>(availableLangs[0]);
  const [selectedAddons, setSelectedAddons] = useState<Set<string>>(new Set());

  // Step 2 — contact + pickup. All fields below are required for submission;
  // backend captures them in PayPalBookingButton's `memo` arg (no API change).
  const [step, setStep] = useState<1 | 2>(1);
  const [phone, setPhone] = useState<string>('');
  const [pickupAddress, setPickupAddress] = useState<string>('');
  const [whatsappId, setWhatsappId] = useState<string>('');
  const [lineId, setLineId] = useState<string>('');
  const [memoText, setMemoText] = useState<string>('');

  // Firestore tour_availability cache (월별). 비어있으면 mock fallback.
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());
  const [firestoreCache, setFirestoreCache] = useState<Map<string, AvailabilityEntry>>(new Map());

  useEffect(() => {
    const ym = `${calendarMonth.getFullYear()}-${String(calendarMonth.getMonth() + 1).padStart(2, '0')}`;
    let cancelled = false;
    fetchMonthAvailability(tour.id, ym)
      .then((map) => { if (!cancelled) setFirestoreCache(map); })
      .catch(() => { /* silent — mock fallback이 처리 */ });
    return () => { cancelled = true; };
  }, [tour.id, calendarMonth]);

  /** Firestore 우선, mock fallback 결합한 단일 일자 검사. */
  function isDateBlocked(iso: string): boolean {
    if (!iso) return false;
    const fsEntry = firestoreCache.get(iso);
    if (fsEntry && (fsEntry.status === 'fully_booked' || fsEntry.status === 'blackout')) {
      return true;
    }
    return !checkAvailability(tour.id, iso).available;
  }

  const days = Math.max(1, tour.durationDays);

  // 비-영어 기사는 자동으로 해당 addon 추가
  const effectiveAddons = useMemo(() => {
    const next = new Set(selectedAddons);
    if (driverLang === 'ja') next.add('japanese_driver');
    if (driverLang === 'zh') next.add('chinese_driver');
    return next;
  }, [selectedAddons, driverLang]);

  // SSOT 기반 가격 — pricing_spec.json daily_tour_prices 우선, 없으면 priceFrom × KRW
  // priceUnit='per_person' 투어는 인당 가격 × pax (예: 나이트 투어 $49/인)
  const unitPriceKRW = useMemo(() => getTourPriceKRW(tour.id, tour.priceFrom, tour.priceUnit), [tour.id, tour.priceFrom, tour.priceUnit]);
  const baseKRW = tour.priceUnit === 'per_person' ? unitPriceKRW * pax : unitPriceKRW;

  // batch 9 fix (B9-5): 투어별 stops 입장료 합산 → attraction_pass addon 가격 동적 override.
  // 마진 0 정책: tour.stops[].entry_fee_krw 합계를 그대로 사용. 합계가 0 이면 옵션 미노출.
  const tourAdmissionTotal = useMemo(() => {
    return tour.stops?.reduce((sum, s) => sum + (s.entry_fee_krw ?? 0), 0) ?? 0;
  }, [tour.stops]);
  const dynamicAddons: AddonItem[] = useMemo(() => {
    return ADDONS.map(a =>
      a.id === 'attraction_pass' ? { ...a, priceKRW: tourAdmissionTotal } : a
    );
  }, [tourAdmissionTotal]);

  const addonKRW = computeAddonTotal(effectiveAddons, pax, days, dynamicAddons);
  const totalKRW = baseKRW + addonKRW;

  const productType = useMemo(() => getTourProductType(tour.id), [tour.id]);
  const availability = useMemo(() => {
    if (!date) return { available: true } as const;
    const fsEntry = firestoreCache.get(date);
    if (fsEntry && (fsEntry.status === 'fully_booked' || fsEntry.status === 'blackout')) {
      return { available: false, reason: fsEntry.status } as const;
    }
    return checkAvailability(tour.id, date);
  }, [tour.id, date, firestoreCache]);
  const langKey = (['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as 'ko' | 'en' | 'ja' | 'zh';
  const availabilityMsg = availability.reason ? REASON_LABELS[availability.reason][langKey] : '';

  // Step 1 → 2 gate: must have a date + availability before showing contact form.
  const canAdvanceStep1 = productType !== null && totalKRW > 0 && !!date && availability.available;
  // Step 2 → checkout gate: all four contact fields populated (whatsapp/line both,
  // phone, pickup). Memo is required per spec ("둘다 메모 필수"). Trim ensures the
  // user actually typed something rather than just spaces.
  const step2Complete = (
    phone.trim().length > 0 &&
    pickupAddress.trim().length > 0 &&
    whatsappId.trim().length > 0 &&
    lineId.trim().length > 0 &&
    memoText.trim().length > 0
  );

  // Bundled memo payload — backend's PayPalBookingButton accepts `memo` and
  // logs/persists the full string. No API contract change required.
  const fullMemo = useMemo(() => {
    const lines = [
      `Tour: ${tour.title.en} | ${pax} pax | ${driverLang.toUpperCase()} driver`,
      `Phone: ${phone}`,
      `Pickup: ${pickupAddress}`,
      `WhatsApp: ${whatsappId}`,
      `LINE: ${lineId}`,
      `Add-ons: ${Array.from(effectiveAddons).join(', ') || 'none'}`,
      `Notes: ${memoText}`,
    ];
    return lines.join(' | ');
  }, [tour.title.en, pax, driverLang, phone, pickupAddress, whatsappId, lineId, effectiveAddons, memoText]);

  // 투어 적용 가능 addon만 (driver lang 옵션은 lang select에서 자동 처리)
  // batch 9 fix (B9-5): attraction_pass 는 tour.stops 합계가 0 이면 노출 안 함
  // (입장료 데이터가 없는 투어에 ₩0 옵션을 노출하면 혼란).
  const visibleAddons = dynamicAddons.filter(a =>
    a.applies_to.includes('tour') &&
    !['japanese_driver', 'chinese_driver'].includes(a.id) &&
    !(a.id === 'attraction_pass' && tourAdmissionTotal <= 0)
  );

  const submitUrl = useMemo(() => {
    const params = new URLSearchParams({
      tour: tour.slug,
      pax: String(pax),
      driverLang,
    });
    if (date) params.set('date', date);
    const addonIds = Array.from(effectiveAddons);
    if (addonIds.length) params.set('addons', addonIds.join(','));
    return `/charter?${params.toString()}`;
  }, [tour.slug, pax, date, driverLang, effectiveAddons]);

  const toggleAddon = (id: string) => {
    setSelectedAddons(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className="max-w-md mx-auto max-h-[85vh] overflow-y-auto"
        style={{ background: 'linear-gradient(180deg, #0f0820 0%, #0a0512 100%)', border: '1px solid rgba(182,104,252,0.20)', color: 'white' }}
      >
        <DialogHeader>
          <DialogTitle className="text-[15px] font-black">{labels.title}</DialogTitle>
          <p className="text-[10px] text-white/45 uppercase tracking-widest mt-1">
            {step === 1 ? labels.step1Title : labels.step2Title}
          </p>
        </DialogHeader>

        {step === 1 && (
        <div className="space-y-4 mt-2">
          {/* Pax stepper */}
          <div>
            <label className="flex items-center gap-1.5 text-[11px] text-white/55 uppercase tracking-wider mb-1.5">
              <Users className="w-3.5 h-3.5" />{labels.pax}
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setPax(p => Math.max(1, p - 1))}
                className="w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)' }}
                aria-label={translations[language].a11y?.decreasePax ||'Decrease passengers'}
              >
                <Minus className="w-4 h-4 text-white/70" />
              </button>
              <span className="text-[18px] font-black tabular-nums w-10 text-center">{pax}</span>
              <button
                type="button"
                onClick={() => setPax(p => Math.min(tour.maxPax, p + 1))}
                className="w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)' }}
                aria-label={translations[language].a11y?.increasePax ||'Increase passengers'}
              >
                <Plus className="w-4 h-4 text-white/70" />
              </button>
              <span className="text-[10px] text-white/55">max {tour.maxPax}</span>
            </div>
          </div>

          {/* Date picker — Popover + Calendar with disabled-date highlighting */}
          <div>
            <label className="flex items-center gap-1.5 text-[11px] text-white/55 uppercase tracking-wider mb-1.5">
              <Calendar className="w-3.5 h-3.5" />{labels.date}
            </label>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="w-full px-3 py-2 rounded-xl text-[13px] text-left focus:outline-none flex items-center justify-between"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: date && !availability.available
                      ? '1px solid rgba(248,113,113,0.45)'
                      : '1px solid rgba(255,255,255,0.10)',
                    color: date ? 'white' : 'rgba(255,255,255,0.40)',
                  }}
                >
                  <span>{date || labels.pickDate}</span>
                  <Calendar className="w-4 h-4 text-white/55" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                className="p-0 w-auto"
                align="start"
                style={{ background: '#0f0820', border: '1px solid rgba(182,104,252,0.25)' }}
              >
                <CalendarPicker
                  mode="single"
                  selected={dateFromIso(date)}
                  onSelect={(d) => setDate(isoFromDate(d))}
                  onMonthChange={setCalendarMonth}
                  disabled={(d) => {
                    const iso = isoFromDate(d);
                    // 12h cutoff 이내 날짜는 선택 불가 (서버와 정책 일치)
                    if (isTourDateClosed(iso)) return true;
                    return isDateBlocked(iso);
                  }}
                  fromDate={new Date()}
                  // batch 9 fix (B9-4, 2026-05-09): 다크 popover 배경 위 가독성 확보.
                  // 기본 react-day-picker 색상이 light 테마 기준이라 다크 배경에서 거의
                  // 안 보임. day text/weekday/today/disabled 모두 명시 색상.
                  className="text-white"
                  classNames={{
                    day_button: 'text-white/90 hover:bg-white/10 hover:text-white',
                    weekday: 'text-white/55',
                    caption_label: 'text-white font-semibold',
                    nav_button: 'text-white/70 hover:text-white',
                    today: 'bg-[#B668FC]/20 text-white rounded-md font-bold',
                    disabled: 'text-white/20',
                    outside: 'text-white/30',
                  }}
                />
              </PopoverContent>
            </Popover>
            {date && !availability.available && (
              <p className="text-[10px] mt-1.5" style={{ color: '#FCA5A5' }}>
                {availabilityMsg}
              </p>
            )}
          </div>

          {/* Driver language */}
          <div>
            <label className="flex items-center gap-1.5 text-[11px] text-white/55 uppercase tracking-wider mb-1.5">
              <Languages className="w-3.5 h-3.5" />{labels.lang}
            </label>
            <div className="flex gap-1.5">
              {(['en', 'ja', 'zh'] as DriverLanguage[]).map(l => {
                const isAvailable = availableLangs.includes(l);
                const isActive = driverLang === l;
                return (
                  <button
                    key={l}
                    type="button"
                    onClick={() => isAvailable && setDriverLang(l)}
                    disabled={!isAvailable}
                    className="flex-1 text-[12px] font-semibold py-2 rounded-xl transition-colors"
                    style={
                      isActive
                        ? { background: 'rgba(140,200,255,0.18)', border: '1px solid rgba(140,200,255,0.45)', color: '#A0CBFF' }
                        : isAvailable
                        ? { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.55)' }
                        : { background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.20)', cursor: 'not-allowed' }
                    }
                  >
                    {DRIVER_LANG_LABELS[l][language]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Add-ons */}
          <div>
            <p className="text-[11px] text-white/55 uppercase tracking-wider mb-1.5">{labels.addons}</p>
            <div className="space-y-1.5">
              {visibleAddons.map(a => {
                const checked = selectedAddons.has(a.id);
                const unitLabel = a.unit === 'per_person'
                  ? (language === 'ko' ? '/인' : language === 'ja' ? '/人' : language === 'zh' ? '/人' : '/pax')
                  : a.unit === 'per_day'
                  ? (language === 'ko' ? '/일' : language === 'ja' ? '/日' : language === 'zh' ? '/天' : '/day')
                  : '';
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggleAddon(a.id)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-left transition-colors"
                    style={
                      checked
                        ? { background: 'rgba(182,104,252,0.10)', border: '1px solid rgba(182,104,252,0.35)' }
                        : { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }
                    }
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className="w-4 h-4 rounded shrink-0 flex items-center justify-center"
                        style={
                          checked
                            ? { background: '#B668FC', border: '1px solid #B668FC' }
                            : { background: 'transparent', border: '1px solid rgba(255,255,255,0.20)' }
                        }
                      >
                        {checked && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <span className="text-[12px] text-white/75 truncate">{a.labels[language] || a.labels.en}</span>
                    </div>
                    <span className="text-[11px] font-bold text-white/55 shrink-0">
                      ₩{a.priceKRW.toLocaleString('ko-KR')}{unitLabel}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Price summary */}
          <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="flex justify-between text-[11px] text-white/55 mb-1">
              <span>
                {labels.priceBase}
                {tour.priceUnit === 'per_person' && (
                  <span className="text-white/40 ml-1">
                    ({formatKRW(unitPriceKRW)} × {pax})
                  </span>
                )}
              </span>
              <span>{formatKRW(baseKRW)}</span>
            </div>
            {addonKRW > 0 && (
              <div className="flex justify-between text-[11px] text-white/55 mb-1">
                <span>{labels.priceAddons}</span>
                <span>+{formatKRW(addonKRW)}</span>
              </div>
            )}
            <div className="h-px bg-white/[0.08] my-1.5" />
            <div className="flex justify-between text-[14px] font-black">
              <span className="text-white">{labels.priceTotal}</span>
              <span style={{ color: '#C99FFF' }}>{formatKRW(totalKRW)}</span>
            </div>
          </div>
        </div>
        )}

        {/* Step 2 — Contact + Pickup. All fields required. */}
        {step === 2 && (
        <div className="space-y-3 mt-2">
          <ContactField
            icon={<Phone className="w-3.5 h-3.5" />}
            label={`${labels.phone} *`}
            placeholder={labels.phonePh}
            value={phone}
            onChange={setPhone}
            type="tel"
          />
          <ContactField
            icon={<MapPin className="w-3.5 h-3.5" />}
            label={`${labels.pickup} *`}
            placeholder={labels.pickupPh}
            value={pickupAddress}
            onChange={setPickupAddress}
          />
          <div className="grid grid-cols-2 gap-2.5">
            <ContactField
              icon={<MessageCircle className="w-3.5 h-3.5" />}
              label={`${labels.whatsapp} *`}
              placeholder={labels.whatsappPh}
              value={whatsappId}
              onChange={setWhatsappId}
              compact
            />
            <ContactField
              icon={<MessageCircle className="w-3.5 h-3.5" />}
              label={`${labels.line} *`}
              placeholder={labels.linePh}
              value={lineId}
              onChange={setLineId}
              compact
            />
          </div>
          <div>
            <label className="flex items-center gap-1.5 text-[11px] text-white/55 uppercase tracking-wider mb-1.5">
              <FileText className="w-3.5 h-3.5" />{labels.memo} *
            </label>
            <textarea
              rows={3}
              value={memoText}
              onChange={e => setMemoText(e.target.value)}
              placeholder={labels.memoPh}
              className="w-full px-3 py-2 rounded-xl text-[13px] focus:outline-none resize-none"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.10)',
                color: 'white',
              }}
            />
          </div>

          {/* Tiny price tag carry-over */}
          <div className="rounded-xl p-3 flex justify-between items-center" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <span className="text-[12px] text-white/55">{labels.priceTotal}</span>
            <span className="text-[14px] font-black" style={{ color: '#C99FFF' }}>{formatKRW(totalKRW)}</span>
          </div>
        </div>
        )}

        <DialogFooter className="gap-2 mt-3 flex-col">
          {step === 1 && (
            canAdvanceStep1 ? (
              <button
                type="button"
                onClick={() => setStep(2)}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-[14px] text-white transition-all hover:opacity-95 active:scale-[0.99]"
                style={{ background: 'linear-gradient(135deg, #B668FC, #FF6B9D)' }}
              >
                {labels.next}
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : productType ? (
              <Link
                to={submitUrl}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-[14px] text-white"
                style={{ background: 'linear-gradient(135deg, #B668FC, #FF6B9D)' }}
              >
                {labels.submit}
              </Link>
            ) : (
              <Link
                to={submitUrl}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-[14px] text-white"
                style={{ background: 'linear-gradient(135deg, #B668FC, #FF6B9D)' }}
              >
                {labels.submit}
              </Link>
            )
          )}
          {step === 1 && !date && productType && (
            <p className="text-[10px] text-white/55 text-center mt-1">
              {language === 'ko' ? '날짜를 선택하면 다음 단계로 진행할 수 있습니다.' :
               language === 'ja' ? '日付を選択すると次へ進めます。' :
               language === 'zh' ? '选择日期后可进入下一步。' :
               'Select a date to proceed to the next step.'}
            </p>
          )}

          {step === 2 && productType && (
            <div className="w-full space-y-2">
              {/* PayPal direct — bundled memo carries phone/pickup/WA/LINE/notes */}
              {step2Complete ? (
                <PayPalBookingButton
                  productType={productType}
                  passengers={pax}
                  dateStart={date}
                  dateEnd={date}
                  priceKRW={totalKRW}
                  p={{}}
                  lang={language}
                  pickupLocation={pickupAddress}
                  vehicleType={tour.vehicleType.toLowerCase()}
                  memo={fullMemo}
                  userEmail={userEmail}
                  // PR-R (2026-05-08): 마감 검증 — 투어는 별도 시간 입력 X, 09:00 기본
                  // durationDays >= 2 면 multi_day cutoff (48h) 자동 적용.
                  pickupTime="09:00"
                  durationDays={days}
                />
              ) : (
                <button
                  type="button"
                  disabled
                  className="w-full py-3 rounded-xl font-bold text-[14px] text-white/40 cursor-not-allowed"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  {labels.missingFields}
                </button>
              )}
              <button
                type="button"
                onClick={() => setStep(1)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[12px] font-semibold text-white/55 hover:text-white/80 hover:bg-white/[0.03] transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                {labels.back}
              </button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
