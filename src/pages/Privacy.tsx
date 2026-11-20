import '@/styles/home-dope.css';
import '@/styles/home-dope-static.css';
import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
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
        body: "주식회사 코코트립 (COCOTRIP, hereinafter referred to as the 'Company') collects the following personal information to provide smooth customer consultation and services.",
        list: [
          'Required Items: Full name, contact number (phone number), email address',
          'Optional Items: Messenger app and ID (WhatsApp, KakaoTalk, LINE, WeChat), (for airport pickup) flight number, arrival time and number of bags, other additional requests',
          'When planning or booking a trip: Travel dates and cities, number of travelers and who you travel with, accommodation address, pickup or meeting place, flight arrival and departure times, dietary requirements (halal, vegan, vegetarian) and food preferences, travel preferences',
          'When signing in: Name, email address and profile photo of your Google or LINE account; your phone number if you sign in with it',
          "When paying: Payment amount, PayPal transaction ID, payer's name and email address (payment details such as card numbers are entered directly with PayPal; the 'Company' does not receive them)",
          'When writing reviews or chatting: Review text and photos, AI chat conversations',
          'Automatically Collected: Service use record, access log, cookie, access IP information',
        ],
      },
      {
        title: 'Article 2 (Purpose of Processing Personal Information)',
        body: "The 'Company' uses the collected personal information for the following purposes:",
        list: [
          'Implementation of contracts related to providing travel services and payment settlement',
          'Securing smooth communication channels such as customer consultation and complaint handling',
          'Developing new services, providing customized services, and guidance on event information',
        ],
      },
      {
        title: 'Article 3 (Retention and Use Period of Personal Information)',
        body: "In principle, after the purpose of collecting and using personal information is achieved, the information is destroyed without delay. However, if it is necessary to preserve it according to the provisions of relevant laws, the 'Company' keeps member information for a certain period set by the relevant laws as follows:",
        list: [
          'Records on contracts or withdrawal of subscription: 5 years (Act on Consumer Protection in Electronic Commerce, etc.)',
          'Records on payment and supply of goods: 5 years (Act on Consumer Protection in Electronic Commerce, etc.)',
          'Records on consumer complaints or dispute handling: 3 years (Act on Consumer Protection in Electronic Commerce, etc.)',
        ],
      },
      {
        title: 'Article 4 (Procedure and Method of Destroying Personal Information)',
        body: "When the retention period ends or the purpose of processing is achieved and personal information is no longer needed, the 'Company' destroys it without delay.",
        list: [
          'Procedure: Personal information to be destroyed is selected and destroyed with the approval of the Personal Information Protection Officer.',
          'Retention required by law: Personal information that other laws require to be kept, as in Article 3, is stored separately from other personal information only for that period and then destroyed.',
          'Method: Electronic files are deleted so that they cannot be restored, and personal information printed on paper is shredded or incinerated.',
        ],
      },
      {
        title: 'Article 5 (Entrustment of Personal Information Processing)',
        body: "To provide its services smoothly, the 'Company' entrusts the processing of personal information as follows. When entrusting, the 'Company' sets out, in accordance with Article 26 of the Personal Information Protection Act, a ban on processing for purposes other than the entrusted work, safeguards, limits on re-entrustment and responsibility such as compensation for damages, and supervises whether the entrusted companies process personal information safely. If the entrusted work or the entrusted companies change, the 'Company' will announce it through this Privacy Policy.",
        list: [
          'Google LLC: Member sign-in, storage of booking and itinerary information and review photos, booking emails, booking records, AI itinerary planning, translation and chat, mobile booking pass, visit analytics (with consent)',
          'Anthropic PBC: AI itinerary planning, editing, translation and chat',
          'Vercel Inc.: Operation of the website and servers',
          'PayPal Pte. Ltd.: Payment processing and refunds',
          'Inngest Inc.: Finishing work after AI itinerary planning',
          'Functional Software, Inc. (Sentry): Checking service errors',
          "Telegram Messenger Inc.: Delivering booking and inquiry notifications to staff of the 'Company' and drivers",
          "Discord Inc.: Delivering notifications to staff of the 'Company'",
          'PostHog Inc.: Visit analytics (with consent)',
        ],
      },
      {
        title: 'Article 6 (Overseas Transfer of Personal Information)',
        body: "To provide its services, the 'Company' transfers personal information overseas to the entrusted companies in Article 5 as follows (Article 28-8 of the Personal Information Protection Act).",
        list: [
          'Google LLC (USA, googlekrsupport@google.com) — Items: all personal information in Article 1 / Purpose: sign-in, data storage, emails, booking records, AI itinerary planning, visit analytics (with consent)',
          'Anthropic PBC (USA, privacy@anthropic.com) — Items: name, trip details (dates, cities, number of travelers, accommodation address, flight times, dietary requirements, requests), AI chat conversations / Purpose: AI itinerary planning, editing, translation and chat',
          'Vercel Inc. (USA, privacy@vercel.com) — Items: personal information exchanged while using the service, access records (IP address, etc.) / Purpose: operation of the website and servers',
          'PayPal Pte. Ltd. (Singapore, paypal.com/kr) — Items: payment amount, order details (product, dates, number of travelers), refund details / Purpose: payment processing and refunds',
          'Inngest Inc. (USA, hello@inngest.com) — Items: name, email address, member ID, trip dates, number of travelers, dietary requirements, requests / Purpose: finishing work after AI itinerary planning',
          'Functional Software, Inc. (Sentry) (USA, compliance@sentry.io) — Items: error details, address of the page where the error occurred, device and browser information, access IP information / Purpose: checking service errors',
          "Telegram Messenger Inc. (United Arab Emirates, telegram.org/support) — Items: name, contact number, email address, pickup and drop-off places, flight number, requests, inquiry and chat content / Purpose: delivering booking and inquiry notifications to staff of the 'Company' and drivers",
          "Discord Inc. (USA, privacy@discord.com) — Items: the same items as the Telegram notifications / Purpose: delivering notifications to staff of the 'Company'",
          'PostHog Inc. (USA, privacy@posthog.com) — Items: pages visited, device and browser information, cookie ID / Purpose: visit analytics (with consent)',
        ],
        contacts: [
          { label: 'Time and method of transfer', value: 'Sent over the network whenever the service is used' },
          { label: 'Retention and use period', value: 'Until the retention period in Article 3 ends or the entrustment contract ends' },
          { label: 'How to refuse and its effect', value: "You can refuse the overseas transfer by emailing the Protection Officer in Article 10. However, the companies above are essential for sign-in, booking, payment and itinerary planning, so if you refuse, you cannot use those services. You can refuse visit analytics (Google Analytics, PostHog) at any time in 'Cookie & analytics settings', and refusing does not limit your use of the service." },
        ],
      },
      {
        title: 'Article 7 (Rights and Obligations of Data Subjects and How to Exercise Them)',
        body: "You may at any time ask the 'Company' to let you view, correct, delete or stop processing your personal information, or withdraw your consent.",
        list: [
          "Viewing: You can see the personal information the 'Company' holds about you and how it is processed.",
          'Correction and deletion: You can ask for wrong personal information to be corrected or for your personal information to be deleted. However, you cannot ask for the deletion of personal information that other laws require to be kept.',
          "Suspension and withdrawal of consent: You can ask the 'Company' to stop processing your personal information or withdraw your consent. The 'Company' may refuse in cases set by law, and will tell you the reason.",
        ],
        footer: 'You can exercise these rights as follows:',
        footerList: [
          "Email the Personal Information Protection Officer in Article 10 (cocotripkr@gmail.com). The 'Company' will act within 10 days and tell you the result.",
          'You can also make a request through a representative, such as a legal representative or a person you have authorized. In that case, please send a power of attorney with the request.',
          "The 'Company' checks that the person making the request is you or your rightful representative.",
          "Please enter your own personal information accurately and do not enter other people's personal information. When you enter details of people traveling with you, please get their consent first.",
        ],
      },
      {
        title: 'Article 8 (Measures to Ensure the Safety of Personal Information)',
        body: "The 'Company' takes the following measures to process personal information safely.",
        list: [
          'Administrative: Only the minimum number of people who need it can handle personal information.',
          'Technical: All communication between the website and the servers is encrypted (HTTPS); database access rules let members reach only their own information; administrator functions are limited to designated accounts.',
          "No storage of payment details or passwords: Payment details such as card numbers are handled directly by PayPal, and sign-in uses Google, LINE or phone number verification, so the 'Company' does not keep this information or any passwords.",
          'Physical: Personal information is stored in the data centers of the entrusted company (Google), which control physical access and encrypt stored data.',
        ],
      },
      {
        title: 'Article 9 (Installation, Operation and Refusal of Cookies and Other Automatic Collection Tools)',
        body: "The 'Company' uses cookies and browser storage to remember information needed for the service and to measure visits. A cookie is a small piece of information that a website sends to your browser and that is stored on your device.",
        list: [
          'Essential storage: Remembers your sign-in, the itinerary and cart you are working on, and your language and cookie settings. It is needed to use the service, so it is used regardless of your cookie settings.',
          "Visit analytics (Google Analytics, PostHog): Collects the pages you visit, how you arrived, and device and browser information to improve the service. It is used only if you choose 'Accept' in the cookie notice.",
        ],
        footer: 'How to refuse:',
        footerList: [
          "Use 'Cookie & analytics settings' at the top of this page to allow or refuse visit analytics, or to withdraw your consent, at any time.",
          'You can refuse or delete cookies in your web browser settings. If you also block essential storage, some features such as sign-in may not work.',
        ],
      },
      {
        title: 'Article 10 (Personal Information Protection Officer)',
        body: "The 'Company' has designated relevant departments and personal information protection officers as follows to protect customers' personal information and handle complaints related to personal information.",
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
      {
        title: 'Article 11 (Changes to This Privacy Policy)',
        body: 'This Privacy Policy applies from November 20, 2026. If it changes, the change will be announced on the website.',
        list: [
          'November 20, 2026: Added the articles on destruction, entrustment, overseas transfer, data subject rights, safety measures, cookies and changes to this policy, and completed the list of collected items. The Protection Officer article moved from Article 4 to Article 10.',
          'Previous versions: Available on request from the Personal Information Protection Officer.',
        ],
      },
    ],
  },
  ko: {
    pageTitle: '개인정보처리방침',
    articles: [
      {
        title: '제1조 (수집하는 개인정보 항목)',
        body: "주식회사 코코트립(이하 '회사')은 원활한 고객 상담 및 서비스 제공을 위해 아래와 같은 개인정보를 수집하고 있습니다.",
        list: [
          '필수항목: 성명, 연락처(전화번호), 이메일 주소',
          '선택항목: 메신저 종류와 아이디(WhatsApp·카카오톡·LINE·WeChat), (공항 픽업 시) 항공편명·도착 시각·짐 개수, 기타 추가 요청사항',
          '여행 일정 작성·예약 시: 여행 날짜와 도시, 인원과 동행 유형, 숙소 주소, 픽업·만남 장소, 항공편 도착·출발 시각, 식이 조건(할랄·비건·채식)과 음식 취향, 여행 취향',
          '로그인 시: Google·LINE 계정의 이름·이메일·프로필 사진, 전화번호로 로그인하는 경우 전화번호',
          "결제 시: 결제 금액, PayPal 거래 번호, 결제자 이름·이메일(카드 번호 등 결제 수단 정보는 PayPal이 직접 받으며 '회사'는 받지 않습니다)",
          '후기·상담 이용 시: 후기 내용과 사진, AI 상담 대화 내용',
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
        title: '제4조 (개인정보의 파기 절차 및 방법)',
        body: "'회사'는 개인정보 보유 기간이 끝나거나 처리 목적을 이루어 개인정보가 필요 없게 되면 지체 없이 그 개인정보를 파기합니다.",
        list: [
          '파기 절차: 파기할 개인정보를 골라 개인정보 보호책임자의 승인을 받아 파기합니다.',
          '법령에 따른 보존: 제3조와 같이 다른 법령에 따라 보존해야 하는 개인정보는 다른 개인정보와 분리하여 그 기간 동안만 보관한 뒤 파기합니다.',
          '파기 방법: 전자 파일은 되살릴 수 없는 방법으로 지우고, 종이에 출력된 개인정보는 분쇄하거나 소각합니다.',
        ],
      },
      {
        title: '제5조 (개인정보 처리업무의 위탁)',
        body: "'회사'는 원활한 서비스 제공을 위해 아래와 같이 개인정보 처리업무를 위탁하고 있습니다. 위탁 계약 시 「개인정보 보호법」 제26조에 따라 위탁 업무 수행 목적 외 개인정보 처리 금지, 안전성 확보 조치, 재위탁 제한, 손해배상 등 책임에 관한 사항을 정하고, 수탁자가 개인정보를 안전하게 처리하는지 감독합니다. 위탁 업무의 내용이나 수탁자가 바뀌면 이 개인정보처리방침을 통해 알리겠습니다.",
        list: [
          'Google LLC: 회원 로그인, 예약·일정 정보와 후기 사진 저장, 예약 안내 메일 발송, 예약 관리 장부, AI 여행 일정 작성·번역·상담, 모바일 예약 확인 카드, 방문 통계(동의한 경우)',
          'Anthropic PBC: AI 여행 일정 작성·수정·번역·상담',
          'Vercel Inc.: 웹사이트와 서버 운영',
          'PayPal Pte. Ltd.: 결제 처리 및 환불',
          'Inngest Inc.: AI 여행 일정 작성 후 마무리 작업 처리',
          'Functional Software, Inc.(Sentry): 서비스 오류 확인',
          "Telegram Messenger Inc.: '회사' 직원과 기사에게 예약·문의 알림 전달",
          "Discord Inc.: '회사' 직원에게 알림 전달",
          'PostHog Inc.: 방문 통계(동의한 경우)',
        ],
      },
      {
        title: '제6조 (개인정보의 국외 이전)',
        body: "'회사'는 서비스 제공을 위해 제5조의 수탁자에게 아래와 같이 개인정보를 국외로 이전합니다(「개인정보 보호법」 제28조의8).",
        list: [
          'Google LLC(미국, googlekrsupport@google.com) — 항목: 제1조의 개인정보 전부 / 목적: 로그인, 정보 저장, 메일 발송, 예약 관리, AI 여행 일정 작성, 방문 통계(동의한 경우)',
          'Anthropic PBC(미국, privacy@anthropic.com) — 항목: 이름, 여행 정보(날짜·도시·인원·숙소 주소·항공편 시각·식이 조건·요청사항), AI 상담 대화 / 목적: AI 여행 일정 작성·수정·번역·상담',
          'Vercel Inc.(미국, privacy@vercel.com) — 항목: 서비스 이용 중 주고받는 개인정보, 접속 기록(IP 주소 등) / 목적: 웹사이트와 서버 운영',
          'PayPal Pte. Ltd.(싱가포르, paypal.com/kr) — 항목: 결제 금액, 주문 내용(상품·날짜·인원), 환불 내용 / 목적: 결제 처리 및 환불',
          'Inngest Inc.(미국, hello@inngest.com) — 항목: 이름, 이메일, 회원 번호, 여행 날짜, 인원, 식이 조건, 요청사항 / 목적: AI 여행 일정 작성 후 마무리 작업',
          'Functional Software, Inc.(Sentry, 미국, compliance@sentry.io) — 항목: 오류 내용, 오류가 난 화면 주소, 기기·브라우저 정보, 접속 IP 정보 / 목적: 서비스 오류 확인',
          "Telegram Messenger Inc.(아랍에미리트, telegram.org/support) — 항목: 성명, 연락처, 이메일, 픽업·하차 장소, 항공편명, 요청사항, 문의·상담 내용 / 목적: '회사' 직원과 기사에게 예약·문의 알림 전달",
          "Discord Inc.(미국, privacy@discord.com) — 항목: 텔레그램 알림과 같은 항목 / 목적: '회사' 직원에게 알림 전달",
          'PostHog Inc.(미국, privacy@posthog.com) — 항목: 방문한 화면, 기기·브라우저 정보, 쿠키 아이디 / 목적: 방문 통계(동의한 경우)',
        ],
        contacts: [
          { label: '이전 일시 및 방법', value: '서비스를 이용할 때 정보통신망을 통해 수시로 전송' },
          { label: '보유 및 이용 기간', value: '제3조의 보유 기간이 끝나거나 위탁 계약이 끝날 때까지' },
          { label: '이전 거부 방법 및 효과', value: "제10조의 보호책임자에게 이메일로 국외 이전을 거부할 수 있습니다. 다만 위 업체들은 로그인·예약·결제·일정 작성에 꼭 필요하여, 거부하시면 해당 서비스를 이용하실 수 없습니다. 방문 통계(Google Analytics·PostHog)는 '쿠키·분석 설정'에서 언제든 거부할 수 있으며, 거부해도 서비스 이용에 제한이 없습니다." },
        ],
      },
      {
        title: '제7조 (정보주체의 권리·의무 및 행사 방법)',
        body: "정보주체는 '회사'에 대해 언제든지 개인정보 열람·정정·삭제·처리정지를 요구하거나 동의를 철회할 수 있습니다.",
        list: [
          "열람 요구: '회사'가 가진 본인의 개인정보와 그 처리 내용을 볼 수 있습니다.",
          '정정·삭제 요구: 잘못된 개인정보를 고치거나 개인정보를 지우도록 요구할 수 있습니다. 다만 다른 법령에서 보존하도록 정한 개인정보는 삭제를 요구할 수 없습니다.',
          "처리정지 요구 및 동의 철회: 개인정보 처리를 멈추거나 동의를 거두도록 요구할 수 있습니다. 다만 법령에서 정한 경우에는 '회사'가 요구를 거절할 수 있으며, 이때 그 이유를 알려 드립니다.",
        ],
        footer: '권리는 다음과 같이 행사하실 수 있습니다:',
        footerList: [
          "제10조의 개인정보 보호책임자에게 이메일(cocotripkr@gmail.com)로 요청하시면 '회사'는 10일 이내에 조치하고 결과를 알려 드립니다.",
          '법정대리인이나 위임을 받은 사람 등 대리인을 통해서도 요청할 수 있으며, 이 경우 위임장을 함께 보내 주셔야 합니다.',
          "'회사'는 요청한 사람이 본인이거나 정당한 대리인인지 확인합니다.",
          '정보주체는 자신의 개인정보를 정확하게 입력해야 하며 다른 사람의 개인정보를 입력해서는 안 됩니다. 함께 여행하는 분의 정보를 입력할 때는 먼저 그분의 동의를 받아 주십시오.',
        ],
      },
      {
        title: '제8조 (개인정보의 안전성 확보 조치)',
        body: "'회사'는 개인정보를 안전하게 처리하기 위해 다음과 같은 조치를 하고 있습니다.",
        list: [
          '관리적 조치: 개인정보를 다룰 수 있는 사람을 꼭 필요한 최소 인원으로 정하고 있습니다.',
          '기술적 조치: 웹사이트와 서버 사이의 모든 통신을 암호화(HTTPS)하고, 회원은 본인 정보에만 접근할 수 있도록 데이터베이스 접근 권한을 제한하며, 관리자 기능은 지정된 계정만 쓸 수 있습니다.',
          "결제 정보·비밀번호 미보관: 카드 번호 등 결제 수단 정보는 PayPal이 직접 처리하고 로그인은 Google·LINE·전화번호 인증으로 하므로, '회사'는 이 정보와 비밀번호를 보관하지 않습니다.",
          '물리적 조치: 개인정보는 출입을 통제하고 저장된 정보를 암호화하는 수탁자(Google)의 데이터센터에 보관합니다.',
        ],
      },
      {
        title: '제9조 (쿠키 등 개인정보 자동 수집 장치의 설치·운영 및 거부)',
        body: "'회사'는 서비스 이용에 필요한 정보를 기억하고 방문 통계를 내기 위해 쿠키와 브라우저 저장소를 사용합니다. 쿠키는 웹사이트가 이용자의 브라우저에 보내 기기에 저장되는 작은 정보입니다.",
        list: [
          '꼭 필요한 저장: 로그인 상태, 작성 중인 여행 일정과 장바구니, 언어와 쿠키 설정을 기억합니다. 서비스 이용에 꼭 필요하므로 쿠키 설정과 관계없이 사용합니다.',
          "방문 통계(Google Analytics·PostHog): 방문한 화면, 유입 경로, 기기·브라우저 정보를 모아 서비스 개선에 씁니다. 쿠키 안내에서 '동의'를 누른 경우에만 사용합니다.",
        ],
        footer: '거부 방법:',
        footerList: [
          "이 페이지 위쪽의 '쿠키·분석 설정'에서 방문 통계를 언제든 허용하거나 거부하고, 동의를 철회할 수 있습니다.",
          '웹 브라우저 설정에서 쿠키 저장을 거부하거나 저장된 쿠키를 지울 수 있습니다. 다만 꼭 필요한 저장까지 막으면 로그인 등 일부 기능을 쓰지 못할 수 있습니다.',
        ],
      },
      {
        title: '제10조 (개인정보 보호책임자)',
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
      {
        title: '제11조 (개인정보처리방침의 변경)',
        body: '이 개인정보처리방침은 2026년 11월 20일부터 적용됩니다. 내용이 바뀌면 웹사이트를 통해 알리겠습니다.',
        list: [
          '2026년 11월 20일: 개인정보 파기, 처리 위탁, 국외 이전, 정보주체의 권리, 안전성 확보 조치, 쿠키, 처리방침 변경 조항을 새로 넣고 수집 항목을 보완했습니다. 보호책임자 조항은 제4조에서 제10조로 옮겼습니다.',
          '이전 개인정보처리방침: 개인정보 보호책임자에게 요청하시면 보내 드립니다.',
        ],
      },
    ],
  },
  ja: {
    pageTitle: 'プライバシーポリシー',
    articles: [
      {
        title: '第1条（収集する個人情報）',
        body: "주식회사 코코트립（COCOTRIP、以下「当社」）は、円滑なカスタマーサポートおよびサービス提供のため、以下の個人情報を収集しています。",
        list: [
          '必須項目：氏名、連絡先（電話番号）、メールアドレス',
          '任意項目：メッセンジャーの種類とID（WhatsApp・カカオトーク・LINE・WeChat）、（空港送迎の場合）フライト番号・到着時刻・荷物の数、その他の追加リクエスト',
          '旅行プランの作成・予約時：旅行の日程と都市、人数と同行者の種類、宿泊先の住所、送迎・待ち合わせ場所、フライトの到着・出発時刻、食事制限（ハラール・ヴィーガン・ベジタリアン）と食の好み、旅行の好み',
          'ログイン時：GoogleまたはLINEアカウントの氏名・メールアドレス・プロフィール写真、電話番号でログインする場合は電話番号',
          '決済時：決済金額、PayPal取引番号、支払者の氏名・メールアドレス（カード番号などの決済手段の情報はPayPalが直接受け取り、当社は受け取りません）',
          'レビュー・相談のご利用時：レビューの内容と写真、AIチャットの会話内容',
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
        title: '第4条（個人情報の破棄の手続きおよび方法）',
        body: '当社は、個人情報の保有期間が終了した場合、または処理目的が達成され個人情報が不要になった場合は、遅滞なく当該個人情報を破棄します。',
        list: [
          '破棄の手続き：破棄する個人情報を選定し、個人情報保護責任者の承認を得て破棄します。',
          '法令による保存：第3条のとおり他の法令により保存が必要な個人情報は、他の個人情報と分けてその期間のみ保管した後に破棄します。',
          '破棄の方法：電子ファイルは復元できない方法で削除し、紙に印刷された個人情報は粉砕または焼却します。',
        ],
      },
      {
        title: '第5条（個人情報の処理業務の委託）',
        body: '当社は、円滑なサービス提供のため、以下のとおり個人情報の処理業務を委託しています。委託契約の際は、韓国「個人情報保護法」第26条に基づき、委託業務の目的以外の処理の禁止、安全性確保措置、再委託の制限、損害賠償などの責任に関する事項を定め、受託者が個人情報を安全に処理しているかを監督します。委託業務の内容または受託者が変わった場合は、本プライバシーポリシーでお知らせします。',
        list: [
          'Google LLC：会員ログイン、予約・旅行プラン情報とレビュー写真の保存、予約案内メールの送信、予約管理台帳、AIによる旅行プランの作成・翻訳・相談、モバイル予約確認カード、訪問統計（同意した場合）',
          'Anthropic PBC：AIによる旅行プランの作成・修正・翻訳・相談',
          'Vercel Inc.：ウェブサイトとサーバーの運用',
          'PayPal Pte. Ltd.：決済処理および返金',
          'Inngest Inc.：AIによる旅行プラン作成後の仕上げ処理',
          'Functional Software, Inc.（Sentry）：サービスエラーの確認',
          'Telegram Messenger Inc.：予約・お問い合わせの通知を当社スタッフとドライバーに送信',
          'Discord Inc.：当社スタッフへの通知の送信',
          'PostHog Inc.：訪問統計（同意した場合）',
        ],
      },
      {
        title: '第6条（個人情報の国外移転）',
        body: '当社は、サービス提供のため、第5条の受託者に以下のとおり個人情報を国外へ移転しています（韓国「個人情報保護法」第28条の8）。',
        list: [
          'Google LLC（米国、googlekrsupport@google.com）— 項目：第1条の個人情報すべて／目的：ログイン、情報の保存、メール送信、予約管理、AIによる旅行プラン作成、訪問統計（同意した場合）',
          'Anthropic PBC（米国、privacy@anthropic.com）— 項目：氏名、旅行情報（日程・都市・人数・宿泊先の住所・フライト時刻・食事制限・リクエスト）、AIチャットの会話内容／目的：AIによる旅行プランの作成・修正・翻訳・相談',
          'Vercel Inc.（米国、privacy@vercel.com）— 項目：サービス利用中にやり取りされる個人情報、アクセス記録（IPアドレスなど）／目的：ウェブサイトとサーバーの運用',
          'PayPal Pte. Ltd.（シンガポール、paypal.com/kr）— 項目：決済金額、注文内容（商品・日付・人数）、返金内容／目的：決済処理および返金',
          'Inngest Inc.（米国、hello@inngest.com）— 項目：氏名、メールアドレス、会員番号、旅行日、人数、食事制限、リクエスト／目的：AIによる旅行プラン作成後の仕上げ処理',
          'Functional Software, Inc.（Sentry、米国、compliance@sentry.io）— 項目：エラーの内容、エラーが発生したページのアドレス、端末・ブラウザ情報、接続IPアドレス／目的：サービスエラーの確認',
          'Telegram Messenger Inc.（アラブ首長国連邦、telegram.org/support）— 項目：氏名、連絡先、メールアドレス、乗車・降車場所、フライト番号、リクエスト、お問い合わせ・相談内容／目的：予約・お問い合わせの通知を当社スタッフとドライバーに送信',
          'Discord Inc.（米国、privacy@discord.com）— 項目：Telegram通知と同じ項目／目的：当社スタッフへの通知の送信',
          'PostHog Inc.（米国、privacy@posthog.com）— 項目：閲覧したページ、端末・ブラウザ情報、Cookie ID／目的：訪問統計（同意した場合）',
        ],
        contacts: [
          { label: '移転の日時および方法', value: 'サービス利用時にネットワークを通じて随時送信' },
          { label: '保有および利用期間', value: '第3条の保有期間が終了するか、委託契約が終了するまで' },
          { label: '移転の拒否方法および効果', value: '第10条の保護責任者へのメールで国外移転を拒否できます。ただし、上記の事業者はログイン・予約・決済・旅行プラン作成に欠かせないため、拒否された場合は該当サービスをご利用いただけません。訪問統計（Google Analytics・PostHog）は「Cookie・分析設定」からいつでも拒否でき、拒否してもサービスの利用に制限はありません。' },
        ],
      },
      {
        title: '第7条（情報主体の権利・義務およびその行使方法）',
        body: 'お客様は当社に対し、いつでも個人情報の閲覧・訂正・削除・処理停止を求め、または同意を撤回することができます。',
        list: [
          '閲覧の請求：当社が保有するご自身の個人情報とその処理内容を確認できます。',
          '訂正・削除の請求：誤った個人情報の訂正、または個人情報の削除を求めることができます。ただし、他の法令で保存が定められている個人情報は削除を求めることができません。',
          '処理停止の請求および同意の撤回：個人情報の処理の停止、または同意の撤回を求めることができます。法令で定める場合は当社が請求をお断りすることがあり、その際は理由をお知らせします。',
        ],
        footer: '権利は次の方法で行使できます：',
        footerList: [
          '第10条の個人情報保護責任者にメール（cocotripkr@gmail.com）でご請求ください。当社は10日以内に対応し、結果をお知らせします。',
          '法定代理人や委任を受けた方などの代理人を通じて請求することもできます。この場合は委任状を添えてお送りください。',
          '当社は、請求者がご本人または正当な代理人であることを確認します。',
          'ご自身の個人情報は正確に入力し、他人の個人情報を入力しないでください。同行者の情報を入力する場合は、事前にその方の同意を得てください。',
        ],
      },
      {
        title: '第8条（個人情報の安全性確保措置）',
        body: '当社は、個人情報を安全に処理するため、以下の措置を講じています。',
        list: [
          '管理的措置：個人情報を取り扱う者を必要最小限に限定しています。',
          '技術的措置：ウェブサイトとサーバー間のすべての通信を暗号化（HTTPS）し、会員がご自身の情報にのみアクセスできるようデータベースのアクセス権限を制限し、管理者機能は指定されたアカウントのみが使用できます。',
          '決済情報・パスワードの非保管：カード番号などの決済手段の情報はPayPalが直接処理し、ログインはGoogle・LINE・電話番号認証で行うため、当社はこれらの情報およびパスワードを保管しません。',
          '物理的措置：個人情報は、入退室を管理し保存データを暗号化している受託者（Google）のデータセンターに保管しています。',
        ],
      },
      {
        title: '第9条（Cookieなど個人情報の自動収集装置の設置・運用および拒否）',
        body: '当社は、サービスの利用に必要な情報を記憶し、訪問統計をとるために、Cookieとブラウザのストレージを使用します。Cookieとは、ウェブサイトがお客様のブラウザに送信し、端末に保存される小さな情報です。',
        list: [
          '必須の保存：ログイン状態、作成中の旅行プランとカート、言語とCookie設定を記憶します。サービスの利用に欠かせないため、Cookie設定にかかわらず使用します。',
          '訪問統計（Google Analytics・PostHog）：閲覧したページ、流入経路、端末・ブラウザ情報を収集し、サービスの改善に使います。Cookieのお知らせで「同意する」を選んだ場合にのみ使用します。',
        ],
        footer: '拒否の方法：',
        footerList: [
          'このページ上部の「Cookie・分析設定」から、訪問統計の許可・拒否や同意の撤回をいつでも行えます。',
          'ウェブブラウザの設定でCookieの保存を拒否したり、保存されたCookieを削除したりできます。ただし、必須の保存まで拒否すると、ログインなど一部の機能がご利用いただけない場合があります。',
        ],
      },
      {
        title: '第10条（個人情報保護責任者）',
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
      {
        title: '第11条（プライバシーポリシーの変更）',
        body: '本プライバシーポリシーは2026年11月20日から適用されます。内容が変更される場合は、ウェブサイトでお知らせします。',
        list: [
          '2026年11月20日：個人情報の破棄、処理の委託、国外移転、情報主体の権利、安全性確保措置、Cookie、ポリシー変更の条項を追加し、収集項目を補いました。個人情報保護責任者の条項は第4条から第10条に移りました。',
          '以前のポリシー：個人情報保護責任者にご請求いただければお送りします。',
        ],
      },
    ],
  },
  zh: {
    pageTitle: '隐私政策',
    articles: [
      {
        title: '第一条（收集的个人信息）',
        body: '주식회사 코코트립（COCOTRIP，以下简称"本公司"）为提供顺畅的客户咨询及服务，收集以下个人信息。',
        list: [
          '必填项目：姓名、联系方式（电话号码）、电子邮箱',
          '选填项目：即时通讯软件类型及账号（WhatsApp、KakaoTalk、LINE、微信）、（机场接机时）航班号、到达时间及行李件数、其他附加需求',
          '制定行程或预订时：旅行日期及城市、人数及同行类型、住宿地址、接送或碰面地点、航班到达及出发时间、饮食限制（清真、纯素、素食）及饮食偏好、旅行偏好',
          '登录时：Google或LINE账号的姓名、电子邮箱及头像；使用手机号登录时的手机号码',
          '付款时：付款金额、PayPal交易编号、付款人姓名及电子邮箱（银行卡号等支付信息由PayPal直接接收，本公司不接收）',
          '撰写评价或咨询时：评价内容及照片、AI聊天对话内容',
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
        title: '第四条（个人信息的销毁程序及方法）',
        body: '个人信息的保留期限届满，或处理目的已实现、不再需要该个人信息时，本公司将立即销毁该个人信息。',
        list: [
          '销毁程序：选定需销毁的个人信息，经个人信息保护负责人批准后销毁。',
          '依法保存：如第三条所述，根据其他法律法规需保存的个人信息，将与其他个人信息分开保管，仅在规定期限内保存，期满后销毁。',
          '销毁方法：电子文件以无法恢复的方式删除；打印在纸上的个人信息予以粉碎或焚烧。',
        ],
      },
      {
        title: '第五条（个人信息处理业务的委托）',
        body: '为顺利提供服务，本公司将个人信息处理业务委托如下。签订委托合同时，本公司依据韩国《个人信息保护法》第26条，明确禁止将个人信息用于委托业务以外的目的、安全保障措施、再委托限制及损害赔偿等责任事项，并监督受托方是否安全处理个人信息。委托业务内容或受托方发生变更时，本公司将通过本隐私政策告知。',
        list: [
          'Google LLC：会员登录、预订及行程信息与评价照片的存储、预订通知邮件发送、预订管理台账、AI行程制定、翻译及咨询、移动端预订确认卡、访问统计（经同意时）',
          'Anthropic PBC：AI行程的制定、修改、翻译及咨询',
          'Vercel Inc.：网站及服务器运营',
          'PayPal Pte. Ltd.：支付处理及退款',
          'Inngest Inc.：AI行程制定后的收尾处理',
          'Functional Software, Inc.（Sentry）：服务错误排查',
          'Telegram Messenger Inc.：向本公司员工及司机发送预订及咨询通知',
          'Discord Inc.：向本公司员工发送通知',
          'PostHog Inc.：访问统计（经同意时）',
        ],
      },
      {
        title: '第六条（个人信息的跨境转移）',
        body: '为提供服务，本公司将个人信息转移至境外的第五条受托方，具体如下（韩国《个人信息保护法》第28条之8）。',
        list: [
          'Google LLC（美国，googlekrsupport@google.com）— 项目：第一条所列全部个人信息／目的：登录、信息存储、邮件发送、预订管理、AI行程制定、访问统计（经同意时）',
          'Anthropic PBC（美国，privacy@anthropic.com）— 项目：姓名、行程信息（日期、城市、人数、住宿地址、航班时间、饮食限制、需求）、AI聊天对话内容／目的：AI行程的制定、修改、翻译及咨询',
          'Vercel Inc.（美国，privacy@vercel.com）— 项目：使用服务过程中传输的个人信息、访问记录（IP地址等）／目的：网站及服务器运营',
          'PayPal Pte. Ltd.（新加坡，paypal.com/kr）— 项目：付款金额、订单内容（产品、日期、人数）、退款内容／目的：支付处理及退款',
          'Inngest Inc.（美国，hello@inngest.com）— 项目：姓名、电子邮箱、会员编号、旅行日期、人数、饮食限制、需求／目的：AI行程制定后的收尾处理',
          'Functional Software, Inc.（Sentry，美国，compliance@sentry.io）— 项目：错误内容、发生错误的页面地址、设备及浏览器信息、访问IP信息／目的：服务错误排查',
          'Telegram Messenger Inc.（阿拉伯联合酋长国，telegram.org/support）— 项目：姓名、联系方式、电子邮箱、上车及下车地点、航班号、需求、咨询及聊天内容／目的：向本公司员工及司机发送预订及咨询通知',
          'Discord Inc.（美国，privacy@discord.com）— 项目：与Telegram通知相同的项目／目的：向本公司员工发送通知',
          'PostHog Inc.（美国，privacy@posthog.com）— 项目：浏览的页面、设备及浏览器信息、Cookie ID／目的：访问统计（经同意时）',
        ],
        contacts: [
          { label: '转移时间及方式', value: '使用服务时通过网络随时传输' },
          { label: '保留及使用期限', value: '至第三条规定的保留期限届满或委托合同终止时为止' },
          { label: '拒绝转移的方法及后果', value: '您可通过电子邮件联系第十条的保护负责人，拒绝个人信息跨境转移。但上述企业是登录、预订、付款及制定行程所必需的，拒绝后将无法使用相关服务。访问统计（Google Analytics、PostHog）可随时在"Cookie 与分析设置"中拒绝，拒绝后不影响服务的使用。' },
        ],
      },
      {
        title: '第七条（信息主体的权利、义务及行使方法）',
        body: '您可随时向本公司要求查阅、更正、删除个人信息或停止处理，也可撤回同意。',
        list: [
          '查阅：您可以查看本公司持有的您的个人信息及其处理情况。',
          '更正及删除：您可以要求更正有误的个人信息或删除个人信息。但其他法律法规规定需保存的个人信息不得要求删除。',
          '停止处理及撤回同意：您可以要求停止处理您的个人信息或撤回同意。在法律法规规定的情形下，本公司可能拒绝该要求，并将告知理由。',
        ],
        footer: '您可通过以下方式行使上述权利：',
        footerList: [
          '请通过电子邮件（cocotripkr@gmail.com）联系第十条的个人信息保护负责人。本公司将在10日内处理并告知结果。',
          '您也可以通过法定代理人或受委托人等代理人提出要求，此时请一并提交委托书。',
          '本公司将确认提出要求者是否为本人或正当代理人。',
          '请准确填写您本人的个人信息，不得填写他人的个人信息。填写同行者信息时，请事先征得其同意。',
        ],
      },
      {
        title: '第八条（个人信息安全保障措施）',
        body: '本公司为安全处理个人信息，采取以下措施。',
        list: [
          '管理措施：将可处理个人信息的人员限定在必要的最小范围内。',
          '技术措施：网站与服务器之间的所有通信均加密（HTTPS）；通过限制数据库访问权限，会员只能访问本人信息；管理员功能仅限指定账号使用。',
          '不保存支付信息及密码：银行卡号等支付信息由PayPal直接处理，登录通过Google、LINE或手机号验证进行，因此本公司不保存此类信息及密码。',
          '物理措施：个人信息存储于受托方（Google）的数据中心，该数据中心实行出入管控并对存储数据加密。',
        ],
      },
      {
        title: '第九条（Cookie等个人信息自动收集装置的设置、运营及拒绝）',
        body: '本公司使用Cookie及浏览器存储来记住使用服务所需的信息并进行访问统计。Cookie是网站发送至您的浏览器并保存在您设备上的少量信息。',
        list: [
          '必要存储：记住您的登录状态、正在制定的行程和购物车以及语言和Cookie设置。此类存储为使用服务所必需，因此与Cookie设置无关。',
          '访问统计（Google Analytics、PostHog）：收集浏览的页面、访问来源以及设备和浏览器信息，用于改进服务。仅在您于Cookie提示中选择"同意"时使用。',
        ],
        footer: '拒绝方法：',
        footerList: [
          '您可随时在本页顶部的"Cookie 与分析设置"中允许或拒绝访问统计，或撤回同意。',
          '您可以在浏览器设置中拒绝保存Cookie或删除已保存的Cookie。但如果连必要存储也加以阻止，登录等部分功能可能无法使用。',
        ],
      },
      {
        title: '第十条（个人信息保护负责人）',
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
      {
        title: '第十一条（隐私政策的变更）',
        body: '本隐私政策自2026年11月20日起施行。如有变更，将通过网站告知。',
        list: [
          '2026年11月20日：新增个人信息销毁、处理委托、跨境转移、信息主体权利、安全保障措施、Cookie及政策变更条款，并补充了收集项目。个人信息保护负责人条款由第四条移至第十条。',
          '以往版本：可向个人信息保护负责人申请提供。',
        ],
      },
    ],
  },
};

type ArticleData = (typeof CONTENT)['en']['articles'][number];

/** Wrapper labels only (2026-10-11, home vocabulary). The legal text above is untouched. */
const LABELS = {
  ko: { kicker: '법적 고지', article: '조항' },
  en: { kicker: 'Legal', article: 'Article' },
  ja: { kicker: '法的情報', article: '条項' },
  zh: { kicker: '法律信息', article: '条款' },
};

const num = (i: number) => String(i + 1).padStart(2, '0');

const PageSection = ({ index, title, chip, children }: { index: number; title: string; chip: string; children: ReactNode }) => (
  <section id={`article-${index + 1}`} className="scroll-mt-24 border-t border-ec-line p-5 first:border-t-0 md:p-8">
    <div className="flex items-start justify-between gap-4">
      <h2 className="ec-h3"><span className="ec-figure mr-2">{num(index)}</span>{title}</h2>
      <span className="ec-chip shrink-0">{chip}</span>
    </div>
    <div className="ec-body mt-4 max-w-[62ch] space-y-4 text-ec-ink-2">{children}</div>
  </section>
);

/** Table of contents in Home's service-row vocabulary; each row anchors to its article. */
const LegalToc = ({ label, titles }: { label: string; titles: string[] }) => (
  <nav aria-label={label} className="home-dope-services home-dope-rows mt-10">
    <ul className="home-dope-rows__list">
      {titles.map((title, i) => (
        <li key={i}>
          <a href={`#article-${i + 1}`} className="home-dope-row">
            <span className="home-dope-row__title">{num(i)}</span>
            <span className="home-dope-row__desc font-semibold">{title}</span>
            <ArrowRight className="home-dope-row__arrow" aria-hidden />
          </a>
        </li>
      ))}
    </ul>
  </nav>
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
  const labels = LABELS[language as keyof typeof LABELS] || LABELS.en;

  usePageMeta({
    title: content.pageTitle,
    description: t.pageMeta?.privacy?.description ||'CocoTrip privacy policy — how we collect, use and protect your personal information.',
  });

  return (
    <div className={isMobile ? 'm-page' : 'min-h-screen bg-[#0a0b14]'}>
      <Header language={language} t={t} onLanguageChange={changeLanguage} />
      <main className="ec-root home-dope home-dope--static" lang={language}>
        <section className="border-b border-ec-line bg-ec-sunken">
          <div className="ec-container-wide py-12 md:py-16">
            <p className="ec-eyebrow home-dope-eyebrow">{labels.kicker} · {content.pageTitle}</p>
            <h1 className="ec-h2 mt-4">{content.pageTitle}</h1>

            {/* 🔴 2026-07-30 (P1-1): 쿠키·분석 설정 진입점.
                Footer 에도 넣었지만 **모바일 화면 일부는 Footer 를 렌더하지 않는다**(이 페이지 포함,
                모바일 홈·About 도 마찬가지). 개인정보 처리방침은 쿠키 배너와 모든 푸터가 링크하는
                곳이라, 여기 두면 어느 화면에서든 도달할 수 있다. */}
            <div className="mt-6 flex">
              <CookieSettings className="inline-flex min-h-[44px] items-center rounded-xl border border-[#B668FC]/40 bg-[#B668FC]/10 px-4 text-[13px] font-semibold text-white hover:bg-[#B668FC]/20 transition-colors" />
            </div>
            <LegalToc label={content.pageTitle} titles={content.articles.map((a) => a.title)} />
          </div>
        </section>
        <div className="ec-container-wide py-12 md:py-16">
          <article className="ec-card max-w-4xl p-0">
            {content.articles.map((article: ArticleData, idx: number) => {
              const a = article as PrivacyArticleExt;
              return (
              <PageSection key={idx} index={idx} title={a.title} chip={labels.article}>
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
          </article>
        </div>
      </main>
      {!isMobile && <Footer t={t} />}
    </div>
  );
}
