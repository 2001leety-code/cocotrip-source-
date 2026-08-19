// 투어 상세 페이지 "SCENE 01~05" 매거진 에디토리얼 섹션 데이터 SSOT.
// MRT P3 (2026-08-19): 스테이지 번호(SCENE 01 등)는 UI 컴포넌트가 렌더 — 데이터엔 없음.
//
// GROUNDING 규칙 — 여기 적힌 모든 문장은 src/data/tours.ts 의 해당 투어 레코드
// (stops[].description / stops[].tip / highlights[] / summary / description) 에서만
// 가져온다. 새로운 사실(운영시간·역사적 주장·거리·가격·소요시간 등 원본에 없는 것)을
// 추가하지 않는다 — 이미 공개된 카피를 매거진 톤으로 다듬어 재서술하는 섹션이다.
// 사진 경로도 그 투어의 images[] 또는 stops[].photo 에 실제로 존재하는 값만 쓴다.
import type { Language } from '@/i18n';

export interface TourScene {
  /** /public 기준 경로 — 반드시 해당 투어의 images[] 또는 stops[].photo 에 이미 있는 값. */
  photo: string;
  /** 짧고 인상적인 장면 제목 (4개 언어). 실제 장소명을 반드시 포함. */
  title: Record<Language, string>;
  /** 2-3문장 에디토리얼 문단 (4개 언어). tours.ts 원본 사실만 재서술. */
  body: Record<Language, string>;
}

