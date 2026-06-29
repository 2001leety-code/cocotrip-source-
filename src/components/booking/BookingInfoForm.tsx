// BookingInfoForm — 트립닷컴식 예약 → 회원정보 통합 폼 (차터/투어 공용).
// 디자인 출처: claude design "코코트립 예약정보 폼.html" (트립닷컴 캡처 기반, 운영자 확정 디자인).
// 순수 UI — 예약 요약·가격은 props, 입력값은 내부 state, 제출은 onSubmit 콜백.
//   결제 실행·필수검증 게이트·SMS 인증은 호출처(CharterWizard/TourBookingDialog)에서 처리.
// SSOT 색: 배경 #080b14 / 보라 #7C5CFC·#B9A4FF / 핑크 #EA537E·#FF6B9D / 민트 #00D28C / 골드 #C4956A.
import { useState } from 'react';

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
  onApplyDiscount?: (code: string) => void;
  onSubmit: (data: BookingFormData) => void;
}

// ── 스타일 토큰 ──────────────────────────────────────────────
const C = {
  card: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 22, backdropFilter: 'blur(20px)' } as React.CSSProperties,
  input: { width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.92)', fontSize: 14, fontFamily: 'inherit', outline: 'none' } as React.CSSProperties,
  label: { display: 'block', fontSize: 12, color: 'rgba(255,255,255,0.5)', margin: '0 0 7px', fontWeight: 500 } as React.CSSProperties,
  req: { color: '#FF6B9D' } as React.CSSProperties,
  opt: { fontSize: 11, color: 'rgba(255,255,255,0.3)' } as React.CSSProperties,
};

function SectionHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 18 }}>
      <span style={{ display: 'flex', width: 32, height: 32, borderRadius: 9, background: 'rgba(124,92,252,0.12)', border: '1px solid rgba(124,92,252,0.25)', alignItems: 'center', justifyContent: 'center', color: '#B9A4FF', flex: '0 0 auto', fontSize: 15 }}>•</span>
      <div>
        <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-0.01em' }}>{title}</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{sub}</div>
      </div>
    </div>
  );
}

function Counter({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const btn: React.CSSProperties = { width: 30, height: 30, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: 'rgba(255,255,255,0.6)', fontSize: 18, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '9px 14px' }}>
      <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <button type="button" onClick={() => onChange(Math.max(0, value - 1))} style={btn}>−</button>
        <span style={{ width: 18, textAlign: 'center', fontWeight: 700, fontSize: 15 }}>{value}</span>
        <button type="button" onClick={() => onChange(value + 1)} style={btn}>+</button>
      </div>
    </div>
  );
}

