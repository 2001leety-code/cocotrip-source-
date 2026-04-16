/**
 * 빵지순례 + 추가 로컬 핫플 추가 스크립트
 */
const fs = require('fs');
const path = require('path');

const spotsPath = path.join(__dirname, '..', 'api', '_korea_spots.json');
const spots = JSON.parse(fs.readFileSync(spotsPath, 'utf8'));

const MORE_SPOTS = [
  // ═══ 서울 빵지순례 ═══
  {
    city: "seoul", dong: "빵지순례", dongEn: "Bakery Pilgrimage", district: "Various",
    themes: ["Bakery Tour", "Korean Bread Culture", "Must-Queue Bakeries"],
    places: [
      { name: "런던베이글뮤지엄 안국점", nameEn: "London Bagel Museum Anguk", address: "서울 종로구 북촌로4길 4", category: "cafe", stayDuration: 45, tip: "Korea's most hyped bakery — expect 1-2 hour queues on weekends. The cream cheese bagels and scones are legendary. Japanese tourists especially love this place. Go on a weekday at opening (8AM) to minimize wait.", nearestStation: "안국역 1번 출구 도보 5분", priceRange: "5000-12000", hours: "매일 08:00-18:00", bestSeason: ["all"], photoSpot: "The blue-tiled facade and overflowing bagel displays.", waitTime: "weekend 60-120min, weekday 20-40min", reservationRequired: false },
      { name: "태극당", nameEn: "Taegeukdang Bakery (Since 1946)", address: "서울 중구 동호로 24길 7", category: "cafe", stayDuration: 40, tip: "Seoul's oldest bakery, operating since 1946. The monakas (Japanese-style filled wafers) and cream puffs are unchanged recipes for 80 years. A living piece of Korean culinary history. Korean grandparents bring their grandkids here.", nearestStation: "동대입구역 5번 출구 도보 5분", priceRange: "3000-8000", hours: "매일 08:30-22:00", bestSeason: ["all"], photoSpot: "The retro storefront and vintage display cases.", waitTime: "weekend 10-20min, weekday none", reservationRequired: false },
      { name: "나폴레옹과자점", nameEn: "Napoleon Bakery (Since 1968)", address: "서울 중구 다산로 244", category: "cafe", stayDuration: 30, tip: "A Seoul Future Heritage site. Their 사라다빵 (salad bread) and cream puffs are iconic. Korean office workers in the area religiously buy these. Extremely affordable — most items under ₩3,000.", nearestStation: "약수역 1번 출구 도보 3분", priceRange: "2000-5000", hours: "매일 07:00-21:00", bestSeason: ["all"], photoSpot: "The humble storefront with retro signage.", waitTime: "lunch 10-15min", reservationRequired: false },
      { name: "김영모과자점 압구정본점", nameEn: "Kim Young Mo Bakery Apgujeong", address: "서울 강남구 도산대로 49길 6", category: "cafe", stayDuration: 30, tip: "Run by a certified Korean Master Baker (대한민국 제과명장). The Mont Blanc cake is considered the best in Korea. Everything is handmade with premium ingredients. A pilgrimage site for serious pastry lovers.", nearestStation: "압구정역 3번 출구 도보 10분", priceRange: "5000-15000", hours: "매일 09:00-21:30", bestSeason: ["all"], photoSpot: "The elegant patisserie display case.", waitTime: "weekend 15-30min", reservationRequired: false },
      { name: "리치몬드과자점 반포본점", nameEn: "Richmond Bakery Banpo", address: "서울 서초구 사평대로 26길 76", category: "cafe", stayDuration: 30, tip: "Famous for 밤식빵 (chestnut bread) since 1979. Korean mothers specifically come here for the 공주밤파이 (chestnut pie). A true neighborhood institution.", nearestStation: "신반포역 도보 5분", priceRange: "4000-10000", hours: "매일 08:00-22:00", bestSeason: ["autumn", "winter"], photoSpot: "The classic bakery interior with fresh bread displays.", waitTime: "weekend 10-20min", reservationRequired: false },
      { name: "아티스트 베이커리", nameEn: "Artist Bakery (by London Bagel creators)", address: "서울 종로구 자하문로 53", category: "cafe", stayDuration: 40, tip: "From the London Bagel Museum team — their salt bread (소금빵) varieties are the current rage among Korean and Japanese foodies. Located in charming Seochon neighborhood near Gyeongbokgung.", nearestStation: "경복궁역 3번 출구 도보 10분", priceRange: "5000-10000", hours: "매일 08:00-18:00", bestSeason: ["all"], photoSpot: "The minimalist white facade in the Seochon hanok neighborhood.", waitTime: "weekend 30-60min, weekday 10-20min", reservationRequired: false },
    ],
    marketingCopy: "Korea's bakery scene rivals Paris and Tokyo. From 80-year-old institutions to viral Instagram bakeries, Seoul's '빵지순례' (bread pilgrimage) is a must-do that Korean and Japanese foodies live for."
  },

  // ═══ 서울 추가 로컬 ═══
  {
    city: "seoul", dong: "서촌", dongEn: "Seochon", district: "Jongno-gu",
    themes: ["Artist Village", "Royal Neighborhood", "Hanok Cafes"],
    places: [
      { name: "통인시장", nameEn: "Tongin Market (Coin Lunch Box)", address: "서울 종로구 자하문로15길 18", category: "food", stayDuration: 60, tip: "Buy ancient Korean 엽전 coins (500KRW=10coins) and use them to assemble your own lunch box from different stalls. A uniquely Korean market experience that tourists rarely know about. The tteokbokki and japchae are best.", nearestStation: "경복궁역 2번 출구 도보 10분", priceRange: "5000-10000", hours: "화-일 11:00-17:00 (월 휴무)", bestSeason: ["all"], photoSpot: "The colorful market stalls with your custom coin lunch box.", waitTime: "weekend 15-20min", reservationRequired: false },
      { name: "대오서점", nameEn: "Daeo Bookshop Cafe", address: "서울 종로구 자하문로7길 55", category: "cafe", stayDuration: 45, tip: "A former 50-year-old bookshop converted into an atmospheric cafe. BTS's RM was spotted here, making it a subtle BTS pilgrimage stop. The vintage bookshelves and warm lighting create a perfect reading atmosphere.", nearestStation: "경복궁역 2번 출구 도보 15분", priceRange: "5000-8000", hours: "매일 11:00-22:00", bestSeason: ["all"], photoSpot: "The floor-to-ceiling vintage bookshelves.", waitTime: "weekend 10-20min", reservationRequired: false },
      { name: "수성동계곡", nameEn: "Suseong-dong Valley", address: "서울 종로구 옥인동 산2", category: "activity", stayDuration: 60, tip: "A hidden valley stream IN THE MIDDLE OF SEOUL. Stone bridges, flowing water, and ancient trees just minutes from Gyeongbokgung. Korean couples' secret date spot. Absolutely free and almost zero tourists.", nearestStation: "경복궁역 1번 출구 도보 20분", priceRange: "free", hours: "24시간", bestSeason: ["summer", "autumn"], photoSpot: "The ancient stone bridge over the valley stream.", waitTime: "none", reservationRequired: false },
    ],
    marketingCopy: "Seochon is Gyeongbokgung Palace's more artistic, less-discovered neighbor — a village of hanok cafes, indie bookshops, and hidden valleys that Korean creatives call their secret haven."
  },
  {
    city: "seoul", dong: "광장시장", dongEn: "Gwangjang Market", district: "Jongno-gu",
    themes: ["Traditional Market", "Street Food Mecca", "Vintage Shopping"],
    places: [
      { name: "광장시장 먹자골목", nameEn: "Gwangjang Market Food Alley", address: "서울 종로구 창경궁로 88", category: "food", stayDuration: 90, tip: "Korea's most famous traditional market. The bindaetteok (mung bean pancakes), mayak gimbap (addictive mini rice rolls), and yukhoe (raw beef) are legendary. Barack Obama ate here. Go at 10AM to beat the crowd.", nearestStation: "종로5가역 8번 출구 도보 2분", priceRange: "3000-15000", hours: "매일 09:00-23:00 (일 일부 휴무)", bestSeason: ["all"], photoSpot: "The bustling market stalls with sizzling pancakes.", waitTime: "lunch 20-40min, morning <10min", reservationRequired: false },
      { name: "부촌육회", nameEn: "Buchon Yukhoe (Raw Beef)", address: "서울 종로구 창경궁로 88 광장시장", category: "food", stayDuration: 45, tip: "Blue Ribbon recognized. The freshest raw beef (육회) you'll ever taste — sesame oil, egg yolk, and melt-in-your-mouth beef. Japanese tourists and Korean foodies queue specifically for this stall.", nearestStation: "종로5가역 8번 출구 도보 3분", priceRange: "15000-20000", hours: "매일 10:00-22:00", bestSeason: ["all"], photoSpot: "The vibrant red raw beef with golden egg yolk on top.", waitTime: "lunch 30-60min", reservationRequired: false },
    ],
    marketingCopy: "Gwangjang Market is where Korean food culture was born — a 120-year-old market where bindaetteok sizzles, raw beef melts on your tongue, and every stall tells a story."
  },

  // ═══ 대전 (일본인 필수 코스) ═══
  {
    city: "gyeonggi", dong: "대전성심당", dongEn: "Daejeon-Sungsimdang", district: "Daejeon",
    themes: ["Korea's Greatest Bakery", "Bakery Pilgrimage", "Regional Icon"],
    places: [
      { name: "성심당 본점", nameEn: "Sungsimdang Main Store (Since 1956)", address: "대전 중구 대종로 480번길 15", category: "cafe", stayDuration: 60, tip: "Korea's #1 bakery — not in Seoul, but in Daejeon. People take the KTX specifically to buy their 튀김소보로 (fried streusel) and 판타롱부추빵 (chive bread). These sell out by noon. Arrive before 10AM. Japanese tourists consider this the highlight of their Korea trip.", nearestStation: "대전역 도보 10분", priceRange: "2000-8000", hours: "매일 08:00-22:00", bestSeason: ["all"], photoSpot: "The massive 4-floor bakery building and overflowing bread displays.", waitTime: "weekend 30-60min, weekday 10-20min", reservationRequired: false },
    ],
    marketingCopy: "Sungsimdang is not just a bakery — it's a cultural phenomenon. Koreans take high-speed trains specifically to visit this 70-year-old Daejeon institution that sells 30,000+ pastries daily."
  },

  // ═══ 부산 추가 ═══
  {
    city: "busan", dong: "기장", dongEn: "Gijang", district: "Gijang-gun",
    themes: ["Ocean View Bakery", "Fresh Seafood", "Coastal Town"],
    places: [
      { name: "칠암사계", nameEn: "Chilam Sagye Bakery", address: "부산 기장군 기장읍 연화리 148-5", category: "cafe", stayDuration: 60, tip: "A massive ocean-view bakery run by a certified master baker. Japanese tourists rank this as Busan's #1 cafe. The sourdough and butter croissants fresh from the oven with Pacific Ocean views are unforgettable.", nearestStation: "기장역에서 택시 10분", priceRange: "5000-15000", hours: "매일 09:00-21:00", bestSeason: ["all"], photoSpot: "The floor-to-ceiling ocean view from the bakery terrace.", waitTime: "weekend 20-40min", reservationRequired: false },
      { name: "초량밀면", nameEn: "Choryang Milmyeon (Cold Wheat Noodles)", address: "부산 동구 중앙대로 214번길 16", category: "food", stayDuration: 40, tip: "Busan's soul food that every Korean local swears by. The chewy wheat noodles in icy broth originated here as post-war refugee food. Under ₩8,000 for a bowl. This is Busan's answer to Pyongyang naengmyeon.", nearestStation: "부산역 도보 10분", priceRange: "6000-8000", hours: "매일 10:00-21:00", bestSeason: ["summer"], photoSpot: "The classic bowl of milky white broth with chewy noodles.", waitTime: "lunch 15-30min", reservationRequired: false },
    ],
    marketingCopy: "Gijang is Busan's coastal gem — ocean-view bakeries, fresh-caught seafood, and the kind of slow coastal town energy that makes you want to extend your trip."
  },
];

let added = 0;
for (const spot of MORE_SPOTS) {
  const exists = spots.find(s => s.dongEn === spot.dongEn && s.city === spot.city);
  if (!exists) {
    spots.push(spot);
    added++;
    console.log(`✅ Added: ${spot.city}/${spot.dongEn} (${spot.places.length} places)`);
  } else {
    console.log(`⏭️ Skipped: ${spot.city}/${spot.dongEn}`);
  }
}

fs.writeFileSync(spotsPath, JSON.stringify(spots, null, 2), 'utf8');
console.log(`\n🎯 Done! Added ${added} neighborhoods. Total: ${spots.length} entries, ${spots.reduce((s,e)=>s+e.places.length,0)} places`);
