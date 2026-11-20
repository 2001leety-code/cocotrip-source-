/**
 * The privacy policy carries the articles Korean law expects (destruction, entrustment, overseas
 * transfer, provision to third parties, data subject rights, safety measures, cookies, policy
 * changes) in all four languages, with the same article order, the same overseas recipients and
 * the same effective date (draft 2026-11-20). The text is read from the source the way
 * legal-docs-trade-name.test.ts does.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf-8');
const src = read('src/pages/Privacy.tsx');
const count = (needle: string) => src.split(needle).length - 1;

// File order is en, ko, ja, zh. Each language lists 12 articles in this order.
const TITLES: Record<string, string[]> = {
  en: [
    'Article 1 (Collected Personal Information)',
    'Article 2 (Purpose of Processing Personal Information)',
    'Article 3 (Retention and Use Period of Personal Information)',
    'Article 4 (Procedure and Method of Destroying Personal Information)',
    'Article 5 (Entrustment of Personal Information Processing)',
    'Article 6 (Overseas Transfer of Personal Information)',
    'Article 7 (Provision of Personal Information to Third Parties)',
    'Article 8 (Rights and Obligations of Data Subjects and How to Exercise Them)',
    'Article 9 (Measures to Ensure the Safety of Personal Information)',
    'Article 10 (Installation, Operation and Refusal of Cookies and Other Automatic Collection Tools)',
    'Article 11 (Personal Information Protection Officer)',
    'Article 12 (Changes to This Privacy Policy)',
  ],
  ko: [
    '제1조 (수집하는 개인정보 항목)',
    '제2조 (개인정보 처리 목적)',
    '제3조 (개인정보 보유 및 이용 기간)',
    '제4조 (개인정보의 파기 절차 및 방법)',
    '제5조 (개인정보 처리업무의 위탁)',
    '제6조 (개인정보의 국외 이전)',
    '제7조 (개인정보의 제3자 제공)',
    '제8조 (정보주체의 권리·의무 및 행사 방법)',
    '제9조 (개인정보의 안전성 확보 조치)',
    '제10조 (쿠키 등 개인정보 자동 수집 장치의 설치·운영 및 거부)',
    '제11조 (개인정보 보호책임자)',
    '제12조 (개인정보처리방침의 변경)',
  ],
  ja: [
    '第1条（収集する個人情報）',
    '第2条（個人情報の利用目的）',
    '第3条（個人情報の保有および利用期間）',
    '第4条（個人情報の破棄の手続きおよび方法）',
    '第5条（個人情報の処理業務の委託）',
    '第6条（個人情報の国外移転）',
    '第7条（個人情報の第三者提供）',
    '第8条（情報主体の権利・義務およびその行使方法）',
    '第9条（個人情報の安全性確保措置）',
    '第10条（Cookieなど個人情報の自動収集装置の設置・運用および拒否）',
    '第11条（個人情報保護責任者）',
    '第12条（プライバシーポリシーの変更）',
  ],
  zh: [
    '第一条（收集的个人信息）',
    '第二条（个人信息处理目的）',
    '第三条（个人信息保留及使用期间）',
    '第四条（个人信息的销毁程序及方法）',
    '第五条（个人信息处理业务的委托）',
    '第六条（个人信息的跨境转移）',
    '第七条（向第三方提供个人信息）',
    '第八条（信息主体的权利、义务及行使方法）',
    '第九条（个人信息安全保障措施）',
    '第十条（Cookie等个人信息自动收集装置的设置、运营及拒绝）',
    '第十一条（个人信息保护负责人）',
    '第十二条（隐私政策的变更）',
  ],
};

// Overseas recipients (article 6) and their contacts. Each recipient is named in article 5 and
// article 6 of every language (8 times); each contact once per language (4 times).
const RECIPIENTS = [
  ['Google LLC', 'googlekrsupport@google.com'],
  ['Anthropic PBC', 'privacy@anthropic.com'],
  ['Vercel Inc.', 'privacy@vercel.com'],
  ['PayPal Pte. Ltd.', 'paypal.com/kr'],
  ['Inngest Inc.', 'hello@inngest.com'],
  ['Functional Software, Inc.', 'compliance@sentry.io'],
  ['Telegram Messenger Inc.', 'telegram.org/support'],
  ['Discord Inc.', 'privacy@discord.com'],
  ['PostHog Inc.', 'privacy@posthog.com'],
];

// How each language quotes a button name in running text.
const QUOTES = [
  ['ko', (l: string) => `'${l}'`],
  ['en', (l: string) => `'${l}'`],
  ['ja', (l: string) => `「${l}」`],
  ['zh', (l: string) => `"${l}"`],
] as const;
const cookieBanner = (lang: string) => JSON.parse(read(`src/i18n/locales/${lang}.json`)).cookieBanner;

describe('privacy policy articles', () => {
  it('every language lists the same 12 articles in the same order', () => {
    const titles = [...src.matchAll(/title: '([^']+)'/g)].map((m) => m[1]);
    expect(titles).toEqual([...TITLES.en, ...TITLES.ko, ...TITLES.ja, ...TITLES.zh]);
  });

  it.each(RECIPIENTS)('%s is named in articles 5 and 6 of every language, with its contact', (name, contact) => {
    expect(count(name)).toBe(8);
    expect(count(contact)).toBe(4);
  });

  it('every language shows the same effective date', () => {
    expect(src).toContain('2026년 11월 20일부터 적용됩니다');
    expect(src).toContain('applies from November 20, 2026');
    expect(src).toContain('2026年11月20日から適用されます');
    expect(src).toContain('自2026年11月20日起施行');
  });

  // The refusal steps name the buttons on this page; a renamed button would leave them pointing nowhere.
  it('the refusal steps use the cookie-settings button name of each language', () => {
    for (const [lang, quoted] of QUOTES) expect(count(quoted(cookieBanner(lang).settingsLink)), lang).toBe(2);
  });

  it('the cookie article uses the accept button name of each language', () => {
    for (const [lang, quoted] of QUOTES) expect(count(quoted(cookieBanner(lang).accept)), lang).toBe(1);
  });

  // Rights requests and transfer refusals go to the protection officer; the article number must follow it.
  it('every language points to the protection officer in article 11', () => {
    expect(count('Protection Officer in Article 11')).toBe(2);
    expect(count('제11조의')).toBe(2);
    expect(count('第11条の')).toBe(2);
    expect(count('第十一条的')).toBe(2);
    expect(src).not.toMatch(/in Article 10\b|제10조의|第10条の|第十条的/);
  });

  // English uses the short name the way article 1 defines it (#1514 review follow-up).
  it("English says the 'Company', the way article 1 defines it", () => {
    expect(src).not.toMatch(/'[Tt]he Company'/);
    expect(src).not.toContain('is collecting');
    expect(src).toContain("The 'Company' uses the collected personal information");
  });
});
