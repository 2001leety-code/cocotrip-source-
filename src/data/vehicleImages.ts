// 차종별 실차 사진 갤러리 (public/vehicles/). 첫 장 = 카드 대표(외부 측면).
// staria = 7인승 갈색 캡틴시트(프리미엄), staria_9 = 9인승 검정 벤치(실용).
// 2026-06-30: 옛 'sprinter' 키가 9인 스타리아(staria9) 사진을 잘못 담고 있어 → staria_9 키로 이관(정배치).
//   진짜 sprinter(중형 벤) 실사진은 아직 없음 → 운영자 준비. bus 도 상담 진행이라 사진 없음.
export const VEHICLE_GALLERY: Partial<Record<string, string[]>> = {
  staria: [
    '/vehicles/staria7/staria7-03.webp', // 외부 측면 (대표)
    '/vehicles/staria7/staria7-04.webp', // 갈색 캡틴시트 내부
    '/vehicles/staria7/staria7-01.webp', // 외부 정면
    '/vehicles/staria7/staria7-02.webp', // 외부 정면 사선
    '/vehicles/staria7/staria7-05.webp', // 내부 앞좌석
    '/vehicles/staria7/staria7-06.webp', // 외부 후면
  ],
  staria_9: [
    '/vehicles/staria9/staria9-08.webp', // 외부 측면 (대표)
    '/vehicles/staria9/staria9-01.webp', // 트렁크 짐칸 (수하물)
    '/vehicles/staria9/staria9-04.webp', // 검정 벤치 내부
    '/vehicles/staria9/staria9-06.webp', // 내부 정면
    '/vehicles/staria9/staria9-03.webp', // 내부 측면
    '/vehicles/staria9/staria9-02.webp', // 외부 후면
    // 2026-07-25: 촬영은 됐는데 목록에서 빠져 손님에게 안 보이던 2장 편입 (차량 사진 = 신뢰·전환 직결).
    //   staria7-07 은 4분할 콜라주 + 번호판 노출이라 단독컷 갤러리와 톤이 안 맞아 제외.
    '/vehicles/staria9/staria9-07.webp', // 내부 후방 — 9인 좌석 배열·선루프
    '/vehicles/staria9/staria9-05.webp', // 내부 3열 벤치 (넓은 레그룸)
  ],
  // 2026-07-12: 운영자 제공 스프린터(10~15인 중형 벤) 사진 5장 반입 (운영자 확정 안내용 이미지).
  sprinter: [
    '/vehicles/sprinter/sprinter-02.webp', // 외부 측면 (대표)
    '/vehicles/sprinter/sprinter-04.webp', // 내부 좌석 전경
    '/vehicles/sprinter/sprinter-01.webp', // 외부 정면 사선
    '/vehicles/sprinter/sprinter-05.webp', // 내부 앞좌석
    '/vehicles/sprinter/sprinter-03.webp', // 외부 후면
  ],
  // bus(16+·45석): 운영자 제공 대표 사진 반입(2026-07-14, 1장). 흰색 45석 대형 코치.
  bus: [
    '/vehicles/bus/bus-01.webp', // 외부 측면 (대표)
  ],
};
