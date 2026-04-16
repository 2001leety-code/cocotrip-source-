/**
 * 한국인 로컬 핫플레이스 + 숨은 명소 추가 스크립트
 * 외국인 가이드북에 없는, 한국인들한테만 유명한 장소들
 */
const fs = require('fs');
const path = require('path');

const spotsPath = path.join(__dirname, '..', 'api', '_korea_spots.json');
const spots = JSON.parse(fs.readFileSync(spotsPath, 'utf8'));

const LOCAL_SPOTS = [
  // ═══════════════════════════════════════════════════
  // 서울 — 한국인 로컬 핫플
  // ═══════════════════════════════════════════════════
  {
    city: "seoul", dong: "익선동", dongEn: "Ikseon-dong", district: "Jongno-gu",
    themes: ["Retro Hanok Cafes", "Korean Hipster Culture", "Hidden Alleys"],
    places: [
      { name: "익선동 한옥거리", nameEn: "Ikseon-dong Hanok Alley", address: "서울 종로구 익선동 166", category: "culture", stayDuration: 60, tip: "Seoul's tiniest hanok alley transformed into a hipster paradise. Unlike Bukchon, you can actually enter the renovated hanoks — they're now cafes, bars, and boutiques. Locals come here for the retro-modern fusion vibe. Best on weekday evenings.", nearestStation: "종로3가역 4번 출구 도보 3분", priceRange: "free", hours: "24시간", bestSeason: ["all"], photoSpot: "The narrow hanok alleys with warm lantern lighting at dusk.", waitTime: "none", reservationRequired: false },
      { name: "낙원역 카페", nameEn: "Nakwon Station Cafe", address: "서울 종로구 익선동", category: "cafe", stayDuration: 45, tip: "Hidden cafe with seasonal signature desserts that change monthly. The interior blends vintage Korean aesthetics with modern design. A true local secret — most tourists walk right past it.", nearestStation: "종로3가역 4번 출구 도보 5분", priceRange: "7000-12000", hours: "매일 11:00-22:00", bestSeason: ["all"], photoSpot: "Seasonal dessert presentation against vintage backdrop.", waitTime: "weekend 15-30min", reservationRequired: false },
      { name: "온천집", nameEn: "Oncheonjip (Hot Spring Bar)", address: "서울 종로구 수표로28길 17-1", category: "activity", stayDuration: 60, tip: "A unique Korean-style bar that recreates an old-school bathhouse aesthetic. You drink makgeolli from wash basins. Extremely popular with Korean 20-30s crowd. Pure local experience that most tourists never discover.", nearestStation: "종로3가역 4번 출구 도보 5분", priceRange: "10000-20000", hours: "매일 17:00-01:00", bestSeason: ["all"], photoSpot: "The bathhouse-themed interior with basin drinks.", waitTime: "weekend 30-60min", reservationRequired: false },
    ],
    marketingCopy: "Ikseon-dong is Seoul's worst-kept secret among Koreans — a maze of century-old hanoks reimagined as trendy cafes and craft cocktail bars. Skip the tourist crowds of Bukchon and experience where young Seoulites actually hang out."
  },
  {
    city: "seoul", dong: "한남동", dongEn: "Hannam-dong", district: "Yongsan-gu",
    themes: ["Celebrity Neighborhood", "Premium Dining", "Design Culture"],
    places: [
      { name: "블루스퀘어", nameEn: "Blue Square", address: "서울 용산구 이태원로 294", category: "culture", stayDuration: 120, tip: "Korea's premier musical theater venue. If you want to see a Korean musical (한국 뮤지컬), this is where the biggest productions run. Many K-pop idols perform here. Book tickets via Interpark.", nearestStation: "한강진역 2번 출구 도보 3분", priceRange: "50000-150000", hours: "공연 시간별 상이", bestSeason: ["all"], photoSpot: "The modern glass facade at night.", waitTime: "none (with reservation)", reservationRequired: true },
      { name: "아모레퍼시픽 본사 1층", nameEn: "Amorepacific HQ Ground Floor", address: "서울 용산구 한강대로 100", category: "culture", stayDuration: 45, tip: "Architect David Chipperfield's masterpiece. The ground floor is open to public with rotating art exhibitions and a beautiful atrium garden. Free entry. Korean office workers' favorite lunch break escape.", nearestStation: "신용산역 도보 1분", priceRange: "free", hours: "월-금 09:00-18:00", bestSeason: ["all"], photoSpot: "The massive atrium with natural light streaming in.", waitTime: "none", reservationRequired: false },
      { name: "한남동 카페거리", nameEn: "Hannam-dong Cafe Street", address: "서울 용산구 한남동 독서당로", category: "cafe", stayDuration: 60, tip: "Where Korean celebrities and influencers actually go for coffee. Tiny specialty roasteries, design-forward interiors. Much quieter than Gangnam or Hongdae. Look for places like Fritz, Felt Coffee.", nearestStation: "한강진역 3번 출구 도보 10분", priceRange: "6000-12000", hours: "매일 10:00-22:00", bestSeason: ["all"], photoSpot: "The tree-lined residential streets with boutique storefronts.", waitTime: "weekend 10-20min", reservationRequired: false },
    ],
    marketingCopy: "Hannam-dong is where Seoul's creative elite actually lives and hangs out. BTS members, top designers, and Korea's most discerning foodies call this neighborhood home."
  },
  {
    city: "seoul", dong: "신당동", dongEn: "Sindang-dong", district: "Jung-gu",
    themes: ["Authentic Street Food", "Working Class Culture", "Hidden Gems"],
    places: [
      { name: "신당동 떡볶이 타운", nameEn: "Sindang-dong Tteokbokki Town", address: "서울 중구 다산로 33길", category: "food", stayDuration: 60, tip: "The ORIGINAL tteokbokki street that's been running since the 1970s. Unlike tourist-friendly versions, this is the real deal — thick, chewy rice cakes in rich, spicy sauce. Koreans consider this a pilgrimage site for tteokbokki lovers.", nearestStation: "신당역 7번 출구 도보 2분", priceRange: "8000-15000", hours: "매일 11:00-22:00", bestSeason: ["all"], photoSpot: "The bubbling red tteokbokki pots at the counter.", waitTime: "weekend 20-40min", reservationRequired: false },
      { name: "레레플레이", nameEn: "Lere Play Cafe", address: "서울 중구 다산로 155", category: "cafe", stayDuration: 45, tip: "Instagram-famous among Korean millennials for its cloud lighting installations and mirror tables. Vintage-yet-modern interior where every angle is photo-worthy. Foreign tourists rarely find this place.", nearestStation: "신당역 2번 출구 도보 5분", priceRange: "7000-10000", hours: "매일 11:00-22:00", bestSeason: ["all"], photoSpot: "Cloud lighting with mirror table reflections.", waitTime: "weekend 20-30min", reservationRequired: false },
    ],
    marketingCopy: "Sindang-dong is where Koreans go for the most authentic tteokbokki experience — zero tourists, maximum flavor, and a vibrant working-class energy that represents the real Seoul."
  },
  {
    city: "seoul", dong: "상봉동", dongEn: "Sangbong-dong", district: "Jungnang-gu",
    themes: ["Outdoor Dining", "Local Foodie Haven", "Late-Night Eats"],
    places: [
      { name: "상봉동 먹자골목", nameEn: "Sangbong Food Alley", address: "서울 중랑구 상봉동 먹자골목", category: "food", stayDuration: 90, tip: "Seoul's hottest 야장 (outdoor dining) district in 2025-2026. Korean locals flock here for gopchang (intestines), dakbal (chicken feet), and soju under string lights. Zero tourists. This is where Koreans party on warm evenings.", nearestStation: "상봉역 2번 출구 도보 5분", priceRange: "15000-30000", hours: "매일 17:00-02:00", bestSeason: ["spring", "summer", "autumn"], photoSpot: "The vibrant outdoor dining scene with string lights at night.", waitTime: "weekend 30-60min", reservationRequired: false },
    ],
    marketingCopy: "Sangbong-dong is Seoul's newest outdoor dining hotspot — imagine Seoul's answer to a Bangkok night market, but Korean-style with grilled intestines, chicken feet, and rivers of soju."
  },
  {
    city: "seoul", dong: "사직동", dongEn: "Sajik-dong", district: "Jongno-gu",
    themes: ["Mountain Views", "Hanok Innovation", "Peaceful Retreat"],
    places: [
      { name: "아르크 카페", nameEn: "Arco Cafe", address: "서울 종로구 사직로8길 15", category: "cafe", stayDuration: 60, tip: "A hanok cafe where traditional Korean architecture meets modern glass walls with a panoramic view of Bukaksan mountain. Korean millennials' favorite for a peaceful afternoon. The matcha here is legendary.", nearestStation: "경복궁역 1번 출구 도보 15분", priceRange: "8000-15000", hours: "매일 10:00-21:00", bestSeason: ["autumn", "spring"], photoSpot: "Mountain view through floor-to-ceiling windows.", waitTime: "weekend 15-30min", reservationRequired: false },
      { name: "인왕산 숲속쉼터", nameEn: "Inwangsan Forest Shelter", address: "서울 종로구 인왕산로 1길", category: "activity", stayDuration: 90, tip: "A hidden forest retreat on Inwangsan mountain favored by Seoul locals for quiet reading or meditation. Free entry. You walk through a forest path and suddenly find a peaceful wooden deck overlooking the city. Most foreigners don't even know this exists.", nearestStation: "독립문역 2번 출구 도보 20분", priceRange: "free", hours: "매일 06:00-22:00", bestSeason: ["spring", "autumn"], photoSpot: "The wooden deck platform overlooking Seoul's skyline through pine trees.", waitTime: "none", reservationRequired: false },
    ],
    marketingCopy: "Sajik-dong is the quiet, sophisticated side of Seoul that locals guard jealously — mountain views, hanok cafes, and forest retreats just minutes from Gyeongbokgung."
  },
  {
    city: "seoul", dong: "홍제동", dongEn: "Hongje-dong", district: "Seodaemun-gu",
    themes: ["Underground Art", "Hidden Waterfalls", "Emerging Neighborhood"],
    places: [
      { name: "홍제유연", nameEn: "Hongje Yuyeon (Underground Waterfall)", address: "서울 서대문구 홍제동 홍제천", category: "activity", stayDuration: 45, tip: "A mystical underground waterfall and art space hidden beneath Hongje Bridge. Artificial waterfalls cascade inside a concrete chamber with changing LED lights. Extremely dramatic and photogenic. Almost zero foreign tourists know about this.", nearestStation: "홍제역 3번 출구 도보 10분", priceRange: "free", hours: "매일 09:00-21:00", bestSeason: ["summer"], photoSpot: "The waterfalls with purple/blue LED lighting in the underground chamber.", waitTime: "weekday none, weekend 10min", reservationRequired: false },
    ],
    marketingCopy: "Hongje-dong's underground waterfall is Seoul's most surreal hidden attraction — a neon-lit cave beneath a city bridge that feels like stepping into another world."
  },
  {
    city: "seoul", dong: "노량진", dongEn: "Noryangjin", district: "Dongjak-gu",
    themes: ["Fresh Seafood Market", "Working Class Eats", "Authentic Experience"],
    places: [
      { name: "스페이스케 노들", nameEn: "SpaceK Nodeul Island", address: "서울 용산구 양녕로 445 노들섬", category: "culture", stayDuration: 90, tip: "A former water intake station on Nodeul Island transformed into a stunning Han River art space. The Han River views here are the most dramatic in Seoul — better than Yeouido. Night visits feature immersive media art installations. A true local gem.", nearestStation: "노들역 도보 5분", priceRange: "free-15000", hours: "매일 10:00-21:00", bestSeason: ["all"], photoSpot: "Han River panoramic view from the rooftop, especially at sunset.", waitTime: "weekend 10min for exhibitions", reservationRequired: false },
    ],
    marketingCopy: "Nodeul Island offers Seoul's best-kept Han River secret — an art island with panoramic views that even most Seoul residents haven't discovered yet."
  },
  {
    city: "seoul", dong: "을지로3가", dongEn: "Euljiro 3-ga", district: "Jung-gu",
    themes: ["Hipjiro Culture", "Old-School Pubs", "Industrial Chic"],
    places: [
      { name: "을지면옥", nameEn: "Euljiro Myeonok", address: "서울 중구 을지로 106-1", category: "food", stayDuration: 45, tip: "A 60-year-old naengmyeon (cold noodle) institution that Seoul office workers swear by. The buckwheat noodles in icy beef broth are perfection. No frills, just legendary food. Lunch hours get extremely busy with Korean salarymen.", nearestStation: "을지로3가역 3번 출구 도보 2분", priceRange: "10000-15000", hours: "매일 11:00-21:00", bestSeason: ["summer"], photoSpot: "The classic Korean restaurant interior with steaming noodle bowls.", waitTime: "lunch 20-40min", reservationRequired: false },
      { name: "가맥집 골목", nameEn: "Gamaekjip (Korean Corner Store Beer) Alley", address: "서울 중구 을지로3가 철공소 골목", category: "activity", stayDuration: 60, tip: "The most authentically Korean drinking experience: grab cheap beer and dried squid at a tiny store counter between metalwork shops. This is 'Hipjiro' culture — industrial grit meets hipster energy. Korean office workers' after-work ritual.", nearestStation: "을지로3가역 4번 출구 도보 3분", priceRange: "5000-10000", hours: "매일 15:00-23:00", bestSeason: ["all"], photoSpot: "The gritty metalwork shop exteriors with beer crates stacked outside.", waitTime: "none", reservationRequired: false },
    ],
    marketingCopy: "Euljiro 3-ga is Seoul's industrial-chic playground — where crumbling metalwork shops hide some of the city's coolest bars and 60-year-old noodle joints that Korean foodies worship."
  },

  // ═══════════════════════════════════════════════════
  // 부산 — 한국인 로컬 핫플
  // ═══════════════════════════════════════════════════
  {
    city: "busan", dong: "흰여울", dongEn: "Huinyeoul", district: "Yeongdo-gu",
    themes: ["Clifftop Village", "Ocean Views", "Indie Film Location"],
    places: [
      { name: "흰여울문화마을", nameEn: "Huinyeoul Culture Village", address: "부산 영도구 영선동4가 절영해안산책로", category: "culture", stayDuration: 90, tip: "A stunning clifftop village with white-washed houses overlooking the sea — Korea's answer to Santorini. Featured in the Korean film 'The Attorney'. Korean couples and photographers love this place. Much less touristy than Gamcheon.", nearestStation: "남포역에서 버스 30분", priceRange: "free", hours: "24시간", bestSeason: ["spring", "autumn"], photoSpot: "The narrow alleys with ocean backdrop, especially a wooden stairway leading to the sea.", waitTime: "none", reservationRequired: false },
    ],
    marketingCopy: "Huinyeoul is Busan's most romantic clifftop village — a whitewashed Mediterranean dream perched above the sea that Koreans flock to for weekend escapes."
  },
  {
    city: "busan", dong: "F1963", dongEn: "F1963-Mangmi", district: "Suyeong-gu",
    themes: ["Industrial Art Space", "Craft Beer", "Cultural Complex"],
    places: [
      { name: "F1963", nameEn: "F1963 Cultural Complex", address: "부산 수영구 구락로 123번길 20", category: "culture", stayDuration: 120, tip: "A former wire-cutting factory transformed into Busan's coolest cultural complex. Houses an art gallery, indie bookstore (Yes24), and a gorgeous Terarosa Coffee branch. Korean creatives' favorite weekend hangout. The industrial architecture alone is worth the visit.", nearestStation: "수영역 3번 출구 도보 15분", priceRange: "free-10000", hours: "매일 09:00-21:00", bestSeason: ["all"], photoSpot: "The industrial steel frame structure with climbing vines and raw concrete.", waitTime: "weekend 10min for cafe", reservationRequired: false },
      { name: "아홉산숲", nameEn: "Ahopsan Forest", address: "부산 기장군 철마면 미동길 37-1", category: "activity", stayDuration: 120, tip: "A 400-year-old private bamboo forest that feels like stepping into a Korean historical drama. Korean nature lovers treat this as a pilgrimage site. The towering bamboo creates an otherworldly atmosphere. Reservation REQUIRED - they limit daily visitors to protect the forest.", nearestStation: "기장역에서 택시 20분", priceRange: "5000", hours: "수-일 10:00-17:00 (월화 휴무)", bestSeason: ["spring", "summer"], photoSpot: "The towering bamboo grove with light filtering through the canopy.", waitTime: "none (reservation system)", reservationRequired: true },
    ],
    marketingCopy: "F1963 and Ahopsan represent the new Busan — where industrial heritage meets nature in ways that even Korean domestic tourists are still discovering."
  },
  {
    city: "busan", dong: "이기대", dongEn: "Igidae", district: "Nam-gu",
    themes: ["Coastal Trail", "Dramatic Cliffs", "Sunrise Spot"],
    places: [
      { name: "이기대 해안산책로", nameEn: "Igidae Coastal Trail", address: "부산 남구 이기대공원로 68", category: "activity", stayDuration: 150, tip: "A breathtaking 5km coastal cliff walk with panoramic views of Gwangandaegyo Bridge and Haeundae. Korean hikers consider this one of the best coastal trails in the country. Far fewer tourists than Haeundae. The sunrise here rivals Jeju.", nearestStation: "경성대부경대역 5번 출구 버스 15분", priceRange: "free", hours: "24시간", bestSeason: ["spring", "autumn"], photoSpot: "The suspension bridge section with Gwangan Bridge in the background at golden hour.", waitTime: "none", reservationRequired: false },
    ],
    marketingCopy: "Igidae is Busan's most dramatic coastal trail — towering sea cliffs, suspension bridges, and panoramic ocean views that Korean hikers rank as one of the country's best-kept secrets."
  },

  // ═══════════════════════════════════════════════════
  // 제주 — 한국인 로컬 숨은 명소
  // ═══════════════════════════════════════════════════
  {
    city: "jeju", dong: "구엄리", dongEn: "Gueom-ri", district: "Jeju-si",
    themes: ["Sunset Drive", "Quiet Coastline", "Local Secret"],
    places: [
      { name: "구엄리 해안도로", nameEn: "Gueom-ri Coastal Road", address: "제주 제주시 애월읍 구엄리 해안도로", category: "activity", stayDuration: 60, tip: "Jeju's most beautiful sunset coastal road that Korean couples consider their secret spot. Stone walls meet the ocean along a peaceful drive with zero tourist buses. The golden hour here produces colors you won't find at Hyeopjae Beach.", nearestStation: "제주공항에서 차량 30분", priceRange: "free", hours: "24시간", bestSeason: ["all"], photoSpot: "The stone wall path with ocean and sunset backdrop.", waitTime: "none", reservationRequired: false },
    ],
    marketingCopy: "Gueom-ri is Jeju's most romantic sunset secret — a quiet coastal road where Korean honeymooners come for golden-hour walks along volcanic stone walls."
  },
  {
    city: "jeju", dong: "무수천", dongEn: "Musucheon", district: "Seogwipo-si",
    themes: ["Secret Stream", "Untouched Nature", "Meditation"],
    places: [
      { name: "무수천", nameEn: "Musucheon Stream", address: "제주 서귀포시 대포동 무수천", category: "activity", stayDuration: 90, tip: "Jeju's most untouched hidden stream. Crystal-clear water flowing through volcanic rocks and ancient trees. Korean nature photographers treat this as sacred ground. Almost zero tourists. The silence here is profound — perfect for meditation.", nearestStation: "서귀포 중문에서 차량 15분", priceRange: "free", hours: "24시간", bestSeason: ["summer", "autumn"], photoSpot: "The volcanic rock pools with crystal water and overhanging trees.", waitTime: "none", reservationRequired: false },
      { name: "소금막 해변", nameEn: "Sogemmak Beach", address: "제주 서귀포시 성산읍 소금막해변", category: "activity", stayDuration: 60, tip: "A tiny secret beach near Seongsan with water so clear you can see the volcanic sand beneath. Korean families bring their kids here because it's shallow and safe. No facilities = no tourists. Bring your own snacks.", nearestStation: "성산일출봉에서 차량 10분", priceRange: "free", hours: "24시간", bestSeason: ["summer"], photoSpot: "The clear turquoise water against black volcanic sand.", waitTime: "none", reservationRequired: false },
    ],
    marketingCopy: "Musucheon and Sogemmak represent the Jeju that Korean islanders don't share with tourists — untouched streams and secret beaches where nature still feels primordial."
  },
  {
    city: "jeju", dong: "하효동", dongEn: "Hahyo-dong", district: "Seogwipo-si",
    themes: ["Tangerine Groves", "Coastal Walk", "Rural Charm"],
    places: [
      { name: "하효해안 산책로", nameEn: "Hahyo Coastal Trail", address: "제주 서귀포시 하효동 해안산책로", category: "activity", stayDuration: 90, tip: "A dreamy coastal walk through tangerine groves and camellia forests that ends at the sea. Korean travel bloggers call this 'Jeju's most romantic trail'. The scent of tangerines mixed with ocean breeze in autumn is unforgettable.", nearestStation: "서귀포에서 차량 15분", priceRange: "free", hours: "24시간", bestSeason: ["autumn", "winter"], photoSpot: "The path between tangerine groves with ocean glimpses.", waitTime: "none", reservationRequired: false },
    ],
    marketingCopy: "Hahyo-dong's coastal trail is where nature poetry meets Jeju's farming heritage — tangerine orchards, camellia forests, and ocean panoramas that Korean travelers call 'the most romantic walk in Jeju'."
  },
];

// Merge: skip if dongEn already exists
let added = 0;
for (const spot of LOCAL_SPOTS) {
  const exists = spots.find(s => s.dongEn === spot.dongEn && s.city === spot.city);
  if (!exists) {
    spots.push(spot);
    added++;
    console.log(`✅ Added: ${spot.city}/${spot.dongEn} (${spot.places.length} places)`);
  } else {
    console.log(`⏭️ Skipped (already exists): ${spot.city}/${spot.dongEn}`);
  }
}

fs.writeFileSync(spotsPath, JSON.stringify(spots, null, 2), 'utf8');
console.log(`\n🎯 Done! Added ${added} neighborhoods. Total: ${spots.length} entries, ${spots.reduce((s,e)=>s+e.places.length,0)} places`);
