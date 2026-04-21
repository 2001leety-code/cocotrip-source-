import type { ReactNode } from 'react';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import { useLanguage } from '@/hooks/useLanguage';
import { useIsMobile } from '@/hooks/use-mobile';
import { usePageMeta } from '@/hooks/usePageMeta';

// ── 다국어 콘텐츠 ──────────────────────────────────────
const CONTENT = {
  en: {
    pageTitle: 'Travel Terms',
    articles: [
      {
        title: 'Article 1 (Purpose)',
        body: 'These terms and conditions aim to stipulate the detailed implementation and compliance of overseas travel contracts concluded between COCOTRIP (hereinafter referred to as the \'Company\') and travelers. This is based on the Standard Terms for Overseas Travel of the Fair Trade Commission.',
      },
      {
        title: 'Article 2 (Obligations of the Company and Traveler)',
        body: '1. Company: The Company faithfully performs various tasks such as establishing, implementing, and post-managing travel plans to provide safe and satisfactory travel services to travelers.\n\n• Name: COCOTRIP\n• Business Registration Number: 423-88-03168\n• Address: B01, 30 Hangang-daero 81-gil, Yongsan-gu, Seoul\n\n2. Traveler: Travelers must faithfully respond to the Company\'s guidance and cooperation requests for traveler safety and smooth travel.',
      },
      {
        title: 'Article 3 (Formation of Contract)',
        body: 'The travel contract is formed at the time the Company notifies the traveler of booking confirmation and the traveler pays the deposit or full travel fee to the Company.',
      },
      {
        title: 'Article 4 (Travel Fees)',
        body: 'Travel fees include airfare, accommodation, meals, transportation, guide fees, and entrance fees specified in the contract. Personal expenses (drinks, tips, optional tours, etc.) are not included.',
      },
      {
        title: 'Article 5 (Contract Termination and Modification)',
        body: '1. The contract can be terminated according to the Company\'s Cancellation and Refund Policy (Article 4 of the Terms of Service).\n\n2. If travel is impossible due to force majeure such as natural disasters, war, government orders, or flight suspension, the contract can be terminated. In this case, the Company refunds the amount excluding actual costs incurred.',
      },
      {
        title: 'Article 6 (Responsibility of the Company)',
        body: 'The Company is responsible for compensation for damages if it causes damage to travelers due to the Company\'s intention or negligence. However, the Company is not responsible for damages caused by the traveler\'s negligence, accidents occurring during free time, or force majeure such as natural disasters.',
      },
      {
        title: 'Article 7 (Responsibility of the Traveler)',
        body: 'Travelers are responsible for compensation for damages if they cause damage to the Company or others due to their intention or negligence. Travelers must have personal documents (passport, visa, etc.) necessary for travel, and all responsibilities for problems caused by their absence lie with the traveler.',
      },
    ],
  },
  ko: {
    pageTitle: '여행 약관',
    articles: [
      {
        title: '제1조 (목적)',
        body: '본 약관은 COCOTRIP(이하 \'회사\')과 여행자 간에 체결한 국외여행 계약의 세부 이행 및 준수 사항을 규정하는 것을 목적으로 합니다. 이는 공정거래위원회의 국외여행 표준약관을 기반으로 합니다.',
      },
      {
        title: '제2조 (회사 및 여행자의 의무)',
        body: '1. 회사: 회사는 여행자에게 안전하고 만족스러운 여행 서비스를 제공하기 위해 여행 계획 수립, 실행, 사후 관리 등 각종 업무를 성실히 수행합니다.\n\n• 상호: COCOTRIP\n• 사업자등록번호: 423-88-03168\n• 주소: 서울특별시 용산구 한강대로81길 30, B01\n\n2. 여행자: 여행자는 안전하고 원활한 여행을 위한 회사의 안내와 협조 요청에 성실히 응하여야 합니다.',
      },
      {
        title: '제3조 (계약의 성립)',
        body: '여행 계약은 회사가 여행자에게 예약 확인을 통보하고, 여행자가 회사에 계약금 또는 여행 요금 전액을 지급하는 시점에 성립됩니다.',
      },
      {
        title: '제4조 (여행 요금)',
        body: '여행 요금에는 계약에 명시된 항공료, 숙박비, 식비, 교통비, 가이드 비용 및 입장료가 포함됩니다. 개인 비용(음료, 팁, 선택 관광 등)은 포함되지 않습니다.',
      },
      {
        title: '제5조 (계약의 해제 및 변경)',
        body: '1. 계약은 회사의 취소 및 환불 정책(서비스 약관 제4조)에 따라 해제할 수 있습니다.\n\n2. 천재지변, 전쟁, 정부 명령, 항공편 중단 등 불가항력으로 여행이 불가능한 경우 계약을 해제할 수 있습니다. 이 경우 회사는 실제 발생한 비용을 제외한 금액을 환불합니다.',
      },
      {
        title: '제6조 (회사의 책임)',
        body: '회사의 고의 또는 과실로 여행자에게 손해를 입힌 경우 회사는 손해배상 책임을 집니다. 다만, 여행자의 과실로 인한 손해, 자유시간 중 발생한 사고, 천재지변 등 불가항력으로 인한 손해에 대해서는 회사가 책임지지 않습니다.',
      },
      {
        title: '제7조 (여행자의 책임)',
        body: '여행자의 고의 또는 과실로 회사나 타인에게 손해를 입힌 경우 여행자가 손해배상 책임을 집니다. 여행자는 여행에 필요한 개인 서류(여권, 비자 등)를 구비하여야 하며, 미비로 인한 모든 문제의 책임은 여행자에게 있습니다.',
      },
    ],
  },
  ja: {
    pageTitle: '旅行約款',
    articles: [
      {
        title: '第1条（目的）',
        body: '本約款は、COCOTRIP（以下「当社」）と旅行者との間で締結された海外旅行契約の詳細な履行および遵守事項を規定することを目的とします。これは公正取引委員会の海外旅行標準約款に基づいています。',
      },
      {
        title: '第2条（当社および旅行者の義務）',
        body: '1. 当社：当社は、旅行者に安全で満足のいく旅行サービスを提供するために、旅行計画の策定、実施、事後管理などの各種業務を誠実に遂行します。\n\n• 商号：COCOTRIP\n• 事業者登録番号：423-88-03168\n• 住所：ソウル特別市龍山区漢江大路81ギル30、B01\n\n2. 旅行者：旅行者は、安全で円滑な旅行のための当社の案内と協力要請に誠実に対応しなければなりません。',
      },
      {
        title: '第3条（契約の成立）',
        body: '旅行契約は、当社が旅行者に予約確認を通知し、旅行者が当社に手付金または旅行代金の全額を支払った時点で成立します。',
      },
      {
        title: '第4条（旅行代金）',
        body: '旅行代金には、契約に明記された航空運賃、宿泊費、食費、交通費、ガイド料金、入場料が含まれます。個人的な費用（飲み物、チップ、オプショナルツアーなど）は含まれません。',
      },
      {
        title: '第5条（契約の解除および変更）',
        body: '1. 契約は、当社のキャンセルおよび返金ポリシー（利用規約第4条）に従って解除できます。\n\n2. 天災、戦争、政府命令、航空便の停止など不可抗力により旅行が不可能な場合、契約を解除できます。この場合、当社は実際に発生した費用を除いた金額を返金します。',
      },
      {
        title: '第6条（当社の責任）',
        body: '当社の故意または過失により旅行者に損害を与えた場合、当社は損害賠償責任を負います。ただし、旅行者の過失による損害、自由時間中に発生した事故、天災などの不可抗力による損害については、当社は責任を負いません。',
      },
      {
        title: '第7条（旅行者の責任）',
        body: '旅行者の故意または過失により当社または他者に損害を与えた場合、旅行者が損害賠償責任を負います。旅行者は旅行に必要な個人書類（パスポート、ビザなど）を準備する必要があり、未準備による全ての問題の責任は旅行者にあります。',
      },
    ],
  },
  zh: {
    pageTitle: '旅行条款',
    articles: [
      {
        title: '第一条（目的）',
        body: '本条款旨在规定COCOTRIP（以下简称"公司"）与旅行者之间签订的海外旅行合同的详细执行和遵守事项。本条款基于公平贸易委员会的海外旅行标准条款。',
      },
      {
        title: '第二条（公司和旅行者的义务）',
        body: '1. 公司：公司忠实地执行旅行计划的制定、实施和后续管理等各项工作，为旅行者提供安全和满意的旅行服务。\n\n• 名称：COCOTRIP\n• 营业执照号码：423-88-03168\n• 地址：首尔特别市龙山区汉江大路81街30号B01\n\n2. 旅行者：旅行者必须忠实地回应公司为保障旅行者安全和顺畅旅行而提出的指导和协助请求。',
      },
      {
        title: '第三条（合同的成立）',
        body: '旅行合同在公司通知旅行者预订确认且旅行者向公司支付定金或全额旅行费用时成立。',
      },
      {
        title: '第四条（旅行费用）',
        body: '旅行费用包括合同中明确的机票、住宿、餐饮、交通、导游费和门票。个人费用（饮料、小费、自选旅游等）不包含在内。',
      },
      {
        title: '第五条（合同的解除和变更）',
        body: '1. 合同可根据公司的取消和退款政策（服务条款第4条）解除。\n\n2. 因自然灾害、战争、政府命令或航班停飞等不可抗力导致无法旅行时，可解除合同。在此情况下，公司退还扣除实际发生费用后的金额。',
      },
      {
        title: '第六条（公司的责任）',
        body: '因公司的故意或过失给旅行者造成损害时，公司承担赔偿责任。但对因旅行者的过失、自由活动期间发生的事故或自然灾害等不可抗力造成的损害，公司不承担责任。',
      },
      {
        title: '第七条（旅行者的责任）',
        body: '因旅行者的故意或过失给公司或他人造成损害时，旅行者承担赔偿责任。旅行者必须备齐旅行所需的个人证件（护照、签证等），因未备齐证件而产生的一切问题由旅行者承担责任。',
      },
    ],
  },
};

