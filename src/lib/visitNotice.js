const notices = {
  ko: { title: '방문 전 필독', body: '방문 전 각 장소의 최신 운영시간과 휴무일을 확인해 주세요. 특히 식당은 구글 지도·네이버 지도 또는 매장에 다시 확인해 주세요. 등록 정보와 실제 운영은 다를 수 있습니다.', extra: '추천 일정에 포함되어도 예약이나 입장권 구매가 완료된 것은 아닙니다. 이동시간은 교통·대기·날씨에 따라 달라질 수 있습니다.', dietary: '요청하신 식이 조건에 맞는 메뉴와 조리 방법을 식당에 다시 확인해 주세요.' },
  en: { title: 'Before you visit', body: 'Check the latest opening hours and closing days for each place before visiting. For restaurants, check Google Maps, Naver Map or the restaurant directly. Listings may differ from actual operations.', extra: 'An itinerary recommendation does not mean a reservation or ticket has been booked. Travel times may vary with traffic, waiting and weather.', dietary: 'Please reconfirm suitable menu items and preparation methods with the restaurant for your requested dietary needs.' },
  ja: { title: '訪問前にご確認ください', body: '訪問前に各施設の最新の営業時間と休業日をご確認ください。特に飲食店はGoogleマップ、Naver Mapまたは店舗に再確認してください。掲載情報と実際の営業は異なる場合があります。', extra: '日程のおすすめに含まれていても、予約やチケットの購入が完了したわけではありません。移動時間は交通、待ち時間、天候により変わる場合があります。', dietary: 'ご希望の食事条件に合うメニューと調理方法を店舗に再確認してください。' },
  zh: { title: '到访前请阅读', body: '到访前请确认各场所最新营业时间和休息日。餐厅尤其需要通过Google地图、Naver地图或直接向店家再次确认。登记信息可能与实际营业情况不同。', extra: '行程推荐并不代表已完成预订或购票。交通、等候和天气可能导致行程时间变化。', dietary: '请向餐厅再次确认符合您所选饮食要求的菜单和烹饪方式。' },
};

export function hasVisitDietaryRequest(input = {}) {
  const intent = input.planner_intent_v1;
  const canonical = intent && Object.prototype.hasOwnProperty.call(intent, 'dietaryRestrictions') ? intent.dietaryRestrictions
    : Object.prototype.hasOwnProperty.call(input, 'dietaryRestrictions') ? input.dietaryRestrictions : undefined;
  const supported = (value) => typeof value === 'string' && /^(halal|vegan|vegetarian)$/i.test(value.trim());
  const aliases = [input.allergies, intent && intent.allergies, intent && intent.dietary && intent.dietary.allergies, input.legacyAllergies];
  const aliasRestrictions = aliases.filter(Array.isArray).flat().filter(supported);
  const legacy = Array.isArray(input.dietary) ? input.dietary : aliasRestrictions.length ? aliasRestrictions
    : Array.isArray(input.dietPrefs) ? input.dietPrefs : aliasRestrictions;
  const restrictions = canonical !== undefined ? canonical : legacy;
  if (canonical !== undefined || Array.isArray(input.dietary) || aliasRestrictions.length || Array.isArray(input.dietPrefs)) return Array.isArray(restrictions) && restrictions.some(supported);
  const rawMedicalAlias = aliases.some((value) => value !== undefined);
  // Public projection carries only this display flag, never a dietary authorization.
  return !rawMedicalAlias && input.visitDietaryRequest === true;
}

export function visitNotice(language, input = {}) {
  const copy = notices[language] || notices.en;
  const titles = {
    ko: ['운영시간과 휴무일', '예약과 입장권', '이동시간', '식이 요청'],
    en: ['Hours and closures', 'Reservations and tickets', 'Travel time', 'Dietary requests'],
    ja: ['営業時間と休業日', '予約とチケット', '移動時間', '食事条件'],
    zh: ['营业时间与休息日', '预订与门票', '交通时间', '饮食要求'],
  };
  const labels = titles[language] || titles.en;
  const separator = language === 'ja' || language === 'zh' ? '。' : '. ';
  const split = copy.extra.indexOf(separator);
  const reservation = copy.extra.slice(0, split + 1);
  const travel = copy.extra.slice(split + separator.length);
  const dietary = hasVisitDietaryRequest(input) ? copy.dietary : '';
  const items = [
    { title: labels[0], body: copy.body },
    { title: labels[1], body: reservation },
    { title: labels[2], body: travel },
    ...(dietary ? [{ title: labels[3], body: dietary }] : []),
  ];
  return { title: copy.title, body: [copy.body, copy.extra, dietary].filter(Boolean).join(' '), items };
}
