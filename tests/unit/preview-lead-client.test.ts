/**
 * PurchaseSection.tsx — free-preview 이탈 회복 리드 캡처 체크박스 회귀 (2026-08-19).
 *
 * 이 파일은 firebase/PayPal/leaflet 를 끌어오는 무거운 컴포넌트라, 렌더 대신 소스 단언으로
 * 잠근다 (editorial-planner-journey.test.ts / manual-payment-ratelimit-pr432.test.ts 와 동일
 * 관례 — repo 의 이 파일 전용 기존 패턴).
 *
 * 잠금:
 *   1. 체크박스 존재 + 기본 unchecked(useState(false)).
 *   2. /api/preview-lead POST 는 "checked && 유효 이메일&& 마운트당 이메일별 1회" 게이트
 *      **뒤에서만** 일어난다(가드가 fetch 보다 먼저 등장).
 *   3. fire-and-forget — .catch 로 에러를 삼키고 throw 하지 않는다.
 *   4. 결제 섹션(필수 이메일 입력·PayPalBookingButton·expectedUSD·userEmail prop)은 무변경.
 *   5. 4언어 체크박스 문구 그대로 존재.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(resolve(process.cwd(), 'src/pages/PlannerPage/components/PurchaseSection.tsx'), 'utf8');

describe('preview-lead opt-in checkbox — exists, optional, unchecked by default', () => {
  it('has a checkbox input wired to wantsPreviewTips state', () => {
    expect(SRC).toMatch(/const \[wantsPreviewTips, setWantsPreviewTips\] = useState\(false\)/);
    expect(SRC).toMatch(/type="checkbox"\s*\n\s*checked=\{wantsPreviewTips\}/);
    expect(SRC).toMatch(/onChange=\{e => setWantsPreviewTips\(e\.target\.checked\)\}/);
  });

  it('does not carry a `required` attribute (optional, unlike the paid-flow email input)', () => {
    const checkboxBlock = SRC.match(/type="checkbox"[\s\S]{0,300}?<\/label>/)?.[0] || '';
    expect(checkboxBlock).not.toMatch(/\brequired\b/);
  });
});

describe('preview-lead opt-in — fire-and-forget POST gated on checked + valid email + once-per-email', () => {
  const effectBlock = SRC.match(/useEffect\(\(\) => \{\s*const email = userEmail\.trim\(\);[\s\S]*?\}, \[wantsPreviewTips, userEmail, language\]\);/)?.[0] || '';

  it('the effect exists and is scoped to [wantsPreviewTips, userEmail, language]', () => {
    expect(effectBlock).not.toBe('');
  });

  it('guards on wantsPreviewTips + email-format validity BEFORE the fetch call', () => {
    const guardIdx = effectBlock.indexOf('if (!wantsPreviewTips');
    const fetchIdx = effectBlock.indexOf("fetch('/api/preview-lead'");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(fetchIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(fetchIdx);
    expect(effectBlock.slice(guardIdx, fetchIdx)).toMatch(/\\S\+@\\S\+\\\.\\S\+/);
  });

  it('once-per-email-per-mount guard (Set ref) runs before the fetch call', () => {
    const hasIdx = effectBlock.indexOf('previewLeadSentEmails.current.has(key)');
    const addIdx = effectBlock.indexOf('previewLeadSentEmails.current.add(key)');
    const fetchIdx = effectBlock.indexOf("fetch('/api/preview-lead'");
    expect(hasIdx).toBeGreaterThan(-1);
    expect(addIdx).toBeGreaterThan(hasIdx);
    expect(fetchIdx).toBeGreaterThan(addIdx);
  });

  it('POST body carries email, language, and the fixed planner_paywall source', () => {
    expect(effectBlock).toMatch(/body:\s*JSON\.stringify\(\{\s*email,\s*language,\s*source:\s*'planner_paywall'\s*\}\)/);
  });

  it('errors are swallowed via .catch (console.warn) — never thrown, never blocks payment', () => {
    expect(effectBlock).toMatch(/\.catch\(\(e\) => console\.warn\(/);
  });

  it('useRef<Set<string>>() backs the once-per-email guard', () => {
    expect(SRC).toMatch(/const previewLeadSentEmails = useRef<Set<string>>\(new Set\(\)\)/);
  });
});

describe('preview-lead opt-in — 4-language copy present verbatim', () => {
  const COPY = {
    ko: '여행 준비 팁과 이 일정 리마인더를 이메일로 받아볼게요 (선택)',
    en: 'Get travel tips and a reminder for this itinerary by email (optional)',
    ja: '旅の準備のコツとこの日程のリマインダーをメールで受け取る（任意）',
    zh: '通过邮件接收旅行准备提示和此行程的提醒（可选）',
  };
  for (const [lang, text] of Object.entries(COPY)) {
    it(`${lang} copy present`, () => {
      expect(SRC).toContain(text);
    });
  }
});

describe('payment section — unchanged by the preview-lead addition', () => {
  it('the paid-flow email input is still required + type="email"', () => {
    expect(SRC).toMatch(/type="email"[\s\S]{0,200}?required/);
  });
  it('PayPalBookingButton still gets expectedUSD + userEmail + memo referencing userEmail', () => {
    expect(SRC).toContain('expectedUSD={AI_PLANNER_FULL_USD}');
    expect(SRC).toContain('userEmail={userEmail}');
    expect(SRC).toMatch(/memo=\{`Full itinerary for: \$\{userEmail\}`\}/);
  });
  it('login-gate branch for unauthenticated + guest-checkout-off is untouched', () => {
    expect(SRC).toContain('(!user && !guestCheckoutEnabled)');
  });
  it('exactly one <input type="email"> element exists (the checkbox stays type="checkbox")', () => {
    const emailInputs = SRC.match(/<input\s+type="email"/g) || [];
    expect(emailInputs).toHaveLength(1);
  });
});