export function BookingInfoForm(props: BookingInfoFormProps) {
  const { isAirport, meetingLabel, baseStr, meetingStr, childSeatStr, totalStr, usdStr, ctaLabel } = props;
  const dial = props.defaultPhoneDial || '+82';

  const [f, setF] = useState<BookingFormData>({
    lastName: '', firstName: '', phone: '', email: '', messenger: 'WhatsApp', messengerId: '',
    meetingPlace: '', flightNo: '', arrivalTime: '', lugSmall: 0, lugMedium: 0, lugLarge: 0, notes: '',
    addonMeeting: true, addonChildSeat: false, discountCode: '',
    agree1: false, agree2: false, agree3: false, agree4: false,
  });
  const set = (patch: Partial<BookingFormData>) => setF((p) => ({ ...p, ...patch }));
  const [error, setError] = useState(false);
  const [appliedCode, setAppliedCode] = useState('');

  const agreeAll = f.agree1 && f.agree2 && f.agree3 && f.agree4;
  const toggleAll = () => { const v = !agreeAll; set({ agree1: v, agree2: v, agree3: v, agree4: v }); };

  const applyCode = (code: string) => { set({ discountCode: code }); setAppliedCode(code); props.onApplyDiscount?.(code); };

  const submit = () => {
    const ok = f.lastName && f.firstName && f.phone && f.email && f.meetingPlace && f.agree1 && f.agree2 && f.agree3;
    if (!ok) { setError(true); return; }
    setError(false);
    props.onSubmit(f);
  };

  const focusable = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.target.style.borderColor = 'rgba(124,92,252,0.55)';
    e.target.style.background = 'rgba(124,92,252,0.06)';
  };
  const blurable = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.target.style.borderColor = 'rgba(255,255,255,0.12)';
    e.target.style.background = 'rgba(255,255,255,0.03)';
  };

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '20px 16px 0', display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start', color: '#fff' }}>
      {/* ── LEFT COLUMN ── */}
      <div style={{ flex: '1 1 460px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* 요약 카드 */}
        <div style={{ ...C.card, display: 'flex', gap: 14, alignItems: 'center' }}>
          {props.thumbnailUrl && <img src={props.thumbnailUrl} alt="" style={{ width: 74, height: 74, borderRadius: 12, objectFit: 'cover', flex: '0 0 auto' }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.16em', color: '#B9A4FF', textTransform: 'uppercase', marginBottom: 5 }}>{props.eyebrow}</div>
            <div style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.3, marginBottom: 8, letterSpacing: '-0.01em' }}>{props.title}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <Chip>{props.dateText}</Chip>
              <Chip>{props.paxText}</Chip>
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#00D28C', marginTop: 8, fontWeight: 600 }}>✓ 사용일 1일 전까지 무료 취소</div>
          </div>
        </div>

        {/* 이용객·연락처 */}
        <div style={C.card}>
          <SectionHead title="이용객 · 연락처 정보" sub="Traveler & contact" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 13 }}>
            <div>
              <label style={C.label}>영문 성 (Last name) <span style={C.req}>*</span></label>
              <input value={f.lastName} onChange={(e) => set({ lastName: e.target.value })} placeholder="HONG" style={C.input} onFocus={focusable} onBlur={blurable} />
            </div>
            <div>
              <label style={C.label}>영문 이름 (First name) <span style={C.req}>*</span></label>
              <input value={f.firstName} onChange={(e) => set({ firstName: e.target.value })} placeholder="GILDONG" style={C.input} onFocus={focusable} onBlur={blurable} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginBottom: 13 }}>
            <div>
              <label style={C.label}>휴대폰 번호 <span style={C.req}>*</span></label>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', padding: '0 13px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: 600 }}>{dial}</div>
                <input value={f.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="10 1234 5678" inputMode="tel" style={{ ...C.input, flex: '1 1 auto', minWidth: 0 }} onFocus={focusable} onBlur={blurable} />
              </div>
            </div>
            <div>
              <label style={C.label}>이메일 주소 <span style={C.req}>*</span></label>
              <input value={f.email} onChange={(e) => set({ email: e.target.value })} placeholder="you@email.com" inputMode="email" style={C.input} onFocus={focusable} onBlur={blurable} />
            </div>
          </div>
          <div>
            <label style={C.label}>메신저 연락처 <span style={C.opt}>(선택 · 빠른 안내)</span></label>
            <div style={{ display: 'grid', gridTemplateColumns: '128px 1fr', gap: 8 }}>
              <select value={f.messenger} onChange={(e) => set({ messenger: e.target.value })} style={{ ...C.input, cursor: 'pointer' }}>
                <option>WhatsApp</option><option>KakaoTalk</option><option>LINE</option><option>WeChat</option>
              </select>
              <input value={f.messengerId} onChange={(e) => set({ messengerId: e.target.value })} placeholder="메신저 ID 또는 번호" style={C.input} onFocus={focusable} onBlur={blurable} />
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 8, lineHeight: 1.5 }}>여행 일정·픽업 관련 안내가 연락처로 발송됩니다. 정확한 정보를 입력해 주세요.</div>
          </div>
        </div>

        {/* 추가 정보 */}
        <div style={C.card}>
          <SectionHead title="추가 정보" sub="Additional details" />
          <div style={{ marginBottom: 13 }}>
            <label style={C.label}>{meetingLabel} <span style={C.req}>*</span></label>
            <input value={f.meetingPlace} onChange={(e) => set({ meetingPlace: e.target.value })} placeholder="예: L7 명동 바이 롯데호텔 (퇴계로 137)" style={C.input} onFocus={focusable} onBlur={blurable} />
          </div>
          {isAirport && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={C.label}>항공편 편명 <span style={C.opt}>(선택)</span></label>
                  <input value={f.flightNo} onChange={(e) => set({ flightNo: e.target.value.toUpperCase() })} placeholder="예: KE5760, OZ521" style={{ ...C.input, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '.08em' }} onFocus={focusable} onBlur={blurable} />
                </div>
                <div>
                  <label style={C.label}>도착 시간 <span style={C.opt}>(현지)</span></label>
                  <input type="time" value={f.arrivalTime} onChange={(e) => set({ arrivalTime: e.target.value })} style={{ ...C.input, colorScheme: 'dark' }} onFocus={focusable} onBlur={blurable} />
                </div>
              </div>
              <div style={{ marginBottom: 13 }}>
                <label style={{ ...C.label, display: 'flex', alignItems: 'center', gap: 6 }}>캐리어 (사이즈별 수량)</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Counter label="소형 (기내반입)" value={f.lugSmall} onChange={(v) => set({ lugSmall: v })} />
                  <Counter label="중형 (24인치)" value={f.lugMedium} onChange={(v) => set({ lugMedium: v })} />
                  <Counter label="대형 (28인치+)" value={f.lugLarge} onChange={(v) => set({ lugLarge: v })} />
                </div>
              </div>
            </>
          )}
          <div>
            <label style={C.label}>추가 요청사항 <span style={C.opt}>(선택)</span></label>
            <textarea value={f.notes} onChange={(e) => set({ notes: e.target.value })} rows={3} placeholder="예: 유아 카시트 필요, 한국어 기사 선호, 특정 시간 픽업…" style={{ ...C.input, resize: 'none', lineHeight: 1.55 }} onFocus={focusable} onBlur={blurable} />
          </div>
        </div>

        {/* 부가 서비스 */}
        <div style={C.card}>
          <SectionHead title="부가 서비스" sub="Optional add-ons" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <AddonRow label="공항 미팅 & 피켓 서비스" desc="픽업 담당직원이 도착 출구(세관 통과 후)에서 피켓을 들고 대기합니다" price={meetingStr} checked={f.addonMeeting} onChange={(v) => set({ addonMeeting: v })} />
            <AddonRow label="유아 카시트" desc="신생아·유아 동반 시 안전 카시트를 미리 장착해 드립니다" price={childSeatStr} checked={f.addonChildSeat} onChange={(v) => set({ addonChildSeat: v })} />
          </div>
        </div>

        {/* 할인코드 */}
        <div style={C.card}>
          <SectionHead title="할인코드" sub="Promo code" />
          <div style={{ display: 'flex', gap: 8, marginBottom: 13 }}>
            <input value={f.discountCode} onChange={(e) => set({ discountCode: e.target.value.toUpperCase() })} placeholder="할인코드 입력" style={{ ...C.input, flex: '1 1 auto', minWidth: 0, textTransform: 'uppercase' }} onFocus={focusable} onBlur={blurable} />
            <button type="button" onClick={() => applyCode(f.discountCode)} style={{ flex: '0 0 auto', padding: '0 22px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>사용</button>
          </div>
          {appliedCode && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: 12, border: '1px solid rgba(0,210,140,0.3)', background: 'rgba(0,210,140,0.08)', marginBottom: 13 }}>
              <span style={{ flex: 1, fontSize: 13, color: 'rgba(255,255,255,0.85)' }}><b style={{ color: '#00D28C' }}>{appliedCode}</b> 할인코드가 적용되었습니다</span>
              <button type="button" onClick={() => { setAppliedCode(''); set({ discountCode: '' }); }} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.45)', cursor: 'pointer', fontSize: 12, textDecoration: 'underline' }}>취소</button>
            </div>
          )}
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 9, fontWeight: 600 }}>사용 가능한 할인코드</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <CouponBtn pct="12%" highlight title="신규 회원 대상 공항 픽업/샌딩 12% 할인" sub="유효기간 2026-07-05 · 코드 WELCOME12" onClick={() => applyCode('WELCOME12')} />
            <CouponBtn pct="10%" title="신규 회원 대상 공항 픽업/샌딩 10% 할인" sub="유효기간 2026-07-05 · 코드 WELCOME10" onClick={() => applyCode('WELCOME10')} />
          </div>
        </div>

        {/* 약관 동의 */}
        <div style={C.card}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', marginBottom: 6 }}>
            <input type="checkbox" checked={agreeAll} onChange={toggleAll} style={{ width: 20, height: 20, accentColor: '#7C5CFC', cursor: 'pointer' }} />
            <span style={{ fontWeight: 700, fontSize: 14 }}>아래 항목에 모두 동의합니다</span>
          </label>
          <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '10px 0' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <AgreeRow checked={f.agree1} onChange={(v) => set({ agree1: v })} req text="만 18세 이상이며 이용약관 및 취소 규정에 동의합니다" />
            <AgreeRow checked={f.agree2} onChange={(v) => set({ agree2: v })} req text="개인정보 제3자 제공 (차량 공급업체·기사)에 동의합니다" />
            <AgreeRow checked={f.agree3} onChange={(v) => set({ agree3: v })} req text="개인정보 국외 이전 및 고유식별정보 수집·이용에 동의합니다" />
            <AgreeRow checked={f.agree4} onChange={(v) => set({ agree4: v })} text="한정 특가·이벤트·여행 소식 등 마케팅 정보 수신에 동의합니다" />
          </div>
        </div>

        {/* CTA */}
        <div>
          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', borderRadius: 12, border: '1px solid rgba(255,100,100,0.3)', background: 'rgba(255,100,100,0.08)', marginBottom: 11, fontSize: 13, color: '#ffb4b4' }}>
              필수 항목(성·이름·연락처·이메일·{meetingLabel})과 필수 약관 동의를 확인해 주세요.
            </div>
          )}
          <button type="button" onClick={submit} style={{ width: '100%', padding: 16, border: 'none', borderRadius: 14, background: 'linear-gradient(135deg,#7C5CFC 0%,#EA537E 100%)', color: '#fff', fontSize: 16, fontWeight: 800, cursor: 'pointer', boxShadow: '0 8px 24px rgba(124,92,252,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, letterSpacing: '-0.01em' }}>
            {ctaLabel} <span style={{ opacity: 0.85, fontWeight: 700 }}>{totalStr}</span>
          </button>
          <div style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 11, lineHeight: 1.6 }}>
            코코트립은 통신판매중개자로서 차량 공급업체가 제공하는 서비스의 당사자가 아니며,<br />예약·이용·환불 관련 의무와 책임은 각 공급업체에 있습니다.
          </div>
        </div>
      </div>

      {/* ── RIGHT RAIL ── */}
      <div style={{ flex: '1 1 300px', maxWidth: 360, minWidth: 280, position: 'sticky', top: 74, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ ...C.card, padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'rgba(255,255,255,0.9)', marginBottom: 16, letterSpacing: '-0.01em' }}>결제 정보</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            <PayRow label={`선택 옵션 · ${props.paxText}`} value={baseStr} />
            {f.addonMeeting && <PayRow label="공항 미팅 & 피켓" value={meetingStr} />}
            {f.addonChildSeat && <PayRow label="유아 카시트" value={childSeatStr} />}
            {appliedCode && <PayRow label={`할인코드 적용 (${appliedCode})`} value="" pink />}
          </div>
          <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '15px 0' }} />
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', fontWeight: 600 }}>예약 총금액</span>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{totalStr}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{usdStr}</div>
            </div>
          </div>
        </div>

        <div style={{ ...C.card, padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'rgba(255,255,255,0.9)', marginBottom: 14, letterSpacing: '-0.01em' }}>취소 규정</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div><div style={{ fontSize: 13, fontWeight: 700, color: '#00D28C' }}>무료 취소</div><div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>사용일 1일 전까지 — 전액 환불</div></div>
            <div><div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>취소 수수료 100%</div><div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>사용일 1일 전 이후 — 환불 불가</div></div>
          </div>
        </div>

        <div style={{ ...C.card, padding: '18px 20px', background: 'rgba(255,255,255,0.03)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Trust title="단일요금, 모든 서비스 투명하게" sub="팁·통행료 포함, 별도 추가요금 없음" />
            <Trust title="항공편 지연 시 무료 대기" sub="도착 후 약 90분간 무료 대기" />
            <Trust title="영어·한국어 가능 기사 · 24시간 지원" sub="노쇼·지각 시 보상 보장" />
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

function CouponBtn({ pct, title, sub, highlight, onClick }: { pct: string; title: string; sub: string; highlight?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '12px 14px', borderRadius: 12, border: highlight ? '1px solid rgba(124,92,252,0.25)' : '1px solid rgba(255,255,255,0.1)', background: highlight ? 'rgba(124,92,252,0.07)' : 'rgba(255,255,255,0.03)', cursor: 'pointer', color: '#fff' }}>
      <span style={{ fontSize: 17, fontWeight: 900, color: highlight ? '#B9A4FF' : 'rgba(255,255,255,0.7)', flex: '0 0 auto' }}>{pct}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{sub}</div>
      </div>
      <span style={{ fontSize: 12, color: highlight ? '#B9A4FF' : 'rgba(255,255,255,0.6)', fontWeight: 700, whiteSpace: 'nowrap' }}>적용 ›</span>
    </button>
  );
}

function AgreeRow({ checked, onChange, text, req }: { checked: boolean; onChange: (v: boolean) => void; text: string; req?: boolean }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '8px 4px', cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 18, height: 18, accentColor: '#7C5CFC', marginTop: 1, flex: '0 0 auto' }} />
      <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.62)', lineHeight: 1.5 }}>
        <span style={{ color: req ? '#FF6B9D' : 'rgba(255,255,255,0.4)', fontWeight: 600 }}>({req ? '필수' : '선택'})</span> {text}
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
