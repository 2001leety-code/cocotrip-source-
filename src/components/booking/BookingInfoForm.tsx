// BookingInfoForm — 트립닷컴식 예약 → 회원정보 통합 폼 (차터/투어 공용).
// 디자인 출처: claude design "코코트립 예약정보 폼.html" (트립닷컴 캡처 기반, 운영자 확정 디자인).
// 순수 UI — 예약 요약·가격은 props, 입력값은 내부 state, 제출은 onSubmit 콜백.
//   결제 실행·필수검증 게이트·SMS 인증은 호출처(CharterWizard/TourBookingDialog)에서 처리.
// SSOT 색: 배경 #080b14 / 보라 #7C5CFC·#B9A4FF / 핑크 #EA537E·#FF6B9D / 민트 #00D28C / 골드 #C4956A.
//
// 2026-06-30 (#3 미팅장소 자동완성 + #4 항공편 도착시간 자동채움):
//   meetingPlace - AddressAutocomplete(Naver Local Search+미니지도) 추가. 자유입력도 병행 유지(예약막힘 방지).
//     자동완성 확인 시 아래 텍스트 input 에 주소 자동 채움. 사용자가 직접 타이핑하면 자동완성 coord 초기화.
//   externalArrivalTime prop - 호출처(Step5DateOptions)가 /api/flight-status 조회 결과를 전달하면
//     arrivalTime 입력에 자동 채움(HH:mm 형식). 사용자가 직접 수정 시 input 을 덮어쓰지 않음(isTouched guard).
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { DEFAULT_DIAL_BY_LANG, parsePhoneValue, normalizeNationalNumber, composePhoneValue, type DialLang } from '@/lib/country-dials';
import { CountryDialPicker } from '@/components/booking/CountryDialPicker';
import { AddressAutocomplete, type AddressResult } from '@/components/charter/AddressAutocomplete';

export interface BookingFormData {
  lastName: string;
  firstName: string;
  phone: string;
  email: string;
  messenger: string;
  messengerId: string;
  meetingPlace: string;
  flightNo: string;
  arrivalTime: string;
  lugSmall: number;
  lugMedium: number;
  lugLarge: number;
  notes: string;
  addonMeeting: boolean;
  addonChildSeat: boolean;
  discountCode: string;
  agree1: boolean;
  agree2: boolean;
  agree3: boolean;
  agree4: boolean;
}

export interface BookingInfoFormProps {
  eyebrow: string;
  title: string;
  dateText: string;
  paxText: string;
  thumbnailUrl?: string;
  isAirport: boolean;
  meetingLabel: string;   // 예: "미팅 장소" / "픽업 장소"
  baseStr: string;        // 기본요금 표시 (예 "₩291,200")
  meetingStr: string;     // 공항미팅·피켓 가격
  childSeatStr: string;   // 유아 카시트 가격
  totalStr: string;
  usdStr: string;
  ctaLabel: string;       // 예: "결제 진행"
  defaultPhoneDial?: string; // 국가번호 표시 (기본 +82)
  /** 국가명·라벨 표시 언어 (휴대폰 국가번호 드롭다운 4언어). 미제공 시 'ko'. */
  lang?: DialLang;
  /** 전화번호 입력 placeholder — 국가코드 포함 국제 예시(외국인이 +82 칸 믿고 국내번호 입력해 SMS 오발송하는 것 방지).
   *  미제공 시 '+82 10 1234 5678' (국가코드 포함 기본). emit/정규화(toE164)는 불변 — 표기만. */
  placeholderPhone?: string;
  onApplyDiscount?: (code: string) => void;
  onSubmit: (data: BookingFormData) => void;
  // ── 하위호환 옵셔널 props (2026-06-29, 투어 Step2 통합 / 방법 A) ──────────
  // 차터(CharterWizard)는 아래 prop 미전달 = 기존 self-contained 동작 그대로.
  // 투어(TourBookingDialog)는 결제/SMS/가격/약관 게이트를 호출처가 소유하므로
  // 아래 prop 들로 BookingInfoForm 의 해당 영역을 호출처에 위임/동기화한다.
  /** 전화번호 controlled — 제공 시 내부 state 대신 사용 (호출처 SMS 인증/게이트와 공유). */
  phone?: string;
  onPhoneChange?: (v: string) => void;
  /** 폼 입력값 변화 emit — 호출처가 메모(요청사항·미팅장소 등) 결제 payload 반영용. */
  onFieldsChange?: (data: BookingFormData) => void;
  /** 약관 SSOT 외부 제어 — 제공 시 agree1~3(필수) 대신 단일 동의 상태(호출처 termsAgreed)와 동기.
   *  ⚠️ 마케팅(agree4=선택)은 이 채널에 안 섞임 — 외부모드에서도 내부 state(f.agree4)로만 관리. */
  externalAgreeAll?: boolean;
  onAgreeAllChange?: (agreed: boolean) => void;
  /** 마케팅(선택) 동의 변화 emit — 외부 약관모드에서 마케팅을 필수 채널과 분리하기 위함.
   *  미배선이면(현행) 마케팅은 내부 f.agree4 로만 유지 → payload 미반영(강제동의 제거가 목적). */
  onMarketingChange?: (agreed: boolean) => void;
  /** 부가 서비스 섹션 숨김 (투어는 Step1 addon 에서 이미 선택 → 가격 재계산 방지). */
  hideAddons?: boolean;
  /** 🔧 2026-07-18 결제 정보 내역 라인 (차터 위저드: 옵션·야간할증·멀티데이 할인) — 이전엔
   *  기본요금 1줄+총액만 렌더돼 "옵션 ₩124,800 vs 총액 ₩424,800" 처럼 내역 없는 차액이 보였다.
   *  표시 전용(라벨·금액 문자열) — 가격 재계산 없음(P311: 값은 quote 파생). */
  extraRows?: { key: string; label: string; value: string; negative?: boolean }[];
  /** 할인코드 섹션 숨김. */
  hideDiscount?: boolean;
  /** 내부 CTA 버튼 숨김 — 호출처가 자체 결제 버튼(PayPalBookingButton) 렌더 시. */
  hideCta?: boolean;
  /** CTA 영역 대체 렌더 (예: SMS 인증 패널 + PayPalBookingButton). hideCta 와 함께 사용. */
  footerSlot?: React.ReactNode;
  /** 항공편 편명 입력 바로 아래 렌더 (예: 공공API 도착정보 "조회" 버튼 + 결과). isAirport 시에만 노출.
   *  차터(CharterWizard)의 #1012 /api/flight-status 자동조회 UI 를 BookingInfoForm 항공편 섹션에 통합. */
  flightLookupSlot?: React.ReactNode;
  /** #4 항공편 도착시간 외부 채움 — /api/flight-status 조회 결과 estimatedTime/scheduledTime(HH:mm 형식).
   *  사용자가 arrivalTime 을 직접 수정한 적 없으면 자동 채움. 직접 수정 후에는 덮어쓰지 않음. */
  externalArrivalTime?: string;
}

