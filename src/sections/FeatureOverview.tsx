import { Link } from 'react-router-dom';
import { Bot, Car, Map, Route, MessagesSquare, CalendarCheck } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { MotionSection } from '@/components/MotionSection';

/**
 * FeatureOverview — UIUX 가이드 P2 "6대 기능 총람" 데스크톱 랜딩 정합 (2026-07-13).
 * AI Planner · Tours · Charter · Route Map · Community · My Bookings 6기능 컴팩트 스트립.
 * HeroCards(서비스 CTA 카드)와 역할 구분: 여기는 "무엇이 있는지" 한눈 총람.
 * 정직 원칙: 전부 실존 기능만 (Route Map = AI 플랜 상세의 실경로 지도).
 * lazy chunk 전용 — eager 번들 134KB 캡 보호를 위해 i18n 도 로컬 객체(en.json 무접촉).
 */

type Lang = 'ko' | 'en' | 'ja' | 'zh';

const FL: Record<Lang, { heading: string; sub: string; items: [string, string][] }> = {
  en: {
    heading: 'Six ways CocoTrip covers your trip',
    sub: 'One account for planning, booking, and getting around Korea',
    items: [
      ['Trip Planner', 'Personalized day-by-day itinerary in minutes'],
      ['Private Tours', 'Handpicked tours with driver included'],
      ['Charter', 'Airport pickup, day trips & multi-day van charter'],
      ['Route Map', 'Real transit routes on every AI plan'],
      ['Community', 'Ask travelers & locals — auto-translated'],
      ['My Bookings', 'Plans and bookings in one place'],
    ],
  },
  ko: {
    heading: '코코트립이 챙기는 6가지',
    sub: '계획부터 예약·이동까지 계정 하나로',
    items: [
      ['여행 플래너', '몇 분 만에 나만의 일자별 일정'],
      ['프라이빗 투어', '기사 포함 엄선 투어'],
      ['전세차량', '공항 픽업·당일·다일 차터'],
      ['경로 지도', '모든 AI 플랜에 실측 대중교통 경로'],
      ['커뮤니티', '여행자·현지인에게 질문 — 자동 번역'],
      ['내 예약', '플랜과 예약을 한곳에서'],
    ],
  },
  ja: {
    heading: 'CocoTripがカバーする6つの機能',
    sub: 'プランから予約・移動までアカウント一つで',
    items: [
      ['旅行プランナー', '数分でパーソナライズされた日別旅程'],
      ['プライベートツアー', 'ドライバー付き厳選ツアー'],
      ['チャーター', '空港送迎・日帰り・複数日の貸切車'],
      ['ルートマップ', '全AIプランに実測の交通ルート'],
      ['コミュニティ', '旅行者・現地の人に質問 — 自動翻訳'],
      ['マイ予約', 'プランと予約をひとつの場所で'],
    ],
  },
  zh: {
    heading: 'CocoTrip 为您覆盖的6大功能',
    sub: '从规划到预订、出行，一个账号搞定',
    items: [
      ['行程规划', '几分钟生成专属每日行程'],
      ['私人旅游', '含司机的精选旅游产品'],
      ['包车服务', '机场接送·一日游·多日包车'],
      ['路线地图', '每份AI行程附实测交通路线'],
      ['社区', '向旅行者和当地人提问 — 自动翻译'],
      ['我的预订', '行程与预订集中管理'],
    ],
  },
};

const FEATURES = [
  { icon: Bot, to: '/planner' },
  { icon: Map, to: '/tours' },
  { icon: Car, to: '/charter' },
  { icon: Route, to: '/planner' },
  { icon: MessagesSquare, to: '/community' },
  { icon: CalendarCheck, to: '/my-plans' },
] as const;

export function FeatureOverview() {
  const { language } = useLanguage();
  const fl = FL[language as Lang] || FL.en;

  return (
    <MotionSection className="py-12 lg:py-16 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-8">
          <h2 className="text-xl sm:text-2xl font-bold text-white">{fl.heading}</h2>
          <p className="text-white/50 text-sm mt-1.5">{fl.sub}</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {FEATURES.map(({ icon: Icon, to }, i) => {
            const [title, desc] = fl.items[i];
            return (
              <Link
                key={to + i}
                to={to}
                className="group rounded-2xl p-4 bg-white/[0.03] border border-white/[0.07] hover:border-[#B668FC]/35 hover:bg-white/[0.05] transition-all"
              >
                <div className="w-9 h-9 rounded-xl bg-[#B668FC]/12 border border-[#B668FC]/25 flex items-center justify-center mb-3">
                  <Icon className="text-[#B668FC]" size={18} />
                </div>
                <p className="text-[13px] font-bold text-white leading-tight">{title}</p>
                <p className="text-[11px] text-white/45 leading-snug mt-1">{desc}</p>
              </Link>
            );
          })}
        </div>
      </div>
    </MotionSection>
  );
}
