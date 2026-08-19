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
      photo: '/파주_dmz/파주 (1).jpg',
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
      photo: '/파주_dmz/파주 (2).jpg',
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
      photo: '/서울/서울 (3).jpg',
      title: {
        ko: '명동, 서울 최대의 쇼핑 거리',
        en: "Myeongdong: Seoul's Biggest Shopping Street",
        ja: '明洞、ソウル最大のショッピング街',
        zh: '明洞，首尔最大的购物街',
      },
      body: {
        ko: '서울에서 가장 큰 쇼핑 거리인 명동에는 K-뷰티 매장과 면세점, 길거리 음식이 한데 모여 있다. 오후 4시를 넘기면 길거리 음식 매대가 본격적으로 문을 연다.',
        en: "Myeongdong, Seoul's biggest shopping street, packs K-beauty stores, duty-free shops, and street food into one stretch. Past 4 PM, the street-food stalls open in earnest.",
        ja: 'ソウル最大のショッピングストリート・明洞には、K-ビューティー店や免税店、屋台が一堂に集まる。16時を過ぎると屋台が本格的に開き始める。',
        zh: '首尔最大的购物街明洞，聚集着K-美妆店、免税店与街头小吃。下午4点后，小吃摊位才正式热闹起来。',
      },
    },
    {
      photo: '/서울/서울 (7).jpg',
      title: {
        ko: 'N서울타워, 360도로 열리는 도시',
        en: 'N Seoul Tower: The City in 360°',
        ja: 'Nソウルタワー、360度に開く街',
        zh: 'N首尔塔，360度展开的城市',
      },
      body: {
        ko: '케이블카나 차량으로 남산 정상에 오르면 서울이 360도로 펼쳐진다. 사랑의 자물쇠가 빼곡히 걸린 난간과 야경 촬영지로도 이름난 곳이다.',
        en: '360° view of Seoul opens up once the cable car or shuttle reaches the top of Namsan. The railings are dense with love locks, and the tower is just as well known for night-skyline photos.',
        ja: 'ケーブルカーか車両で南山の頂上に上がると、ソウルが360度に広がる。愛のロックがびっしり掛かる手すりと、夜景撮影の名所としても知られる。',
        zh: '乘缆车或车辆登上南山顶，首尔在眼前360度展开。挂满情侣锁的栏杆，也是拍摄夜景闻名的地方。',
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
      photo: '/경주/경주 (1).jpg',
      title: {
        ko: '석굴암, 동해를 향한 시선',
        en: 'Seokguram: Facing the East Sea',
        ja: '石窟庵、東海を見つめる眼差し',
        zh: '石窟庵，凝望东海的目光',
      },
      body: {
        ko: '8세기에 지어진 석굴 사원 석굴암, 본존불상은 동해에서 떠오르는 해를 향해 앉아 있다. 자연광이 스며드는 내부는 사진 촬영이 금지되어 있어 한 줄로 천천히 걸으며 눈으로만 담아야 한다.',
        en: 'Seokguram, an 8th-century stone-cave temple, seats its Buddha statue facing the sunrise over the East Sea. Photography is off-limits inside, so the natural light filtering through the chamber is something you carry only in memory, filing past in a single line.',
        ja: '8世紀に築かれた石窟寺院・石窟庵。本尊仏は東海から昇る朝日の方向に座している。自然光が差し込む内部は撮影禁止のため、一列でゆっくり歩きながら目に焼き付けるほかない。',
        zh: '始建于8世纪的石窟寺院石窟庵，本尊佛面朝东海日出的方向而坐。洞内禁止拍照，自然光洒落其间的景象只能单列缓行、用眼睛记下。',
      },
    },
    {
      photo: '/경주/경주 (3).jpg',
      title: {
        ko: '경주 한정식, 신라 궁중의 상차림',
        en: 'A Silla-Court Lunch in Gyeongju',
        ja: '慶州韓定食、新羅宮中の膳',
        zh: '庆州韩定食，新罗宫廷的一桌',
      },
      body: {
        ko: '신라 궁중요리를 본뜬 한정식으로 오후를 준비한다. 보리굴비와 황남빵이 상 위에 함께 오르며, 하루의 절반을 걸어온 다리를 잠시 쉬게 한다.',
        en: "Lunch borrows from Silla court cuisine, a hanjeongsik spread that carries boriguibi (dried yellow corvina) and Hwangnam-bbang pastry to the table. It's the pause that lets legs recover before the afternoon's tumuli and pond await.",
        ja: '新羅宮中料理になぞらえた韓定食で午後に備える。麦塩漬けの魚や黄南パンが膳に並び、半日歩いた脚を休ませる時間になる。',
        zh: '以新罗宫廷料理为灵感的韩定食为下午蓄力。麦盐渍鱼与黄南面包摆上桌，也让走了半天的双腿得以稍作休息。',
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
      photo: '/경주/경주 (5).jpg',
      title: {
        ko: '동궁과 월지, 해 진 뒤의 빛',
        en: 'Donggung & Wolji After Sunset',
        ja: '東宮と月池、日没後の光',
        zh: '东宫与月池，日落后的光',
      },
      body: {
        ko: '신라의 별궁이 있던 동궁과 월지, 해가 지고 나면 조명이 연못 위 신라 기와를 그대로 비춘다. 일몰 30분 전에 도착하면 야경이 서서히 물드는 순간부터 지켜볼 수 있다.',
        en: 'Donggung Palace and Wolji Pond once formed a Silla detached palace, and once the sun goes down, lights reflect the old rooflines across the water. Arriving thirty minutes before sunset means catching the whole slow shift into night.',
        ja: '新羅の別宮があった東宮と月池は、日が沈むと照明が新羅瓦を池の水面に映し出す。日没30分前に着けば、夜景が徐々に色づく瞬間から見届けられる。',
        zh: '曾是新罗离宫所在的东宫与月池，日落后灯光会将新罗瓦当的轮廓映在水面上。若在日落前30分钟到达，便能看着夜色一点点漫上来。',
      },
    },
  ],
};

export function getTourScenes(tourId: string): TourScene[] {
  return TOUR_SCENES[tourId] || [];
}
