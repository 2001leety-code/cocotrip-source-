// Display evidence limits without inventing a route, duration or service availability.
const COPY = {
  ko: {
    estimated: '출발·도착은 예상 시각입니다. 이용 전 실제 시간표·요금을 확인해 주세요.',
    outbound: '숙소→출발역·터미널 연결 안내가 없습니다. 이동 방법·소요시간을 별도로 확인해 주세요.',
    inbound: '도착역·터미널→숙소 연결 안내가 없습니다. 이동 방법·소요시간을 별도로 확인해 주세요.',
    connection: '역·터미널 접근 구간은 추정 이동정보입니다. 실제 경로를 확인해 주세요.',
  },
  en: {
    estimated: 'Departure and arrival times are estimates. Check actual timetables and fares before travel.',
    outbound: 'Hotel-to-departure station/terminal directions are unavailable. Check the route and travel time separately.',
    inbound: 'Arrival station/terminal-to-hotel directions are unavailable. Check the route and travel time separately.',
    connection: 'Station/terminal access uses estimated directions. Check the actual route before travel.',
  },
  ja: {
    estimated: '出発・到着は予想時刻です。ご利用前に実際の時刻表・運賃をご確認ください。',
    outbound: '宿泊先から出発駅・ターミナルまでの案内がありません。経路・所要時間を別途ご確認ください。',
    inbound: '到着駅・ターミナルから宿泊先までの案内がありません。経路・所要時間を別途ご確認ください。',
    connection: '駅・ターミナルへのアクセスは推定情報です。実際の経路をご確認ください。',
  },
  zh: {
    estimated: '出发和到达时间为预计时间。出行前请确认实际时刻表和票价。',
    outbound: '暂无住宿地点至出发车站或航站楼的路线指引。请另行确认路线和所需时间。',
    inbound: '暂无到达车站或航站楼至住宿地点的路线指引。请另行确认路线和所需时间。',
    connection: '车站或航站楼接驳路线为估算信息。出行前请确认实际路线。',
  },
};

function hasConnection(leg) {
  return !!leg && typeof leg === 'object' && !!(leg.method || leg.mode)
    && Number.isFinite(leg.est_min) && leg.est_min >= 0;
}

/** @param {object} intercity @param {string} language @returns {string[]} */
export function intercityEvidenceNotices(intercity, language = 'en') {
  if (!intercity) return [];
  const text = Object.prototype.hasOwnProperty.call(COPY, language) ? COPY[language] : COPY.en;
  const notices = [];
  if (intercity.depart_estimated === true) notices.push(text.estimated);
  if (!hasConnection(intercity.lodging_to_station)) notices.push(text.outbound);
  if (!hasConnection(intercity.station_to_lodging)) notices.push(text.inbound);
  const connections = [intercity.lodging_to_station, intercity.station_to_lodging];
  if (connections.some((leg) => leg && (leg._bookend_fallback === true || leg.source === 'naver_fallback'))) {
    notices.push(text.connection);
  }
  return notices;
}
