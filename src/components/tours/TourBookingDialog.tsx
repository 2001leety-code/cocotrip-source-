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
import { useProfileContactSync } from '@/hooks/useProfileContactSync';
import { normalizeProfilePhone, isEmptyVal } from '@/lib/profilePrefill';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarPicker } from '@/components/ui/calendar';
import { Calendar, Users, Languages, Plus, Minus, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import pricingSpec from '@/data/pricing_spec.json';
import { getTourProductType, getTourPriceKRW } from '@/data/tours';
import { isPastCutoff } from '@/lib/bookingCutoff';
import { trackDateSelect, trackTourBookingStart, trackTourStep } from '@/lib/analytics';
import { checkAvailability, REASON_LABELS } from '@/data/tour-availability';
import { fetchMonthAvailability, type AvailabilityEntry } from '@/lib/tour-availability-store';
import { PayPalBookingButton } from '@/components/PayPalBookingButton';
import { CartAddButton } from '@/components/CartButton';
import { BookingInfoForm } from '@/components/booking/BookingInfoForm';
import { formatPrice } from '@/lib/exchange-rate';
import { FEATURE_TOUR_BOOKING_MINIMAL, isTourStep2Complete, computeTourBookingTotalKRW, clampHanbokCount } from './tourBookingValidation';
import { SlotPicker } from '@/components/tours/SlotPicker';
import { resolveSlotCapacity, tourSlotBody } from '@/lib/tourSlotBooking';
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
  /** CRITICAL-1 fix (2026-06-29): 단일 messenger ("WhatsApp: id" 등). 구 snapshot
   *  whatsappId/lineId 는 마이그레이션 폴백으로만 읽음(신규 저장 X). */
  messenger?: string;
  whatsappId?: string;
  lineId?: string;
  memoText: string;
  /** Phase 1 (2026-05-19): 시간 슬롯 ID (tour.slots[].id). 슬롯 없는 투어는 null. */
  selectedSlotId?: string | null;
  /** 2026-06-30: 한복 대여 인원 카운터(0~pax). 가격 미반영(애드온=무료) — 운영자 준비 수량용. */
  hanbokCount?: number;
};

