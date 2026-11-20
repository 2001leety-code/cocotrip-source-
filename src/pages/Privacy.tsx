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
import { PREVIOUS_PRIVACY, PRIVACY_EFFECTIVE_DATE, formatPolicyDate, isRevisionPending, type PolicyLang } from './privacyVersions';

type PolicyTableData = { head: string[]; rows: string[][] };
type PolicyArticle = {
  title: string;
  body: string;
  list?: string[];
  table?: PolicyTableData;
  contacts?: { label: string; value: string }[];
  footer?: string;
  footerList?: string[];
  seeAlso?: { text: string; href: string };
};

// 시행일은 privacyVersions.ts 한 곳에만 둔다 — 제12조·개정 예정 안내·이전 판이 같은 날을 쓴다.
const DATE: Record<PolicyLang, string> = {
  en: formatPolicyDate(PRIVACY_EFFECTIVE_DATE, 'en'),
  ko: formatPolicyDate(PRIVACY_EFFECTIVE_DATE, 'ko'),
  ja: formatPolicyDate(PRIVACY_EFFECTIVE_DATE, 'ja'),
  zh: formatPolicyDate(PRIVACY_EFFECTIVE_DATE, 'zh'),
};

// ── 다국어 콘텐츠 ──────────────────────────────────────
// 2026-11-20 운영자 결정(질문 21개)을 반영. 아래 문장 중 식단 따로 동의·보호자 동의·한 달 자동 파기는
// 그 코드가 운영에 먼저 들어가야 사실이 된다 — 이 판은 그 뒤에 올린다.
// 🔴 제3조 표의 견적 문의·사이트 채팅·후기와 커뮤니티 글·협력사 포털 예약 4줄은 작성자 제안(2차 검토) — 운영자 결정 전.
const CONTENT: Record<PolicyLang, { pageTitle: string; changeSummary: string; articles: PolicyArticle[] }> = {
  en: {
    pageTitle: 'Privacy Policy',
    changeSummary: 'Added the articles on destruction, entrustment, overseas transfer, provision to third parties, data subject rights, safety measures, cookies and changes to this policy, and completed the collected items and retention periods. The Protection Officer article moved from Article 4 to Article 11.',
    articles: [
      {
        title: 'Article 1 (Collected Personal Information)',
        body: "주식회사 코코트립 (COCOTRIP, hereinafter referred to as the 'Company') collects the following personal information to provide smooth customer consultation and services.",
        list: [
          'Required Items: Full name, contact number (phone number), email address',
          'Optional Items: Messenger app and ID (WhatsApp, KakaoTalk, LINE, WeChat), (for airport pickup) flight number, terminal, arrival time and number of bags, other additional requests',
          'When planning or booking a trip: Travel dates and cities, number of travelers and who you travel with, accommodation address, pickup or meeting place, flight arrival and departure times, dietary requirements (halal, vegan, vegetarian, allergies) and food preferences, travel preferences',
          'When signing in: Name, email address and profile photo of your Google or LINE account; your phone number if you sign in with it',
          "When paying: Payment amount, PayPal transaction ID, payer's name and email address (payment details such as card numbers are entered directly with PayPal; the 'Company' does not receive them)",
          "When writing reviews or community posts, chatting or sending inquiries: Review text and photos, community posts (title, text, photos, display name, the author's account email address), AI chat and website chat conversations, inquiry details (including quote requests)",
          'Automatically Collected: Service use record, access log, device and browser information, cookie, access IP information',
        ],
        footer: 'Please also note:',
        footerList: [
          "Sensitive information: Dietary requirements (such as allergies, halal and vegetarian) can reveal health or beliefs, so the 'Company' treats them as sensitive information and processes them only with your separate consent.",
          "Children under 14: Children under 14 cannot sign up or book by themselves. For a booking that includes a child, the parent or guardian enters the child's information and gives consent.",
          "Partner portal: In the booking portal used by staff of partner companies (advertising agencies), the 'Company' collects the staff member's sign-in email address, the booking details (date, time, departure, destination, stops, airport, notes) the name of the influencer who travels with them, and the schedule text the staff member pastes in.",
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
        body: "The 'Company' keeps personal information only for the periods in the table below and destroys it without delay under Article 4 when the period ends. Information that the law requires to be kept is kept for the period set by the Act on Consumer Protection in Electronic Commerce, etc. (the 'E-Commerce Act') and the Framework Act on National Taxes.",
        table: {
          head: ['Information', 'Retention period'],
          rows: [
            ['Trip preparation details (pickup and drop-off places, flights, dietary requirements, requests and notes, messages exchanged with drivers)', '1 month after the trip ends'],
            ['Contact details left for an itinerary preview by people who did not book', '1 month after they were left'],
            ['Member account and saved itineraries', 'Until you delete your account'],
            ["Contract and payment records (booking number, product, amount, dates, booker's name and email address)", '5 years (Article 6 of the Enforcement Decree of the E-Commerce Act)'],
            ['Records of consumer complaints or dispute handling', '3 years (Article 6 of the Enforcement Decree of the E-Commerce Act)'],
            ['Records of labeling and advertising', '6 months (Article 6 of the Enforcement Decree of the E-Commerce Act)'],
            ['Tax books and supporting documents', '5 years (Article 85-3 of the Framework Act on National Taxes)'],
            ["Inquiries received in the email inbox of the 'Company'", '30 days after the inquiry is closed'],
            ['Quote requests sent through the website form', '30 days after the request is closed'],
            ['Website chat conversations (including AI chat)', '1 month after the last message'],
            ['Reviews and community posts (text and photos)', 'Until you delete them or delete your account'],
            ['Partner portal bookings (influencer name, staff email address, date and route)', '1 month after the ride ends'],
            ['Information provided to rental car companies and drivers (Article 7)', '1 month after the ride ends'],
            ['Automatically collected records (access records, error reports, visit analytics)', "The period set by each recipient's policy and settings (Article 6)"],
          ],
        },
      },
      {
        title: 'Article 4 (Procedure and Method of Destroying Personal Information)',
        body: "When the retention period ends or the purpose of processing is achieved and personal information is no longer needed, the 'Company' destroys it without delay.",
        list: [
          'Procedure: Personal information whose period in the Article 3 table has ended is selected and deleted without delay.',
          'Retention required by law: Information that the law requires to be kept in the Article 3 table (contract and payment records, records of complaints and disputes, records of labeling and advertising, tax books) is stored separately from other personal information only for that period and then destroyed.',
          "Method: Electronic files are deleted so that they cannot be restored. The 'Company' does not keep personal information on paper.",
        ],
      },
      {
        title: 'Article 5 (Entrustment of Personal Information Processing)',
        body: "To provide its services smoothly, the 'Company' entrusts the processing of personal information as follows. If the entrusted work or the entrusted companies change, the 'Company' will announce it through this Privacy Policy.",
        list: [
          'Google LLC: Member sign-in, storage of booking and itinerary information and review photos, booking emails, booking records, AI itinerary planning and editing, translation (inquiries and community posts), chat, reading partner portal schedules (Gemini, when Claude is unavailable), mobile booking pass, visit analytics (with consent)',
          'Anthropic PBC: AI itinerary planning and editing, translation (inquiries and community posts), chat, reading partner portal schedules (Claude, used first)',
          'Vercel Inc.: Operation of the website and servers',
          'PayPal Pte. Ltd.: Payment processing and refunds',
          'Inngest Inc.: Finishing work after AI itinerary planning',
          'Functional Software, Inc. (Sentry): Checking service errors',
          "Telegram Messenger Inc.: Sending booking, dispatch, payment, inquiry and community post review notifications to the 'Company' operator, relaying website chat consultations, and sending dispatch requests to rental car companies and drivers",
          'PostHog Inc.: Visit analytics (with consent)',
        ],
        footer: 'Route search and maps: Naver Cloud, TMAP and ODsay receive only the addresses and coordinates needed to find routes, not names or contact details. Naver maps are loaded by your browser directly from Naver, so Naver then receives your access IP, browser information and the address of the page you are viewing.',
      },
      {
        title: 'Article 6 (Overseas Transfer of Personal Information)',
        body: "To provide its services, the 'Company' transfers personal information overseas as follows. Transfers needed to carry out your contract are made by disclosing them in this Privacy Policy under Article 28-8 (1) 3 (a) of the Personal Information Protection Act. Visit analytics (Google Analytics, PostHog) are transferred only if you consent in the cookie notice.",
        table: {
          head: ['Recipient (contact)', 'Country', 'When and how', 'Items', 'Purpose', 'Retention and use period'],
          rows: [
            ['Google LLC (googlekrsupport@google.com)', 'USA', 'Sent over the network when you use the service', 'All personal information in Article 1', 'Sign-in, data storage, emails, booking records, mobile booking pass, visit analytics (with consent)', 'The periods in Article 3'],
            ['Anthropic PBC (privacy@anthropic.com)', 'USA', 'Sent over the network when AI features are used', 'Name, trip details (dates, cities, number of travelers, accommodation address, flight times, dietary requirements, requests), AI chat conversations, inquiry text and community posts to be translated, partner portal schedule text', 'AI itinerary planning and editing, translation (inquiries and community posts), chat, reading partner portal schedules (Claude, used first). Customer information is not used to train AI.', "After processing, as set in the recipient's own policy"],
            ['Google LLC — Gemini (googlekrsupport@google.com)', 'USA', 'Sent over the network when Claude is unavailable', 'The same items as Claude', 'AI itinerary planning and editing, translation (inquiries and community posts), chat, reading partner portal schedules (paid connection). Customer information is not used to train AI.', "After processing, as set in the recipient's own policy"],
            ['Vercel Inc. (privacy@vercel.com)', 'USA (servers in Washington, D.C.)', 'Sent over the network when you use the service', 'Personal information exchanged while using the service, access records (IP address, etc.)', 'Operation of the website and servers', "After processing, as set in the recipient's own policy"],
            ['PayPal Pte. Ltd. (agent in Korea: PayPal Korea Services LLC, 27F & 30F Trade Tower, 511 Yeongdong-daero, Gangnam-gu, Seoul, +82-2-737-5775, skrprivacy@paypal.com)', 'Singapore', 'Sent over the network when you pay or get a refund', 'Payment amount, order details (product, dates, number of travelers), refund details', 'Payment processing and refunds', "The periods in Article 3 (records PayPal keeps under its own legal duties follow PayPal's policy)"],
            ['Inngest Inc. (600 California St, Suite 1200, San Francisco, CA 94109, USA · hello@inngest.com)', 'USA', 'Sent over the network after an AI itinerary is created', 'Name, email address, member ID, trip details (dates, cities, number of travelers, accommodation address, arrival and departure airports, flight times, dietary requirements, travel preferences, requests), the AI itinerary, PayPal order number, coupon code', 'Finishing work after AI itinerary planning', "After processing, as set in the recipient's own policy"],
            ['Functional Software, Inc. (Sentry) (compliance@sentry.io)', 'Stored in Germany (Frankfurt); the company is in the USA', 'Sent over the network when an error occurs', 'Error details, address of the page where the error occurred, device and browser information, access IP information, member ID and account email address in some error reports', 'Checking service errors', "As set in the recipient's own policy"],
            ['Telegram Messenger Inc. (EU representative EDPO request form: edpo.com/telegram-gdpr-data-request)', 'Not stated in its privacy policy', 'Sent over the network when a notification or chat message is sent', 'Name, email address, phone number, WhatsApp ID, booking number and details (product, date, number of travelers, vehicle), pickup and drop-off places, flight number, terminal and number of bags, notes and requests, payment amount, coupon and PayPal transaction ID, quote inquiries (original and translation), website chat conversations, partner portal bookings (booker email address, date and route), title and author email address of community posts held for review', "Sending booking, dispatch, payment, inquiry and community post review notifications to the 'Company' operator, relaying website chat consultations, and sending dispatch requests to rental car companies and drivers", 'The periods in Article 3'],
            ['PostHog Inc. (privacy@posthog.com)', 'USA', 'Sent over the network when you visit, after you consent in the cookie notice', 'Pages visited, device and browser information, cookie ID, access IP information', 'Visit analytics', "As set in the recipient's own policy"],
          ],
        },
        contacts: [
          { label: 'How to refuse and its effect', value: "You can refuse the overseas transfer by emailing the Protection Officer in Article 11. However, the companies above are essential for sign-in, booking, payment and itinerary planning, so if you refuse, you cannot use those services. You can refuse visit analytics (Google Analytics, PostHog) at any time in 'Cookie & analytics settings', and refusing does not limit your use of the service." },
        ],
        footer: "Messengers: The 'Company' contacts you through the messenger you choose. Your conversations stay on that messenger company's servers, and that company's privacy policy applies.",
        footerList: [
          'WhatsApp: WhatsApp LLC (a Meta company, USA)',
          'KakaoTalk: Kakao Corp. (Republic of Korea)',
          'LINE: LY Corporation (Japan)',
          'WeChat: WeChat International Pte. Ltd. (a Tencent company, Singapore). Weixin in mainland China: Shenzhen Tencent Computer Systems Company Limited (China)',
        ],
      },
      {
        title: 'Article 7 (Provision of Personal Information to Third Parties)',
        body: "The 'Company' provides personal information to third parties only when you consent or when the law specifically allows it. When you book a vehicle, the 'Company' asks for your consent and provides personal information as follows.",
        list: [
          'Recipients: The rental car company that accepts the dispatch request for your booking, and its drivers. The dispatch request is sent to several rental car companies, and the company that accepts it handles the booking. Contact us to learn the name of the company assigned to your booking.',
          'Purpose: Providing the vehicle service you booked, such as pickup and transfers',
          'Items: Booking number, product, date of use, number of travelers, pickup and drop-off places, requests',
          "Retention and use period: 1 month after the ride ends. The booking details in a dispatch request are removed from the driver's chat when the driver accepts or declines it, or when it ends unanswered.",
          'You may refuse to consent, but if you refuse, you cannot book a vehicle.',
        ],
      },
      {
        title: 'Article 8 (Rights and Obligations of Data Subjects and How to Exercise Them)',
        body: "You may at any time ask the 'Company' to let you view, correct, delete or stop processing your personal information, or withdraw your consent.",
        list: [
          "Viewing: You can see the personal information the 'Company' holds about you and how it is processed.",
          'Correction and deletion: You can ask for wrong personal information to be corrected or for your personal information to be deleted. However, you cannot ask for the deletion of personal information that other laws require to be kept.',
          "Suspension and withdrawal of consent: You can ask the 'Company' to stop processing your personal information or withdraw your consent. The 'Company' may refuse in cases set by law, and will tell you the reason.",
        ],
        footer: 'You can exercise these rights as follows:',
        footerList: [
          "Email the Personal Information Protection Officer in Article 11 (cocotripkr@gmail.com). The 'Company' will act within 10 days and tell you the result.",
          'You can also make a request through a representative, such as a legal representative or a person you have authorized. In that case, please send a power of attorney with the request.',
          "The 'Company' checks that the person making the request is you or your rightful representative.",
          "Please enter your own personal information accurately and do not enter other people's personal information. When you enter details of people traveling with you, please get their consent first.",
        ],
      },
      {
        title: 'Article 9 (Measures to Ensure the Safety of Personal Information)',
        body: "The 'Company' takes the following measures to process personal information safely.",
        list: [
          'Administrative: One person, the representative, handles customer personal information. When an itinerary is created, the information is passed to AI (Claude, or Gemini when Claude is unavailable), and these providers do not use customer information to train AI (Article 6).',
          'Technical: All communication between the website and the servers is encrypted (HTTPS); database access rules let members reach only their own information; administrator functions are limited to designated accounts.',
          "No storage of payment details or passwords: Payment details such as card numbers are handled directly by PayPal, and sign-in uses Google, LINE or phone number verification, so the 'Company' does not keep this information or any passwords.",
          "Physical: Personal information is mainly stored in the data centers of the entrusted company (Google), which control physical access and encrypt stored data. The 'Company' does not keep personal information on paper.",
        ],
      },
      {
        title: 'Article 10 (Installation, Operation and Refusal of Cookies and Other Automatic Collection Tools)',
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
        seeAlso: { text: 'The companies that run visit analytics and their countries are listed in Article 6 (Overseas Transfer of Personal Information).', href: '#article-6' },
      },
      {
        title: 'Article 11 (Personal Information Protection Officer)',
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
        title: 'Article 12 (Changes to This Privacy Policy)',
        body: `This Privacy Policy applies from ${DATE.en}. If it changes, the change will be announced on this page from 7 days before it takes effect, and the previous version will remain available on this page.`,
        list: [
          `${DATE.en}: Added the articles on destruction, entrustment, overseas transfer, provision to third parties, data subject rights, safety measures, cookies and changes to this policy, and completed the collected items and retention periods. The Protection Officer article moved from Article 4 to Article 11.`,
          "Previous version: Open 'View the previous Privacy Policy' at the bottom of this page.",
        ],
      },
    ],
  },
  ko: {
    pageTitle: '개인정보처리방침',
    changeSummary: '개인정보 파기, 처리 위탁, 국외 이전, 제3자 제공, 정보주체의 권리, 안전성 확보 조치, 쿠키, 처리방침 변경 조항을 새로 넣고, 수집 항목과 보관 기간을 보완했습니다. 보호책임자 조항은 제4조에서 제11조로 옮겼습니다.',
    articles: [
      {
        title: '제1조 (수집하는 개인정보 항목)',
        body: "주식회사 코코트립(이하 '회사')은 원활한 고객 상담 및 서비스 제공을 위해 아래와 같은 개인정보를 수집하고 있습니다.",
        list: [
          '필수항목: 성명, 연락처(전화번호), 이메일 주소',
          '선택항목: 메신저 종류와 아이디(WhatsApp·카카오톡·LINE·WeChat), (공항 픽업 시) 항공편명·터미널·도착 시각·짐 개수, 기타 추가 요청사항',
          '여행 일정 작성·예약 시: 여행 날짜와 도시, 인원과 동행 유형, 숙소 주소, 픽업·만남 장소, 항공편 도착·출발 시각, 식이 조건(할랄·비건·채식·알레르기)과 음식 취향, 여행 취향',
          '로그인 시: Google·LINE 계정의 이름·이메일·프로필 사진, 전화번호로 로그인하는 경우 전화번호',
          "결제 시: 결제 금액, PayPal 거래 번호, 결제자 이름·이메일(카드 번호 등 결제 수단 정보는 PayPal이 직접 받으며 '회사'는 받지 않습니다)",
          '후기·커뮤니티 글·상담·문의 이용 시: 후기 내용과 사진, 커뮤니티 글(제목·내용·사진·표시 이름, 작성자 계정 이메일), AI 상담과 사이트 채팅 대화 내용, 문의 내용(견적 문의 포함)',
          '자동 수집: 서비스 이용기록, 접속 로그, 기기·브라우저 정보, 쿠키, 접속 IP 정보',
        ],
        footer: '따로 알려 드리는 점:',
        footerList: [
          '민감정보: 식이 조건(알레르기·할랄·채식 등)은 건강이나 신념을 알 수 있는 민감정보로 보고, 따로 동의를 받아 처리합니다.',
          '만 14세 미만 아동: 만 14세 미만은 직접 가입하거나 예약할 수 없습니다. 아이와 함께 가는 예약은 보호자가 아이의 정보를 넣고 동의합니다.',
          '협력사 포털: 협력사(광고사) 직원이 쓰는 예약 포털에서는 직원의 로그인 이메일, 예약 내용(날짜·시간·출발지·도착지·경유지·공항·메모), 함께 이동하는 인플루언서의 이름, 직원이 붙여 넣은 일정 글을 받습니다.',
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
        body: "'회사'는 개인정보를 아래 표의 기간 동안만 보관하고, 기간이 지나면 제4조에 따라 지체 없이 파기합니다. 법령이 보관을 정한 정보는 「전자상거래 등에서의 소비자보호에 관한 법률」(이하 '전자상거래법')과 「국세기본법」이 정한 기간 동안 보관합니다.",
        table: {
          head: ['정보', '보관 기간'],
          rows: [
            ['여행 준비 정보(픽업·하차 장소, 항공편, 식이 조건, 요청사항·메모, 기사와 주고받은 내용)', '여행이 끝난 날부터 1개월'],
            ['예약하지 않은 분이 일정 미리보기에 남긴 연락처', '남긴 날부터 1개월'],
            ['회원 계정과 저장한 여행 일정', '회원 탈퇴 시까지'],
            ['계약·결제 기록(예약 번호, 상품, 금액, 날짜, 예약자 이름·이메일)', '5년 (전자상거래법 시행령 제6조)'],
            ['소비자 불만 또는 분쟁 처리 기록', '3년 (전자상거래법 시행령 제6조)'],
            ['표시·광고에 관한 기록', '6개월 (전자상거래법 시행령 제6조)'],
            ['세금 관련 장부와 증빙 서류', '5년 (국세기본법 제85조의3)'],
            ['회사 메일 받은편지함(문의함)으로 받은 문의', '처리를 마친 뒤 30일'],
            ['사이트 견적 문의 양식으로 보낸 문의', '처리를 마친 뒤 30일'],
            ['사이트 채팅 대화(AI 상담 포함)', '마지막 대화 후 1개월'],
            ['후기·커뮤니티 글(내용과 사진)', '직접 지우거나 회원 탈퇴할 때까지'],
            ['협력사 포털 예약(인플루언서 이름, 직원 이메일, 날짜·경로)', '운행이 끝난 뒤 1개월'],
            ['렌터카 회사·기사에게 제공한 정보(제7조)', '운행이 끝난 뒤 1개월'],
            ['자동으로 수집되는 기록(접속 기록·오류 기록·방문 통계)', '각 업체의 방침과 설정에 따른 기간(제6조)'],
          ],
        },
      },
      {
        title: '제4조 (개인정보의 파기 절차 및 방법)',
        body: "'회사'는 개인정보 보유 기간이 끝나거나 처리 목적을 이루어 개인정보가 필요 없게 되면 지체 없이 그 개인정보를 파기합니다.",
        list: [
          '파기 절차: 제3조 표의 기간이 지난 개인정보를 골라 지체 없이 지웁니다.',
          '법령에 따른 보존: 제3조 표에서 법령에 따라 보관하는 정보(계약·결제 기록, 불만·분쟁 처리 기록, 표시·광고 기록, 세금 장부)는 다른 개인정보와 분리하여 그 기간 동안만 보관한 뒤 파기합니다.',
          "파기 방법: 전자 파일은 되살릴 수 없는 방법으로 지웁니다. '회사'는 개인정보를 종이로 보관하지 않습니다.",
        ],
      },
      {
        title: '제5조 (개인정보 처리업무의 위탁)',
        body: "'회사'는 원활한 서비스 제공을 위해 아래와 같이 개인정보 처리업무를 위탁하고 있습니다. 위탁 업무의 내용이나 수탁자가 바뀌면 이 개인정보처리방침을 통해 알리겠습니다.",
        list: [
          'Google LLC: 회원 로그인, 예약·일정 정보와 후기 사진 저장, 예약 안내 메일 발송, 예약 관리 장부, AI 여행 일정 작성·수정, 번역(문의·커뮤니티 글), 상담, 협력사 포털 일정 글 읽기(Claude를 쓸 수 없을 때 Gemini), 모바일 예약 확인 카드, 방문 통계(동의한 경우)',
          'Anthropic PBC: AI 여행 일정 작성·수정, 번역(문의·커뮤니티 글), 상담, 협력사 포털 일정 글 읽기(Claude, 먼저 사용)',
          'Vercel Inc.: 웹사이트와 서버 운영',
          'PayPal Pte. Ltd.: 결제 처리 및 환불',
          'Inngest Inc.: AI 여행 일정 작성 후 마무리 작업 처리',
          'Functional Software, Inc.(Sentry): 서비스 오류 확인',
          "Telegram Messenger Inc.: '회사' 운영자에게 예약·배차·결제·문의·커뮤니티 글 검토 알림 전달, 사이트 채팅 상담 중계, 렌터카 회사·기사에게 배차 요청 전달",
          'PostHog Inc.: 방문 통계(동의한 경우)',
        ],
        footer: '길찾기·지도: 네이버 클라우드·TMAP·ODsay에는 길을 찾는 데 필요한 주소·좌표만 보내고, 이름·연락처는 보내지 않습니다. 네이버 지도는 손님의 브라우저가 네이버에서 직접 불러오므로, 그때 네이버는 접속 IP·브라우저 정보·보고 있는 화면 주소를 받습니다.',
      },
      {
        title: '제6조 (개인정보의 국외 이전)',
        body: "'회사'는 서비스 제공을 위해 아래와 같이 개인정보를 국외로 이전합니다. 계약 이행에 필요한 이전은 「개인정보 보호법」 제28조의8 제1항 제3호 가목에 따라 이 처리방침에 공개하여 하고, 방문 통계(Google Analytics·PostHog)는 쿠키 안내에서 동의하신 경우에만 이전합니다.",
        table: {
          head: ['이전받는 자(연락처)', '이전되는 나라', '이전 시기·방법', '이전 항목', '이용 목적', '보유·이용 기간'],
          rows: [
            ['Google LLC (googlekrsupport@google.com)', '미국', '서비스를 이용할 때 네트워크로 전송', '제1조의 개인정보 전부', '로그인, 정보 저장, 메일 발송, 예약 관리 장부, 모바일 예약 확인 카드, 방문 통계(동의한 경우)', '제3조의 기간'],
            ['Anthropic PBC (privacy@anthropic.com)', '미국', 'AI 기능을 쓸 때 네트워크로 전송', '이름, 여행 정보(날짜·도시·인원·숙소 주소·항공편 시각·식이 조건·요청사항), AI 상담 대화, 번역할 문의 내용과 커뮤니티 글, 협력사 포털 일정 글', 'AI 여행 일정 작성·수정, 번역(문의·커뮤니티 글), 상담, 협력사 포털 일정 글 읽기(Claude, 먼저 사용). 손님 정보를 AI 학습에 쓰지 않습니다.', '처리 후 업체 방침에 따른 기간'],
            ['Google LLC — Gemini (googlekrsupport@google.com)', '미국', 'Claude를 쓸 수 없을 때 네트워크로 전송', 'Claude와 같은 항목', 'AI 여행 일정 작성·수정, 번역(문의·커뮤니티 글), 상담, 협력사 포털 일정 글 읽기(유료 연결). 손님 정보를 AI 학습에 쓰지 않습니다.', '처리 후 업체 방침에 따른 기간'],
            ['Vercel Inc. (privacy@vercel.com)', '미국 (서버: 워싱턴 D.C.)', '서비스를 이용할 때 네트워크로 전송', '서비스 이용 중 주고받는 개인정보, 접속 기록(IP 주소 등)', '웹사이트와 서버 운영', '처리 후 업체 방침에 따른 기간'],
            ['PayPal Pte. Ltd. (국내대리인: PayPal Korea Services LLC, 서울 강남구 영동대로 511 트레이드타워 27·30층, 02-737-5775, skrprivacy@paypal.com)', '싱가포르', '결제·환불할 때 네트워크로 전송', '결제 금액, 주문 내용(상품·날짜·인원), 환불 내용', '결제 처리 및 환불', '제3조의 기간(PayPal이 법에 따라 따로 보관하는 기록은 PayPal 방침에 따름)'],
            ['Inngest Inc. (600 California St, Suite 1200, San Francisco, CA 94109, USA · hello@inngest.com)', '미국', 'AI 여행 일정을 만든 뒤 네트워크로 전송', '이름, 이메일, 회원 번호, 여행 정보(날짜·도시·인원·숙소 주소·도착·출발 공항·항공편 시각·식이 조건·여행 취향·요청사항), AI가 만든 여행 일정, PayPal 주문 번호, 쿠폰 코드', 'AI 여행 일정 작성 후 마무리 작업', '처리 후 업체 방침에 따른 기간'],
            ['Functional Software, Inc.(Sentry) (compliance@sentry.io)', '독일(프랑크푸르트)에 저장 · 회사는 미국', '오류가 날 때 네트워크로 전송', '오류 내용, 오류가 난 화면 주소, 기기·브라우저 정보, 접속 IP 정보, 일부 오류 기록의 회원 번호·계정 이메일', '서비스 오류 확인', '업체 방침에 따른 기간'],
            ['Telegram Messenger Inc. (EU 대리인 EDPO 문의 양식: edpo.com/telegram-gdpr-data-request)', '처리방침에 나라를 밝히지 않음', '알림·채팅이 생길 때 네트워크로 전송', '성명, 이메일, 전화번호, WhatsApp 아이디, 예약 번호와 내용(상품·날짜·인원·차종), 픽업·하차 장소, 항공편명·터미널·짐 개수, 메모·요청사항, 결제 금액·쿠폰·PayPal 거래 번호, 견적 문의 내용(원문과 번역), 사이트 채팅 대화, 협력사 포털 예약(예약자 이메일·날짜·경로), 검토가 필요한 커뮤니티 글의 제목·작성자 이메일', "'회사' 운영자에게 예약·배차·결제·문의·커뮤니티 글 검토 알림 전달, 사이트 채팅 상담 중계, 렌터카 회사·기사에게 배차 요청 전달", '제3조의 기간'],
            ['PostHog Inc. (privacy@posthog.com)', '미국', '쿠키 안내에서 동의하신 뒤 방문할 때 네트워크로 전송', '방문한 화면, 기기·브라우저 정보, 쿠키 아이디, 접속 IP 정보', '방문 통계', '업체 방침에 따른 기간'],
          ],
        },
        contacts: [
          { label: '이전 거부 방법 및 효과', value: "제11조의 보호책임자에게 이메일로 국외 이전을 거부할 수 있습니다. 다만 위 업체들은 로그인·예약·결제·일정 작성에 꼭 필요하여, 거부하시면 해당 서비스를 이용하실 수 없습니다. 방문 통계(Google Analytics·PostHog)는 '쿠키·분석 설정'에서 언제든 거부할 수 있으며, 거부해도 서비스 이용에 제한이 없습니다." },
        ],
        footer: "연락용 메신저: '회사'는 손님이 고른 메신저로 연락드립니다. 대화는 그 메신저 회사의 서버에 남고, 그 회사의 개인정보처리방침이 적용됩니다.",
        footerList: [
          'WhatsApp: WhatsApp LLC(Meta 계열, 미국)',
          '카카오톡: 주식회사 카카오(Kakao Corp., 대한민국)',
          'LINE: LY Corporation(일본)',
          'WeChat: WeChat International Pte. Ltd.(Tencent 계열, 싱가포르). 중국 본토의 Weixin: Shenzhen Tencent Computer Systems Company Limited(중국)',
        ],
      },
      {
        title: '제7조 (개인정보의 제3자 제공)',
        body: "'회사'는 정보주체가 동의한 경우나 법률에 특별한 규정이 있는 경우 등에만 개인정보를 제3자에게 제공합니다. 차량을 예약할 때 동의를 받아 아래와 같이 제공합니다.",
        list: [
          '제공받는 자: 배차를 수락한 렌터카 회사와 그 회사 기사. 배차 요청은 여러 렌터카 회사에 함께 보내고, 수락한 회사가 그 예약을 맡습니다. 배정된 회사 이름은 문의하시면 알려 드립니다.',
          '제공 목적: 픽업·이동 등 예약한 차량 서비스 제공',
          '제공 항목: 예약 번호, 상품, 이용 날짜, 인원, 픽업·하차 장소, 요청사항',
          '보유 및 이용 기간: 운행이 끝난 뒤 1개월. 배차 요청 메시지의 예약 정보는 기사가 수락하거나 거절할 때, 또는 답이 없어 요청이 끝날 때 기사의 대화창에서 지워집니다.',
          '동의를 거부할 수 있으나, 거부하면 차량 예약을 이용할 수 없습니다.',
        ],
      },
      {
        title: '제8조 (정보주체의 권리·의무 및 행사 방법)',
        body: "정보주체는 '회사'에 대해 언제든지 개인정보 열람·정정·삭제·처리정지를 요구하거나 동의를 철회할 수 있습니다.",
        list: [
          "열람 요구: '회사'가 가진 본인의 개인정보와 그 처리 내용을 볼 수 있습니다.",
          '정정·삭제 요구: 잘못된 개인정보를 고치거나 개인정보를 지우도록 요구할 수 있습니다. 다만 다른 법령에서 보존하도록 정한 개인정보는 삭제를 요구할 수 없습니다.',
          "처리정지 요구 및 동의 철회: 개인정보 처리를 멈추거나 동의를 거두도록 요구할 수 있습니다. 다만 법령에서 정한 경우에는 '회사'가 요구를 거절할 수 있으며, 이때 그 이유를 알려 드립니다.",
        ],
        footer: '권리는 다음과 같이 행사하실 수 있습니다:',
        footerList: [
          "제11조의 개인정보 보호책임자에게 이메일(cocotripkr@gmail.com)로 요청하시면 '회사'는 10일 이내에 조치하고 결과를 알려 드립니다.",
          '법정대리인이나 위임을 받은 사람 등 대리인을 통해서도 요청할 수 있으며, 이 경우 위임장을 함께 보내 주셔야 합니다.',
          "'회사'는 요청한 사람이 본인이거나 정당한 대리인인지 확인합니다.",
          '정보주체는 자신의 개인정보를 정확하게 입력해야 하며 다른 사람의 개인정보를 입력해서는 안 됩니다. 함께 여행하는 분의 정보를 입력할 때는 먼저 그분의 동의를 받아 주십시오.',
        ],
      },
      {
        title: '제9조 (개인정보의 안전성 확보 조치)',
        body: "'회사'는 개인정보를 안전하게 처리하기 위해 다음과 같은 조치를 하고 있습니다.",
        list: [
          '관리적 조치: 손님 개인정보를 다루는 사람은 대표 1명입니다. 여행 일정을 만들 때는 AI(Claude, 쓸 수 없을 때 Gemini)에 정보를 넘기며, 이 업체들은 손님 정보를 AI 학습에 쓰지 않습니다(제6조).',
          '기술적 조치: 웹사이트와 서버 사이의 모든 통신을 암호화(HTTPS)하고, 회원은 본인 정보에만 접근할 수 있도록 데이터베이스 접근 권한을 제한하며, 관리자 기능은 지정된 계정만 쓸 수 있습니다.',
          "결제 정보·비밀번호 미보관: 카드 번호 등 결제 수단 정보는 PayPal이 직접 처리하고 로그인은 Google·LINE·전화번호 인증으로 하므로, '회사'는 이 정보와 비밀번호를 보관하지 않습니다.",
          "물리적 조치: 개인정보는 주로 출입을 통제하고 저장된 정보를 암호화하는 수탁자(Google)의 데이터센터에 보관합니다. '회사'는 개인정보를 종이로 보관하지 않습니다.",
        ],
      },
      {
        title: '제10조 (쿠키 등 개인정보 자동 수집 장치의 설치·운영 및 거부)',
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
        seeAlso: { text: '방문 통계를 하는 업체와 그 나라는 제6조(개인정보의 국외 이전)에서 볼 수 있습니다.', href: '#article-6' },
      },
      {
        title: '제11조 (개인정보 보호책임자)',
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
        title: '제12조 (개인정보처리방침의 변경)',
        body: `이 개인정보처리방침은 ${DATE.ko}부터 적용됩니다. 내용이 바뀌면 시행 7일 전부터 이 화면에 미리 알리고, 이전 판도 이 화면에서 볼 수 있게 두겠습니다.`,
        list: [
          `${DATE.ko}: 개인정보 파기, 처리 위탁, 국외 이전, 제3자 제공, 정보주체의 권리, 안전성 확보 조치, 쿠키, 처리방침 변경 조항을 새로 넣고, 수집 항목과 보관 기간을 보완했습니다. 보호책임자 조항은 제4조에서 제11조로 옮겼습니다.`,
          "이전 판: 이 화면 아래의 '이전 개인정보처리방침 보기'를 열면 볼 수 있습니다.",
        ],
      },
    ],
  },
  ja: {
    pageTitle: 'プライバシーポリシー',
    changeSummary: '個人情報の破棄、処理の委託、国外移転、第三者提供、情報主体の権利、安全性確保措置、Cookie、ポリシー変更の条項を追加し、収集項目と保管期間を補いました。個人情報保護責任者の条項は第4条から第11条に移りました。',
    articles: [
      {
        title: '第1条（収集する個人情報）',
        body: "주식회사 코코트립（COCOTRIP、以下「当社」）は、円滑なカスタマーサポートおよびサービス提供のため、以下の個人情報を収集しています。",
        list: [
          '必須項目：氏名、連絡先（電話番号）、メールアドレス',
          '任意項目：メッセンジャーの種類とID（WhatsApp・カカオトーク・LINE・WeChat）、（空港送迎の場合）フライト番号・ターミナル・到着時刻・荷物の数、その他の追加リクエスト',
          '旅行プランの作成・予約時：旅行の日程と都市、人数と同行者の種類、宿泊先の住所、送迎・待ち合わせ場所、フライトの到着・出発時刻、食事制限（ハラール・ヴィーガン・ベジタリアン・アレルギー）と食の好み、旅行の好み',
          'ログイン時：GoogleまたはLINEアカウントの氏名・メールアドレス・プロフィール写真、電話番号でログインする場合は電話番号',
          '決済時：決済金額、PayPal取引番号、支払者の氏名・メールアドレス（カード番号などの決済手段の情報はPayPalが直接受け取り、当社は受け取りません）',
          'レビュー・コミュニティ投稿・相談・お問い合わせのご利用時：レビューの内容と写真、コミュニティ投稿（タイトル・本文・写真・表示名、投稿者のアカウントのメールアドレス）、AIチャットとサイトのチャットの会話内容、お問い合わせ内容（見積もりのお問い合わせを含む）',
          '自動収集：サービス利用記録、アクセスログ、端末・ブラウザ情報、Cookie、接続IPアドレス',
        ],
        footer: 'あわせてお知らせする点：',
        footerList: [
          'センシティブ情報：食事制限（アレルギー・ハラール・ベジタリアンなど）は健康や信条がわかるセンシティブ情報として扱い、別途同意をいただいたうえで処理します。',
          '満14歳未満のお子様：満14歳未満の方は、ご自身で会員登録やご予約をすることはできません。お子様が同行するご予約は、保護者の方がお子様の情報を入力し、同意してください。',
          '協力会社ポータル：協力会社（広告代理店）のスタッフが使う予約ポータルでは、スタッフのログイン用メールアドレス、予約内容（日付・時間・出発地・目的地・経由地・空港・メモ）、同行するインフルエンサーの氏名、スタッフが貼り付けた日程文を収集します。',
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
        body: '当社は、個人情報を下表の期間に限り保管し、期間が過ぎたら第4条に従い遅滞なく破棄します。法令により保管が必要な情報は、韓国「電子商取引等における消費者保護に関する法律」（以下「電子商取引法」）および「国税基本法」が定める期間保管します。',
        table: {
          head: ['情報', '保管期間'],
          rows: [
            ['旅行準備の情報（乗車・降車場所、フライト、食事制限、リクエスト・メモ、ドライバーとのやり取り）', '旅行終了日から1か月'],
            ['予約しなかった方が旅行プランのプレビューに残した連絡先', '残した日から1か月'],
            ['会員アカウントと保存した旅行プラン', '退会するまで'],
            ['契約・決済の記録（予約番号、商品、金額、日付、予約者の氏名・メールアドレス）', '5年（電子商取引法施行令第6条）'],
            ['消費者の苦情または紛争処理に関する記録', '3年（電子商取引法施行令第6条）'],
            ['表示・広告に関する記録', '6か月（電子商取引法施行令第6条）'],
            ['税務上の帳簿と証憑書類', '5年（国税基本法第85条の3）'],
            ['当社のメール受信箱（お問い合わせ箱）で受け付けたお問い合わせ', '対応完了から30日'],
            ['サイトの見積もりフォームから送られたお問い合わせ', '対応完了から30日'],
            ['サイトのチャットの会話（AIチャットを含む）', '最後の会話から1か月'],
            ['レビュー・コミュニティ投稿（本文と写真）', 'ご自身で削除するか退会するまで'],
            ['協力会社ポータルの予約（インフルエンサーの氏名、スタッフのメールアドレス、日付・ルート）', '運行終了から1か月'],
            ['レンタカー会社・ドライバーに提供した情報（第7条）', '運行終了から1か月'],
            ['自動で収集される記録（アクセス記録・エラー記録・訪問統計）', '各事業者の方針と設定による期間（第6条）'],
          ],
        },
      },
      {
        title: '第4条（個人情報の破棄の手続きおよび方法）',
        body: '当社は、個人情報の保有期間が終了した場合、または処理目的が達成され個人情報が不要になった場合は、遅滞なく当該個人情報を破棄します。',
        list: [
          '破棄の手続き：第3条の表の期間が過ぎた個人情報を選び、遅滞なく削除します。',
          '法令による保存：第3条の表のうち法令により保管する情報（契約・決済の記録、苦情・紛争処理の記録、表示・広告の記録、税務上の帳簿）は、他の個人情報と分けてその期間のみ保管した後に破棄します。',
          '破棄の方法：電子ファイルは復元できない方法で削除します。当社は個人情報を紙で保管していません。',
        ],
      },
      {
        title: '第5条（個人情報の処理業務の委託）',
        body: '当社は、円滑なサービス提供のため、以下のとおり個人情報の処理業務を委託しています。委託業務の内容または受託者が変わった場合は、本プライバシーポリシーでお知らせします。',
        list: [
          'Google LLC：会員ログイン、予約・旅行プラン情報とレビュー写真の保存、予約案内メールの送信、予約管理台帳、AIによる旅行プランの作成・修正、翻訳（お問い合わせ・コミュニティ投稿）、相談、協力会社ポータルの日程文の読み取り（Claudeが使えない場合のGemini）、モバイル予約確認カード、訪問統計（同意した場合）',
          'Anthropic PBC：AIによる旅行プランの作成・修正、翻訳（お問い合わせ・コミュニティ投稿）、相談、協力会社ポータルの日程文の読み取り（Claude、優先して使用）',
          'Vercel Inc.：ウェブサイトとサーバーの運用',
          'PayPal Pte. Ltd.：決済処理および返金',
          'Inngest Inc.：AIによる旅行プラン作成後の仕上げ処理',
          'Functional Software, Inc.（Sentry）：サービスエラーの確認',
          'Telegram Messenger Inc.：当社の運営者への予約・配車・決済・お問い合わせ・コミュニティ投稿の確認の通知、サイトのチャット相談の中継、レンタカー会社・ドライバーへの配車依頼の送信',
          'PostHog Inc.：訪問統計（同意した場合）',
        ],
        footer: 'ルート検索・地図：Naver Cloud・TMAP・ODsayには、ルート検索に必要な住所・座標のみを送り、氏名・連絡先は送りません。Naverの地図はお客様のブラウザがNaverから直接読み込むため、その際Naverは接続IPアドレス・ブラウザ情報・閲覧中のページのアドレスを受け取ります。',
      },
      {
        title: '第6条（個人情報の国外移転）',
        body: '当社は、サービス提供のため、以下のとおり個人情報を国外へ移転しています。契約の履行に必要な移転は、韓国「個人情報保護法」第28条の8第1項第3号イ（本ポリシーでの公開）に基づいて行い、訪問統計（Google Analytics・PostHog）はCookieのお知らせで同意した場合にのみ移転します。',
        table: {
          head: ['移転先（連絡先）', '移転先の国', '移転の時期・方法', '移転する項目', '利用目的', '保有・利用期間'],
          rows: [
            ['Google LLC（googlekrsupport@google.com）', '米国', 'サービス利用時にネットワークで送信', '第1条の個人情報すべて', 'ログイン、情報の保存、メール送信、予約管理台帳、モバイル予約確認カード、訪問統計（同意した場合）', '第3条の期間'],
            ['Anthropic PBC（privacy@anthropic.com）', '米国', 'AI機能の利用時にネットワークで送信', '氏名、旅行情報（日程・都市・人数・宿泊先の住所・フライト時刻・食事制限・リクエスト）、AIチャットの会話内容、翻訳するお問い合わせ内容とコミュニティ投稿、協力会社ポータルの日程文', 'AIによる旅行プランの作成・修正、翻訳（お問い合わせ・コミュニティ投稿）、相談、協力会社ポータルの日程文の読み取り（Claude、優先して使用）。お客様の情報をAIの学習に使いません。', '処理後、移転先の方針で定める期間'],
            ['Google LLC — Gemini（googlekrsupport@google.com）', '米国', 'Claudeが使えない場合にネットワークで送信', 'Claudeと同じ項目', 'AIによる旅行プランの作成・修正、翻訳（お問い合わせ・コミュニティ投稿）、相談、協力会社ポータルの日程文の読み取り（有料接続）。お客様の情報をAIの学習に使いません。', '処理後、移転先の方針で定める期間'],
            ['Vercel Inc.（privacy@vercel.com）', '米国（サーバー：ワシントンD.C.）', 'サービス利用時にネットワークで送信', 'サービス利用中にやり取りされる個人情報、アクセス記録（IPアドレスなど）', 'ウェブサイトとサーバーの運用', '処理後、移転先の方針で定める期間'],
            ['PayPal Pte. Ltd.（韓国内の代理人：PayPal Korea Services LLC、ソウル特別市江南区永東大路511 トレードタワー27・30階、+82-2-737-5775、skrprivacy@paypal.com）', 'シンガポール', '決済・返金時にネットワークで送信', '決済金額、注文内容（商品・日付・人数）、返金内容', '決済処理および返金', '第3条の期間（PayPalが法令により別途保管する記録はPayPalの方針による）'],
            ['Inngest Inc.（600 California St, Suite 1200, San Francisco, CA 94109, USA・hello@inngest.com）', '米国', 'AIの旅行プラン作成後にネットワークで送信', '氏名、メールアドレス、会員番号、旅行情報（日程・都市・人数・宿泊先の住所・到着・出発空港・フライト時刻・食事制限・旅行の好み・リクエスト）、AIが作成した旅行プラン、PayPal注文番号、クーポンコード', 'AIによる旅行プラン作成後の仕上げ処理', '処理後、移転先の方針で定める期間'],
            ['Functional Software, Inc.（Sentry）（compliance@sentry.io）', 'ドイツ（フランクフルト）で保存・会社は米国', 'エラー発生時にネットワークで送信', 'エラーの内容、エラーが発生したページのアドレス、端末・ブラウザ情報、接続IPアドレス、一部のエラー記録に含まれる会員番号・アカウントのメールアドレス', 'サービスエラーの確認', '移転先の方針で定める期間'],
            ['Telegram Messenger Inc.（EU代理人EDPOの問い合わせフォーム：edpo.com/telegram-gdpr-data-request）', 'プライバシーポリシーに国の記載なし', '通知・チャットの発生時にネットワークで送信', '氏名、メールアドレス、電話番号、WhatsApp ID、予約番号と予約内容（商品・日付・人数・車種）、乗車・降車場所、フライト番号・ターミナル・荷物の数、メモ・リクエスト、決済金額・クーポン・PayPal取引番号、見積もりのお問い合わせ内容（原文と翻訳）、サイトのチャットの会話、協力会社ポータルの予約（予約者のメールアドレス・日付・ルート）、確認が必要なコミュニティ投稿のタイトル・投稿者のメールアドレス', '当社の運営者への予約・配車・決済・お問い合わせ・コミュニティ投稿の確認の通知、サイトのチャット相談の中継、レンタカー会社・ドライバーへの配車依頼の送信', '第3条の期間'],
            ['PostHog Inc.（privacy@posthog.com）', '米国', 'Cookieのお知らせで同意した後、訪問時にネットワークで送信', '閲覧したページ、端末・ブラウザ情報、Cookie ID、接続IPアドレス', '訪問統計', '移転先の方針で定める期間'],
          ],
        },
        contacts: [
          { label: '移転の拒否方法および効果', value: '第11条の保護責任者へのメールで国外移転を拒否できます。ただし、上記の事業者はログイン・予約・決済・旅行プラン作成に欠かせないため、拒否された場合は該当サービスをご利用いただけません。訪問統計（Google Analytics・PostHog）は「Cookie・分析設定」からいつでも拒否でき、拒否してもサービスの利用に制限はありません。' },
        ],
        footer: '連絡用メッセンジャー：当社は、お客様が選んだメッセンジャーでご連絡します。会話はそのメッセンジャー会社のサーバーに残り、その会社のプライバシーポリシーが適用されます。',
        footerList: [
          'WhatsApp：WhatsApp LLC（Metaグループ、米国）',
          'カカオトーク：Kakao Corp.（株式会社カカオ、韓国）',
          'LINE：LY Corporation（LINEヤフー株式会社、日本）',
          'WeChat：WeChat International Pte. Ltd.（Tencentグループ、シンガポール）。中国本土のWeixin：Shenzhen Tencent Computer Systems Company Limited（中国）',
        ],
      },
      {
        title: '第7条（個人情報の第三者提供）',
        body: '当社は、お客様の同意がある場合や法律に特別の定めがある場合などに限り、個人情報を第三者に提供します。車両のご予約時に同意をいただき、以下のとおり提供します。',
        list: [
          '提供先：配車依頼を承諾したレンタカー会社とその会社のドライバー。配車依頼は複数のレンタカー会社に同時に送り、承諾した会社がそのご予約を担当します。担当する会社の名称は、お問い合わせいただければお知らせします。',
          '提供目的：送迎・移動など、ご予約の車両サービスの提供',
          '提供項目：予約番号、商品、利用日、人数、乗車・降車場所、リクエスト',
          '保有・利用期間：運行終了から1か月。配車依頼メッセージの予約情報は、ドライバーが承諾または辞退したとき、または応答がなく依頼が終了したときに、ドライバーのチャットから削除されます。',
          '同意を拒否することができますが、拒否された場合は車両のご予約をご利用いただけません。',
        ],
      },
      {
        title: '第8条（情報主体の権利・義務およびその行使方法）',
        body: 'お客様は当社に対し、いつでも個人情報の閲覧・訂正・削除・処理停止を求め、または同意を撤回することができます。',
        list: [
          '閲覧の請求：当社が保有するご自身の個人情報とその処理内容を確認できます。',
          '訂正・削除の請求：誤った個人情報の訂正、または個人情報の削除を求めることができます。ただし、他の法令で保存が定められている個人情報は削除を求めることができません。',
          '処理停止の請求および同意の撤回：個人情報の処理の停止、または同意の撤回を求めることができます。法令で定める場合は当社が請求をお断りすることがあり、その際は理由をお知らせします。',
        ],
        footer: '権利は次の方法で行使できます：',
        footerList: [
          '第11条の個人情報保護責任者にメール（cocotripkr@gmail.com）でご請求ください。当社は10日以内に対応し、結果をお知らせします。',
          '法定代理人や委任を受けた方などの代理人を通じて請求することもできます。この場合は委任状を添えてお送りください。',
          '当社は、請求者がご本人または正当な代理人であることを確認します。',
          'ご自身の個人情報は正確に入力し、他人の個人情報を入力しないでください。同行者の情報を入力する場合は、事前にその方の同意を得てください。',
        ],
      },
      {
        title: '第9条（個人情報の安全性確保措置）',
        body: '当社は、個人情報を安全に処理するため、以下の措置を講じています。',
        list: [
          '管理的措置：お客様の個人情報を取り扱うのは代表者1名です。旅行プランの作成時にはAI（Claude、使えない場合はGemini）に情報を渡しますが、これらの事業者はお客様の情報をAIの学習に使いません（第6条）。',
          '技術的措置：ウェブサイトとサーバー間のすべての通信を暗号化（HTTPS）し、会員がご自身の情報にのみアクセスできるようデータベースのアクセス権限を制限し、管理者機能は指定されたアカウントのみが使用できます。',
          '決済情報・パスワードの非保管：カード番号などの決済手段の情報はPayPalが直接処理し、ログインはGoogle・LINE・電話番号認証で行うため、当社はこれらの情報およびパスワードを保管しません。',
          '物理的措置：個人情報は、主に入退室を管理し保存データを暗号化している受託者（Google）のデータセンターに保管しています。当社は個人情報を紙で保管していません。',
        ],
      },
      {
        title: '第10条（Cookieなど個人情報の自動収集装置の設置・運用および拒否）',
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
        seeAlso: { text: '訪問統計を行う事業者とその国は、第6条（個人情報の国外移転）でご確認いただけます。', href: '#article-6' },
      },
      {
        title: '第11条（個人情報保護責任者）',
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
        title: '第12条（プライバシーポリシーの変更）',
        body: `本プライバシーポリシーは${DATE.ja}から適用されます。内容が変更される場合は、施行の7日前からこのページでお知らせし、以前の版もこのページでご覧いただけるようにします。`,
        list: [
          `${DATE.ja}：個人情報の破棄、処理の委託、国外移転、第三者提供、情報主体の権利、安全性確保措置、Cookie、ポリシー変更の条項を追加し、収集項目と保管期間を補いました。個人情報保護責任者の条項は第4条から第11条に移りました。`,
          '以前の版：このページ下部の「以前のプライバシーポリシーを見る」を開くとご覧いただけます。',
        ],
      },
    ],
  },
  zh: {
    pageTitle: '隐私政策',
    changeSummary: '新增个人信息销毁、处理委托、跨境转移、向第三方提供、信息主体权利、安全保障措施、Cookie及政策变更条款，并补充了收集项目和保存期限。个人信息保护负责人条款由第四条移至第十一条。',
    articles: [
      {
        title: '第一条（收集的个人信息）',
        body: '주식회사 코코트립（COCOTRIP，以下简称"本公司"）为提供顺畅的客户咨询及服务，收集以下个人信息。',
        list: [
          '必填项目：姓名、联系方式（电话号码）、电子邮箱',
          '选填项目：即时通讯软件类型及账号（WhatsApp、KakaoTalk、LINE、微信）、（机场接机时）航班号、航站楼、到达时间及行李件数、其他附加需求',
          '制定行程或预订时：旅行日期及城市、人数及同行类型、住宿地址、接送或碰面地点、航班到达及出发时间、饮食限制（清真、纯素、素食、过敏）及饮食偏好、旅行偏好',
          '登录时：Google或LINE账号的姓名、电子邮箱及头像；使用手机号登录时的手机号码',
          '付款时：付款金额、PayPal交易编号、付款人姓名及电子邮箱（银行卡号等支付信息由PayPal直接接收，本公司不接收）',
          '撰写评价或社区帖子、聊天或咨询时：评价内容及照片、社区帖子（标题、正文、照片、显示名称、作者的账号电子邮箱）、AI聊天及网站聊天对话内容、咨询内容（含报价咨询）',
          '自动收集：服务使用记录、访问日志、设备及浏览器信息、Cookie、访问IP信息',
        ],
        footer: '特别说明：',
        footerList: [
          '敏感信息：饮食限制（过敏、清真、素食等）可能反映健康状况或信仰，本公司将其视为敏感信息，仅在另行征得您的同意后处理。',
          '未满14周岁的儿童：未满14周岁者不能自行注册或预订。包含儿童的预订，由监护人填写儿童信息并表示同意。',
          '合作方门户：在合作方（广告代理公司）员工使用的预订门户中，本公司收集员工的登录电子邮箱、预订内容（日期、时间、出发地、目的地、途经地、机场、备注）、同行网红的姓名以及员工粘贴的日程文本。',
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
        body: '本公司仅在下表所列期限内保存个人信息，期限届满后依照第四条立即销毁。法律法规要求保存的信息，按照韩国《电子商务等消费者保护法》（以下简称"电子商务法"）及《国税基本法》规定的期限保存。',
        table: {
          head: ['信息', '保存期限'],
          rows: [
            ['旅行准备信息（上车及下车地点、航班、饮食限制、需求及备注、与司机往来的内容）', '旅行结束之日起1个月'],
            ['未预订者在行程预览中留下的联系方式', '留下之日起1个月'],
            ['会员账号及保存的行程', '至注销会员时为止'],
            ['合同及付款记录（预订编号、产品、金额、日期、预订人姓名及电子邮箱）', '5年（电子商务法施行令第6条）'],
            ['消费者投诉或争议处理记录', '3年（电子商务法施行令第6条）'],
            ['标示及广告记录', '6个月（电子商务法施行令第6条）'],
            ['税务账簿及凭证', '5年（国税基本法第85条之3）'],
            ['通过本公司电子邮箱（咨询箱）收到的咨询', '处理完毕后30日'],
            ['通过网站报价咨询表单提交的咨询', '处理完毕后30日'],
            ['网站聊天对话（含AI聊天）', '最后一次对话后1个月'],
            ['评价及社区帖子（正文及照片）', '至您自行删除或注销会员时为止'],
            ['合作方门户的预订（网红姓名、员工电子邮箱、日期及路线）', '行驶结束后1个月'],
            ['向租车公司及司机提供的信息（第七条）', '行驶结束后1个月'],
            ['自动收集的记录（访问记录、错误记录、访问统计）', '依各企业的政策及设置确定的期限（第六条）'],
          ],
        },
      },
      {
        title: '第四条（个人信息的销毁程序及方法）',
        body: '个人信息的保留期限届满，或处理目的已实现、不再需要该个人信息时，本公司将立即销毁该个人信息。',
        list: [
          '销毁程序：选出已超过第三条表中期限的个人信息，并立即删除。',
          '依法保存：第三条表中依法需保存的信息（合同及付款记录、投诉及争议处理记录、标示及广告记录、税务账簿）将与其他个人信息分开保管，仅在规定期限内保存，期满后销毁。',
          '销毁方法：电子文件以无法恢复的方式删除。本公司不以纸质形式保存个人信息。',
        ],
      },
      {
        title: '第五条（个人信息处理业务的委托）',
        body: '为顺利提供服务，本公司将个人信息处理业务委托如下。委托业务内容或受托方发生变更时，本公司将通过本隐私政策告知。',
        list: [
          'Google LLC：会员登录、预订及行程信息与评价照片的存储、预订通知邮件发送、预订管理台账、AI行程的制定及修改、翻译（咨询内容及社区帖子）、聊天咨询、读取合作方门户的日程文本（无法使用Claude时使用Gemini）、移动端预订确认卡、访问统计（经同意时）',
          'Anthropic PBC：AI行程的制定及修改、翻译（咨询内容及社区帖子）、聊天咨询、读取合作方门户的日程文本（Claude，优先使用）',
          'Vercel Inc.：网站及服务器运营',
          'PayPal Pte. Ltd.：支付处理及退款',
          'Inngest Inc.：AI行程制定后的收尾处理',
          'Functional Software, Inc.（Sentry）：服务错误排查',
          'Telegram Messenger Inc.：向本公司运营者发送预订、派车、付款、咨询及社区帖子审核通知，中转网站聊天咨询，向租车公司及司机发送派车请求',
          'PostHog Inc.：访问统计（经同意时）',
        ],
        footer: '路线查询及地图：向Naver Cloud、TMAP及ODsay仅发送查询路线所需的地址和坐标，不发送姓名及联系方式。Naver地图由您的浏览器直接从Naver加载，届时Naver会收到您的访问IP、浏览器信息及所浏览页面的地址。',
      },
      {
        title: '第六条（个人信息的跨境转移）',
        body: '为提供服务，本公司将个人信息转移至境外，具体如下。履行合同所需的转移，依据韩国《个人信息保护法》第28条之8第1款第3项第1目（在本隐私政策中公开）进行；访问统计（Google Analytics、PostHog）仅在您于Cookie提示中同意后转移。',
        table: {
          head: ['接收方（联系方式）', '转移国家', '转移时间及方式', '转移项目', '使用目的', '保留及使用期限'],
          rows: [
            ['Google LLC（googlekrsupport@google.com）', '美国', '使用服务时通过网络传输', '第一条所列全部个人信息', '登录、信息存储、邮件发送、预订管理台账、移动端预订确认卡、访问统计（经同意时）', '第三条规定的期限'],
            ['Anthropic PBC（privacy@anthropic.com）', '美国', '使用AI功能时通过网络传输', '姓名、行程信息（日期、城市、人数、住宿地址、航班时间、饮食限制、需求）、AI聊天对话内容、需翻译的咨询内容及社区帖子、合作方门户的日程文本', 'AI行程的制定及修改、翻译（咨询内容及社区帖子）、聊天咨询、读取合作方门户的日程文本（Claude，优先使用）。不将客户信息用于AI训练。', '处理后按接收方政策规定的期限'],
            ['Google LLC — Gemini（googlekrsupport@google.com）', '美国', '无法使用Claude时通过网络传输', '与Claude相同的项目', 'AI行程的制定及修改、翻译（咨询内容及社区帖子）、聊天咨询、读取合作方门户的日程文本（付费连接）。不将客户信息用于AI训练。', '处理后按接收方政策规定的期限'],
            ['Vercel Inc.（privacy@vercel.com）', '美国（服务器：华盛顿特区）', '使用服务时通过网络传输', '使用服务过程中传输的个人信息、访问记录（IP地址等）', '网站及服务器运营', '处理后按接收方政策规定的期限'],
            ['PayPal Pte. Ltd.（韩国境内代理人：PayPal Korea Services LLC，首尔特别市江南区永东大路511 Trade Tower 27、30层，+82-2-737-5775，skrprivacy@paypal.com）', '新加坡', '付款及退款时通过网络传输', '付款金额、订单内容（产品、日期、人数）、退款内容', '支付处理及退款', '第三条规定的期限（PayPal依法另行保存的记录按PayPal的政策处理）'],
            ['Inngest Inc.（600 California St, Suite 1200, San Francisco, CA 94109, USA；hello@inngest.com）', '美国', '生成AI行程后通过网络传输', '姓名、电子邮箱、会员编号、行程信息（日期、城市、人数、住宿地址、到达及出发机场、航班时间、饮食限制、旅行偏好、需求）、AI生成的行程、PayPal订单号、优惠券代码', 'AI行程制定后的收尾处理', '处理后按接收方政策规定的期限'],
            ['Functional Software, Inc.（Sentry）（compliance@sentry.io）', '存储于德国（法兰克福）；公司位于美国', '发生错误时通过网络传输', '错误内容、发生错误的页面地址、设备及浏览器信息、访问IP信息、部分错误记录中的会员编号及账号电子邮箱', '服务错误排查', '按接收方政策规定的期限'],
            ['Telegram Messenger Inc.（欧盟代表EDPO的申请表单：edpo.com/telegram-gdpr-data-request）', '其隐私政策未载明国家', '发送通知或聊天消息时通过网络传输', '姓名、电子邮箱、电话号码、WhatsApp账号、预订编号及预订内容（产品、日期、人数、车型）、上车及下车地点、航班号、航站楼及行李件数、备注及需求、付款金额、优惠券及PayPal交易编号、报价咨询内容（原文及译文）、网站聊天对话、合作方门户的预订（预订人电子邮箱、日期及路线）、待审核社区帖子的标题及作者电子邮箱', '向本公司运营者发送预订、派车、付款、咨询及社区帖子审核通知，中转网站聊天咨询，向租车公司及司机发送派车请求', '第三条规定的期限'],
            ['PostHog Inc.（privacy@posthog.com）', '美国', '在Cookie提示中同意后访问时通过网络传输', '浏览的页面、设备及浏览器信息、Cookie ID、访问IP信息', '访问统计', '按接收方政策规定的期限'],
          ],
        },
        contacts: [
          { label: '拒绝转移的方法及后果', value: '您可通过电子邮件联系第十一条的保护负责人，拒绝个人信息跨境转移。但上述企业是登录、预订、付款及制定行程所必需的，拒绝后将无法使用相关服务。访问统计（Google Analytics、PostHog）可随时在"Cookie 与分析设置"中拒绝，拒绝后不影响服务的使用。' },
        ],
        footer: '联系用即时通讯软件：本公司通过您选择的即时通讯软件与您联系。对话内容保存在该软件公司的服务器上，并适用该公司的隐私政策。',
        footerList: [
          'WhatsApp：WhatsApp LLC（Meta旗下，美国）',
          'KakaoTalk：Kakao Corp.（韩国）',
          'LINE：LY Corporation（日本）',
          '微信（WeChat）：WeChat International Pte. Ltd.（腾讯旗下，新加坡）。中国大陆的微信（Weixin）：深圳市腾讯计算机系统有限公司（Shenzhen Tencent Computer Systems Company Limited，中国）',
        ],
      },
      {
        title: '第七条（向第三方提供个人信息）',
        body: '本公司仅在您同意或法律有特别规定等情形下向第三方提供个人信息。预订车辆时，本公司在征得您同意后按以下方式提供。',
        list: [
          '接收方：接受您预订派车请求的租车公司及其司机。派车请求会同时发送给多家租车公司，由接受请求的公司负责该预订。如需了解被指派公司的名称，请与我们联系。',
          '提供目的：提供接送、出行等您预订的车辆服务',
          '提供项目：预订编号、产品、使用日期、人数、上车及下车地点、需求',
          '保留及使用期限：行驶结束后1个月。司机接受或拒绝派车请求时，或请求因无人回应而结束时，派车消息中的预订信息将从司机的聊天窗口中删除。',
          '您可以拒绝同意，但拒绝后将无法预订车辆。',
        ],
      },
      {
        title: '第八条（信息主体的权利、义务及行使方法）',
        body: '您可随时向本公司要求查阅、更正、删除个人信息或停止处理，也可撤回同意。',
        list: [
          '查阅：您可以查看本公司持有的您的个人信息及其处理情况。',
          '更正及删除：您可以要求更正有误的个人信息或删除个人信息。但其他法律法规规定需保存的个人信息不得要求删除。',
          '停止处理及撤回同意：您可以要求停止处理您的个人信息或撤回同意。在法律法规规定的情形下，本公司可能拒绝该要求，并将告知理由。',
        ],
        footer: '您可通过以下方式行使上述权利：',
        footerList: [
          '请通过电子邮件（cocotripkr@gmail.com）联系第十一条的个人信息保护负责人。本公司将在10日内处理并告知结果。',
          '您也可以通过法定代理人或受委托人等代理人提出要求，此时请一并提交委托书。',
          '本公司将确认提出要求者是否为本人或正当代理人。',
          '请准确填写您本人的个人信息，不得填写他人的个人信息。填写同行者信息时，请事先征得其同意。',
        ],
      },
      {
        title: '第九条（个人信息安全保障措施）',
        body: '本公司为安全处理个人信息，采取以下措施。',
        list: [
          '管理措施：处理客户个人信息的人员仅为代表1人。制定行程时会将信息交给AI（Claude；无法使用时为Gemini），这些服务商不会将客户信息用于AI训练（第六条）。',
          '技术措施：网站与服务器之间的所有通信均加密（HTTPS）；通过限制数据库访问权限，会员只能访问本人信息；管理员功能仅限指定账号使用。',
          '不保存支付信息及密码：银行卡号等支付信息由PayPal直接处理，登录通过Google、LINE或手机号验证进行，因此本公司不保存此类信息及密码。',
          '物理措施：个人信息主要存储于受托方（Google）的数据中心，该数据中心实行出入管控并对存储数据加密。本公司不以纸质形式保存个人信息。',
        ],
      },
      {
        title: '第十条（Cookie等个人信息自动收集装置的设置、运营及拒绝）',
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
        seeAlso: { text: '提供访问统计服务的企业及其所在国家，请参阅第六条（个人信息的跨境转移）。', href: '#article-6' },
      },
      {
        title: '第十一条（个人信息保护负责人）',
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
        title: '第十二条（隐私政策的变更）',
        body: `本隐私政策自${DATE.zh}起施行。如有变更，将自施行前7日起在本页面提前告知，并在本页面保留以往版本供查阅。`,
        list: [
          `${DATE.zh}：新增个人信息销毁、处理委托、跨境转移、向第三方提供、信息主体权利、安全保障措施、Cookie及政策变更条款，并补充了收集项目和保存期限。个人信息保护负责人条款由第四条移至第十一条。`,
          '以往版本：打开本页面底部的"查看以往版本的隐私政策"即可查阅。',
        ],
      },
    ],
  },
};

/** Wrapper labels (2026-10-11, home vocabulary) and the upcoming-change notice (2026-11-20). The legal text above is untouched. */
const LABELS: Record<PolicyLang, {
  kicker: string;
  article: string;
  noticeTitle: string;
  notice: (date: string) => string;
  changes: string;
  previous: string;
  until: (date: string) => string;
}> = {
  ko: {
    kicker: '법적 고지',
    article: '조항',
    noticeTitle: '개정 예정 안내',
    notice: (d) => `새 개인정보처리방침은 ${d}부터 시행됩니다. 그 전까지는 이전 판이 적용됩니다.`,
    changes: '바뀌는 점:',
    previous: '이전 개인정보처리방침 보기',
    until: (d) => `${d}까지 적용`,
  },
  en: {
    kicker: 'Legal',
    article: 'Article',
    noticeTitle: 'Upcoming change',
    notice: (d) => `The new Privacy Policy takes effect on ${d}. Until then, the previous version applies.`,
    changes: 'What changes:',
    previous: 'View the previous Privacy Policy',
    until: (d) => `applied until ${d}`,
  },
  ja: {
    kicker: '法的情報',
    article: '条項',
    noticeTitle: '改定予定のお知らせ',
    notice: (d) => `新しいプライバシーポリシーは${d}から施行されます。それまでは以前の版が適用されます。`,
    changes: '主な変更点：',
    previous: '以前のプライバシーポリシーを見る',
    until: (d) => `${d}まで適用`,
  },
  zh: {
    kicker: '法律信息',
    article: '条款',
    noticeTitle: '修订预告',
    notice: (d) => `新的隐私政策自${d}起施行。在此之前适用以往版本。`,
    changes: '主要变更：',
    previous: '查看以往版本的隐私政策',
    until: (d) => `适用至${d}`,
  },
};

const num = (i: number) => String(i + 1).padStart(2, '0');

const PageSection = ({ index, title, chip, wide, children }: { index: number; title: string; chip: string; wide?: boolean; children: ReactNode }) => (
  <section id={`article-${index + 1}`} className="scroll-mt-24 border-t border-ec-line p-5 first:border-t-0 md:p-8">
    <div className="flex items-start justify-between gap-4">
      <h2 className="ec-h3"><span className="ec-figure mr-2">{num(index)}</span>{title}</h2>
      <span className="ec-chip shrink-0">{chip}</span>
    </div>
    <div className={`ec-body mt-4 space-y-4 text-ec-ink-2 ${wide ? '' : 'max-w-[62ch]'}`}>{children}</div>
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

/** Desktop: a real table (a wide one scrolls inside its own box). Phone: one card per row, labelled by the header. */
const PolicyTable = ({ table, isMobile, label }: { table: PolicyTableData; isMobile: boolean; label: string }) =>
  isMobile ? (
    <div className="space-y-3">
      {table.rows.map((row, r) => (
        <dl key={r} className="space-y-2 rounded-xl border border-ec-line p-4">
          {row.map((cell, c) => (
            <div key={c}>
              <dt className="text-[12px] font-semibold text-white/70">{table.head[c]}</dt>
              <dd className="mt-0.5 text-white/55">{cell}</dd>
            </div>
          ))}
        </dl>
      ))}
    </div>
  ) : (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={label}>
      <table className={`w-full border-collapse text-left text-[14px] leading-relaxed ${table.head.length > 3 ? 'min-w-[760px]' : ''}`}>
        <thead>
          <tr>
            {table.head.map((h, i) => (
              <th key={i} scope="col" className="border-b border-ec-line px-2 py-2 align-top font-semibold text-ec-ink">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} className="border-b border-ec-line px-2 py-2 align-top">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

const ArticleBody = ({ a, isMobile }: { a: PolicyArticle; isMobile: boolean }) => {
  const muted = isMobile ? 'text-white/55' : '';
  return (
    <>
      <p>{a.body}</p>
      {a.list && (
        <ul className={`list-disc list-inside space-y-2 ${muted}`}>
          {a.list.map((item, i) => <li key={i}>{item}</li>)}
        </ul>
      )}
      {a.table && <PolicyTable table={a.table} isMobile={isMobile} label={a.title} />}
      {a.contacts && (
        <ul className={`list-none space-y-2 ${muted}`}>
          {a.contacts.map((c, i) => <li key={i}><strong>{c.label}:</strong> {c.value}</li>)}
        </ul>
      )}
      {a.footer && <p>{a.footer}</p>}
      {a.footerList && (
        <ul className={`list-disc list-inside space-y-2 ${muted}`}>
          {a.footerList.map((item, i) => <li key={i}>{item}</li>)}
        </ul>
      )}
      {a.seeAlso && (
        <p><a href={a.seeAlso.href} className="font-semibold underline underline-offset-4">{a.seeAlso.text}</a></p>
      )}
    </>
  );
};

export default function Privacy() {
  const { language, t, changeLanguage } = useLanguage();
  const isMobile = useIsMobile();
  const lang: PolicyLang = language in CONTENT ? (language as PolicyLang) : 'en';
  const content = CONTENT[lang];
  const labels = LABELS[lang];
  const pending = isRevisionPending();
  const openPrevious = () => {
    const el = document.getElementById('privacy-previous');
    if (el instanceof HTMLDetailsElement) el.open = true;
  };

  usePageMeta({
    title: content.pageTitle,
    description: t.pageMeta?.privacy?.description || 'CocoTrip privacy policy — how we collect, use and protect your personal information.',
  });

  return (
    <div className={isMobile ? 'm-page' : 'min-h-screen bg-[#0a0b14]'}>
      <Header language={language} t={t} onLanguageChange={changeLanguage} />
      <main className="ec-root home-dope home-dope--static" lang={language}>
        <section className="border-b border-ec-line bg-ec-sunken">
          <div className="ec-container-wide py-12 md:py-16">
            <p className="ec-eyebrow home-dope-eyebrow">{labels.kicker} · {content.pageTitle}</p>
            <h1 className="ec-h2 mt-4">{content.pageTitle}</h1>

            {/* 개정 예정 안내 — 시행일(한국 시간) 전까지만 보인다. 운영자 결정 2026-11-20: 운영 반영일 + 7일에 시행, 그동안 미리 알림. */}
            {pending && (
              <div role="note" className="mt-6 max-w-4xl rounded-xl border border-[#B668FC]/40 bg-[#B668FC]/10 p-4 text-[14px] leading-relaxed text-ec-ink-2">
                <p className="font-semibold text-ec-ink">{labels.noticeTitle}</p>
                <p className="mt-1">{labels.notice(DATE[lang])}</p>
                <p className="mt-1">{labels.changes} {content.changeSummary}</p>
                <a href="#privacy-previous" onClick={openPrevious} className="inline-flex min-h-[44px] items-center font-semibold text-ec-ink underline underline-offset-4">
                  {labels.previous}
                </a>
              </div>
            )}

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
            {content.articles.map((a, idx) => (
              <PageSection key={idx} index={idx} title={a.title} chip={labels.article} wide={(a.table?.head.length || 0) > 3}>
                <ArticleBody a={a} isMobile={isMobile} />
              </PageSection>
            ))}
          </article>

          {/* 이전 판 — 시행일 전에는 이 판이 적용되고, 그 뒤에도 볼 수 있게 둔다. */}
          <details id="privacy-previous" className="ec-card mt-8 max-w-4xl scroll-mt-24 p-5 md:p-8">
            <summary className="flex min-h-[44px] cursor-pointer items-center font-semibold text-ec-ink">
              {labels.previous} ({labels.until(formatPolicyDate(PRIVACY_EFFECTIVE_DATE, lang, -1))})
            </summary>
            {PREVIOUS_PRIVACY[lang].articles.map((a, i) => (
              <section key={i} className="mt-6 border-t border-ec-line pt-6">
                <h3 className="ec-h3">{a.title}</h3>
                <div className="ec-body mt-4 max-w-[62ch] space-y-4 text-ec-ink-2">
                  <ArticleBody a={a} isMobile={isMobile} />
                </div>
              </section>
            ))}
          </details>
        </div>
      </main>
      {!isMobile && <Footer t={t} />}
    </div>
  );
}
