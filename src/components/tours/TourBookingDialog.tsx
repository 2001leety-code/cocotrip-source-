// TourBookingDialog — 투어 상세 CTA 클릭 시 인원수·날짜·언어·addon 선택 + PayPal 직진입.
// productType 매핑 있으면 (대부분) PayPalBookingButton, 없으면 (multicity-3d) charter 페이지 redirect.
// 2026-05-10 (B9-35 잔여, P3): tour:${id} 별 24h autosave (silent prefill) — Dialog 가 modal
// UX 라 ResumeWizardModal 중첩 대신 자연스러운 prefill + 24h TTL 자동 expire.
//
// PR-F (2026-06-01): 투어 예약 결제 마찰 축소 — 기능 플래그.
// VITE_FEATURE_TOUR_BOOKING_MINIMAL=true 시 Step 2 에서 전화번호 1개만 필수,
// 나머지 4개(픽업주소·WhatsApp·LINE·메모) 는 선택 입력.
// 미설정(OFF/기본) = 기존 5개 필수 동작 byte-identical.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useUserProfile } from '@/hooks/useUserProfile';
import { normalizeProfilePhone, isEmptyVal } from '@/lib/profilePrefill';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarPicker } from '@/components/ui/calendar';
import { Calendar, Users, Languages, Plus, Minus, Check, Phone, MapPin, MessageCircle, FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import pricingSpec from '@/data/pricing_spec.json';
import { getTourProductType, getTourPriceKRW } from '@/data/tours';
import { checkAvailability, REASON_LABELS } from '@/data/tour-availability';
import { fetchMonthAvailability, type AvailabilityEntry } from '@/lib/tour-availability-store';
import { PayPalBookingButton } from '@/components/PayPalBookingButton';
import { CartAddButton } from '@/components/CartButton';
import { FEATURE_TOUR_BOOKING_MINIMAL, isTourStep2Complete } from './tourBookingValidation';
import { SlotPicker } from '@/components/tours/SlotPicker';
import { useAuth } from '@/hooks/useAuth';
import type { Tour, DriverLanguage } from '@/data/tours';
import { translations, type Language } from '@/i18n';
import { loadWizardSnapshot, useWizardPersistence } from '@/hooks/useWizardPersistence';

// PR-F (2026-06-01): FEATURE_TOUR_BOOKING_MINIMAL + isTourStep2Complete →
//   src/components/tours/tourBookingValidation.ts 로 분리 (firebase-free 순수 모듈, CI fix:
//   테스트가 TourBookingDialog import 시 PayPalBookingButton→firebase getAuth() CI throw).

// tour booking 자동저장 snapshot — Set<string> 은 JSON 직렬화 불가라 array 로 변환 보존.
type TourBookingSnapshot = {
  pax: number;
  date: string;
  driverLang: DriverLanguage;
  selectedAddons: string[];
  step: 1 | 2;
  phone: string;
  pickupAddress: string;
  whatsappId: string;
  lineId: string;
  memoText: string;
  /** Phase 1 (2026-05-19): 시간 슬롯 ID (tour.slots[].id). 슬롯 없는 투어는 null. */
  selectedSlotId?: string | null;
};

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
  /** PR-F: 선택 필드 표기 — 플래그 ON 시에만 사용 */
  optional: string;
}> = {
  ko: { title: '투어 예약', pax: '인원수', date: '투어 날짜', lang: '기사 언어', addons: '추가 옵션',
        priceBase: '기본', priceAddons: '추가옵션', priceTotal: '총액 (예상)',
        cancel: '취소', submit: '견적 받기', pickDate: '날짜 선택',
        step1Title: '1단계 — 옵션 선택', step2Title: '2단계 — 연락처·픽업',
        next: '다음', back: '이전',
        phone: '휴대폰 번호', phonePh: '예: +82 10 1234 5678',
        pickup: '픽업 호텔/주소', pickupPh: '예: 명동 롯데호텔, 종로구 ○○○',
        whatsapp: 'WhatsApp ID', whatsappPh: '+82 10 1234 5678',
        line: 'LINE ID', linePh: 'cocotrip_user',
        memo: '특별 요청 / 메모', memoPh: '알레르기, 아동 동반, 접근성 등',
        required: '필수', missingFields: '필수 항목을 모두 입력해주세요',
        optional: '선택' },
  en: { title: 'Book This Tour', pax: 'Passengers', date: 'Tour date', lang: 'Driver language', addons: 'Add-ons',
        priceBase: 'Base', priceAddons: 'Add-ons', priceTotal: 'Estimated total',
        cancel: 'Cancel', submit: 'Get a quote', pickDate: 'Select date',
        step1Title: 'Step 1 — Options', step2Title: 'Step 2 — Contact & Pickup',
        next: 'Next', back: 'Back',
        phone: 'Mobile number', phonePh: 'e.g. +1 555 123 4567',
        pickup: 'Pickup hotel / address', pickupPh: 'e.g. Lotte Hotel Myeongdong',
        whatsapp: 'WhatsApp ID', whatsappPh: '+1 555 123 4567',
        line: 'LINE ID', linePh: 'cocotrip_user',
        memo: 'Special requests / notes', memoPh: 'Allergies, kids, accessibility, etc.',
        required: 'required', missingFields: 'Please fill in all required fields',
        optional: 'optional' },
  ja: { title: 'ツアー予約', pax: '人数', date: 'ツアー日', lang: 'ドライバー言語', addons: '追加オプション',
        priceBase: '基本', priceAddons: 'オプション', priceTotal: '合計（予想）',
        cancel: 'キャンセル', submit: '見積もりを取得', pickDate: '日付を選択',
        step1Title: 'ステップ 1 — オプション', step2Title: 'ステップ 2 — 連絡先・ピックアップ',
        next: '次へ', back: '戻る',
        phone: '携帯番号', phonePh: '例: +81 90 1234 5678',
        pickup: 'ピックアップホテル / 住所', pickupPh: '例: 明洞ロッテホテル',
        whatsapp: 'WhatsApp ID', whatsappPh: '+81 90 1234 5678',
        line: 'LINE ID', linePh: 'cocotrip_user',
        memo: '特別なリクエスト / メモ', memoPh: 'アレルギー、お子様連れ、バリアフリーなど',
        required: '必須', missingFields: '必須項目をすべて入力してください',
        optional: '任意' },
  zh: { title: '预订旅游', pax: '人数', date: '旅游日期', lang: '司机语言', addons: '附加选项',
        priceBase: '基本', priceAddons: '附加选项', priceTotal: '估计总额',
        cancel: '取消', submit: '获取报价', pickDate: '选择日期',
        step1Title: '第 1 步 — 选项', step2Title: '第 2 步 — 联系方式·接送',
        next: '下一步', back: '上一步',
        phone: '手机号码', phonePh: '例: +86 138 1234 5678',
        pickup: '接送酒店 / 地址', pickupPh: '例: 明洞乐天酒店',
        whatsapp: 'WhatsApp ID', whatsappPh: '+86 138 1234 5678',
        line: 'LINE ID', linePh: 'cocotrip_user',
        memo: '特别要求 / 备注', memoPh: '过敏、儿童同行、无障碍需求等',
        required: '必填', missingFields: '请填写所有必填项',
        optional: '选填' },
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

  // 2026-05-10 (B9-35 잔여): tour:${id} 별 snapshot 로드 → useState initial value prefill.
  // tour 별로 분리 (서로 다른 투어 입력 충돌 방지). 24h TTL 만료 시 null → 빈 상태.
  const persistKey = `tour:${tour.id}`;
  const initialSnap = useMemo(() => {
    return loadWizardSnapshot<TourBookingSnapshot>(persistKey)?.values ?? null;
  }, [persistKey]);

  const [pax, setPax] = useState<number>(initialSnap?.pax ?? 2);
  const [date, setDate] = useState<string>(initialSnap?.date ?? '');
  const [driverLang, setDriverLang] = useState<DriverLanguage>(
    initialSnap?.driverLang && availableLangs.includes(initialSnap.driverLang)
      ? initialSnap.driverLang
      : availableLangs[0],
  );
  const [selectedAddons, setSelectedAddons] = useState<Set<string>>(
    new Set(initialSnap?.selectedAddons ?? []),
  );

  // Step 2 — contact + pickup. All fields below are required for submission;
  // backend captures them in PayPalBookingButton's `memo` arg (no API change).
  const [step, setStep] = useState<1 | 2>(initialSnap?.step ?? 1);
  const [phone, setPhone] = useState<string>(initialSnap?.phone ?? '');
  const [pickupAddress, setPickupAddress] = useState<string>(initialSnap?.pickupAddress ?? '');
  const [whatsappId, setWhatsappId] = useState<string>(initialSnap?.whatsappId ?? '');
  const [lineId, setLineId] = useState<string>(initialSnap?.lineId ?? '');
  const [memoText, setMemoText] = useState<string>(initialSnap?.memoText ?? '');

  // 2026-06-11 가입 프로필 prefill — phone 만 빈칸일 때 채움 (픽업/WhatsApp/LINE/메모는 프로필 미수집 → 무변경).
  // localStorage 직전입력/사용자 타이핑은 절대 안 덮음(functional update 로 최신 phone 확인). 실패/로그아웃=빈칸 graceful.
  const { profile: prefillProfile } = useUserProfile();
  const phonePrefilled = useRef(false);
  useEffect(() => {
    if (phonePrefilled.current || !prefillProfile) return;
    phonePrefilled.current = true; // 프로필 도착 후 1회만 (지운 빈칸 재주입 방지 — critique #4)
    const p = normalizeProfilePhone(prefillProfile.phone, prefillProfile.countryCode);
    if (!isEmptyVal(p)) setPhone((cur) => (isEmptyVal(cur) ? p : cur));
  }, [prefillProfile]);

  // Phase 1 (2026-05-19): 시간 슬롯 선택 (tour.slots 가 정의된 어드민 투어용)
  const activeSlots = useMemo(
    () => (tour.slots ?? []).filter((s) => s.is_active !== false),
    [tour.slots],
  );
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(initialSnap?.selectedSlotId ?? null);

  // 날짜 변경 시 슬롯 선택 reset (날짜별 capacity 변할 수 있어 — 향후 확장 대비)
  useEffect(() => {
    if (activeSlots.length === 0) setSelectedSlotId(null);
  }, [date, activeSlots.length]);

  // debounced autosave — 매 키 입력마다 저장 X, 500ms 후 1번. Set 직렬화 array 변환.
  const persistValues = useMemo<TourBookingSnapshot>(() => ({
    pax, date, driverLang,
    selectedAddons: Array.from(selectedAddons),
    step, phone, pickupAddress, whatsappId, lineId, memoText,
    selectedSlotId,
  }), [pax, date, driverLang, selectedAddons, step, phone, pickupAddress, whatsappId, lineId, memoText, selectedSlotId]);
  useWizardPersistence(persistKey, persistValues, step);

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

  // Phase 1 (2026-05-19): 선택 슬롯의 price_modifier_krw 가 총액에 반영됨.
  // 슬롯 미선택이거나 슬롯 없는 투어는 0.
  const selectedSlot = useMemo(
    () => activeSlots.find((s) => s.id === selectedSlotId),
    [activeSlots, selectedSlotId],
  );
  const slotModifierKRW = selectedSlot?.price_modifier_krw ?? 0;

  const totalKRW = baseKRW + addonKRW + slotModifierKRW;

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
  // Phase 1 (2026-05-19): tour.slots 가 정의된 투어는 슬롯 선택 필수.
  //   activeSlots.length === 1 이면 SlotPicker 가 자동 선택 → 항상 truthy.
  //   activeSlots.length > 1 이면 사용자가 직접 선택 필요.
  const slotRequirementMet = activeSlots.length === 0 || !!selectedSlotId;
  const canAdvanceStep1 = productType !== null && totalKRW > 0 && !!date && availability.available && slotRequirementMet;
  // Step 2 → checkout gate. isTourStep2Complete 헬퍼에 위임 (테스트 가능).
  // PR-F: minimal=true = 전화 1개만 필수. minimal=false = 5개 전부 필수 (기본).
  const step2Complete = isTourStep2Complete(
    { phone, pickupAddress, whatsappId, lineId, memoText },
    FEATURE_TOUR_BOOKING_MINIMAL,
  );

  // Bundled memo payload — backend's PayPalBookingButton accepts `memo` and
  // logs/persists the full string. No API contract change required.
  // Phase 1 (2026-05-19): 슬롯 선택된 경우 slot info (id, time, modifier) 포함 →
  // 운영자가 배차 시 정확한 출발 시각 인지 가능 + 추후 backend slot capacity 차감 hook 시 활용.
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
    if (selectedSlot) {
      const mod = selectedSlot.price_modifier_krw ?? 0;
      const modStr = mod === 0 ? '' : mod > 0 ? ` (+₩${mod.toLocaleString()})` : ` (-₩${Math.abs(mod).toLocaleString()})`;
      const labelStr = selectedSlot.label?.en || selectedSlot.label?.ko || '';
      lines.push(`Slot: ${selectedSlot.id} @ ${selectedSlot.start_time}${labelStr ? ` "${labelStr}"` : ''}${modStr}`);
    }
    return lines.join(' | ');
  }, [tour.title.en, pax, driverLang, phone, pickupAddress, whatsappId, lineId, effectiveAddons, memoText, selectedSlot]);

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

          {/* Phase 1 (2026-05-19): 시간 슬롯 picker — tour.slots 가 정의된 어드민 투어만 */}
          {/* TODO: slot id forward to backend (Phase 2 follow-up — 결제 메모에 포함됨) */}
          {activeSlots.length > 0 && (
            <SlotPicker
              slots={activeSlots}
              selectedSlotId={selectedSlotId}
              onChange={setSelectedSlotId}
              language={language}
            />
          )}

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
            {/* batch 9 fix (B9-9, 2026-05-09): 부가세 포함 명시. */}
            <p className="text-[10px] text-white/45 text-right mt-1">
              {language === 'ko' ? '부가세 포함' : language === 'ja' ? '税込' : language === 'zh' ? '含税' : 'VAT included'}
            </p>
          </div>
        </div>
        )}

        {/* Step 2 — Contact + Pickup.
            PR-F: 플래그 ON = 전화 필수, 나머지 선택. OFF = 전부 필수. */}
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
            label={FEATURE_TOUR_BOOKING_MINIMAL
              ? `${labels.pickup} (${labels.optional})`
              : `${labels.pickup} *`}
            placeholder={labels.pickupPh}
            value={pickupAddress}
            onChange={setPickupAddress}
          />
          <div className="grid grid-cols-2 gap-2.5">
            <ContactField
              icon={<MessageCircle className="w-3.5 h-3.5" />}
              label={FEATURE_TOUR_BOOKING_MINIMAL
                ? `${labels.whatsapp} (${labels.optional})`
                : `${labels.whatsapp} *`}
              placeholder={labels.whatsappPh}
              value={whatsappId}
              onChange={setWhatsappId}
              compact
            />
            <ContactField
              icon={<MessageCircle className="w-3.5 h-3.5" />}
              label={FEATURE_TOUR_BOOKING_MINIMAL
                ? `${labels.line} (${labels.optional})`
                : `${labels.line} *`}
              placeholder={labels.linePh}
              value={lineId}
              onChange={setLineId}
              compact
            />
          </div>
          <div>
            <label className="flex items-center gap-1.5 text-[11px] text-white/55 uppercase tracking-wider mb-1.5">
              <FileText className="w-3.5 h-3.5" />
              {FEATURE_TOUR_BOOKING_MINIMAL
                ? `${labels.memo} (${labels.optional})`
                : `${labels.memo} *`}
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
              /* 날짜 미선택 + 결제 가능 투어(productType): /charter 로 점프하지 않고 비활성 —
                 날짜를 선택해야 Next(Step2 결제)로 진행 (아래 "날짜 선택" 안내와 함께). */
              <button
                type="button"
                disabled
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-[14px] text-white opacity-40 cursor-not-allowed"
                style={{ background: 'linear-gradient(135deg, #B668FC, #FF6B9D)' }}
              >
                {labels.next}
                <ChevronRight className="w-4 h-4" />
              </button>
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
                <>
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
                  {/* 2026-06-06 PR2b: 장바구니 담기 (VITE_FEATURE_CART OFF=null 미렌더).
                      예약 상세(productType/날짜/인원/픽업/메모) 채운 뒤 = 완전한 결제 항목
                      (PR1 카드 담기는 productType만이라 결제 불가였음 → 올바른 진입점).
                      운영자 "위시리스트=장바구니, 투어 담아 한번에 결제" 비전. */}
                  <CartAddButton
                    id={`${tour.id}-${date}-${pax}`}
                    booking={{
                      productType,
                      passengers: pax,
                      dateStart: date,
                      dateEnd: date,
                      durationDays: days,
                      pickupLocation: pickupAddress,
                      vehicleType: tour.vehicleType.toLowerCase(),
                      memo: fullMemo,
                    }}
                    displayName={`${tour.title[language] || tour.title.en} (${date})`}
                    thumbnailUrl={tour.thumbnail}
                    priceKRW={totalKRW}
                    className="w-full inline-flex items-center justify-center gap-1.5 py-3 rounded-xl text-[13px] font-semibold bg-white/[0.05] text-white/75 border border-white/12 hover:bg-white/[0.09] transition-colors"
                  />
                </>
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
