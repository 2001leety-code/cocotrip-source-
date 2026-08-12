// 투어 상세 지도 — 투어가 어디를 도는지 핀 + 순서 직선으로 보여준다.
//
// CourseMiniMap 을 그대로 재사용한다(Leaflet + CARTO, 무료·무키·async chunk).
// 좌표를 가진 stop 이 2개 미만이면 CourseMiniMap 이 스스로 null 을 반환해 아무것도 안 뜬다.
//
// 💰 실경로(차량 폴리라인)는 여기서 안 그린다. 정적 9투어는 전세차량 상품이라 대중교통
//    course-route 를 쓰면 안 되고, 차량 실경로는 조회당 TMAP 과금이 붙는다. 지도의 목적은
//    "이 투어가 어느 지역을 도는가"를 보여주는 것이고, 그건 핀 + 순서 직선으로 충분하다.
//    (CourseMiniMap 은 routeSegments 를 안 주면 stop 사이를 직선으로 잇는다.)
import { lazy, Suspense } from 'react';
import type { TourStop, I18nString } from '@/data/tours';
import type { Language } from '@/i18n';
import type { CourseStop } from '@/pages/PlannerPage/components/courseBuilder/courseOps';
import { countStopsWithCoords, MIN_STOPS_FOR_MAP } from '@/lib/tourStopCoords';

// CourseMiniMap 은 Leaflet 을 자체 chunk 로 로드한다 → lazy 로 감싸 투어 상세 초기 번들 무영향.
const CourseMiniMap = lazy(() =>
  import('@/pages/PlannerPage/components/courseBuilder/CourseMiniMap')
    .then((m) => ({ default: m.CourseMiniMap })),
);

function txt(field: I18nString | undefined, lang: Language): string {
  if (!field) return '';
  return field[lang] || field.en || field.ko || '';
}

/** TourStop → CourseStop. 좌표 없는 stop 은 CourseMiniMap 이 알아서 건너뛴다(핀만 안 찍힘). */
function toCourseStops(stops: TourStop[], lang: Language): CourseStop[] {
  return stops.map((s, i) => ({
    id: `tour-stop-${i}`,
    time: s.time || '',
    title: txt(s.name, lang),
    category: 'sight', // 핀 렌더에 무영향(번호+제목만 사용). 필수 필드라 채워둘 뿐.
    memo: '',
    lat: s.lat,
    lng: s.lng,
  }));
}

interface TourStopMapProps {
  stops: TourStop[];
  language: Language;
  title: string;
}

export function TourStopMap({ stops, language, title }: TourStopMapProps) {
  // 좌표를 가진 stop 이 2개 미만이면 지도를 아예 안 그린다(CourseMiniMap 도 null 을 반환하지만,
  // Suspense·컨테이너를 만들기 전에 여기서 먼저 끊어 불필요한 청크 로드를 막는다).
  // 판정은 `@/lib/tourStopCoords` 한 곳 — 어드민의 "좌표 n곳 입력됨" 표시와 같은 기준이어야
  // "어드민엔 핀 2개인데 손님 화면엔 지도가 없다"가 안 생긴다.
  if (countStopsWithCoords(stops) < MIN_STOPS_FOR_MAP) return null;

  return (
    <div className="tour-detail-stop-map mb-5">
      <Suspense fallback={<div className="h-[220px] animate-pulse rounded-ec-md bg-ec-sunken" />}>
        <CourseMiniMap stops={toCourseStops(stops, language)} title={title} />
      </Suspense>
    </div>
  );
}
