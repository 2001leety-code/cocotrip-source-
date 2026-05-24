import type { ReactNode } from 'react';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import { useLanguage } from '@/hooks/useLanguage';
import { useIsMobile } from '@/hooks/use-mobile';
import { usePageMeta } from '@/hooks/usePageMeta';

// ── 다국어 콘텐츠 ──────────────────────────────────────
const CONTENT = {
  en: {
    pageTitle: 'Terms of Service',
    articles: [
      {
        title: 'Article 1 (Purpose)',
        body: "These terms and conditions aim to stipulate the conditions and procedures for using all travel-related services provided by COCOTRIP (hereinafter referred to as the 'Company').",
      },
      {
        title: 'Article 2 (Booking Method)',
        body: "1. Customers can book travel services through the 'Company' website, phone, or email.\n\n2. When booking, customers must provide accurate traveler information (name, contact information, email, etc.).\n\n3. After the booking request, a 'Company' representative will check availability and provide guidance. The booking is confirmed only after payment is completed.",
      },
      {
        title: 'Article 3 (Fees and Payment)',
        body: '1. Fees for all travel products follow the prices specified on the website and must be paid through designated payment methods (PayPal, bank transfer, etc.).\n\n2. Fees specify included items (vehicle, guide, entrance fees, etc.) and excluded items for each product, so please check them when booking.\n\n3. All payments must be completed before the booking is confirmed; otherwise, the booking may be automatically canceled.',
      },
      {
        title: 'Article 4 (Cancellation and Refund Policy)',
        body: 'Cancellations and refunds for travel services are processed according to the following regulations:',
        list: [
          'Cancellation 15 days before the travel date: Full refund',
          'Cancellation 8 to 14 days before the travel date: Refund after deducting a 10% fee of the total fee',
          'Cancellation 2 to 7 days before the travel date: Refund after deducting a 50% fee of the total fee',
          'Cancellation 1 day before or on the day of travel: No refund',
          'In case of cancellation due to force majeure such as natural disasters, it will be handled through mutual consultation.',
        ],
      },
    ],
  },
  ko: {
    pageTitle: '이용약관',
    articles: [
      {
        title: '제1조 (목적)',
        body: "이 약관은 COCOTRIP(이하 '회사')이 제공하는 여행 관련 모든 서비스의 이용 조건 및 절차를 규정하는 것을 목적으로 합니다.",
      },
      {
        title: '제2조 (예약 방법)',
        body: "1. 고객은 '회사' 웹사이트, 전화 또는 이메일을 통해 여행 서비스를 예약할 수 있습니다.\n\n2. 예약 시 고객은 정확한 여행자 정보(성명, 연락처, 이메일 등)를 제공해야 합니다.\n\n3. 예약 요청 후 '회사' 담당자가 가용 여부를 확인하고 안내를 드립니다. 결제가 완료된 후에만 예약이 확정됩니다.",
      },
      {
        title: '제3조 (요금 및 결제)',
        body: '1. 모든 여행 상품의 요금은 웹사이트에 명시된 가격을 따르며, 지정된 결제 수단(PayPal, 계좌이체 등)을 통해 결제해야 합니다.\n\n2. 요금은 각 상품별로 포함 사항(차량, 가이드, 입장료 등)과 불포함 사항이 명시되어 있으므로 예약 시 확인하시기 바랍니다.\n\n3. 모든 결제는 예약 확정 전에 완료되어야 하며, 그렇지 않을 경우 예약이 자동 취소될 수 있습니다.',
      },
      {
        title: '제4조 (취소 및 환불 정책)',
        body: '여행 서비스의 취소 및 환불은 아래 규정에 따라 처리됩니다:',
        list: [
          '여행일 15일 전 취소: 전액 환불',
          '여행일 8~14일 전 취소: 총 요금의 10% 공제 후 환불',
          '여행일 2~7일 전 취소: 총 요금의 50% 공제 후 환불',
          '여행일 1일 전 또는 당일 취소: 환불 불가',
          '천재지변 등 불가항력에 의한 취소 시 상호 협의하여 처리합니다.',
        ],
      },
    ],
  },
  ja: {
    pageTitle: '利用規約',
    articles: [
      {
        title: '第1条（目的）',
        body: "本規約は、COCOTRIP（以下「当社」）が提供する旅行関連の全サービスの利用条件および手続きを規定することを目的とします。",
      },
      {
        title: '第2条（予約方法）',
        body: "1. お客様は当社のウェブサイト、電話、またはメールを通じて旅行サービスをご予約いただけます。\n\n2. ご予約の際は、正確な旅行者情報（氏名、連絡先、メールアドレスなど）をご提供ください。\n\n3. ご予約リクエスト後、当社担当者が空き状況を確認しご案内いたします。お支払い完了後にご予約が確定されます。",
      },
      {
        title: '第3条（料金およびお支払い）',
        body: '1. すべての旅行商品の料金はウェブサイトに掲載された価格に従い、指定のお支払い方法（PayPal、銀行振込など）で決済いただきます。\n\n2. 各商品ごとに含まれるもの（車両、ガイド、入場料など）と含まれないものが明記されておりますので、ご予約時にご確認ください。\n\n3. お支払いは予約確定前に完了する必要があります。完了しない場合、ご予約は自動的にキャンセルされる場合があります。',
      },
      {
        title: '第4条（キャンセルおよび返金ポリシー）',
        body: '旅行サービスのキャンセルおよび返金は、以下の規定に従って処理されます：',
        list: [
          '旅行日の15日前のキャンセル：全額返金',
          '旅行日の8〜14日前のキャンセル：総額の10%を差し引いた金額を返金',
          '旅行日の2〜7日前のキャンセル：総額の50%を差し引いた金額を返金',
          '旅行日の前日または当日のキャンセル：返金不可',
          '天災などの不可抗力によるキャンセルの場合は、双方の協議により対応いたします。',
        ],
      },
    ],
  },
  zh: {
    pageTitle: '服务条款',
    articles: [
      {
        title: '第一条（目的）',
        body: '本条款旨在规定使用COCOTRIP（以下简称"公司"）提供的所有旅行相关服务的条件和程序。',
      },
      {
        title: '第二条（预订方式）',
        body: '1. 客户可通过本公司网站、电话或电子邮件预订旅行服务。\n\n2. 预订时，客户须提供准确的旅行者信息（姓名、联系方式、电子邮箱等）。\n\n3. 预订请求提交后，公司工作人员将确认可用性并提供指导。仅在付款完成后预订才会确认。',
      },
      {
        title: '第三条（费用及支付）',
        body: '1. 所有旅行产品的费用按网站上标明的价格执行，须通过指定支付方式（PayPal、银行转账等）支付。\n\n2. 各产品的费用明确标注了包含项目（车辆、导游、门票等）和不包含项目，请在预订时确认。\n\n3. 所有付款须在预订确认前完成，否则预订可能被自动取消。',
      },
      {
        title: '第四条（取消与退款政策）',
        body: '旅行服务的取消和退款按以下规定处理：',
        list: [
          '旅行日15天前取消：全额退款',
          '旅行日8至14天前取消：扣除总费用10%后退款',
          '旅行日2至7天前取消：扣除总费用50%后退款',
          '旅行日1天前或当天取消：不予退款',
          '因自然灾害等不可抗力取消时，双方协商处理。',
        ],
      },
    ],
  },
};