// ── 폼 내부 라벨 4언어 사전 (2026-07-17 — 한국어 하드코딩 해소) ─────────────
// 외국인 인바운드 결제 직전 폼이 한국어 고정이던 문제. lang prop(DialLang) 기준.
// 새 사용자노출 텍스트 = ko/en/ja/zh 동시 유지 (CLAUDE.md 배포 전 체크).
const STR = {
  ko: {
    freeCancel24h: '✓ 사용일 24시간 전까지 무료 취소',
    travelerSection: '이용객 · 연락처 정보', travelerSub: 'Traveler & contact',
    lastName: '영문 성 (Last name)', firstName: '영문 이름 (First name)',
    phone: '휴대폰 번호', phoneHint: '투어 당일 연락에만 사용',
    email: '이메일 주소', emailHint: '예약 확인서 발송에만 사용',
    messenger: '메신저 연락처', optQuick: '(선택 · 빠른 안내)',
    messengerPh: '메신저 ID 또는 번호',
    messengerHint: '여행 일정·픽업 관련 안내가 연락처로 발송됩니다. 정확한 정보를 입력해 주세요.',
    addInfoSection: '추가 정보', addInfoSub: 'Additional details',
    meetingPh: '예: L7 명동 바이 롯데호텔 (퇴계로 137)',
    flightNo: '항공편 편명', optional: '(선택)', arrivalTime: '도착 시간', localTime: '(현지)',
    luggage: '캐리어 (사이즈별 수량)', lugSmall: '소형 (기내반입)', lugMedium: '중형 (24인치)', lugLarge: '대형 (28인치+)',
    notes: '추가 요청사항', notesPh: '예: 유아 카시트 필요, 한국어 기사 선호, 특정 시간 픽업…',
    addonsSection: '부가 서비스', addonsSub: 'Optional add-ons',
    addonMeeting: '공항 미팅 & 피켓 서비스',
    addonMeetingDesc: '픽업 담당직원이 도착 출구(세관 통과 후)에서 피켓을 들고 대기합니다',
    addonChildSeat: '유아 카시트',
    addonChildSeatDesc: '신생아·유아 동반 시 안전 카시트를 미리 장착해 드립니다',
    promoSection: '할인코드', promoSub: 'Promo code', promoPh: '할인코드 입력', promoApply: '사용',
    promoApplied: '할인코드가 적용되었습니다', promoRemove: '취소',
    promoHint: '가입 시 발급된 차터·투어 5% 쿠폰 코드는 마이페이지 › 쿠폰에서 확인하세요.',
    promoToggle: '🎟 할인코드가 있으신가요?',
    agreeAll: '아래 항목에 모두 동의합니다', req: '필수', opt: '선택',
    agree1: '만 18세 이상이며 이용약관 및 취소 규정에 동의합니다',
    agree2: '개인정보 제3자 제공 (차량 공급업체·기사)에 동의합니다',
    agree3: '개인정보 국외 이전 및 고유식별정보 수집·이용에 동의합니다',
    agree4: '한정 특가·이벤트·여행 소식 등 마케팅 정보 수신에 동의합니다',
    privacyLink: '개인정보 처리방침', termsLink: '이용약관',
    errRequired: (meeting: string) => `필수 항목(성·이름·연락처·이메일·${meeting})과 필수 약관 동의를 확인해 주세요.`,
    disclaimer: '코코트립은 통신판매중개자로서 차량 공급업체가 제공하는 서비스의 당사자가 아니며, 예약·이용·환불 관련 의무와 책임은 각 공급업체에 있습니다.',
    payInfo: '결제 정보', payBase: '차량 기본요금', payMeeting: '공항 미팅 & 피켓', payPromo: '할인코드 적용', payTotal: '예약 총금액',
    cancelPolicy: '취소 규정', cancelFreeTitle: '무료 취소', cancelFreeDesc: '사용일 24시간 전까지 — 전액 환불',
    cancelFeeTitle: '⚠ 취소 수수료 100%', cancelFeeDesc: '사용일 24시간 전 이후 — 환불 불가',
    trust1: '단일요금, 모든 서비스 투명하게', trust1Sub: '팁·통행료 포함, 별도 추가요금 없음',
    trust2: '항공편 지연 시 무료 대기', trust2Sub: '도착 후 약 90분간 무료 대기',
    trust3: '영어·한국어 가능 기사 · 24시간 지원', trust3Sub: '노쇼·지각 시 보상 보장',
  },
  en: {
    freeCancel24h: '✓ Free cancellation until 24h before use',
    travelerSection: 'Traveler & contact', travelerSub: '',
    lastName: 'Last name (passport)', firstName: 'First name (passport)',
    phone: 'Mobile number', phoneHint: 'For tour-day contact only',
    email: 'Email address', emailHint: 'Only for booking confirmation',
    messenger: 'Messenger contact', optQuick: '(optional · faster updates)',
    messengerPh: 'Messenger ID or number',
    messengerHint: 'Trip and pickup updates are sent to this contact. Please enter accurate details.',
    addInfoSection: 'Additional details', addInfoSub: '',
    meetingPh: 'e.g. L7 Myeongdong by Lotte (137 Toegye-ro)',
    flightNo: 'Flight number', optional: '(optional)', arrivalTime: 'Arrival time', localTime: '(local)',
    luggage: 'Luggage (count by size)', lugSmall: 'Small (carry-on)', lugMedium: 'Medium (24")', lugLarge: 'Large (28"+)',
    notes: 'Special requests', notesPh: 'e.g. child seat needed, Korean-speaking driver, specific pickup time…',
    addonsSection: 'Optional add-ons', addonsSub: '',
    addonMeeting: 'Airport meet & greet (name board)',
    addonMeetingDesc: 'Staff waits at the arrival exit (after customs) holding a name board',
    addonChildSeat: 'Child car seat',
    addonChildSeatDesc: 'We pre-install a safety seat for infants and toddlers',
    promoSection: 'Promo code', promoSub: '', promoPh: 'Enter promo code', promoApply: 'Apply',
    promoApplied: 'applied', promoRemove: 'Remove',
    promoHint: 'Find your 5% charter/tour coupon codes in My Page › Coupons.',
    promoToggle: '🎟 Have a promo code?',
    agreeAll: 'I agree to all items below', req: 'Required', opt: 'Optional',
    agree1: 'I am 18 or older and agree to the Terms of Service and cancellation policy',
    agree2: 'I consent to sharing my personal data with third parties (vehicle suppliers and drivers)',
    agree3: 'I consent to cross-border transfer of my personal data and collection/use of unique identification information',
    agree4: 'I agree to receive marketing updates (limited deals, events, travel news)',
    privacyLink: 'Privacy Policy', termsLink: 'Terms of Service',
    errRequired: (meeting: string) => `Please complete the required fields (last name, first name, phone, email, ${meeting}) and the required consents.`,
    disclaimer: 'CocoTrip acts as a booking intermediary and is not a party to the services provided by vehicle suppliers. Obligations and liability for reservations, service, and refunds lie with each supplier.',
    payInfo: 'Payment summary', payBase: 'Vehicle base fare', payMeeting: 'Airport meet & greet', payPromo: 'Promo applied', payTotal: 'Total',
    cancelPolicy: 'Cancellation policy', cancelFreeTitle: 'Free cancellation', cancelFreeDesc: 'Until 24h before use — full refund',
    cancelFeeTitle: '⚠ 100% cancellation fee', cancelFeeDesc: 'Within 24h of use — non-refundable',
    trust1: 'One transparent price', trust1Sub: 'Tips & tolls included, no extra charges',
    trust2: 'Free waiting for flight delays', trust2Sub: 'Up to ~90 minutes free waiting after arrival',
    trust3: 'English/Korean-speaking drivers · 24/7 support', trust3Sub: 'Compensation guaranteed for no-show or lateness',
  },
  ja: {
    freeCancel24h: '✓ ご利用日の24時間前まで無料キャンセル',
    travelerSection: '利用者・連絡先情報', travelerSub: 'Traveler & contact',
    lastName: '姓（ローマ字）', firstName: '名（ローマ字）',
    phone: '携帯電話番号', phoneHint: 'ツアー当日の連絡のみに使用',
    email: 'メールアドレス', emailHint: '予約確認書の送付のみに使用',
    messenger: 'メッセンジャー連絡先', optQuick: '（任意・迅速なご案内）',
    messengerPh: 'メッセンジャーIDまたは番号',
    messengerHint: '旅行日程・ピックアップのご案内がこの連絡先に送信されます。正確にご入力ください。',
    addInfoSection: '追加情報', addInfoSub: 'Additional details',
    meetingPh: '例: L7明洞 バイ ロッテ（退渓路137）',
    flightNo: 'フライト便名', optional: '（任意）', arrivalTime: '到着時間', localTime: '（現地）',
    luggage: 'スーツケース（サイズ別数量）', lugSmall: '小型（機内持込）', lugMedium: '中型（24インチ）', lugLarge: '大型（28インチ以上）',
    notes: '追加リクエスト', notesPh: '例: チャイルドシート必要、韓国語ドライバー希望、特定時間ピックアップ…',
    addonsSection: 'オプションサービス', addonsSub: 'Optional add-ons',
    addonMeeting: '空港ミーティング＆ネームボード',
    addonMeetingDesc: '担当スタッフが到着出口（税関通過後）でネームボードを持ってお待ちします',
    addonChildSeat: 'チャイルドシート',
    addonChildSeatDesc: '乳幼児同伴時、安全なチャイルドシートを事前に設置します',
    promoSection: '割引コード', promoSub: 'Promo code', promoPh: '割引コードを入力', promoApply: '適用',
    promoApplied: 'を適用しました', promoRemove: '解除',
    promoHint: '登録時に発行されたチャーター・ツアー5%クーポンはマイページ › クーポンでご確認ください。',
    promoToggle: '🎟 割引コードをお持ちですか？',
    agreeAll: '以下すべてに同意します', req: '必須', opt: '任意',
    agree1: '満18歳以上であり、利用規約およびキャンセル規定に同意します',
    agree2: '個人情報の第三者提供（車両供給業者・ドライバー）に同意します',
    agree3: '個人情報の国外移転および固有識別情報の収集・利用に同意します',
    agree4: '限定特価・イベント・旅行情報などのマーケティング情報の受信に同意します',
    privacyLink: 'プライバシーポリシー', termsLink: '利用規約',
    errRequired: (meeting: string) => `必須項目（姓・名・連絡先・メール・${meeting}）と必須規約への同意をご確認ください。`,
    disclaimer: 'CocoTripは通信販売仲介者であり、車両供給業者が提供するサービスの当事者ではありません。予約・利用・返金に関する義務と責任は各供給業者にあります。',
    payInfo: 'お支払い情報', payBase: '車両基本料金', payMeeting: '空港ミーティング＆ネームボード', payPromo: '割引コード適用', payTotal: '予約総額',
    cancelPolicy: 'キャンセル規定', cancelFreeTitle: '無料キャンセル', cancelFreeDesc: 'ご利用24時間前まで — 全額返金',
    cancelFeeTitle: '⚠ キャンセル料100%', cancelFeeDesc: 'ご利用24時間前以降 — 返金不可',
    trust1: '単一料金・すべて透明', trust1Sub: 'チップ・通行料込み、追加料金なし',
    trust2: 'フライト遅延時は無料待機', trust2Sub: '到着後約90分間無料待機',
    trust3: '英語・韓国語対応ドライバー・24時間サポート', trust3Sub: 'ノーショー・遅刻時は補償保証',
  },
  zh: {
    freeCancel24h: '✓ 使用日前24小时可免费取消',
    travelerSection: '乘客·联系信息', travelerSub: 'Traveler & contact',
    lastName: '姓（英文/拼音）', firstName: '名（英文/拼音）',
    phone: '手机号码', phoneHint: '仅用于出行当天联系',
    email: '电子邮箱', emailHint: '仅用于发送预订确认函',
    messenger: '即时通讯联系方式', optQuick: '（可选·更快通知）',
    messengerPh: '账号ID或号码',
    messengerHint: '行程与接送通知将发送至此联系方式，请填写准确信息。',
    addInfoSection: '补充信息', addInfoSub: 'Additional details',
    meetingPh: '例: L7明洞乐天酒店（退溪路137）',
    flightNo: '航班号', optional: '（可选）', arrivalTime: '到达时间', localTime: '（当地）',
    luggage: '行李箱（按尺寸数量）', lugSmall: '小型（登机箱）', lugMedium: '中型（24寸）', lugLarge: '大型（28寸以上）',
    notes: '其他要求', notesPh: '例: 需要儿童座椅、希望韩语司机、指定接送时间…',
    addonsSection: '附加服务', addonsSub: 'Optional add-ons',
    addonMeeting: '机场接机举牌服务',
    addonMeetingDesc: '工作人员将在到达出口（过海关后）举牌等候',
    addonChildSeat: '儿童安全座椅',
    addonChildSeatDesc: '携带婴幼儿时，我们会提前安装安全座椅',
    promoSection: '优惠码', promoSub: 'Promo code', promoPh: '输入优惠码', promoApply: '使用',
    promoApplied: '已应用', promoRemove: '取消',
    promoHint: '注册时发放的包车·跟团5%优惠码请在“我的页面 › 优惠券”中查看。',
    promoToggle: '🎟 有优惠码吗？',
    agreeAll: '同意以下全部条款', req: '必选', opt: '可选',
    agree1: '本人已满18岁，并同意服务条款及取消政策',
    agree2: '同意向第三方（车辆供应商·司机）提供个人信息',
    agree3: '同意个人信息跨境传输及唯一识别信息的收集·使用',
    agree4: '同意接收限时特价·活动·旅行资讯等营销信息',
    privacyLink: '隐私政策', termsLink: '服务条款',
    errRequired: (meeting: string) => `请填写必填项（姓、名、联系方式、邮箱、${meeting}）并勾选必选条款。`,
    disclaimer: 'CocoTrip作为交易中介，并非车辆供应商所提供服务的当事方；预订、使用及退款相关义务与责任由各供应商承担。',
    payInfo: '支付信息', payBase: '车辆基本费用', payMeeting: '机场接机举牌', payPromo: '已用优惠码', payTotal: '预订总额',
    cancelPolicy: '取消政策', cancelFreeTitle: '免费取消', cancelFreeDesc: '使用前24小时 — 全额退款',
    cancelFeeTitle: '⚠ 取消手续费100%', cancelFeeDesc: '使用前24小时内 — 不可退款',
    trust1: '一口价，全程透明', trust1Sub: '含小费·过路费，无额外费用',
    trust2: '航班延误免费等候', trust2Sub: '抵达后约90分钟免费等候',
    trust3: '英语·韩语司机·24小时支持', trust3Sub: '爽约·迟到有补偿保障',
  },
} satisfies Record<DialLang, unknown>;
type FormStrings = (typeof STR)['ko'];

