/**
 * AI 플래너 — 무료와 유료를 갈라 보여주는 안내 (2026-07-30).
 *
 * 🔴 고친 문제: 플래너 입력 화면에 **금액이 한 글자도 없었다.**
 *   상단 배너는 "1~3일 AI 일정 무료" 를 크게 말하고, 화면 어디에도 유료 구간이 없어서
 *   손님은 전부 공짜인 줄 알고 설문을 다 채운 뒤 결제 단계에서 처음 $9.90 을 만난다.
 *   그 지점이 이탈 지점이 된다. 무료로 주는 것과 파는 것을 **미리** 나눠 적는다.
 *
 * 세 줄로 나눈다.
 *   1) 무료 미리보기        — 누구나, 결제 없이
 *   2) 신규회원 1~3일 무료   — 가입하면 받는 쿠폰
 *   3) 전체 일정 $9.90      — 실제 판매 상품
 *
 * 가격 문자열은 절대 여기서 만들지 않는다. lib/aiPlannerPrice.ts 가 정본이다.
 */
import { Gift, Sparkles, Wallet } from 'lucide-react';
import { formatAiPlannerUsd, formatAiPlannerApproxKrw } from '@/lib/aiPlannerPrice';

interface Props {
  language: string;
}

type Copy = { free: string; coupon: string; paid: string; note: string };

const COPY: Record<'ko' | 'en' | 'ja' | 'zh', Copy> = {
  ko: {
    free: '무료 미리보기 — 결제 없이 일정 뼈대를 먼저 봅니다',
    coupon: '신규 회원 쿠폰 — 가입하면 1~3일 일정 무료',
    paid: '전체 일정 {price} — 하루 단위 동선·이동수단·지도·PDF 포함',
    note: '표시 금액은 실제 결제 금액입니다. 원화는 참고용이며 카드사 환율에 따라 다를 수 있어요.',
  },
  en: {
    free: 'Free preview — see the outline before paying anything',
    coupon: 'New member coupon — 1–3 day itinerary free when you sign up',
    paid: 'Full itinerary {price} — day-by-day route, transit, map and PDF',
    note: 'The price shown is what you are charged. KRW is for reference and may differ by card issuer.',
  },
  ja: {
    free: '無料プレビュー — 支払い前に旅程の骨組みを確認',
    coupon: '新規会員クーポン — 登録で1〜3日分の旅程が無料',
    paid: '全旅程 {price} — 日別ルート・交通・地図・PDF 付き',
    note: '表示金額が実際の請求額です。円・ウォン表記は参考で、カード会社のレートにより異なります。',
  },
  zh: {
    free: '免费预览 — 付款前先看行程框架',
    coupon: '新会员优惠券 — 注册即享 1–3 天行程免费',
    paid: '完整行程 {price} — 含每日路线·交通·地图·PDF',
    note: '显示金额即实际扣款金额。韩元为参考值，可能因发卡行汇率而不同。',
  },
};

export function AiPlannerPricingNote({ language }: Props) {
  const lang = (['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as keyof typeof COPY;
  const c = COPY[lang];
  const price = `${formatAiPlannerUsd()} (${formatAiPlannerApproxKrw(lang)})`;

  const rows = [
    { icon: Sparkles, text: c.free, tone: 'text-white/70' },
    { icon: Gift, text: c.coupon, tone: 'text-[#FF6B9D]' },
    { icon: Wallet, text: c.paid.replace('{price}', price), tone: 'text-white' },
  ];

  return (
    <section
      className="mb-4 rounded-[18px] px-4 py-3"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
    >
      <ul className="space-y-1.5">
        {rows.map(({ icon: Icon, text, tone }) => (
          <li key={text} className="flex items-start gap-2">
            <Icon className="w-3.5 h-3.5 mt-[3px] shrink-0 text-[#B668FC]" aria-hidden />
            <span className={`text-[12.5px] leading-snug ${tone}`}>{text}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] leading-snug text-white/40">{c.note}</p>
    </section>
  );
}