function isoFromDate(d: Date | undefined): string {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 투어는 별도 시각 입력이 없다 — 마감 계산의 기준 출발 시각 (서버 fallback 과 동일). */
const TOUR_DEFAULT_PICKUP_TIME = '09:00';

/**
 * 투어 날짜가 마감(출발 8시간 전, 09:00 KST 기준) 이내인지 검사.
 * 마감 이내 출발은 서버(createPaypalOrder)가 차단하므로 달력에서도 비활성한다.
 * 값은 서버 미러(lib/bookingCutoff)에서만 온다 — 12h 하드코딩 제거 (2026-07-28).
 */
function isTourDateClosed(iso: string, productType: string | null): boolean {
  if (!iso) return false;
  return isPastCutoff(productType, iso, TOUR_DEFAULT_PICKUP_TIME, TOUR_DEFAULT_PICKUP_TIME);
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

// 2026-06-30: computeAddonTotal 제거 — 애드온=무료/현장결제 확정으로 totalKRW 에 더 이상
//   합산하지 않음(P311 표시가=청구가). attraction_pass 동적 가격은 여전히 옵션 목록 참고표시에만 사용.

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
  /** 2026-06-30 운영자 확정: 투어 애드온=무료/현장결제. 총액 미포함 인지용 라벨. */
  addonOnsite: string;
  /** 한복 인원 카운터 라벨 (가격 미반영 — 운영자 준비 수량용) */
  hanbokCount: string;
  /** 배차 실패 시 자동취소 고지 (운영자 2026-07-28) — 결제 전 항상 노출. */
  autoCancelNote: string;
}> = {
  ko: { title: '투어 예약', pax: '인원수', date: '투어 날짜', lang: '기사 언어', addons: '추가 옵션',
        priceBase: '기본', priceAddons: '추가옵션', priceTotal: '총액 (예상)',
        cancel: '취소', submit: '견적 받기', pickDate: '날짜 선택',
        step1Title: '1단계 — 옵션 선택', step2Title: '2단계 — 연락처·픽업',
        next: '결제 단계로', back: '이전',
        phone: '휴대폰 번호', phonePh: '예: +82 10 1234 5678',
        pickup: '픽업 호텔/주소', pickupPh: '예: 명동 롯데호텔, 종로구 ○○○',
        whatsapp: 'WhatsApp ID', whatsappPh: '+82 10 1234 5678',
        line: 'LINE ID', linePh: 'cocotrip_user',
        memo: '특별 요청 / 메모', memoPh: '카시트, 접근성, 시간 변경, 픽업 위치 등',
        required: '필수', missingFields: '필수 항목을 모두 입력해주세요',
        optional: '선택',
        addonOnsite: '선택 옵션 · 현장 결제 (총액 미포함)',
        hanbokCount: '한복 대여 (인원)',
        autoCancelNote: '차량 또는 기사를 배정하지 못할 경우 예약은 자동 취소되며 전액 환불됩니다. 취소 사유는 예약 내역과 이메일로 안내드립니다.' },
  en: { title: 'Book This Tour', pax: 'Passengers', date: 'Tour date', lang: 'Driver language', addons: 'Add-ons',
        priceBase: 'Base', priceAddons: 'Add-ons', priceTotal: 'Estimated total',
        cancel: 'Cancel', submit: 'Get a quote', pickDate: 'Select date',
        step1Title: 'Step 1 — Options', step2Title: 'Step 2 — Contact & Pickup',
        next: 'Continue to payment', back: 'Back',
        phone: 'Mobile number', phonePh: 'e.g. +1 555 123 4567',
        pickup: 'Pickup hotel / address', pickupPh: 'e.g. Lotte Hotel Myeongdong',
        whatsapp: 'WhatsApp ID', whatsappPh: '+1 555 123 4567',
        line: 'LINE ID', linePh: 'cocotrip_user',
        memo: 'Special requests / notes', memoPh: 'Kids, accessibility, pickup details, etc.',
        required: 'required', missingFields: 'Please fill in all required fields',
        optional: 'optional',
        addonOnsite: 'Optional · pay on-site (not included in total)',
        hanbokCount: 'Hanbok rental (count)',
        autoCancelNote: 'If we cannot assign a vehicle or driver, your booking is cancelled automatically and refunded in full. The reason is sent to you by email and shown in your bookings.' },
  ja: { title: 'ツアー予約', pax: '人数', date: 'ツアー日', lang: 'ドライバー言語', addons: '追加オプション',
        priceBase: '基本', priceAddons: 'オプション', priceTotal: '合計（予想）',
        cancel: 'キャンセル', submit: '見積もりを取得', pickDate: '日付を選択',
        step1Title: 'ステップ 1 — オプション', step2Title: 'ステップ 2 — 連絡先・ピックアップ',
        next: '決済へ進む', back: '戻る',
        phone: '携帯番号', phonePh: '例: +81 90 1234 5678',
        pickup: 'ピックアップホテル / 住所', pickupPh: '例: 明洞ロッテホテル',
        whatsapp: 'WhatsApp ID', whatsappPh: '+81 90 1234 5678',
        line: 'LINE ID', linePh: 'cocotrip_user',
        memo: '特別なリクエスト / メモ', memoPh: 'チャイルドシート、バリアフリー、時間変更、ピックアップ場所など',
        required: '必須', missingFields: '必須項目をすべて入力してください',
        optional: '任意',
        addonOnsite: '任意オプション · 現地払い（合計に含まれません）',
        hanbokCount: '韓服レンタル（人数）',
        autoCancelNote: '車両またはドライバーを手配できない場合、ご予約は自動的にキャンセルされ全額返金されます。理由はメールと予約履歴でお知らせします。' },
  zh: { title: '预订旅游', pax: '人数', date: '旅游日期', lang: '司机语言', addons: '附加选项',
        priceBase: '基本', priceAddons: '附加选项', priceTotal: '估计总额',
        cancel: '取消', submit: '获取报价', pickDate: '选择日期',
        step1Title: '第 1 步 — 选项', step2Title: '第 2 步 — 联系方式·接送',
        next: '前往支付', back: '上一步',
        phone: '手机号码', phonePh: '例: +86 138 1234 5678',
        pickup: '接送酒店 / 地址', pickupPh: '例: 明洞乐天酒店',
        whatsapp: 'WhatsApp ID', whatsappPh: '+86 138 1234 5678',
        line: 'LINE ID', linePh: 'cocotrip_user',
        memo: '特别要求 / 备注', memoPh: '儿童座椅、无障碍需求、时间调整、接送地点等',
        required: '必填', missingFields: '请填写所有必填项',
        optional: '选填',
        addonOnsite: '可选项 · 现场支付（不含在总额内）',
        hanbokCount: '韩服租赁（人数）',
        autoCancelNote: '如无法安排车辆或司机，订单将自动取消并全额退款。取消原因将通过邮件和订单记录告知您。' },
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
  // CRITICAL-1 fix (2026-06-29): 트립닷컴식 BookingInfoForm 통합 후 WhatsApp/LINE 전용
  //   입력 UI 가 삭제됐는데 whatsappId/lineId 가 세터 없는 read-only 라 영구 빈값이었음 →
  //   (A) memo 에 손님 메신저 통째 누락 (B) isTourStep2Complete 의 whatsapp|line 요구가
  //   영구 false → PayPal 버튼 미렌더 = 투어 결제 전면 차단. BookingInfoForm 이 수집하는
  //   단일 messenger(드롭다운+id, WhatsApp/KakaoTalk/LINE/WeChat) 를 받아 배선 (차터 패턴).
  //   구 snapshot(whatsappId/lineId) 은 마이그레이션 폴백으로 흡수.
  const [messenger, setMessenger] = useState<string>(() => {
    if (initialSnap?.messenger) return initialSnap.messenger;
    if (initialSnap?.whatsappId) return `WhatsApp: ${initialSnap.whatsappId}`;
    if (initialSnap?.lineId) return `LINE: ${initialSnap.lineId}`;
    return '';
  });
  const [memoText, setMemoText] = useState<string>(initialSnap?.memoText ?? '');

  // 2026-06-30 트립닷컴식 예약정보 (SMS 인증 제거 운영자 결정): 결제 직전 약관 동의.
  //   termsAgreed 는 매 결제마다 명시 동의 받도록 비저장 (재진입 시 다시 체크).
  const [termsAgreed, setTermsAgreed] = useState<boolean>(false);
  // 2026-06-29 마케팅(선택) 정보 수신 동의 — 약관(termsAgreed)과 독립. 결제 게이트(step2Complete)에
  //   절대 미포함(미동의해도 결제 진행). capture body 로만 전달돼 booking 레코드에 보존.
  const [marketingConsent, setMarketingConsent] = useState<boolean>(false);

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

  // 2026-07-26: 위 prefill 이 읽는 값을 쓰는 코드가 없어 매 예약마다 재입력이었다 → 저장 배선.
  useProfileContactSync(phone);

  // Phase 1 (2026-05-19): 시간 슬롯 선택 (tour.slots 가 정의된 어드민 투어용)
  const activeSlots = useMemo(
    () => (tour.slots ?? []).filter((s) => s.is_active !== false),
    [tour.slots],
  );
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(initialSnap?.selectedSlotId ?? null);

  // 2026-06-30: 한복 대여 인원 카운터 (0~pax). 가격 미반영(애드온=무료/현장결제) — 운영자가
  //   몇 벌 준비할지 파악용. snapshot 복원 시 현재 pax 로 clamp(저장 후 pax 줄었을 수 있음).
  const [hanbokCount, setHanbokCount] = useState<number>(
    () => clampHanbokCount(initialSnap?.hanbokCount ?? 0, initialSnap?.pax ?? pax),
  );

  // 날짜 변경 시 슬롯 선택 reset (날짜별 capacity 변할 수 있어 — 향후 확장 대비)
  useEffect(() => {
    if (activeSlots.length === 0) setSelectedSlotId(null);
  }, [date, activeSlots.length]);

  // pax 감소 시 한복 인원 clamp (예: 4명→2명 변경 시 hanbokCount 4→2). 증가 시는 무변경.
  useEffect(() => {
    setHanbokCount((c) => clampHanbokCount(c, pax));
  }, [pax]);

  // debounced autosave — 매 키 입력마다 저장 X, 500ms 후 1번. Set 직렬화 array 변환.
  const persistValues = useMemo<TourBookingSnapshot>(() => ({
    pax, date, driverLang,
    selectedAddons: Array.from(selectedAddons),
    step, phone, pickupAddress, messenger, memoText,
    selectedSlotId, hanbokCount,
  }), [pax, date, driverLang, selectedAddons, step, phone, pickupAddress, messenger, memoText, selectedSlotId, hanbokCount]);
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
  // 2026-06-30: hanbok_rental 은 인원 카운터(hanbokCount)로 분리됐으므로 애드온 집합에서 제외
  //   (구 snapshot 에 남아있어도 이중계산/메모 중복 방지 — 어차피 totalKRW 는 애드온 제외라 가격 무관).
  const effectiveAddons = useMemo(() => {
    const next = new Set(selectedAddons);
    next.delete('hanbok_rental');
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

  // 2026-06-30: addonKRW(애드온 소계) 제거 — 애드온=무료/현장결제라 totalKRW(=청구가)에 미포함.
  //   computeAddonTotal 호출 삭제 → totalKRW 가 애드온과 무관해 P311(표시가=청구가) 정합.

  // Phase 1 (2026-05-19): 선택 슬롯의 price_modifier_krw 가 총액에 반영됨.
  // 슬롯 미선택이거나 슬롯 없는 투어는 0.
  const selectedSlot = useMemo(
    () => activeSlots.find((s) => s.id === selectedSlotId),
    [activeSlots, selectedSlotId],
  );
  const slotModifierKRW = selectedSlot?.price_modifier_krw ?? 0;

  // 🔴 2026-08-08 슬롯 정원(오버부킹 방지) — 지금까지 고른 슬롯이 결제 메모 문자열에만 들어가고
  //   백엔드로는 안 갔다(`acquireSlotLock`/`confirmSlotLock` 이 한 번도 안 걸림).
  //   슬롯별 capacity 가 비어 있으면 tour.maxPax 로 폴백한다 — 규칙 정본은
  //   api/_shared/slot-capacity.js 헤더 + admin-product-publish-validation.validateSlotNumeric.
  const slotCapacityForOrder = resolveSlotCapacity(selectedSlot?.capacity, tour.maxPax);

  // 장바구니 담기도 같은 4필드를 실어야 한다 — 담아서 결제하면 createCartOrder 가
  //   acquireSlotLock 을, captureCartOrder 가 confirmSlotLock 을 부른다. 안 실으면
  //   "장바구니로 사면 정원 강제가 없다" 는 반쪽 수정이 된다(결제 경로와 동일 규칙 재사용).
  const cartSlotFields = tourSlotBody({
    tourId: tour.id,
    tourSlotId: selectedSlot ? selectedSlot.id : '',
    bookingDate: date,
    slotCapacity: slotCapacityForOrder,
  });
  // 슬롯이 다르면 장바구니 라인도 달라야 한다 — id 가 같으면 10시 담고 14시 담을 때
  //   isInCart 가 이미 담김으로 보고 add 가 앞 항목을 덮는다(정원 계산도 한 슬롯만 남는다).
  //   슬롯 없는 투어는 접미사가 빈 문자열 = 기존 id 그대로.
  const cartSlotSuffix = cartSlotFields.tourSlotId ? `-${cartSlotFields.tourSlotId}` : '';

  // P311 (2026-06-30 운영자 확정): 투어 애드온(한복/카시트/가이드)=무료/현장결제 →
  //   PayPal 청구에 미포함(백엔드 resolveKrwAmount = dailyPrice×days = baseKRW 만 청구).
  //   따라서 표시 총액에서도 addonKRW 를 제외해야 표시가 == 청구가(priceKRW={totalKRW}).
  //   slotModifierKRW 는 애드온 아님(공항 시간대 등)이라 기존대로 포함(표시 동작 보존).
  //   ⚠️ addonKRW 를 totalKRW 에 재합산하지 말 것 — P311 위반(표시가>청구가).
  const totalKRW = computeTourBookingTotalKRW(baseKRW, slotModifierKRW);

  // 표시가 = 청구가 (P311): totalStr/usdStr 은 기존 totalKRW 에서 파생만. 재계산 금지.
  const totalStr = formatKRW(totalKRW);
  const usdStr = formatPrice(totalKRW, 'en', { withCurrencyCode: true }); // "$NNN USD"
  const baseDisplayStr = formatKRW(baseKRW);
  const paxText = `${pax} ${language === 'ko' ? '명' : language === 'ja' ? '名' : language === 'zh' ? '人' : 'pax'}`;
  const dateText = date || labels.pickDate;

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
    { phone, pickupAddress, messenger, memoText, termsAgreed },
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
      `Messenger: ${messenger}`,
      `Add-ons: ${Array.from(effectiveAddons).join(', ') || 'none'}`,
      // 2026-06-30: 한복 대여 인원(가격 미반영 — 무료/현장결제). 운영자가 몇 벌 준비할지 파악용.
      `Hanbok: ${hanbokCount} pax`,
      `Notes: ${memoText}`,
      // 2026-06-30 트립닷컴식 예약정보 — 약관 동의 결과를 memo 에 기록 (SMS 인증 제거 운영자).
      //   (결제 로직 무관 — backend 가 memo 를 그대로 booking 에 보존. 운영자 컴플라이언스 추적용.)
      `Terms agreed: ${termsAgreed ? 'yes' : 'no'}`,
      `Marketing: ${marketingConsent ? 'yes' : 'no'}`,
    ];
    if (selectedSlot) {
      const mod = selectedSlot.price_modifier_krw ?? 0;
      const modStr = mod === 0 ? '' : mod > 0 ? ` (+₩${mod.toLocaleString()})` : ` (-₩${Math.abs(mod).toLocaleString()})`;
      const labelStr = selectedSlot.label?.en || selectedSlot.label?.ko || '';
      lines.push(`Slot: ${selectedSlot.id} @ ${selectedSlot.start_time}${labelStr ? ` "${labelStr}"` : ''}${modStr}`);
    }
    return lines.join(' | ');
  }, [tour.title.en, pax, driverLang, phone, pickupAddress, messenger, effectiveAddons, hanbokCount, memoText, selectedSlot, termsAgreed, marketingConsent]);

  // 투어 적용 가능 addon만 (driver lang 옵션은 lang select에서 자동 처리)
  // batch 9 fix (B9-5): attraction_pass 는 tour.stops 합계가 0 이면 노출 안 함
  // (입장료 데이터가 없는 투어에 ₩0 옵션을 노출하면 혼란).
  // 2026-06-30: hanbok_rental 은 체크박스 대신 인원 카운터로 분리 렌더 → 토글 목록에서 제외.
  const visibleAddons = dynamicAddons.filter(a =>
    a.applies_to.includes('tour') &&
    !['japanese_driver', 'chinese_driver', 'hanbok_rental'].includes(a.id) &&
    !(a.id === 'attraction_pass' && tourAdmissionTotal <= 0)
  );
  // 한복 애드온 메타(라벨·참고가). 투어 적용 가능할 때만 카운터 노출.
  const hanbokAddon = useMemo(
    () => ADDONS.find(a => a.id === 'hanbok_rental' && a.applies_to.includes('tour')) ?? null,
    [],
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

  // 퍼널 계측 (2026-08-19 감사 2번) — 시작=열림 1회(마운트당), 단계는 도달 최대치
  // 상승 시만 발화(뒤로가기·재진입 중복 방지, charter 위저드와 동일 규칙).
  // dialogEverOpened 는 state 다 — snapshot 복원으로 step=2 인 채 마운트돼도 열리기
  // 전엔 아무것도 안 쏘고, 열리는 순간 effect 가 다시 돌아 현재 단계까지 채워 쏜다.
  const [dialogEverOpened, setDialogEverOpened] = useState(false);
  const startTracked = useRef(false);
  const maxTrackedStep = useRef(1);
  useEffect(() => {
    if (!dialogEverOpened) return;
    if (!startTracked.current) {
      startTracked.current = true;
      trackTourBookingStart();
    }
    if (step === 2 && maxTrackedStep.current < 2) {
      maxTrackedStep.current = 2;
      trackTourStep(2);
    }
    if (step === 2 && step2Complete && maxTrackedStep.current < 3) {
      maxTrackedStep.current = 3;
      trackTourStep(3);
    }
  }, [dialogEverOpened, step, step2Complete]);

  return (
    <Dialog onOpenChange={(open) => { if (open) setDialogEverOpened(true); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className="cocotrip-mobile-booking-dialog max-w-md mx-auto max-h-[85vh] overflow-y-auto"
        style={{ background: 'linear-gradient(180deg, #0f0820 0%, #0a0512 100%)', border: '1px solid rgba(182,104,252,0.20)', color: 'white' }}
      >
        <DialogHeader>
          <DialogTitle className="text-[15px] font-black">{labels.title}</DialogTitle>
          <p className="text-[10px] text-white/45 uppercase tracking-widest mt-1">
            {step === 1 ? labels.step1Title : labels.step2Title}
          </p>
          <div className="flex items-center gap-1 mt-2" aria-hidden="true">
            <span className={`h-1 flex-1 rounded-full transition-colors ${step >= 1 ? 'bg-[#B9A4FF]' : 'bg-white/15'}`} />
            <span className={`h-1 flex-1 rounded-full transition-colors ${step >= 2 ? 'bg-[#B9A4FF]' : 'bg-white/15'}`} />
            <span className="h-1 flex-1 rounded-full bg-white/15" />
          </div>
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
                className="w-11 h-11 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)' }}
                aria-label={translations[language].a11y?.decreasePax ||'Decrease passengers'}
              >
                <Minus className="w-4 h-4 text-white/70" />
              </button>
              <span className="text-[18px] font-black tabular-nums w-10 text-center">{pax}</span>
              <button
                type="button"
                onClick={() => setPax(p => Math.min(tour.maxPax, p + 1))}
                className="w-11 h-11 rounded-full flex items-center justify-center"
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
                className="cocotrip-mobile-booking-popover p-0 w-auto"
                align="start"
                style={{ background: '#0f0820', border: '1px solid rgba(182,104,252,0.25)' }}
              >
                <CalendarPicker
                  mode="single"
                  selected={dateFromIso(date)}
                  onSelect={(d) => { setDate(isoFromDate(d)); if (d) trackDateSelect('tour'); }}
                  onMonthChange={setCalendarMonth}
                  disabled={(d) => {
                    const iso = isoFromDate(d);
                    // 마감(lib/bookingCutoff: 투어 8h · 전세차량 1h) 이내 날짜는 선택 불가 — 서버와 동일 판정.
                    if (isTourDateClosed(iso, productType)) return true;
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

          {/* Phase 1 (2026-05-19): 시간 슬롯 picker — tour.slots 가 정의된 어드민 투어만.
              2026-08-08: 고른 슬롯은 메모뿐 아니라 결제 body 로도 전달된다(아래 PayPalBookingButton). */}
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

          {/* Add-ons — 2026-06-30 운영자 확정: 무료/현장결제. 표시 총액(=청구가)에 미포함.
              "현장 결제(선택)" 라벨로 사용자가 총액에 안 더해짐을 인지하게. 각 가격은 참고표시 유지. */}
          <div>
            <div className="flex items-baseline justify-between gap-2 mb-1.5">
              <p className="text-[11px] text-white/55 uppercase tracking-wider">{labels.addons}</p>
              <p className="text-[10px] text-white/40">{labels.addonOnsite}</p>
            </div>
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

              {/* 한복 대여 — 인원 카운터 (가격 미반영·무료/현장결제). 운영자 준비 수량용.
                  Counter 패턴 = BookingInfoForm 캐리어 카운터(미export → 인라인). max=pax. */}
              {hanbokAddon && (
                <div
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl"
                  style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <div className="flex flex-col min-w-0">
                    <span className="text-[12px] text-white/75 truncate">{labels.hanbokCount}</span>
                    <span className="text-[10px] text-white/40">
                      ₩{hanbokAddon.priceKRW.toLocaleString('ko-KR')}
                      {language === 'ko' ? '/인' : language === 'ja' ? '/人' : language === 'zh' ? '/人' : '/pax'}
                      {' · '}{labels.optional}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      type="button"
                      onClick={() => setHanbokCount(c => clampHanbokCount(c - 1, pax))}
                      disabled={hanbokCount <= 0}
                      className="w-9 h-9 rounded-full flex items-center justify-center disabled:opacity-30"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)' }}
                      aria-label={translations[language].a11y?.decreasePax || 'Decrease'}
                    >
                      <Minus className="w-3.5 h-3.5 text-white/70" />
                    </button>
                    <span className="text-[14px] font-black tabular-nums w-6 text-center">{hanbokCount}</span>
                    <button
                      type="button"
                      onClick={() => setHanbokCount(c => clampHanbokCount(c + 1, pax))}
                      disabled={hanbokCount >= pax}
                      className="w-9 h-9 rounded-full flex items-center justify-center disabled:opacity-30"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)' }}
                      aria-label={translations[language].a11y?.increasePax || 'Increase'}
                    >
                      <Plus className="w-3.5 h-3.5 text-white/70" />
                    </button>
                  </div>
                </div>
              )}
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
            {/* 2026-06-30: 애드온 소계 라인 제거 — 애드온=무료/현장결제라 총액(=청구가)에 미포함.
                "+₩X" 표기는 총액에 더해진다는 오해를 줘 P311(표시가>청구가) 인상 → 삭제.
                각 애드온 참고가는 위 옵션 목록에서 유지(현장결제 라벨과 함께). */}
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

        {/* Step 2 — Contact + Pickup (트립닷컴식 BookingInfoForm 디자인 / 방법 A).
            결제·가격·약관 게이트는 이 컴포넌트가 소유 — BookingInfoForm 은 입력 UI 만 제공.
            phone 은 controlled, 약관은 termsAgreed SSOT 동기, addon/할인/CTA 는 숨기고
            footerSlot 으로 가격 태그를 렌더 (PayPal 버튼은 DialogFooter 가 소유).
            SMS 본인인증(BookingConsent)은 제거 (2026-06-30 운영자 결정). */}
        {step === 2 && (
        <BookingInfoForm
          eyebrow={labels.step2Title}
          title={tour.title[language] || tour.title.en}
          dateText={dateText}
          paxText={paxText}
          thumbnailUrl={tour.thumbnail}
          isAirport={false}
          meetingLabel={labels.pickup}
          baseStr={baseDisplayStr}
          meetingStr=""
          childSeatStr=""
          totalStr={totalStr}
          usdStr={usdStr}
          ctaLabel={labels.next}
          lang={langKey}
          phone={phone}
          onPhoneChange={setPhone}
          placeholderPhone={labels.phonePh}
          externalAgreeAll={termsAgreed}
          onAgreeAllChange={setTermsAgreed}
          onMarketingChange={setMarketingConsent}
          onFieldsChange={(d) => {
            // CRITICAL-1: 미팅장소→픽업, 요청사항→메모, 메신저(드롭다운+id)→단일 messenger
            //   (차터 패턴 "WhatsApp: id" — KakaoTalk/WeChat 까지 커버, fullMemo·게이트 반영).
            // HIGH fix: BookingInfoForm 마운트 시 빈 f 로 1회 emit → snapshot 복원값을 빈값으로
            //   덮어 지우는 회귀 방지. 값 있을 때만 set (비파괴 — 차터 handleFieldsChange 패턴).
            if (d.meetingPlace) setPickupAddress(d.meetingPlace);
            if (d.notes) setMemoText(d.notes);
            if (d.messengerId) setMessenger(`${d.messenger}: ${d.messengerId}`);
          }}
          hideAddons
          hideDiscount
          hideCta
          onSubmit={() => { /* 결제는 footerSlot 의 PayPalBookingButton 이 담당 */ }}
          footerSlot={
            <div className="space-y-3">
              <div className="rounded-xl p-3 flex justify-between items-center" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <span className="text-[12px] text-white/55">{labels.priceTotal}</span>
                <span className="text-[14px] font-black" style={{ color: '#C99FFF' }}>{formatKRW(totalKRW)}</span>
              </div>
            </div>
          }
        />
        )}

        {/* 모바일(<768px) 전용: footer 를 모달 스크롤 하단 sticky 로 — 가격/CTA 항상 노출.
            DialogContent 가 position:fixed+transform 조상이라 viewport fixed 불가 →
            모달 내부 sticky (max-h-[85vh] overflow-y-auto 스크롤 컨테이너 기준).
            -mx-6 px-6 = DialogContent p-6(24px) 좌우 패딩 상쇄. md: 부터 static 복귀(데스크탑 무변경).
            배경 그라데이션 = 하단색 #0a0512 페이드(콘텐츠가 비쳐 잘리는 인상 방지). */}
        <DialogFooter className="cocotrip-mobile-booking-footer gap-2 mt-3 flex-col md:static sticky bottom-0 -mx-6 px-6 pt-3 pb-[calc(8px+env(safe-area-inset-bottom))] z-10 bg-gradient-to-t from-[#0a0512] via-[#0a0512]/95 to-transparent">
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
              {/* 배차 실패 시 자동취소 고지 — 결제 직전에 반드시 읽히게 (운영자 2026-07-28). */}
              <p className="text-[11px] leading-snug text-white/50 rounded-lg px-3 py-2"
                 style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                🚐 {labels.autoCancelNote}
              </p>
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
                    // 2026-06-30 트립닷컴식 예약정보 — 결제 게이트(step2Complete)가 약관 동의를 보장.
                    //   백엔드 booking 레코드에 동의 증거를 남기도록 capture body 로 전달 (SMS 인증 제거).
                    termsAgreed={termsAgreed}
                    marketingConsent={marketingConsent}
                    // PR-R (2026-05-08): 마감 검증 — 투어는 별도 시간 입력 X, 09:00 기본
                    // 2026-07-28 이후 durationDays 는 마감 계산에 쓰이지 않는다 — multi_day
                    // 전용 cutoff(48h)는 폐기됐고, 마감은 상품군만으로 결정된다(투어=8h 고정).
                    // 참고: api/_shared/booking-cutoff.js
                    pickupTime="09:00"
                    durationDays={days}
                    // 🔴 슬롯 정원 강제 — 슬롯을 실제로 고른 예약만 4필드를 넘긴다.
                    //   슬롯 없는 투어는 미전달 = 백엔드가 잠금을 건너뛰어 기존 동작 그대로.
                    {...(selectedSlot && slotCapacityForOrder !== undefined
                      ? {
                          tourId: tour.id,
                          tourSlotId: selectedSlot.id,
                          bookingDate: date,
                          slotCapacity: slotCapacityForOrder,
                        }
                      : {})}
                  />
                  {/* 2026-06-06 PR2b: 장바구니 담기 (VITE_FEATURE_CART OFF=null 미렌더).
                      예약 상세(productType/날짜/인원/픽업/메모) 채운 뒤 = 완전한 결제 항목
                      (PR1 카드 담기는 productType만이라 결제 불가였음 → 올바른 진입점).
                      운영자 "위시리스트=장바구니, 투어 담아 한번에 결제" 비전. */}
                  <CartAddButton
                    id={`${tour.id}-${date}-${pax}${cartSlotSuffix}`}
                    booking={{
                      productType,
                      passengers: pax,
                      dateStart: date,
                      dateEnd: date,
                      durationDays: days,
                      pickupLocation: pickupAddress,
                      vehicleType: tour.vehicleType.toLowerCase(),
                      memo: fullMemo,
                      // 🔴 슬롯 정원 — 4필드 전부이거나 전무(tourSlotBody). 백엔드가 이 값들로 잠근다.
                      ...cartSlotFields,
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