type ArticleData = (typeof CONTENT)['en']['articles'][number];

const PageSection = ({ title, children, isMobile }: { title: string; children: ReactNode; isMobile?: boolean }) => (
  <section className="mb-8">
    <h2 className={`text-xl font-semibold pb-2 mb-4 border-b-2 ${
      isMobile ? 'text-white border-[#B668FC]/30' : 'text-white border-[#FF6B9D]/40'
    }`}>{title}</h2>
    <div className={`space-y-4 text-sm leading-relaxed ${isMobile ? 'text-white/50' : 'text-white/70'}`}>{children}</div>
  </section>
);

export default function Terms() {
  const { language, t, changeLanguage } = useLanguage();
  const isMobile = useIsMobile();
  const content = CONTENT[language as keyof typeof CONTENT] ||CONTENT.en;

  usePageMeta({
    title: content.pageTitle,
    description: t.pageMeta?.terms?.description ||'CocoTrip terms of service — booking, payment, cancellation and refund policies.',
  });

  return (
    <div className={isMobile ? 'm-page' : 'min-h-screen bg-gradient-to-b from-[#0a0412] via-[#0d0618] to-[#080210]'}>
      <Header language={language} t={t} onLanguageChange={changeLanguage} />
      <main className={`container mx-auto px-4 ${isMobile ? 'pt-6 pb-4' : 'py-16 sm:py-24'}`}>
        <div className={isMobile ? '' : 'max-w-4xl mx-auto bg-white/[0.04] backdrop-blur-md border border-white/[0.08] p-8 sm:p-12 rounded-lg shadow-lg'}>
          <h1 className={`text-2xl font-bold text-center mb-8 ${isMobile ? 'm-shimmer-text' : 'text-white text-3xl sm:text-4xl sm:mb-12'}`}>{content.pageTitle}</h1>
          
          {content.articles.map((article: ArticleData, idx: number) => (
            <PageSection key={idx} title={article.title} isMobile={isMobile}>
              {article.body.split('\n\n').map((paragraph, pIdx) => (
                <p key={pIdx}>{paragraph}</p>
              ))}
              {'list' in article && (article as ArticleData & { list?: string[] }).list && (
                <ul className={`list-disc list-inside space-y-2 ${isMobile ? 'text-white/55' : ''}`}>
                  {((article as ArticleData & { list?: string[] }).list!).map((item: string, i: number) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              )}
            </PageSection>
          ))}
        </div>
      </main>
      {!isMobile && <Footer t={t} />}
    </div>
  );
}
