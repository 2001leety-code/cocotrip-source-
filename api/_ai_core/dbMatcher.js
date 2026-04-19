/**
 * Food DB matcher — applies verified restaurant data to Gemini output.
 * Extracted verbatim from api/ai-planner-full.js L953-1009.
 */

export function applyDBMatcher(itinerary, foodIndex) {
  if (!foodIndex || foodIndex.length === 0) return;

  let dbMatched = 0, dbUnmatched = 0;
  const allStops = (itinerary.days || []).flatMap(d => d.stops || []);
  for (const stop of allStops) {
    if (stop.category !== 'food') continue;
    
    const stopName = (stop.name || stop.name_ko || '').trim();
    if (!stopName) { dbUnmatched++; continue; }

    const stopDisplayName = (stop.display_name || stop.name_en || '').toLowerCase();

    // 1차: 정확 매칭 (name 또는 nameEn)
    let match = foodIndex.find(r => {
      const dbName = (r.name || '').split('|')[0].trim();
      const dbNameEn = (r.nameEn || '').toLowerCase();
      return dbName === stopName || (stopDisplayName && dbNameEn === stopDisplayName);
    });

    // 2차: 부분 매칭 (DB 이름이 stop 이름에 포함되거나 그 반대)
    if (!match) {
      match = foodIndex.find(r => {
        const dbName = (r.name || '').split('|')[0].trim();
        if (!dbName || dbName.length < 2) return false;
        return stopName.includes(dbName) || dbName.includes(stopName);
      });
    }

    if (match) {
      // DB 데이터로 교정 — 주소/좌표/URL을 실제 검증된 데이터로 덮어씌움
      const dbName = (match.name || '').split('|')[0].trim();
      if (match.address) {
        // _food_index 주소 정리: "대한민국 " 접두사, "KR " 제거, 역순 주소 무시
        let cleanAddr = match.address
          .replace(/^대한민국\s+/, '')
          .replace(/\bKR\s+/g, '');
        // DB 주소가 한국 도시로 시작하면 덮어쓰기, 아니면 Gemini 주소 유지
        if (/^(서울|부산|제주|인천|경기|강원|충청|전라|경상|울산|대구|대전|광주|세종)/.test(cleanAddr)) {
          stop.address = cleanAddr;
        }
        // else: keep Gemini's address (usually cleaner)
      }
      if (match.lat) { stop.lat = match.lat; stop._dbLat = match.lat; }
      if (match.lng) { stop.lng = match.lng; stop._dbLng = match.lng; }
      if (match.googleMapsUrl) stop.googleMapsUrl = match.googleMapsUrl;
      stop.verified = true;
      stop._dbMatchedName = dbName;
      dbMatched++;
    } else {
      stop.verified = false;
      dbUnmatched++;
    }
  }
  console.log(`[planner] DB Match: ${dbMatched} matched, ${dbUnmatched} unmatched out of ${dbMatched + dbUnmatched} food stops`);
}