export const TOUR_SCENES: Record<string, TourScene[]> = {
  'tour-dmz': [
    {
      photo: '/tourists/people-dmz-imjingak.webp',
      title: {
        ko: '임진각, 분단의 문 앞에서',
        en: 'Imjingak: At the Edge of the Divide',
        ja: '臨津閣、分断の入り口で',
        zh: '临津阁，站在分裂的门前',
      },
      body: {
        ko: '자유의 다리와 평화의 종, 망배단이 나란히 서 있는 임진각에서 하루가 시작된다. 분단을 상징하는 공간을 걸으며 마음을 가다듬고, 입구에서 여권을 지참해 통합 신청서를 작성한다.',
        en: 'The day opens at Imjingak, where the Freedom Bridge, the Peace Bell, and the Mangbaedan altar stand side by side. Walking through this monument to division sets the tone before a passport-in-hand permit form at the entrance clears the way north.',
        ja: '自由の橋、平和の鐘、望拝壇が並ぶ臨津閣で一日が始まる。分断を象徴する空間を歩きながら気持ちを整え、入口ではパスポートを手に総合申請書を記入する。',
        zh: '一天从临津阁开始，自由之桥、和平之钟与望拜坛并肩而立。走过这处象征分裂的场所后，需在入口处持护照填写综合申请表。',
      },
    },
    {
      photo: '/tourists/people-dmz-third-tunnel.webp',
      title: {
        ko: '지하 73미터, 제3땅굴',
        en: '73 Meters Down: The 3rd Tunnel',
        ja: '地下73メートル、第3トンネル',
        zh: '地下73米，第三地道',
      },
      body: {
        ko: '북한이 뚫은 침투 땅굴 속으로 모노레일이나 두 발로 73미터를 내려간다. 헬멧을 쓰고 카메라는 입구에 맡긴 채, 좁은 통로를 따라 분단의 실체를 가장 가까이서 마주한다.',
        en: 'A monorail — or your own two feet — carries you 73 meters down into a tunnel North Korea once dug toward the South. Helmets on and cameras left at the entrance, the narrow passage puts the reality of the border closer than anywhere else on the route.',
        ja: '北朝鮮が掘った侵入トンネルへ、モノレールか徒歩で地下73メートルを下る。ヘルメットをかぶりカメラは入口に預け、狭い通路の先で分断の現実に最も近づく瞬間だ。',
        zh: '乘单轨车或徒步深入地下73米，走进朝鲜当年挖掘的渗透隧道。戴上头盔、相机寄存在入口，在狭窄的通道尽头，与分裂的现实靠得最近。',
      },
    },
    {
      photo: '/tourists/people-dmz-dora-observatory.webp',
      title: {
        ko: '도라산 전망대에서 바라본 북쪽',
        en: 'Dorasan Observatory: A Look North',
        ja: '都羅山展望台から見る北',
        zh: '都罗山观景台，北望的一刻',
      },
      body: {
        ko: '전망대에 서면 개성공단과 송악산이 눈앞에 펼쳐진다. 망원경을 손에 들고 북측 마을을 가만히 들여다보는 시간, 맑은 날일수록 가시거리는 더 멀어진다.',
        en: 'From the observatory deck, the Kaesong Industrial Region and Mt. Songak spread out ahead. Binoculars in hand, this is a quiet moment spent studying a North Korean village across the line — visibility stretches farther on a clear day.',
        ja: '展望台に立つと、開城工業団地と松岳山が目の前に広がる。望遠鏡を手に北側の村をじっと見つめる時間。晴れた日ほど視界は遠くまで届く。',
        zh: '站上观景台，开城工业区与松岳山尽收眼底。手持望远镜静静眺望对面的朝鲜村庄，天气越晴朗，能看到的越远。',
      },
    },
    {
      photo: '/파주_dmz/파주 (4).jpg',
      title: {
        ko: '평양행, 열리지 않은 도라산역',
        en: 'Dorasan Station: The Line to Pyongyang',
        ja: '都羅山駅、平壌行きの標',
        zh: '都罗山站，通往平壤的路牌',
      },
      body: {
        ko: '남북을 잇는 철도역 도라산역, 승강장에는 "평양 →" 방향판이 서 있다. 통합 입장권으로 들어와 통일 우표를 파는 기념품점을 둘러보며 잠시 멈춰 선다.',
        en: 'Dorasan Station links the two Koreas by rail, and its platform carries a sign pointing simply: "To Pyongyang." Entry comes with the combo pass, and the small souvenir shop selling unification stamps invites a slow pause.',
        ja: '南北を結ぶ鉄道駅・都羅山駅のホームには「平壌→」という標識が立つ。総合入場券で入り、統一切手を売る土産店を覗きながらしばし足を止める。',
        zh: '连接南北的都罗山站，站台上立着一块写着"开往平壤"的路牌。凭通票入内，可在售卖统一邮票的纪念品店稍作停留。',
      },
    },
    {
      photo: '/파주_dmz/파주 (1).jpg',
      title: {
        ko: '민통선 마을, 통일촌의 밥상',
        en: 'Lunch in Unification Village',
        ja: '民統線の村、統一村の食卓',
        zh: '民统线村庄，统一村的餐桌',
      },
      body: {
        ko: '민간인 통제선 안쪽 마을 식당에서 점심을 먹는다. 마을에서 기른 콩으로 담근 청국장과 두부 정식, 식사 후에는 콩나물과 된장을 직접 살 수도 있다.',
        en: 'Lunch is served at a restaurant inside the Civilian Control Zone. The set menu of cheonggukjang stew and tofu is made from soybeans grown right in the village, and soybean sprouts or fermented paste are there to take home afterward.',
        ja: '民間人統制線の内側にある村の食堂で昼食をとる。村で育てた大豆で仕込んだ清麹醤と豆腐の定食で、食後には村産のもやしや味噌を買うこともできる。',
        zh: '在民间人统制线内的村庄餐馆用午餐。清麹酱与豆腐定食用的是村里自种的大豆，饭后还能买到村产的豆芽和大酱。',
      },
    },
  ],

  'tour-seoul-city': [
    {
      photo: '/JnR5Ie_경복궁(1).webp',
      title: {
        ko: '경복궁, 조선 정궁의 아침',
        en: 'Gyeongbokgung: A Morning at the Main Palace',
        ja: '景福宮、朝鮮正宮の朝',
        zh: '景福宫，朝鲜正宫的清晨',
      },
      body: {
        ko: '조선 5대 궁궐 가운데 가장 규모가 큰 정궁, 경복궁에서 하루가 열린다. 수문장 교대식은 하루 다섯 차례 열리고, 한복을 입으면 입장료 없이 들어설 수 있다.',
        en: "The day opens at Gyeongbokgung, the largest of Joseon's five grand palaces. The changing-of-the-guard ceremony runs five times a day, and hanbok gets you through the gate free of charge.",
        ja: '朝鮮5大宮殿の中で最大規模を誇る正宮、景福宮で一日が始まる。守門将交代式は1日5回行われ、韓服を着れば入場料なしで入れる。',
        zh: '一天从景福宫开始，这是朝鲜五大宫殿中规模最大的正宫。守门将交代仪式每日举行五次，穿韩服可免费入场。',
      },
    },
    {
      photo: '/3Xgcka_북촌한옥마을(1).webp',
      title: {
        ko: '북촌한옥마을, 600년 골목',
        en: 'Bukchon: 600 Years of Alleyways',
        ja: '北村韓屋村、600年の路地',
        zh: '北村韩屋村，六百年的巷弄',
      },
      body: {
        ko: '600년 역사를 가진 한옥 거리, 가회동 31번지가 대표적인 포토 스팟이다. 주민들이 실제로 살고 있는 동네라 정숙한 관람이 필요하며, 오전 11시에서 오후 1시 사이가 가장 한산하다.',
        en: 'A hanok district with 600 years of history, where Gahoe-dong 31 is the iconic spot for photos. Residents still live here, so quiet visiting matters, and the alleys are calmest between 11 AM and 1 PM.',
        ja: '600年の歴史を持つ韓屋街で、嘉会洞31番地が代表的なフォトスポット。住民が実際に暮らす町のため静かな見学が求められ、11時から13時の間が最も落ち着いている。',
        zh: '拥有六百年历史的韩屋街道，嘉会洞31号是标志性拍照点。这里住着真正的居民，参观需保持安静，上午11点到下午1点之间人流最少。',
      },
    },
    {
      photo: '/서울/서울 (1).jpg',
      title: {
        ko: '인사동·익선동, 골목의 점심',
        en: 'Insadong & Ikseondong: Lunch in the Alleys',
        ja: '仁寺洞・益善洞、路地のランチ',
        zh: '仁寺洞·益善洞，巷弄里的午餐',
      },
      body: {
        ko: '전통 공예점과 갤러리, 찻집이 이어지는 인사동 골목을 걷다 익선동 한옥 카페골목까지 도보로 잇는다. 점심은 한정식이나 비빔밥이 잘 어울리는 동네다.',
        en: "Alleys of traditional craft shops, galleries, and tea houses lead the walk from Insadong over to Ikseondong's hanok cafe lane. Lunch here leans toward a Korean set table or bibimbap.",
        ja: '伝統工芸店やギャラリー、茶屋が連なる仁寺洞の路地を歩き、益善洞の韓屋カフェ通りまで足を延ばす。昼食は韓定食やビビンバが似合う街だ。',
        zh: '穿过传统工艺店、画廊与茶屋相连的仁寺洞小巷，再步行至益善洞的韩屋咖啡街。在这里，午餐最适合韩定食或拌饭。',
      },
    },
    {
      photo: '/서울/서울 (10).jpg',
      title: {
        ko: '광장시장, 백 년의 먹자골목',
        en: 'Gwangjang Market: A Century of Street Food',
        ja: '広蔵市場、百年の食べ物横丁',
        zh: '广藏市场，百年小吃街',
      },
      body: {
        ko: '100년을 이어온 재래시장에서 빈대떡과 마약김밥, 육회, 칼국수를 맛본다. 오후 5시가 지나면 시장은 한층 더 활기를 띤다.',
        en: 'A traditional market with a century of history, famed for bindae-tteok pancakes, mayak gimbap, beef tartare, and kalguksu noodles. Past five in the evening the aisles only get livelier.',
        ja: '100年続く伝統市場で、ビンデトックに麻薬キンパ、ユッケ、カルグクスを味わう。17時を過ぎると市場はいっそう活気づく。',
        zh: '在延续百年的传统市场里，品尝绿豆煎饼、麻药饭卷、生牛肉和刀削面。过了下午5点，市场愈发热闹。',
      },
    },
    {
      photo: '/1uA0qa_반포대교(1).webp',
      title: {
        ko: '한강공원, 무지개분수와 저무는 해',
        en: 'Han River Park: Rainbow Fountain, Setting Sun',
        ja: '漢江公園、虹の噴水と沈む日',
        zh: '汉江公园，彩虹喷泉与落日',
      },
      body: {
        ko: '반포대교 무지개분수 쇼와 한강의 노을이 함께 저무는 시간, 4월부터 10월까지 하루 4~6회 분수가 가동된다. 분수 시간표는 계절마다 바뀌니 도시락이나 치맥을 곁들이며 여유롭게 기다려도 좋다.',
        en: "As the Han River's sunset meets the Banpo Bridge Rainbow Fountain show, the fountain runs several times a day from April through October. Showtimes shift with the season, so a picnic or chimaek makes the wait an easy one.",
        ja: '漢江の夕日と盤浦大橋の虹の噴水ショーが重なる時間。4月から10月まで1日に数回噴水が稼働する。噴水の時間は季節ごとに変わるため、お弁当やチメクを片手にゆったり待つのもいい。',
        zh: '汉江日落与盘浦大桥彩虹喷泉表演相遇的时刻，4月至10月每日喷泉表演数次。喷泉时间随季节而变，不妨带着便当或炸鸡啤酒悠闲等候。',
      },
    },
  ],

  'tour-gyeongju': [
    {
      photo: '/Type1_불국사_두드림_z0WAPa.jpg',
      title: {
        ko: '불국사, 신라 불교 미술의 정수',
        en: "Bulguksa: Silla's Buddhist Craft",
        ja: '仏国寺、新羅仏教美術の精髄',
        zh: '佛国寺，新罗佛教艺术的精华',
      },
      body: {
        ko: '다보탑과 석가탑, 청운교가 자리한 불국사는 유네스코 세계유산으로 등재된 신라 불교 미술의 정수를 보여준다. 오전 일찍 도착하면 햇빛도 좋고 한적하며, 한복을 입으면 입장료 없이 들어설 수 있다.',
        en: 'Home to the Dabotap and Seokgatap pagodas and the Cheongun Bridge, Bulguksa is a UNESCO World Heritage site showing the craft of Silla Buddhist art at its clearest. Arrive in the morning for softer light and fewer crowds, and hanbok gets you through the gate for free.',
        ja: '多宝塔と釈迦塔、青雲橋が並ぶ仏国寺は、ユネスコ世界遺産に登録された新羅仏教美術の精髄を今に伝える。午前中に訪れると光がよく人も少なく、韓服を着れば入場料なしで入れる。',
        zh: '多宝塔、释迦塔与青云桥所在的佛国寺，是被列入联合国教科文组织世界遗产的新罗佛教艺术精华所在。清晨到访光线更好、人也更少，穿韩服可免费入场。',
      },
    },
    {
      photo: '/Type1_대릉원(천마총)_한국관광공사, 엠엠피 김진규_651iea(1).jpg',
      title: {
        ko: '대릉원, 왕릉 사이를 걷다',
        en: 'Daereungwon: Walking Among Royal Tombs',
        ja: '大陵苑、王陵の間を歩く',
        zh: '大陵苑，行走于王陵之间',
      },
      body: {
        ko: '신라 왕족의 무덤이 모여 있는 대릉원, 천마총은 내부까지 들어가 볼 수 있고 황남대총은 바깥에서 그 규모를 가늠한다. 도보로 30분이면 첨성대와 계림까지 이어 걸을 수 있다.',
        en: 'Daereungwon gathers the burial mounds of Silla royalty — step inside Cheonmachong, and take in the scale of Hwangnam-daechong from outside. A 30-minute walk continues on to Cheomseongdae and Gyerim Forest nearby.',
        ja: '新羅王族の墳墓が集まる大陵苑。天馬塚は内部まで見学でき、皇南大塚はその外観から規模を実感する。徒歩30分で瞻星台と鶏林まで歩いて回れる。',
        zh: '新罗王族的陵墓群聚于大陵苑，天马冢可入内参观，皇南大冢则从外观感受其规模。步行30分钟即可继续走到瞻星台与鸡林。',
      },
    },
    {
      photo: '/경주/경주 (1).jpg',
      title: {
        ko: '첨성대, 별을 헤아리던 들판',
        en: 'Cheomseongdae: Reading the Stars',
        ja: '瞻星台、星を数えた野原',
        zh: '瞻星台，数星星的原野',
      },
      body: {
        ko: '동양에서 가장 오래된 천문대 첨성대가 왕릉 곁 들판에 서 있다. 대릉원에서 계림을 지나 걸어 닿는 자리라, 걷는 동안 신라의 옛 도시가 천천히 몸에 스며든다.',
        en: 'Cheomseongdae, the oldest astronomical observatory in East Asia, stands in an open field beside the royal tombs. The walk over from Daereungwon passes Gyerim Forest, and the old Silla capital settles in slowly with every step.',
        ja: '東洋最古の天文台・瞻星台が、王陵のかたわらの野原に立つ。大陵苑から鶏林を抜けて歩いて着く場所で、歩くうちに新羅の古都が静かに染み込んでくる。',
        zh: '东方最古老的天文台瞻星台，静立在王陵旁的原野上。从大陵苑经鸡林步行即到，一路走来，新罗古都的气息缓缓渗入心间。',
      },
    },
    {
      photo: '/경주/경주 (5).jpg',
      title: {
        ko: '황리단길, 한옥 지붕 아래의 오늘',
        en: 'Hwangnidan-gil: Under the Hanok Roofs',
        ja: '皇理団キル、韓屋の屋根の下の今',
        zh: '皇理团路，韩屋屋檐下的今天',
      },
      body: {
        ko: '대릉원 곁으로 이어지는 황리단길은 한옥 지붕 아래 카페와 작은 상점이 모인 거리다. 사진 찍기 좋은 곳으로 이름난 골목을 천천히 걸으며 경주의 하루를 마무리한다.',
        en: 'Hwangnidan-gil runs alongside Daereungwon, its hanok roofs sheltering cafes and small shops. Known as one of the most photographed streets in Gyeongju, it makes an easy, slow close to the day.',
        ja: '大陵苑のそばに続く皇理団キルは、韓屋の屋根の下にカフェや小さな店が集まる通り。写真映えで知られる路地をゆっくり歩いて、慶州の一日を締めくくる。',
        zh: '皇理团路沿着大陵苑延伸，韩屋屋檐下聚集着咖啡馆与小店。这条以适合拍照闻名的街道，正好用来慢慢收尾在庆州的一天。',
      },
    },
  ],
};

export function getTourScenes(tourId: string): TourScene[] {
  return TOUR_SCENES[tourId] || [];
}
