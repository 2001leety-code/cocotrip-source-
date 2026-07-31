import type { ReactNode } from 'react';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import { CookieSettings } from '@/components/CookieSettings';
import { useLanguage } from '@/hooks/useLanguage';
import { useIsMobile } from '@/hooks/use-mobile';
import { usePageMeta } from '@/hooks/usePageMeta';

// ── 다국어 콘텐츠 ──────────────────────────────────────
const CONTENT = {
  en: {
    pageTitle: 'Privacy Policy',
    articles: [
      {
        title: 'Article 1 (Collected Personal Information)',
        body: "'COCOTRIP' is collecting the following personal information to provide smooth customer consultation and services.",
        list: [
          'Required Items: Full name, contact number (phone number), email address',
          'Optional Items: (For airport pickup) Flight number, other additional requests',
          'Automatically Collected: Service use record, access log, cookie, access IP information',
        ],
      },
      {
        title: 'Article 2 (Purpose of Processing Personal Information)',
        body: "'The Company' uses the collected personal information for the following purposes:",
        list: [
          'Implementation of contracts related to providing travel services and payment settlement',
          'Securing smooth communication channels such as customer consultation and complaint handling',
          'Developing new services, providing customized services, and guidance on event information',
        ],
      },
      {
        title: 'Article 3 (Retention and Use Period of Personal Information)',
        body: "In principle, after the purpose of collecting and using personal information is achieved, the information is destroyed without delay. However, if it is necessary to preserve it according to the provisions of relevant laws, 'the Company' keeps member information for a certain period set by the relevant laws as follows:",
        list: [
          'Records on contracts or withdrawal of subscription: 5 years (Act on Consumer Protection in Electronic Commerce, etc.)',
          'Records on payment and supply of goods: 5 years (Act on Consumer Protection in Electronic Commerce, etc.)',
          'Records on consumer complaints or dispute handling: 3 years (Act on Consumer Protection in Electronic Commerce, etc.)',
        ],
      },
      {
        title: 'Article 4 (Personal Information Protection Officer)',
        body: "'The Company' has designated relevant departments and personal information protection officers as follows to protect customers' personal information and handle complaints related to personal information.",
        contacts: [
          { label: 'Protection Officer', value: 'Kim Hyemi' },
          { label: 'Email', value: 'cocotripkr@gmail.com' },
        ],
        footer: 'If you need advice or report other privacy infringements, please contact the following organizations:',
        footerList: [
          'Privacy Infringement Reporting Center (privacy.kisa.or.kr / 118)',
          "Cyber Investigation Department of the Supreme Prosecutor's Office (www.spo.go.kr / 1301)",
          'Cyber Safety Bureau of the National Police Agency (cyberbureau.police.go.kr / 182)',
        ],
      },
    ],
  },
  ko: {
    pageTitle: '개인정보처리방침',
    articles: [
      {
        title: '제1조 (수집하는 개인정보 항목)',
        body: "'코코트립(COCOTRIP)'은 원활한 고객 상담 및 서비스 제공을 위해 아래와 같은 개인정보를 수집하고 있습니다.",
        list: [
          '필수항목: 성명, 연락처(전화번호), 이메일 주소',
          '선택항목: (공항 픽업 시) 항공편명, 기타 추가 요청사항',
          '자동 수집: 서비스 이용기록, 접속 로그, 쿠키, 접속 IP 정보',
        ],
      },
      {
        title: '제2조 (개인정보 처리 목적)',
        body: "'회사'는 수집한 개인정보를 다음 목적으로 사용합니다:",
        list: [
          '여행 서비스 제공에 따른 계약 이행 및 대금 정산',
          '고객 상담 및 민원 처리 등 원활한 의사소통 경로 확보',
          '신규 서비스 개발, 맞춤형 서비스 제공 및 이벤트 정보 안내',
        ],
      },
      {
        title: '제3조 (개인정보 보유 및 이용 기간)',
        body: "원칙적으로 개인정보의 수집 및 이용 목적이 달성된 후에는 해당 정보를 지체 없이 파기합니다. 다만, 관계 법령의 규정에 의하여 보존할 필요가 있는 경우 '회사'는 아래와 같이 관계 법령에서 정한 일정 기간 동안 회원 정보를 보관합니다:",
        list: [
          '계약 또는 청약철회에 관한 기록: 5년 (전자상거래 등에서의 소비자 보호에 관한 법률)',
          '대금 결제 및 재화 등의 공급에 관한 기록: 5년 (전자상거래 등에서의 소비자 보호에 관한 법률)',
          '소비자 불만 또는 분쟁 처리에 관한 기록: 3년 (전자상거래 등에서의 소비자 보호에 관한 법률)',
        ],
      },
      {
        title: '제4조 (개인정보 보호책임자)',
        body: "'회사'는 고객의 개인정보를 보호하고 개인정보와 관련한 불만을 처리하기 위하여 아래와 같이 관련 부서 및 개인정보보호 책임자를 지정하고 있습니다.",
        contacts: [
          { label: '보호책임자', value: '김혜미' },
          { label: '이메일', value: 'cocotripkr@gmail.com' },
        ],
        footer: '기타 개인정보 침해에 대한 상담이나 신고가 필요하신 경우 아래 기관에 문의하시기 바랍니다:',
        footerList: [
          '개인정보 침해신고센터 (privacy.kisa.or.kr / 118)',
          '대검찰청 사이버수사과 (www.spo.go.kr / 1301)',
          '경찰청 사이버안전국 (cyberbureau.police.go.kr / 182)',
        ],
      },
    ],
  },
  ja: {
    pageTitle: 'プライバシーポリシー',
    articles: [
      {
        title: '第1条（収集する個人情報）',
        body: "「COCOTRIP」は、円滑なカスタマーサポートおよびサービス提供のため、以下の個人情報を収集しています。",
        list: [
          '必須項目：氏名、連絡先（電話番号）、メールアドレス',
          '任意項目：（空港送迎の場合）フライト番号、その他の追加リクエスト',
          '自動収集：サービス利用記録、アクセスログ、Cookie、接続IPアドレス',
        ],
      },
      {
        title: '第2条（個人情報の利用目的）',
        body: "当社は収集した個人情報を以下の目的で使用します：",
        list: [
          '旅行サービス提供に関する契約の履行および代金決済',
          'カスタマーサポートおよび苦情処理など円滑なコミュニケーションチャネルの確保',
          '新サービスの開発、カスタマイズサービスの提供、イベント情報のご案内',
        ],
      },
      {
        title: '第3条（個人情報の保有および利用期間）',
        body: "原則として、個人情報の収集および利用目的が達成された後は、当該情報を遅滞なく破棄します。ただし、関係法令の規定により保存する必要がある場合、当社は以下のとおり関係法令が定める一定期間、会員情報を保管します：",
        list: [
          '契約または申込撤回に関する記録：5年（電子商取引等における消費者保護に関する法律）',
          '代金決済および財貨等の供給に関する記録：5年（電子商取引等における消費者保護に関する法律）',
          '消費者の苦情または紛争処理に関する記録：3年（電子商取引等における消費者保護に関する法律）',
        ],
      },
      {
        title: '第4条（個人情報保護責任者）',
        body: "当社はお客様の個人情報を保護し、個人情報に関する苦情を処理するため、以下のとおり関連部門および個人情報保護責任者を指定しています。",
        contacts: [
          { label: '保護責任者', value: 'Kim Hyemi' },
          { label: 'メール', value: 'cocotripkr@gmail.com' },
        ],
        footer: 'その他の個人情報侵害に関するご相談や通報が必要な場合は、以下の機関にお問い合わせください：',
        footerList: [
          '個人情報侵害申告センター (privacy.kisa.or.kr / 118)',
          '大検察庁サイバー捜査課 (www.spo.go.kr / 1301)',
          '警察庁サイバー安全局 (cyberbureau.police.go.kr / 182)',
        ],
      },
    ],
  },
  zh: {
    pageTitle: '隐私政策',
    articles: [
      {
        title: '第一条（收集的个人信息）',
        body: "「COCOTRIP」为提供顺畅的客户咨询及服务，收集以下个人信息。",
        list: [
          '必填项目：姓名、联系方式（电话号码）、电子邮箱',
          '选填项目：（机场接机时）航班号、其他附加需求',
          '自动收集：服务使用记录、访问日志、Cookie、访问IP信息',
        ],
      },
      {
        title: '第二条（个人信息处理目的）',
        body: "本公司将收集的个人信息用于以下目的：",
        list: [
          '履行与旅行服务提供相关的合同及结算',
          '确保客户咨询及投诉处理等顺畅沟通渠道',
          '开发新服务、提供定制化服务及活动信息通知',
        ],
      },
      {
        title: '第三条（个人信息保留及使用期间）',
        body: "原则上，在个人信息的收集和使用目的达成后，将立即销毁相关信息。但如因相关法律法规需要保存，本公司将按以下规定期限保留会员信息：",
        list: [
          '合同或撤销订阅的记录：5年（电子商务中的消费者保护法等）',
          '付款及商品供应记录：5年（电子商务中的消费者保护法等）',
          '消费者投诉或争议处理记录：3年（电子商务中的消费者保护法等）',
        ],
      },
      {
        title: '第四条（个人信息保护负责人）',
        body: "本公司为保护客户个人信息并处理与个人信息相关的投诉，指定了以下部门及个人信息保护负责人。",
        contacts: [
          { label: '保护负责人', value: 'Kim Hyemi' },
          { label: '电子邮箱', value: 'cocotripkr@gmail.com' },
        ],
        footer: '如需咨询或举报其他隐私侵权行为，请联系以下机构：',
        footerList: [
          '个人信息侵害举报中心 (privacy.kisa.or.kr / 118)',
          '大检察厅网络调查部 (www.spo.go.kr / 1301)',
          '警察厅网络安全局 (cyberbureau.police.go.kr / 182)',
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

type PrivacyArticleExt = ArticleData & {
  list?: string[];
  contacts?: { label: string; value: string }[];
  footer?: string;
  footerList?: string[];
};

export default function Privacy() {
  const { language, t, changeLanguage } = useLanguage();
  const isMobile = useIsMobile();
  const content = CONTENT[language as keyof typeof CONTENT] ||CONTENT.en;

  usePageMeta({
    title: content.pageTitle,
    description: t.pageMeta?.privacy?.description ||'CocoTrip privacy policy — how we collect, use and protect your personal information.',
  });

  return (
    <div className={isMobile ? 'm-page' : 'min-h-screen bg-gradient-to-b from-[#0a0412] via-[#0d0618] to-[#080210]'}>
      <Header language={language} t={t} onLanguageChange={changeLanguage} />
      <main className={`container mx-auto px-4 ${isMobile ? 'pt-6 pb-4' : 'py-16 sm:py-24'}`}>
        <div className={isMobile ? '' : 'max-w-4xl mx-auto bg-white/[0.04] backdrop-blur-md border border-white/[0.08] p-8 sm:p-12 rounded-lg shadow-lg'}>
          <h1 className={`text-2xl font-bold text-center mb-8 ${isMobile ? 'm-shimmer-text' : 'text-white text-4xl sm:text-5xl sm:mb-12 font-display font-normal tracking-tight'}`}>{content.pageTitle}</h1>

          {/* 🔴 2026-07-30 (P1-1): 쿠키·분석 설정 진입점.
              Footer 에도 넣었지만 **모바일 화면 일부는 Footer 를 렌더하지 않는다**(이 페이지 포함,
              모바일 홈·About 도 마찬가지). 개인정보 처리방침은 쿠키 배너와 모든 푸터가 링크하는
              곳이라, 여기 두면 어느 화면에서든 도달할 수 있다. */}
          <div className="mb-8 flex justify-center">
            <CookieSettings className="inline-flex min-h-[44px] items-center rounded-xl border border-[#B668FC]/40 bg-[#B668FC]/10 px-4 text-[13px] font-semibold text-white hover:bg-[#B668FC]/20 transition-colors" />
          </div>

          {content.articles.map((article: ArticleData, idx: number) => {
            const a = article as PrivacyArticleExt;
            return (
            <PageSection key={idx} title={a.title} isMobile={isMobile}>
              <p>{a.body}</p>
              {a.list && (
                <ul className={`list-disc list-inside space-y-2 ${isMobile ? 'text-white/55' : ''}`}>
                  {a.list.map((item: string, i: number) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              )}
              {a.contacts && (
                <ul className={`list-none space-y-2 ${isMobile ? 'text-white/55' : ''}`}>
                  {a.contacts.map((c, i: number) => (
                    <li key={i}><strong>{c.label}:</strong> {c.value}</li>
                  ))}
                </ul>
              )}
              {a.footer && (
                <>
                  <p>{a.footer}</p>
                  <ul className={`list-disc list-inside space-y-2 ${isMobile ? 'text-white/55' : ''}`}>
                    {(a.footerList || []).map((item: string, i: number) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </>
              )}
            </PageSection>
            );
          })}
        </div>
      </main>
      {!isMobile && <Footer t={t} />}
    </div>
  );
}
