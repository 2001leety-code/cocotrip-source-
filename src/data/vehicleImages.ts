// 차종별 실차 사진 갤러리 (public/vehicles/). 첫 장 = 카드 대표(외부 측면).
// staria = 7인승 갈색 캡틴시트(프리미엄), sprinter = 9인승 검정 벤치(실용).
// bus/vip 는 상담 진행이라 사진 없음.
export const VEHICLE_GALLERY: Partial<Record<string, string[]>> = {
  staria: [
    '/vehicles/staria7/staria7-03.webp', // 외부 측면 (대표)
    '/vehicles/staria7/staria7-04.webp', // 갈색 캡틴시트 내부
    '/vehicles/staria7/staria7-01.webp', // 외부 정면
    '/vehicles/staria7/staria7-02.webp', // 외부 정면 사선
    '/vehicles/staria7/staria7-05.webp', // 내부 앞좌석
    '/vehicles/staria7/staria7-06.webp', // 외부 후면
  ],
  sprinter: [
    '/vehicles/staria9/staria9-08.webp', // 외부 측면 (대표)
    '/vehicles/staria9/staria9-01.webp', // 트렁크 짐칸 (수하물)
    '/vehicles/staria9/staria9-04.webp', // 검정 벤치 내부
    '/vehicles/staria9/staria9-06.webp', // 내부 정면
    '/vehicles/staria9/staria9-03.webp', // 내부 측면
    '/vehicles/staria9/staria9-02.webp', // 외부 후면
  ],
};