const PageSection = ({ title, children, isMobile }: { title: string; children: ReactNode; isMobile?: boolean }) => (
  <section className="mb-8">
    <h2 className={`text-xl font-semibold pb-2 mb-4 border-b-2 ${
      isMobile ? 'text-white border-[#B668FC]/30' : 'text-[#1a1a2e] border-[#c0b283]'
    }`}>{title}</h2>
    <div className={`space-y-4 text-sm leading-relaxed ${isMobile ? 'text-white/50' : 'text-gray-700'}`}>{children}</div>
  </section>
);

export default function TravelTerms() {
  const { language, t, changeLanguage } = useLanguage();
  const isMobile = useIsMobile();
  const content = CONTENT[language as keyof typeof CONTENT] ?? CONTENT.en;

  usePageMeta({
    title: content.pageTitle,
    description: 'CocoTrip travel terms — obligations, fees, cancellation, and responsibilities for overseas travel.',
  });

  return (
    <div className={isMobile ? 'm-page' : 'min-h-screen bg-[#faf9f6]'}>
      <Header language={language} t={t} onLanguageChange={changeLanguage} />
      <main className={`container mx-auto px-4 ${isMobile ? 'pt-6 pb-4' : 'py-16 sm:py-24'}`}>
        <div className={isMobile ? '' : 'max-w-4xl mx-auto bg-white p-8 sm:p-12 rounded-lg shadow-lg'}>
          <h1 className={`text-2xl font-bold text-center mb-8 ${isMobile ? 'm-shimmer-text' : 'text-[#1a1a2e] text-3xl sm:text-4xl sm:mb-12'}`}>{content.pageTitle}</h1>
          
          {content.articles.map((article, idx) => (
            <PageSection key={idx} title={article.title} isMobile={isMobile}>
              {article.body.split('\n\n').map((paragraph, pIdx) => (
                <p key={pIdx} className={paragraph.startsWith('•') ? `pl-4 text-xs ${isMobile ? 'text-white/30' : 'text-gray-600'}` : undefined}>
                  {paragraph}
                </p>
              ))}
            </PageSection>
          ))}
        </div>
      </main>
      {!isMobile && <Footer t={t} />}
    </div>
  );
}