// ── 스타일 토큰 ──────────────────────────────────────────────
const C = {
  card: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 22, backdropFilter: 'blur(20px)' } as React.CSSProperties,
  input: { width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.92)', fontSize: 16, fontFamily: 'inherit', outline: 'none' } as React.CSSProperties,
  label: { display: 'block', fontSize: 13, color: 'rgba(255,255,255,0.65)', margin: '0 0 9px', fontWeight: 500 } as React.CSSProperties,
  req: { color: '#FF6B9D' } as React.CSSProperties,
  opt: { fontSize: 12, color: 'rgba(255,255,255,0.4)' } as React.CSSProperties,
};

function SectionHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 24 }}>
      <span style={{ display: 'flex', width: 32, height: 32, borderRadius: 9, background: 'rgba(124,92,252,0.12)', border: '1px solid rgba(124,92,252,0.25)', alignItems: 'center', justifyContent: 'center', color: '#B9A4FF', flex: '0 0 auto', fontSize: 15 }}>•</span>
      <div>
        <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-0.01em' }}>{title}</div>
        {sub ? <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{sub}</div> : null}
      </div>
    </div>
  );
}

function Counter({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const btn: React.CSSProperties = { width: 44, height: 44, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: 'rgba(255,255,255,0.6)', fontSize: 18, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '9px 14px' }}>
      <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <button type="button" onClick={() => onChange(Math.max(0, value - 1))} style={btn}>{'−'}</button>
        <span style={{ width: 18, textAlign: 'center', fontWeight: 700, fontSize: 15 }}>{value}</span>
        <button type="button" onClick={() => onChange(value + 1)} style={btn}>+</button>
      </div>
    </div>
  );
}

