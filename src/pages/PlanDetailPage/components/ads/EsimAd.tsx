// eSIM affiliate banner — Trip.com 단일 (batch 9, 2026-05-09).
//
// 이전: Airalo + Yesim 2버튼 (운영자 별도 가입 필요, ID 미발급 시 매출 0).
// 변경: Trip.com 단일 버튼 — 기존 4831212 Allianceid 그대로 활용 → 운영자 추가 가입 X.
// 운영자 결정 (5/8): Airalo/Yesim 가입 회피 + 관리 단순화 우선. 매출 차이 미미.
//
// VITE_AIRALO_AFFILIATE_ID / VITE_YESIM_AFFILIATE_ID env 는 코드에서 더 이상 참조 안 함.
// 추후 운영자가 Airalo/Yesim 가입 시 별도 컴포넌트로 부활 가능.
import { Phone } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { buildEsimLink } from '@/config/affiliateLinks';

export function EsimAd() {
  const { t } = useLanguage();
  const url = buildEsimLink();

  return (
    <div className="rounded-2xl overflow-hidden border border-[#B668FC]/25 mt-6"
      style={{ background: 'linear-gradient(135deg, rgba(182,104,252,0.08), rgba(255,107,157,0.05))' }}>
      <div className="px-5 py-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-[#B668FC]/20 border border-[#B668FC]/30">
          <Phone className="w-5 h-5 text-[#B668FC]" />
        </div>
        <div className="flex-1">
          <p className="font-bold text-white text-base leading-tight">{t.planner?.esimTitle || 'Got your Korea eSIM ready?'}</p>
          <p className="text-xs text-white/50 mt-0.5">{t.planner?.esimDesc || 'Buy an eSIM before landing and stay connected.'}</p>
        </div>
      </div>
      <div className="px-5 pb-4">
        <a href={url} target="_blank" rel="noopener noreferrer"
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 hover:scale-[1.02] active:scale-95"
          style={{ background: '#0073E6', boxShadow: '0 4px 16px rgba(0,115,230,0.25)' }}>
          {t.planner?.esimCta || 'Get eSIM on Trip.com'} {'→'}
        </a>
      </div>
      <p className="text-[10px] text-white/55 text-center pb-3 px-5">{t.planner?.esimNote || 'Purchasing via these links helps support CocoTrip.'}</p>
    </div>
  );
}
