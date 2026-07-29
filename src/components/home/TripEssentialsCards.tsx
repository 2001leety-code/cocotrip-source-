/**
 * 모바일 홈 "여행 준비" 2칸 — eSIM · 호텔 (2026-07-30).
 *
 * 🔴 이 컴포넌트는 **기본으로 꺼져 있다.** 두 개의 조건이 모두 맞아야 렌더한다.
 *
 *   1) `VITE_FEATURE_HOME_AFFILIATE === 'true'` — 운영자가 명시적으로 켤 때만
 *   2) `isAffiliateConfigured()` — Trip.com 제휴 ID 가 env 에 실제로 들어와 있을 때만
 *
 * 왜 이렇게까지 하나: 현재 Vercel 에는 `VITE_TRIPCOM_AFFILIATE_ID` · `VITE_TRIPCOM_SID` 가
 * 없다. 코드에는 옛 하드코딩 폴백(운영자 확인 전 계정)이 남아 있어서, 그냥 켜면
 * **확인되지 않은 계정으로 새 트래픽을 보내게 된다.** 수수료가 어디로 가는지 모르는 채
 * 노출을 늘리는 것은 매출이 아니라 부채다. 그래서 fail-closed — 설정이 없으면 숨긴다.
 *
 * 켜는 순서 (운영자)
 *   ① Trip.com 파트너 계정·수수료율 확인
 *   ② Vercel 에 VITE_TRIPCOM_AFFILIATE_ID / VITE_TRIPCOM_SID / VITE_TRIPCOM_SUB1 설정
 *   ③ VITE_FEATURE_HOME_AFFILIATE=true 설정 후 재배포
 *
 * 배치 원칙: **자체 상품(Smart Picks) 아래**에 둔다. 우리 상품이 먼저다.
 * 배너가 아니라 "준비물" 톤 — 낮은 카드 2칸, 제휴 고지 명시.
 */
import { Globe, Hotel } from 'lucide-react';
import {
  buildEsimLink, buildHotelListLink, isAffiliateConfigured,
} from '@/config/affiliateLinks';
import { AffiliateCard } from '@/components/AffiliateCard';
import { trackAffiliateClick } from '@/lib/affiliateTracking';

const PLACEMENT = 'home_mobile_essentials';

type Lang = 'ko' | 'en' | 'ja' | 'zh';

const COPY: Record<Lang, { heading: string; esimT: string; esimB: string; hotelT: string; hotelB: string; note: string }> = {
  ko: {
    heading: '여행 준비',
    esimT: 'eSIM', esimB: '도착 즉시 데이터',
    hotelT: '숙소', hotelB: '무료 취소 비교',
    note: 'Trip.com 파트너 링크 · 구매 시 CocoTrip에 수수료가 발생합니다',
  },
  en: {
    heading: 'Trip essentials',
    esimT: 'eSIM', esimB: 'Data the moment you land',
    hotelT: 'Hotels', hotelB: 'Compare free-cancel rates',
    note: 'Trip.com partner links — CocoTrip earns a commission on purchases',
  },
  ja: {
    heading: '旅の準備',
    esimT: 'eSIM', esimB: '到着後すぐ通信',
    hotelT: 'ホテル', hotelB: '無料キャンセルを比較',
    note: 'Trip.com パートナーリンク · 購入時に CocoTrip へ手数料が入ります',
  },
  zh: {
    heading: '出行准备',
    esimT: 'eSIM', esimB: '落地即可上网',
    hotelT: '酒店', hotelB: '比较免费取消房价',
    note: 'Trip.com 合作链接 · 购买时 CocoTrip 会获得佣金',
  },
};

interface Props {
  language: string;
  /** 도시를 알면 호텔 링크를 좁힌다. 모르면 전체 목록. */
  cityKey?: string;
}

/** 기능 플래그 + 제휴 설정이 **둘 다** 맞을 때만 true. */
export function shouldShowHomeAffiliate(): boolean {
  const flag = String(import.meta.env.VITE_FEATURE_HOME_AFFILIATE || '').trim() === 'true';
  return flag && isAffiliateConfigured();
}

export function TripEssentialsCards({ language, cityKey }: Props) {
  const lang = (['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as Lang;
  const c = COPY[lang];

  // 🔴 호출부가 잊어도 여기서 한 번 더 막는다(fail-closed 는 한 겹으로 두지 않는다).
  if (!shouldShowHomeAffiliate()) return null;

  const CARD = 'flex flex-col gap-1 rounded-2xl px-3.5 py-3 min-h-[76px] justify-center';
  const CARD_STYLE = {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
  } as const;

  return (
    <section className="px-4 mt-5">
      <h2 className="text-[13px] font-black text-white/80 mb-2">{c.heading}</h2>
      <div className="grid grid-cols-2 gap-2.5">
        <AffiliateCard payload={{ product: 'esim' as const, placement: PLACEMENT, language: lang, linkKey: 'esim' }}>
        <a
          href={buildEsimLink()}
          target="_blank"
          rel="noopener noreferrer sponsored"
          onClick={() => trackAffiliateClick({ product: 'esim' as const, placement: PLACEMENT, language: lang, linkKey: 'esim' })}
          className={CARD}
          style={CARD_STYLE}
        >
          <Globe className="w-4 h-4 text-[#B668FC]" aria-hidden />
          <span className="text-[13px] font-bold text-white leading-tight">{c.esimT}</span>
          <span className="text-[11px] text-white/50 leading-tight">{c.esimB}</span>
        </a>
        </AffiliateCard>

        <AffiliateCard payload={{ product: 'hotel' as const, placement: PLACEMENT, language: lang, city: cityKey, linkKey: 'hotel' }}>
        <a
          href={buildHotelListLink(cityKey)}
          target="_blank"
          rel="noopener noreferrer sponsored"
          onClick={() => trackAffiliateClick({ product: 'hotel' as const, placement: PLACEMENT, language: lang, city: cityKey, linkKey: 'hotel' })}
          className={CARD}
          style={CARD_STYLE}
        >
          <Hotel className="w-4 h-4 text-[#B668FC]" aria-hidden />
          <span className="text-[13px] font-bold text-white leading-tight">{c.hotelT}</span>
          <span className="text-[11px] text-white/50 leading-tight">{c.hotelB}</span>
        </a>
        </AffiliateCard>
      </div>
      <p className="mt-1.5 text-[10.5px] leading-snug text-white/35">{c.note}</p>
    </section>
  );
}