export function BookingInfoForm(props: BookingInfoFormProps) {
  const { isAirport, meetingLabel, baseStr, meetingStr, childSeatStr, totalStr, usdStr, ctaLabel } = props;
  const lang: DialLang = props.lang || 'ko';
  // 폼 내부 라벨 4언어 — 한국어 하드코딩 해소 (2026-07-17).
  const s: FormStrings = STR[lang] || STR.en;
  // 신뢰 바(결제 직전 안심) 4언어 — 가이드 docs/DESIGN-BOOKING-FORM-UX.md §6. 표시만.
  const trustItems = ({
    ko: ['PayPal 보안결제', '24h+ 무료 취소', 'KTO 등록사업자'],
    en: ['PayPal Secure', 'Free 24h+ cancellation', 'KTO Registered'],
    ja: ['PayPal安全決済', '24h+前無料キャンセル', 'KTO登録事業者'],
    zh: ['PayPal安全支付', '提前24h+免费取消', 'KTO注册企业'],
  } as Record<DialLang, string[]>)[lang] || ['PayPal Secure', 'Free 24h+ cancellation', 'KTO Registered'];
  // 휴대폰 국가번호(dial, + 없는 숫자) 기본값 — props.defaultPhoneDial('+82' 형태) 파싱 우선,
  //   없으면 언어 기본(DEFAULT_DIAL_BY_LANG), 그래도 없으면 한국('82'). 국내 회귀 안전(KR 기본).
  const initialDial = (() => {
    const fromProp = (props.defaultPhoneDial || '').replace(/\D/g, '');
    if (fromProp) return fromProp;
    return DEFAULT_DIAL_BY_LANG[lang] || '82';
  })();
  const [selDial, setSelDial] = useState<string>(initialDial);

  const [f, setF] = useState<BookingFormData>({
    lastName: '', firstName: '', phone: '', email: '', messenger: 'WhatsApp', messengerId: '',
    meetingPlace: '', flightNo: '', arrivalTime: '', lugSmall: 0, lugMedium: 0, lugLarge: 0, notes: '',
    addonMeeting: true, addonChildSeat: false, discountCode: '',
    agree1: false, agree2: false, agree3: false, agree4: false,
  });
  const set = (patch: Partial<BookingFormData>) => setF((p) => ({ ...p, ...patch }));
  const [error, setError] = useState(false);
  const [appliedCode, setAppliedCode] = useState('');
  const [discountOpen, setDiscountOpen] = useState(false);

  // #3 미팅장소 자동완성 state.
  //   AddressAutocomplete 확인 시 f.meetingPlace 자동 채움.
  //   사용자가 아래 plain input 을 직접 타이핑하면 coord 초기화(자유입력 우선).
  const [meetingPlaceCoord, setMeetingPlaceCoord] = useState<AddressResult | null>(null);
  const handleMeetingAutocomplete = (coord: AddressResult | null) => {
    setMeetingPlaceCoord(coord);
    if (coord) {
      // 확인된 장소 → 텍스트 input 에 자동 채움.
      const filled = coord.address ? `${coord.name} (${coord.address})` : coord.name;
      set({ meetingPlace: filled });
    }
    // coord=null(변경 버튼) 시에는 f.meetingPlace 를 건드리지 않음 — 자유 타이핑 보존.
  };

  // #4 항공편 도착시간 외부 채움 — externalArrivalTime(HH:mm) 변경 시 arrivalTime 자동 set.
  //   사용자가 직접 수정한 적 있으면(arrivalTimeTouched.current=true) 덮어쓰지 않음.
  const arrivalTimeTouched = useRef(false);
  useEffect(() => {
    if (!props.externalArrivalTime) return;
    if (arrivalTimeTouched.current) return;
    // "HH:MM:SS" → "HH:MM" 로 잘라 time input 호환 형식 확보.
    const t = props.externalArrivalTime.slice(0, 5);
    if (/^\d{2}:\d{2}$/.test(t)) set({ arrivalTime: t });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.externalArrivalTime]);

  // 전화번호 controlled 위임 — props.phone 제공 시 호출처가 소유 (내부 f.phone 미사용).
  const phoneValue = props.phone !== undefined ? props.phone : f.phone;

  // 국가번호 드롭다운 — 입력 칸엔 가입자번호(national)만, dial 은 selDial 로 분리 표시.
  //   localNumber = 사용자가 번호 칸에 입력한 표시값(숫자/구분자 허용, emit 시 정규화).
  const [localNumber, setLocalNumber] = useState<string>('');
  // resume 역파싱 — 부모/내부 phoneValue("+82 1012345678" 또는 구 raw "01012345678")를
  //   마운트/prop변경 시 selDial + localNumber 로 분리. 사용자 타이핑 중 덮어쓰지 않도록
  //   합성값(composePhoneValue 결과)과 동일하면 skip (자기 emit 의 echo 무시 = 커서 점프 방지).
  useEffect(() => {
    if (!phoneValue) { setLocalNumber(''); return; }
    // 현재 selDial+localNumber 합성과 같으면(내가 방금 emit 한 값) 역파싱 skip.
    if (phoneValue === composePhoneValue(selDial, normalizeNationalNumber(localNumber, selDial))) return;
    const { dial, national } = parsePhoneValue(phoneValue);
    if (dial) setSelDial(dial);            // "+82 ..." → dial 동기. 구 raw(dial='')는 기존 selDial 유지.
    setLocalNumber(national);
    // selDial/localNumber 는 의도적으로 deps 제외 — phoneValue(부모 SSOT) 변할 때만 역파싱.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phoneValue]);

  // dial 또는 번호 변경 시 합성값 emit — "+{dial} {national}" (공백 1개, leading 0 strip, 이중 prefix strip).
  const emitPhone = (dial: string, rawNumber: string) => {
    const national = normalizeNationalNumber(rawNumber, dial);
    const composed = composePhoneValue(dial, national);
    if (props.onPhoneChange) props.onPhoneChange(composed);
    else set({ phone: composed });
  };

  // 폼 입력값 변화를 호출처로 emit (메모/미팅장소 등 결제 payload 반영용).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { props.onFieldsChange?.(f); }, [f]);

  // 약관 SSOT 외부 제어 — externalAgreeAll 제공 시 단일 동의 상태(호출처)와 동기.
  const externallyControlledTerms = props.externalAgreeAll !== undefined;
  // 필수 동의(agree1~3)만의 상태. 외부모드면 호출처 termsAgreed, 내부모드면 필수 3개 AND.
  //   마케팅(agree4=선택)은 절대 이 값에 안 섞임 — 강제동의 방지.
  const requiredAgreed = externallyControlledTerms
    ? !!props.externalAgreeAll
    : (f.agree1 && f.agree2 && f.agree3);
  // "모두 동의" 상단 체크 = 필수 + 마케팅 모두 켜야 전체 표시.
  const agreeAll = requiredAgreed && f.agree4;
  const toggleAll = () => {
    const v = !agreeAll;
    // 필수(외부 or 내부 agree1~3) + 마케팅(내부 agree4) 분리 호출.
    if (externallyControlledTerms) {
      props.onAgreeAllChange?.(v);
      set({ agree4: v });
      props.onMarketingChange?.(v);
      return;
    }
    set({ agree1: v, agree2: v, agree3: v, agree4: v });
  };

  const applyCode = (code: string) => { set({ discountCode: code }); setAppliedCode(code); props.onApplyDiscount?.(code); };

  const submit = () => {
    // 마케팅(선택)은 필수 게이트에 안 섞이게 — requiredAgreed 사용 (hideCta=true 라 미호출이나 정합성 위해).
    const termsOk = requiredAgreed;
    const ok = f.lastName && f.firstName && (phoneValue) && f.email && f.meetingPlace && termsOk;
    if (!ok) { setError(true); return; }
    setError(false);
    props.onSubmit(f);
  };

  const focusable = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.target.style.borderColor = 'rgba(124,92,255,0.45)';
    e.target.style.background = 'rgba(255,255,255,0.98)';
  };
  const blurable = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.target.style.borderColor = 'rgba(124,92,255,0.16)';
    e.target.style.background = 'rgba(255,255,255,0.94)';
  };

  // AddressAutocomplete language 타입 가드.
  const meetingAutocompleteLang: 'ko' | 'en' | 'ja' | 'zh' =
    lang === 'ko' || lang === 'en' || lang === 'ja' || lang === 'zh' ? lang : 'en';
  const meetingAutocompletePlaceholder =
    lang === 'ko' ? '호텔 이름으로 검색 (예: L7 명동)' :
    lang === 'ja' ? 'ホテル名で検索 (例: L7 明洞)' :
    lang === 'zh' ? '搜索酒店名称 (例: L7 明洞)' :
    'Search hotel/address (e.g. L7 Myeongdong)';
  const meetingFreeTypeHint =
    lang === 'ko' ? '위 검색으로 자동완성하거나 직접 입력하세요.' :
    lang === 'ja' ? '上の検索で自動補完するか、直接入力してください。' :
    lang === 'zh' ? '使用上方搜索自动填写，或直接输入。' :
    'Use the search above or type the address directly.';

  return (
    <div className="cocotrip-mobile-booking-form" style={{ maxWidth: 1080, margin: '0 auto', padding: '20px 16px 0', display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start', color: '#fff' }}>
      {/* ── LEFT COLUMN ── */}
      <div style={{ flex: '1 1 460px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* 요약 카드 */}
        <div style={{ ...C.card, display: 'flex', gap: 14, alignItems: 'center' }}>
          {props.thumbnailUrl && <img src={props.thumbnailUrl} alt="" style={{ width: 74, height: 74, borderRadius: 12, objectFit: 'cover', flex: '0 0 auto' }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.16em', color: '#B9A4FF', textTransform: 'uppercase', marginBottom: 5 }}>{props.eyebrow}</div>
            <div style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.3, marginBottom: 8, letterSpacing: '-0.01em' }}>{props.title}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <Chip>{props.dateText}</Chip>
              <Chip>{props.paxText}</Chip>
              {/* 총금액 항상 노출 — 모달/모바일에서 우측 결제정보 카드가 아래로 밀려도 요약에서 즉시 확인.
                  값=prop totalStr 그대로(재계산 X · PayPal priceKRW 와 동일 source). */}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 800, color: '#C99FFF', background: 'rgba(182,104,252,0.12)', border: '1px solid rgba(182,104,252,0.30)', padding: '4px 9px', borderRadius: 9999, whiteSpace: 'nowrap' }}>{totalStr}</span>
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#00D28C', marginTop: 8, fontWeight: 600 }}>{s.freeCancel24h}</div>
          </div>
        </div>

        {/* 이용객·연락처 */}
        <div style={C.card}>
          <SectionHead title={s.travelerSection} sub={s.travelerSub} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 13 }}>
            <div>
              <label style={C.label}>{s.lastName} <span style={C.req}>*</span></label>
              <input value={f.lastName} onChange={(e) => set({ lastName: e.target.value })} placeholder="HONG" style={C.input} onFocus={focusable} onBlur={blurable} />
            </div>
            <div>
              <label style={C.label}>{s.firstName} <span style={C.req}>*</span></label>
              <input value={f.firstName} onChange={(e) => set({ firstName: e.target.value })} placeholder="GILDONG" style={C.input} onFocus={focusable} onBlur={blurable} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginBottom: 13 }}>
            <div>
              <label style={C.label}>{s.phone} <span style={C.req}>*</span></label>
              <div style={{ display: 'flex', gap: 8 }}>
                {/* 국가번호 picker — 트립닷컴식(검색+자주찾는+전세계 ~239국). COUNTRIES SSOT(로그인 전화인증과 공유). */}
                <CountryDialPicker
                  value={selDial}
                  onChange={(d) => { setSelDial(d); emitPhone(d, localNumber); }}
                  lang={lang}
                />
                <input
                  value={localNumber}
                  onChange={(e) => { const v = e.target.value; setLocalNumber(v); emitPhone(selDial, v); }}
                  placeholder={props.placeholderPhone ?? '10 1234 5678'}
                  inputMode="tel"
                  style={{ ...C.input, flex: '1 1 auto', minWidth: 0 }}
                  onFocus={focusable}
                  onBlur={blurable}
                />
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 6 }}>{s.phoneHint}</div>
            </div>
            <div>
              <label style={C.label}>{s.email} <span style={C.req}>*</span></label>
              <input value={f.email} onChange={(e) => set({ email: e.target.value })} placeholder="you@email.com" inputMode="email" style={C.input} onFocus={focusable} onBlur={blurable} />
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 6 }}>{s.emailHint}</div>
            </div>
          </div>
          <div>
            <label style={C.label}>{s.messenger} <span style={C.opt}>{s.optQuick}</span></label>
            <div style={{ display: 'grid', gridTemplateColumns: '128px 1fr', gap: 8 }}>
              <select value={f.messenger} onChange={(e) => set({ messenger: e.target.value })} style={{ ...C.input, cursor: 'pointer' }}>
                <option>WhatsApp</option><option>KakaoTalk</option><option>LINE</option><option>WeChat</option>
              </select>
              <input value={f.messengerId} onChange={(e) => set({ messengerId: e.target.value })} placeholder={s.messengerPh} style={C.input} onFocus={focusable} onBlur={blurable} />
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 8, lineHeight: 1.5 }}>{s.messengerHint}</div>
          </div>
        </div>

        {/* 추가 정보 */}
        <div style={C.card}>
          <SectionHead title={s.addInfoSection} sub={s.addInfoSub} />
          <div style={{ marginBottom: 13 }}>
            <label style={C.label}>{meetingLabel} <span style={C.req}>*</span></label>
            {/* #3 미팅장소 자동완성 — AddressAutocomplete(Naver Local Search + 미니지도).
                확인 시 아래 plain input 에 주소 자동 채움. 자유입력도 항상 가능(예약막힘 방지).
                ⚠️ 자유입력 보존: 아래 input 직접 타이핑 시 meetingPlaceCoord 초기화. */}
            <div style={{ marginBottom: 8 }}>
              <AddressAutocomplete
                id="booking-meeting-place-autocomplete"
                label=""
                placeholder={meetingAutocompletePlaceholder}
                language={meetingAutocompleteLang}
                value={meetingPlaceCoord ?? undefined}
                onChange={handleMeetingAutocomplete}
              />
            </div>
            {/* 자유입력 input — 자동완성이 채워주거나, 직접 타이핑도 가능. 항상 표시(예약막힘 방지). */}
            <input
              value={f.meetingPlace}
              onChange={(e) => {
                set({ meetingPlace: e.target.value });
                // 직접 타이핑 시 자동완성 coord 초기화(자유입력 우선).
                if (meetingPlaceCoord) setMeetingPlaceCoord(null);
              }}
              placeholder={s.meetingPh}
              style={C.input}
              onFocus={focusable}
              onBlur={blurable}
            />
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 6 }}>{meetingFreeTypeHint}</div>
          </div>
          {isAirport && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={C.label}>{s.flightNo} <span style={C.opt}>{s.optional}</span></label>
                  <input value={f.flightNo} onChange={(e) => set({ flightNo: e.target.value.toUpperCase() })} placeholder="예: KE5760, OZ521" style={{ ...C.input, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '.08em' }} onFocus={focusable} onBlur={blurable} />
                </div>
                <div>
                  <label style={C.label}>{s.arrivalTime} <span style={C.opt}>{s.localTime}</span></label>
                  {/* #4 도착시간 — externalArrivalTime(조회 결과)으로 자동 채움.
                      사용자가 직접 수정하면 arrivalTimeTouched=true → 이후 조회 결과로 덮어쓰지 않음. */}
                  <input
                    type="time"
                    value={f.arrivalTime}
                    onChange={(e) => { arrivalTimeTouched.current = true; set({ arrivalTime: e.target.value }); }}
                    style={{ ...C.input, colorScheme: 'dark' }}
                    onFocus={focusable}
                    onBlur={blurable}
                  />
                </div>
              </div>
              {/* 항공편 도착정보 자동조회 슬롯 (#1012 /api/flight-status — 호출처가 조회 버튼·결과 렌더). */}
              {props.flightLookupSlot && <div style={{ marginBottom: 14 }}>{props.flightLookupSlot}</div>}
              <div style={{ marginBottom: 13 }}>
                <label style={{ ...C.label, display: 'flex', alignItems: 'center', gap: 6 }}>{s.luggage}</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Counter label={s.lugSmall} value={f.lugSmall} onChange={(v) => set({ lugSmall: v })} />
                  <Counter label={s.lugMedium} value={f.lugMedium} onChange={(v) => set({ lugMedium: v })} />
                  <Counter label={s.lugLarge} value={f.lugLarge} onChange={(v) => set({ lugLarge: v })} />
                </div>
              </div>
            </>
          )}
          <div>
            <label style={C.label}>{s.notes} <span style={C.opt}>{s.optional}</span></label>
            <textarea value={f.notes} onChange={(e) => set({ notes: e.target.value })} rows={3} placeholder={s.notesPh} style={{ ...C.input, resize: 'none', lineHeight: 1.55 }} onFocus={focusable} onBlur={blurable} />
          </div>
        </div>

        {/* 부가 서비스 */}
        {!props.hideAddons && (
        <div style={C.card}>
          <SectionHead title={s.addonsSection} sub={s.addonsSub} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <AddonRow label={s.addonMeeting} desc={s.addonMeetingDesc} price={meetingStr} checked={f.addonMeeting} onChange={(v) => set({ addonMeeting: v })} />
            <AddonRow label={s.addonChildSeat} desc={s.addonChildSeatDesc} price={childSeatStr} checked={f.addonChildSeat} onChange={(v) => set({ addonChildSeat: v })} />
          </div>
        </div>
        )}

        {/* 할인코드 */}
        {!props.hideDiscount && ((discountOpen || appliedCode) ? (
        <div style={C.card}>
          <SectionHead title={s.promoSection} sub={s.promoSub} />
          <div style={{ display: 'flex', gap: 8, marginBottom: 13 }}>
            <input value={f.discountCode} onChange={(e) => set({ discountCode: e.target.value.toUpperCase() })} placeholder={s.promoPh} style={{ ...C.input, flex: '1 1 auto', minWidth: 0, textTransform: 'uppercase' }} onFocus={focusable} onBlur={blurable} />
            <button type="button" onClick={() => applyCode(f.discountCode)} style={{ flex: '0 0 auto', padding: '0 22px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>{s.promoApply}</button>
          </div>
          {appliedCode && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: 12, border: '1px solid rgba(0,210,140,0.3)', background: 'rgba(0,210,140,0.08)', marginBottom: 13 }}>
              <span style={{ flex: 1, fontSize: 13, color: 'rgba(255,255,255,0.85)' }}><b style={{ color: '#00D28C' }}>{appliedCode}</b> {s.promoApplied}</span>
              <button type="button" onClick={() => { setAppliedCode(''); set({ discountCode: '' }); }} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.45)', cursor: 'pointer', fontSize: 12, textDecoration: 'underline' }}>{s.promoRemove}</button>
            </div>
          )}
          {/* 2026-07-07: 가짜 공개코드(WELCOME12/10 — 서버 미존재, 클릭 시 실패) 제거.
              실제 5% 쿠폰은 가입 시 개인 코드로 발급 → 마이페이지에서 확인·입력. */}
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 4, lineHeight: 1.5 }}>
            {s.promoHint}
          </div>
        </div>
        ) : (
          <button type="button" onClick={() => setDiscountOpen(true)} style={{ ...C.card, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.7)', textAlign: 'left', width: '100%', fontFamily: 'inherit' }}>
            <span>{s.promoToggle}</span>
            <span style={{ color: '#B9A4FF', fontSize: 18 }}>›</span>
          </button>
        ))}

        {/* 약관 동의 */}
        <div style={C.card}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', marginBottom: 6 }}>
            <input type="checkbox" checked={agreeAll} onChange={toggleAll} style={{ width: 20, height: 20, accentColor: '#7C5CFC', cursor: 'pointer' }} />
            <span style={{ fontWeight: 700, fontSize: 14 }}>{s.agreeAll}</span>
          </label>
          <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '10px 0' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* 필수 3개 — 외부모드면 checked=requiredAgreed(마케팅 토글이 필수 표시에 안 새게), onChange=호출처 termsAgreed. */}
            <AgreeRow checked={externallyControlledTerms ? requiredAgreed : f.agree1} onChange={(v) => externallyControlledTerms ? props.onAgreeAllChange?.(v) : set({ agree1: v })} req reqLabel={s.req} optLabel={s.opt} text={s.agree1} />
            <AgreeRow checked={externallyControlledTerms ? requiredAgreed : f.agree2} onChange={(v) => externallyControlledTerms ? props.onAgreeAllChange?.(v) : set({ agree2: v })} req reqLabel={s.req} optLabel={s.opt} text={s.agree2} />
            <AgreeRow checked={externallyControlledTerms ? requiredAgreed : f.agree3} onChange={(v) => externallyControlledTerms ? props.onAgreeAllChange?.(v) : set({ agree3: v })} req reqLabel={s.req} optLabel={s.opt} text={s.agree3} />
            {/* 마케팅(선택) — 외부모드에서도 내부 state(f.agree4)로만. onMarketingChange 미배선이면 payload 미반영(강제동의 제거 목적). */}
            <AgreeRow checked={f.agree4} onChange={(v) => { set({ agree4: v }); if (externallyControlledTerms) props.onMarketingChange?.(v); }} reqLabel={s.req} optLabel={s.opt} text={s.agree4} />
          </div>
          {/* 🔴 법적 근거 링크 — 이 약관 카드가 약관 SSOT 이므로 /privacy·/terms 링크를 유지(법무 근거 보존 의무).
              (2026-06-30 SMS 본인인증 제거 후 약관 동의 게이트의 단일 소유처.) */}
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.07)', fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
            <Link to="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'rgba(255,255,255,0.55)', textDecoration: 'underline' }}>{s.privacyLink}</Link>
            <span> · </span>
            <Link to="/terms" target="_blank" rel="noopener noreferrer" style={{ color: 'rgba(255,255,255,0.55)', textDecoration: 'underline' }}>{s.termsLink}</Link>
          </div>
        </div>

        {/* CTA */}
        <div>
          {/* 신뢰 바 — 결제 직전 안심(PayPal·무료취소·KTO). 가이드 §6. 표시만, 결제 무관. */}
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '9px 12px', borderRadius: 10, background: 'rgba(0,210,140,0.06)', marginBottom: 12, fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ color: '#00D28C', fontSize: 12 }}>🔒</span> {trustItems[0]}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ color: '#00D28C', fontSize: 12 }}>✓</span> {trustItems[1]}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ color: '#B9A4FF', fontSize: 12 }}>🛡</span> {trustItems[2]}</span>
          </div>
          {props.hideCta ? (
            props.footerSlot
          ) : (
            <>
              {error && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', borderRadius: 12, border: '1px solid rgba(255,100,100,0.3)', background: 'rgba(255,100,100,0.08)', marginBottom: 11, fontSize: 13, color: '#ffb4b4' }}>
                  {s.errRequired(meetingLabel)}
                </div>
              )}
              <button type="button" onClick={submit} style={{ width: '100%', padding: 16, border: 'none', borderRadius: 14, background: 'linear-gradient(135deg,#7C5CFC 0%,#EA537E 100%)', color: '#fff', fontSize: 16, fontWeight: 800, cursor: 'pointer', boxShadow: '0 8px 24px rgba(124,92,252,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, letterSpacing: '-0.01em' }}>
                {ctaLabel} <span style={{ opacity: 0.85, fontWeight: 700 }}>{totalStr}</span>
              </button>
              <div style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 11, lineHeight: 1.6 }}>
                {s.disclaimer}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── RIGHT RAIL ── */}
      <div style={{ flex: '1 1 300px', maxWidth: 360, minWidth: 280, position: 'sticky', top: 74, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ ...C.card, padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'rgba(255,255,255,0.9)', marginBottom: 16, letterSpacing: '-0.01em' }}>{s.payInfo}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            <PayRow label={`${s.payBase} · ${props.paxText}`} value={baseStr} />
            {/* 🔧 2026-07-18: 차터 옵션·야간할증·할인 내역 — 총액과 기본요금 차액이 설명되도록. */}
            {(props.extraRows || []).map((r) => (
              <PayRow key={r.key} label={r.label} value={r.value} pink={r.negative === true} />
            ))}
            {!props.hideAddons && f.addonMeeting && <PayRow label={s.payMeeting} value={meetingStr} />}
            {!props.hideAddons && f.addonChildSeat && <PayRow label={s.addonChildSeat} value={childSeatStr} />}
            {!props.hideDiscount && appliedCode && <PayRow label={`${s.payPromo} (${appliedCode})`} value="" pink />}
          </div>
          <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '15px 0' }} />
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', fontWeight: 600 }}>{s.payTotal}</span>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{totalStr}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{usdStr}</div>
            </div>
          </div>
        </div>

        <div style={{ ...C.card, padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'rgba(255,255,255,0.9)', marginBottom: 14, letterSpacing: '-0.01em' }}>{s.cancelPolicy}</div>
          {/* 🔧 2026-07-18: 조건 문구 대비 상향(0.45→0.72 + 굵게) — 굵은 제목("무료 취소"/"수수료
              100%")만 읽으면 모순처럼 보이던 정적 2행 안내표. 조건이 제목만큼 읽히게. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div><div style={{ fontSize: 13, fontWeight: 700, color: '#00D28C' }}>{s.cancelFreeTitle}</div><div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.72)', lineHeight: 1.5 }}>{s.cancelFreeDesc}</div></div>
            <div><div style={{ fontSize: 13, fontWeight: 700, color: '#FF6B6B' }}>{s.cancelFeeTitle}</div><div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.72)', lineHeight: 1.5 }}>{s.cancelFeeDesc}</div></div>
          </div>
        </div>

        <div style={{ ...C.card, padding: '18px 20px', background: 'rgba(255,255,255,0.03)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Trust title={s.trust1} sub={s.trust1Sub} />
            <Trust title={s.trust2} sub={s.trust2Sub} />
            <Trust title={s.trust3} sub={s.trust3Sub} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 보조 컴포넌트 ──────────────────────────────────────────────
function Chip({ children }: { children: React.ReactNode }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', padding: '4px 9px', borderRadius: 9999 }}>{children}</span>;
}

function AddonRow({ label, desc, price, checked, onChange }: { label: string; desc: string; price: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14, borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', cursor: 'pointer' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.92)' }}>{label}</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 1.4 }}>{desc}</div>
      </div>
      <span style={{ fontSize: 14, fontWeight: 700, color: '#C4956A', whiteSpace: 'nowrap' }}>{price}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 20, height: 20, accentColor: '#7C5CFC', cursor: 'pointer', flex: '0 0 auto' }} />
    </label>
  );
}

function AgreeRow({ checked, onChange, text, req, reqLabel, optLabel }: { checked: boolean; onChange: (v: boolean) => void; text: string; req?: boolean; reqLabel: string; optLabel: string }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '8px 4px', cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 18, height: 18, accentColor: '#7C5CFC', marginTop: 1, flex: '0 0 auto' }} />
      <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.62)', lineHeight: 1.5 }}>
        <span style={{ color: req ? '#FF6B9D' : 'rgba(255,255,255,0.4)', fontWeight: 600 }}>({req ? reqLabel : optLabel})</span> {text}
      </span>
    </label>
  );
}

function PayRow({ label, value, pink }: { label: string; value: string; pink?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ fontSize: 13, color: pink ? '#FF9EC2' : 'rgba(255,255,255,0.55)' }}>{label}</span>
      {value && <span style={{ fontSize: 14, fontWeight: 600, color: pink ? '#FF9EC2' : '#fff', whiteSpace: 'nowrap' }}>{value}</span>}
    </div>
  );
}

function Trust({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
      <span style={{ color: '#00D28C', flex: '0 0 auto', marginTop: 1, fontWeight: 700 }}>✓</span>
      <div><div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>{title}</div><div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{sub}</div></div>
    </div>
  );
}
