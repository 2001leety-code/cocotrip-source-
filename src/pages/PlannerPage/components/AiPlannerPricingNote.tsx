/**
 * 플래너 — 무료와 유료를 갈라 보여주는 안내 (2026-07-30).
 *
 * 🔴 고친 문제: 플래너 입력 화면에 **금액이 한 글자도 없었다.**
 *   상단 배너는 "1~3일 일정 무료" 를 크게 말하고, 화면 어디에도 유료 구간이 없어서
 *   손님은 전부 공짜인 줄 알고 설문을 다 채운 뒤 결제 단계에서 처음 $9.90 을 만난다.
 *   그 지점이 이탈 지점이 된다. 무료로 주는 것과 파는 것을 **미리** 나눠 적는다.
 *
 * 세 줄로 나눈다.
 *   1) 무료 미리보기        — 누구나, 결제 없이
 *   2) 신규회원 1~3일 무료   — 가입하면 받는 쿠폰
 *   3) 전체 일정 $9.90      — 실제 판매 상품
 *
 * 가격 문자열은 절대 여기서 만들지 않는다. lib/aiPlannerPrice.ts 가 정본이다.
 * (`tests/unit/affiliate-inventory-and-tracking.test.ts` 가 이 세 구분과
 *  "여기서 가격 문자열을 만들지 않는다" 를 소스에서 확인한다 — 사전은 여기 남는다.)
 *
 * 2026-08-10 (Korea Editorial Concierge): 보라 반투명 카드 → 종이 위의 요금 원장.
 *   금액이 tabular figure 로 정렬되고, 세 줄은 하이라인으로만 갈린다. 문구는 값이
 *   아니라 표현만 다듬었다 — 무료/쿠폰/유료의 경계와 원화 참고 고지는 그대로다.
 */
import { formatAiPlannerUsd, formatAiPlannerApproxKrw } from '@/lib/aiPlannerPrice';

interface Props {
  language: string;
}

type Copy = { heading: string; free: string; coupon: string; paid: string; note: string };

const COPY: Record<'ko' | 'en' | 'ja' | 'zh', Copy> = {
  ko: {
    heading: '무료인 것과 유료인 것',
    free: '무료 미리보기 — 결제 전에 1일차 뼈대를 먼저 봅니다',
    coupon: '신규 회원 쿠폰 — 가입하면 1~3일 일정 무료',
    paid: '전체 일정 {price} — 하루 단위 동선·이동수단·지도·PDF 포함',
    note: '표시 금액은 실제 결제 금액입니다. 원화는 참고용이며 카드사 환율에 따라 다를 수 있어요.',
  },
  en: {
    heading: 'What is free and what is paid',
    free: 'Free preview — see the outline of day one before paying anything',
    coupon: 'New member coupon — 1–3 day itinerary free when you sign up',
    paid: 'Full itinerary {price} — day-by-day route, transit, map and PDF',
    note: 'The price shown is what you are charged. KRW is for reference and may differ by card issuer.',
  },
  ja: {
    heading: '無料の範囲と有料の範囲',
    free: '無料プレビュー — 支払い前に1日目の骨組みを確認',
    coupon: '新規会員クーポン — 登録で1〜3日分の旅程が無料',
    paid: '全旅程 {price} — 日別ルート・交通・地図・PDF 付き',
    note: '表示金額が実際の請求額です。円・ウォン表記は参考で、カード会社のレートにより異なります。',
  },
  zh: {
    heading: '哪些免费，哪些收费',
    free: '免费预览 — 付款前先看第一天的框架',
    coupon: '新会员优惠券 — 注册即享 1–3 天行程免费',
    paid: '完整行程 {price} — 含每日路线·交通·地图·PDF',
    note: '显示金额即实际扣款金额。韩元为参考值，可能因发卡行汇率而不同。',
  },
};

export function AiPlannerPricingNote({ language }: Props) {
  const lang = (['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as keyof typeof COPY;
  const c = COPY[lang];
  const price = `${formatAiPlannerUsd()} (${formatAiPlannerApproxKrw(lang)})`;

  const rows = [c.free, c.coupon, c.paid.replace('{price}', price)];

  return (
    <section className="ai-planner-pricing-note">
      <p className="ec-eyebrow">{c.heading}</p>
      <ul className="mt-1.5 border-t border-ec-line sm:mt-2">
        {rows.map((text, i) => (
          <li
            key={text}
            className={`border-b border-ec-line py-2 text-[13px] leading-snug sm:py-2.5 sm:text-[14px] ${
              i === rows.length - 1 ? 'font-semibold text-ec-ink' : 'text-ec-ink-2'
            }`}
          >
            {text}
          </li>
        ))}
      </ul>
      {/* 원화는 참고값이라는 고지는 줄이지 않는다 — 소비자 사전 고지다. */}
      <p className="mt-1.5 text-[12px] leading-snug text-ec-ink-3 sm:mt-2 sm:text-[13px]">{c.note}</p>
    </section>
  );
}
