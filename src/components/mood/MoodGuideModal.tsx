/**
 * MoodGuideModal — MOOD 포털 이용 안내 & Q&A (직원용, 2026-07-05 운영자 요청)
 *
 * 헤더 ❓ 버튼으로 열림. 요금 숫자는 전부 moodPricing 상수에서 파생 —
 * 요율 개정 시 안내문이 자동으로 따라감 (하드코딩 금지, derive-not-dedup).
 * 취소/변경은 포털에 기능이 없으므로(취소 API 부재) 운영자 연락 안내가 정답.
 */
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import {
  MOOD_RATES,
  MOOD_MIN_DURATION_HOURS,
  MOOD_DISTANCE_THRESHOLD_KM,
  MOOD_SURCHARGE_PER_KM,
  MOOD_FIXED_PRICE_KRW,
  formatKRW,
} from '@/lib/moodPricing';

const C = {
  card: 'rgba(15,18,32,0.97)',
  cardBorder: '1px solid rgba(124,92,252,0.16)',
  accentSolid: '#B668FC',
  text: '#ffffff',
  textDim: 'rgba(255,255,255,0.6)',
  boxBg: 'rgba(124,92,252,0.06)',
  boxBorder: '1px solid rgba(124,92,252,0.18)',
};

interface MoodGuideModalProps {
  open: boolean;
  onClose: () => void;
}

/** 섹션 카드 공통 래퍼. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-3.5" style={{ background: C.boxBg, border: C.boxBorder }}>
      <p className="text-[12px] font-bold mb-1.5" style={{ color: C.accentSolid }}>{title}</p>
      <div className="text-[12px] leading-relaxed" style={{ color: C.textDim }}>{children}</div>
    </div>
  );
}

export function MoodGuideModal({ open, onClose }: MoodGuideModalProps) {
  if (!open) return null;
  const airportFixed = MOOD_FIXED_PRICE_KRW.airport || 0;
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative w-full max-w-md mx-3 mb-3 sm:mb-0 max-h-[85vh] overflow-y-auto rounded-2xl p-5 flex flex-col gap-3"
        style={{ background: C.card, border: C.cardBorder }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold" style={{ color: C.text }}>
            MOOD 포털 <span style={{ color: C.accentSolid }}>이용 안내</span>
          </h2>
          <button type="button" onClick={onClose} aria-label="닫기" className="p-1.5 rounded-lg text-white/55 hover:bg-white/[0.06]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <Section title="💡 이 포털은">
          무드 전용 차량·매니저·공항 이동 예약 창구입니다. 예약하면 <b style={{ color: C.text }}>선불 잔액에서 자동 차감</b>되고,
          운영자가 배차를 진행합니다.
        </Section>

        <Section title="💰 요금">
          <ul className="list-disc pl-4 space-y-1">
            <li>🚗 차량: <b style={{ color: C.text }}>{formatKRW(MOOD_RATES.vehicle)}/시간</b> (최소 {MOOD_MIN_DURATION_HOURS}시간)</li>
            <li>🧑‍💼 매니저: <b style={{ color: C.text }}>{formatKRW(MOOD_RATES.manager)}/시간</b> (최소 {MOOD_MIN_DURATION_HOURS}시간)</li>
            <li>✈️ 공항 픽업/샌딩: <b style={{ color: C.text }}>{formatKRW(airportFixed)} 정액</b> (시간·거리 무관)</li>
            <li>총 이동거리 {MOOD_DISTANCE_THRESHOLD_KM}km 이상이면 km당 {formatKRW(MOOD_SURCHARGE_PER_KM)} 거리요금 + 톨비 실비</li>
          </ul>
          <p className="mt-1.5">화면의 예상 금액은 참고용이고, 확정 금액은 서버가 실제 경로(거리·톨비)로 계산합니다.</p>
        </Section>

        <Section title="📝 예약하는 법 (2가지)">
          <p><b style={{ color: C.text }}>① 수기 예약</b> — 서비스 선택 → 날짜·시작 시각·이용 시간 → 출발/도착 주소 입력(검색 지원) → 예상 금액 확인 → 예약.</p>
          <p className="mt-1.5"><b style={{ color: C.text }}>② AI 예약</b> — 카톡으로 받은 일정 텍스트를 그대로 붙여넣고 "일정 분석" →
            장소·서비스가 자동 인식됩니다. 확인만 하고 예약하세요.</p>
          <ul className="list-disc pl-4 mt-1.5 space-y-1">
            <li>🔴 빨간 칸(주소 못 찾음)은 <b style={{ color: C.text }}>🔍 검색</b>으로 장소를 찾아 선택하면 됩니다.</li>
            <li>날짜가 2개인 일정은 날짜 칩이 떠요 — <b style={{ color: C.text }}>날짜별로 각각</b> 예약하세요.</li>
            <li>항공편(KE765 등)은 자동으로 예약 메모에 붙습니다.</li>
          </ul>
        </Section>

        <Section title="📅 예약 확인·정산">
          <ul className="list-disc pl-4 space-y-1">
            <li>현황 탭의 캘린더·리스트에서 예약을 확인하고, 눌러서 요금 상세(영수증)를 볼 수 있어요.</li>
            <li>운행이 끝나면 <b style={{ color: C.text }}>실제 이용 시간 기준으로 최종 정산</b>됩니다 — 차액은 잔액에 자동 반영.</li>
            <li>잔액이 부족해도 예약은 되지만 잔액이 마이너스로 표시돼요. 충전은 운영자에게 요청.</li>
          </ul>
        </Section>

        <Section title="❓ 자주 묻는 질문">
          <div className="space-y-2">
            <p><b style={{ color: C.text }}>Q. 예약을 취소·변경하고 싶어요</b><br />
              포털에서 직접 취소는 안 됩니다 — 운영자(코코트립)에게 연락 주세요.</p>
            <p><b style={{ color: C.text }}>Q. 주소를 계속 못 찾아요</b><br />
              장소 이름 대신 도로명주소로 검색해 보세요. 자주 가는 곳은 운영자에게 말하면 주소록에 등록해 드립니다 (다음부터 자동 인식).</p>
            <p><b style={{ color: C.text }}>Q. 이용 시간이 늘어나면?</b><br />
              운행 종료 후 실제 시간으로 재정산되니 그대로 이용하시면 됩니다.</p>
            <p><b style={{ color: C.text }}>Q. 앱처럼 쓰고 싶어요</b><br />
              크롬에서 이 페이지를 연 뒤 메뉴(⋮) → "홈 화면에 추가"를 누르면 MOOD 앱으로 설치됩니다.</p>
            <p><b style={{ color: C.text }}>Q. 예상 금액과 청구 금액이 달라요</b><br />
              예상은 화면 참고용이고 확정은 서버가 실제 도로 거리·톨비로 계산합니다. 상세 내역은 예약의 영수증에서 확인하세요.</p>
          </div>
        </Section>

        <button
          type="button"
          onClick={onClose}
          className="w-full py-3 rounded-xl text-sm font-bold"
          style={{ background: 'linear-gradient(135deg, #7C5CFC, #EA537E)', color: '#fff' }}
        >
          확인했어요
        </button>
      </div>
    </div>,
    document.body,
  );
}

export default MoodGuideModal;
