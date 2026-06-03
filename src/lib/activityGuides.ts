// 활동 가이드 콘텐츠 라이브러리 (2026-06-03) — 따릉이/러닝/트레킹 6살용 how-to (4개국어).
//
// 운영자 아이디어: plan 에 무료 활동(따릉이/러닝/트레킹)이 있으면 마지막 Day 와 Wrap-up 사이에
// "활동 가이드" 탭으로 따라하기 쉬운 단계별 설명 + 안전 + 코스 지도 링크를 제공.
// 콘텐츠는 외국인 관광객 기준 딥서치(외국카드 3D Secure 함정, 겨울 아이젠, 일몰 전 하산 등) 반영.
// 스타일 원칙: 한 문장=한 동작 / 번호 단계 / 쉬운 단어 / 숫자·시간 명시 / 함정 사전 경고.

import type { Language } from '@/i18n';

export type ActivityKind = 'bike' | 'running' | 'trekking';

export interface DetectedActivity {
  kind: ActivityKind;
  dayNumber: number; // 1-based
  dayIndex: number;  // 0-based
  theme: string;
  startName: string; // 첫 stop 이름 (지도 링크용)
}

// plan 의 최소 형태(페이지 타입 비의존 — 테스트 가능). activity_meta 또는 따릉이 키워드로 감지.
interface ActivityStopLike { name?: string; display_name?: string; lat?: number; lng?: number }
interface ActivityDayLike {
  day?: number;
  theme?: string;
  activity_meta?: { activity_type?: string } | null;
  stops?: (ActivityStopLike | null)[];
}
interface PlanLike { itinerary?: { days?: (ActivityDayLike | null)[] } | null }

const BIKE_RE = /따릉이|한강\s*자전거|hangang.?bike|ttareungi|자전거\s*대여/i;

/** plan 의 활동 day 감지 — trekking/running 은 activity_meta, 따릉이는 city_day 라 키워드 매칭. */
export function detectActivities(plan: PlanLike | null | undefined): DetectedActivity[] {
  const days = (plan && plan.itinerary && plan.itinerary.days) || [];
  const out: DetectedActivity[] = [];
  days.forEach((d, i) => {
    if (!d) return;
    const at = d.activity_meta && d.activity_meta.activity_type;
    const theme = String(d.theme || '');
    const stops = (d.stops || []).filter((s): s is ActivityStopLike => !!s);
    const stopsText = stops.map((s) => `${s.name || ''} ${s.display_name || ''}`).join(' ');
    let kind: ActivityKind | null = null;
    if (at === 'trekking') kind = 'trekking';
    else if (at === 'running_route') kind = 'running';
    else if (BIKE_RE.test(`${theme} ${stopsText}`)) kind = 'bike';
    if (kind) {
      out.push({
        kind,
        dayNumber: Number(d.day) || i + 1,
        dayIndex: i,
        theme,
        startName: (stops[0] && (stops[0].display_name || stops[0].name)) || theme || '',
      });
    }
  });
  return out;
}

export function hasActivityGuide(plan: PlanLike | null | undefined): boolean {
  return detectActivities(plan).length > 0;
}

/** 첫 stop 이름으로 네이버 지도 검색 링크 (v1 — 임베드 이미지는 후속). */
export function buildMapLink(startName: string): string {
  return `https://map.naver.com/p/search/${encodeURIComponent(startName || '한강')}`;
}

export interface GuideContent {
  title: string;
  intro: string;
  steps: string[];
  warnings: string[];
  mapLabel: string;
}

// ── 콘텐츠 (4개국어). 앱 버튼명/역명/패스명은 현장 대조 위해 영문 그대로 유지. ──
export const ACTIVITY_GUIDES: Record<ActivityKind, Record<Language, GuideContent>> = {
  bike: {
    en: {
      title: 'Ride a Bike by the Han River (Ttareungi)',
      intro: 'Seoul\'s public bikes are cheap and easy. Here is how to ride one by the river.',
      steps: [
        'Open your app store. Search "Ttareungi" (Seoul Bike). Tap Install.',
        'Open the app. On the first screen, tap "Foreigner" — now it is in English.',
        'Tap "Purchase Voucher" → "Day Voucher". 1 hour = ₩1,000.',
        'Pay with a Visa/Mastercard, or use a Discover Seoul Pass (bikes free for 24 hours).',
        'The app shows bike stations (대여소, a bike rack) near you. Walk to the closest one.',
        'Pick any bike. Scan its QR code with the app. The lock clicks open. Now ride!',
        'Stay on the flat bike path by the river. Ride slowly. Watch for people walking.',
        'To finish: ride to any station and push the bike\'s lock down until it clicks. Done.',
      ],
      warnings: [
        'If your card says "error" or "failed", that is a common Korea problem (an extra password check). Use a Discover Seoul Pass or a Climate Card instead.',
        'No helmet is provided. Easy first route: Yeouido → Banpo Bridge, flat, ~12 km round trip (~1 hour).',
      ],
      mapLabel: 'See the course on the map',
    },
    ko: {
      title: '한강에서 따릉이 타기',
      intro: '서울 공공자전거는 싸고 쉽습니다. 한강에서 타는 법을 알려드려요.',
      steps: [
        '앱 스토어를 엽니다. "따릉이"(Seoul Bike)를 검색하고 설치를 누릅니다.',
        '앱을 엽니다. 첫 화면에서 "Foreigner" 버튼을 누르면 영어로 바뀝니다.',
        '"Purchase Voucher" → "Day Voucher"를 누릅니다. 1시간 = ₩1,000.',
        'Visa/Mastercard로 결제하거나, Discover Seoul Pass가 있으면 24시간 무료입니다.',
        '앱이 근처 대여소(자전거 거치대)를 보여줍니다. 가장 가까운 곳으로 걸어갑니다.',
        '아무 자전거나 고릅니다. 앱으로 QR코드를 스캔하면 잠금이 풀립니다. 출발!',
        '강가 평평한 자전거길로만 천천히 탑니다. 걷는 사람을 조심합니다.',
        '반납: 아무 대여소로 가서 자전거 잠금장치를 딸깍 소리 날 때까지 눌러 넣으면 끝.',
      ],
      warnings: [
        '카드가 "error/실패"로 뜨면 한국에서 흔한 문제(추가 비밀번호 인증)입니다. Discover Seoul Pass나 기후동행카드를 쓰세요.',
        '헬멧은 제공 안 됩니다. 쉬운 첫 코스: 여의도 → 반포대교, 평지 왕복 약 12km(약 1시간).',
      ],
      mapLabel: '지도에서 코스 보기',
    },
    ja: {
      title: '漢江で自転車に乗る（タルンイ）',
      intro: 'ソウルの公共自転車は安くて簡単。漢江での乗り方を紹介します。',
      steps: [
        'アプリストアを開き「Ttareungi」(Seoul Bike)を検索してインストール。',
        'アプリを開き、最初の画面で「Foreigner」を押すと英語になります。',
        '「Purchase Voucher」→「Day Voucher」を選択。1時間 = ₩1,000。',
        'Visa/Mastercardで支払い、またはDiscover Seoul Passなら24時間無料。',
        'アプリが近くの貸出所(대여소)を表示。一番近い所まで歩きます。',
        '自転車を選び、QRコードをスキャン。ロックが外れたら出発！',
        '川沿いの平らな自転車道をゆっくり。歩行者に注意。',
        '返却：どの貸出所でもロックをカチッと押し込めば完了。',
      ],
      warnings: [
        'カードが「error/失敗」になるのは韓国でよくある問題(追加パスワード認証)です。Discover Seoul Passや気候同行カードを使ってください。',
        'ヘルメットはありません。簡単な初コース：汝矣島→盤浦大橋、平坦で往復約12km(約1時間)。',
      ],
      mapLabel: '地図でコースを見る',
    },
    zh: {
      title: '在汉江骑公共自行车（Ttareungi）',
      intro: '首尔的公共自行车便宜又简单。这是在汉江骑行的方法。',
      steps: [
        '打开应用商店，搜索「Ttareungi」(Seoul Bike)并安装。',
        '打开应用，在第一个界面点「Foreigner」即可切换英文。',
        '点「Purchase Voucher」→「Day Voucher」。1小时 = ₩1,000。',
        '用Visa/Mastercard付款，或用Discover Seoul Pass（24小时免费）。',
        '应用会显示附近的租借站(대여소)。走到最近的一个。',
        '选任意一辆，用应用扫描车上的二维码，锁打开后即可出发！',
        '在江边平坦的自行车道慢慢骑，注意行人。',
        '归还：骑到任意租借站，把车锁向下按到「咔哒」一声即完成。',
      ],
      warnings: [
        '如果卡显示「error/失败」，这是韩国常见问题(额外密码验证)。请改用Discover Seoul Pass或气候同行卡。',
        '不提供头盔。简单首选路线：汝矣岛→盘浦大桥，平路往返约12公里(约1小时)。',
      ],
      mapLabel: '在地图上查看路线',
    },
  },
  running: {
    en: {
      title: 'Run by the Han River',
      intro: 'The riverside path is flat and beautiful — perfect for an easy run.',
      steps: [
        'Wear running shoes. Bring a small water bottle (there are water fountains too).',
        'Go to Yeouido Hangang Park (Subway Line 5, Yeouinaru Station). Walk to the river.',
        'Near the station is a free Runner Station — lockers, showers, a place to leave your bag.',
        'Find the flat path by the water and start running. Keep the river on one side.',
        'A 5 km run is great for beginners. The Banpo route (~5 km) is flat and easy.',
        'Best times: early morning (6–8 AM) or evening (6–8 PM). Turn back the same way you came.',
      ],
      warnings: [
        'Stay on the running/walking path, not the bike lane.',
        'At night, run where the lights are on (Banpo Bridge lights up and is pretty).',
      ],
      mapLabel: 'See the course on the map',
    },
    ko: {
      title: '한강에서 러닝하기',
      intro: '강변길은 평평하고 예뻐서 가볍게 뛰기 딱 좋습니다.',
      steps: [
        '러닝화를 신습니다. 작은 물병을 챙깁니다(길에 음수대도 있어요).',
        '여의도 한강공원으로 갑니다(지하철 5호선 여의나루역). 강 쪽으로 걸어갑니다.',
        '역 근처에 무료 러너 스테이션이 있어요 — 사물함·샤워실·짐 보관.',
        '강가 평평한 길을 찾아 뛰기 시작합니다. 강을 한쪽에 두고 달리면 길 안 잃어요.',
        '초보는 5km가 좋아요. 반포 코스(약 5km)가 평지라 쉽습니다.',
        '좋은 시간: 이른 아침(6–8시) 또는 저녁(6–8시). 왔던 길로 되돌아옵니다.',
      ],
      warnings: [
        '자전거 도로 말고 러닝/보행 길로만 다니세요.',
        '밤에는 불 켜진 곳으로 뛰세요(반포대교는 불이 켜져 예뻐요).',
      ],
      mapLabel: '지도에서 코스 보기',
    },
    ja: {
      title: '漢江でランニング',
      intro: '川沿いの道は平らで美しく、軽いランに最適です。',
      steps: [
        'ランニングシューズを履き、小さな水筒を持ちます(給水所もあります)。',
        '汝矣島漢江公園へ(地下鉄5号線 汝矣ナル駅)。川の方へ歩きます。',
        '駅近くに無料のランナーステーション — ロッカー・シャワー・荷物預け。',
        '川沿いの平らな道を見つけて走り始めます。川を片側に。',
        '初心者は5kmがおすすめ。盤浦コース(約5km)は平坦で簡単。',
        'おすすめ時間：早朝(6–8時)か夕方(6–8時)。来た道を戻ります。',
      ],
      warnings: [
        '自転車道ではなくランニング/歩行者の道を。',
        '夜は明かりのある所で(盤浦大橋はライトアップされ綺麗)。',
      ],
      mapLabel: '地図でコースを見る',
    },
    zh: {
      title: '在汉江跑步',
      intro: '江边小路平坦又漂亮，非常适合轻松跑步。',
      steps: [
        '穿跑鞋，带一个小水瓶(路上也有饮水处)。',
        '前往汝矣岛汉江公园(地铁5号线 汝矣渡口站)，走向江边。',
        '车站附近有免费的跑者驿站 — 储物柜、淋浴、寄存行李。',
        '找到江边平坦的小路开始跑，把江放在一侧就不会迷路。',
        '新手跑5公里很好。盘浦路线(约5公里)平坦又简单。',
        '最佳时间：清晨(6–8点)或傍晚(6–8点)。原路返回。',
      ],
      warnings: [
        '请走跑步/步行道，不要走自行车道。',
        '夜晚在有灯光的地方跑(盘浦大桥会亮灯，很美)。',
      ],
      mapLabel: '在地图上查看路线',
    },
  },
  trekking: {
    en: {
      title: 'Easy Mountain Hike (Bukhansan)',
      intro: 'Bukhansan is a real mountain inside Seoul. Here is how to hike it safely.',
      steps: [
        'Bring a small backpack: 1–1.5 L water, a snack, tissue, a trash bag, a light jacket.',
        'Wear comfy closed shoes. Sneakers are okay for the easy path.',
        'Take the Ui LRT line to Bukhansan Ui Station, Exit 2.',
        'No gear? The Seoul Hiking Tourism Center (5-min walk) rents boots/poles/jacket (~₩2,000–5,000).',
        'Get a free paper trail map at the Park Information Center before you start.',
        'Easiest walk (no climbing): the Bukhansan Dulle-gil, a flat forest path, ~90 minutes round trip.',
        'Start early, around 8 AM. It gets crowded after 9–11 AM. A weekday is quieter.',
      ],
      warnings: [
        'Come down before dark. Park gates close ~5 PM (Mar–Nov), ~4 PM (Dec–Feb).',
        'In winter (Dec–Feb) the path gets icy — you MUST wear crampons/spikes (rent them). Best seasons: spring and fall.',
      ],
      mapLabel: 'See the course on the map',
    },
    ko: {
      title: '쉬운 등산 (북한산)',
      intro: '북한산은 서울 안에 있는 진짜 산입니다. 안전하게 오르는 법이에요.',
      steps: [
        '작은 배낭에 챙기기: 물 1–1.5L, 간식, 휴지, 쓰레기봉투, 얇은 겉옷.',
        '편한 운동화를 신습니다(쉬운 길은 운동화로 충분).',
        '우이신설선을 타고 북한산우이역 2번 출구로 갑니다.',
        '장비가 없으면 서울 등산관광센터(도보 5분)에서 등산화·스틱·재킷 대여(약 ₩2,000–5,000).',
        '출발 전 공원 안내센터에서 무료 종이 지도를 받습니다.',
        '가장 쉬운 길(오르막 없음): 북한산 둘레길, 평평한 숲길 왕복 약 90분.',
        '아침 8시쯤 일찍 출발하세요. 9–11시 이후엔 붐벼요. 평일이 한산합니다.',
      ],
      warnings: [
        '어두워지기 전에 내려오세요. 공원 문은 약 오후 5시(3–11월)·오후 4시(12–2월)에 닫혀요.',
        '겨울(12–2월)엔 길이 얼어요 — 아이젠을 꼭 착용(대여 가능). 가장 좋은 계절: 봄·가을.',
      ],
      mapLabel: '지도에서 코스 보기',
    },
    ja: {
      title: '簡単な登山（北漢山）',
      intro: '北漢山はソウル市内にある本物の山。安全に登る方法です。',
      steps: [
        '小さなリュックに：水1–1.5L、おやつ、ティッシュ、ゴミ袋、薄い上着。',
        '歩きやすい靴を。簡単な道ならスニーカーでOK。',
        '牛耳新設線で北漢山牛耳駅2番出口へ。',
        '装備がなければソウル登山観光センター(徒歩5分)で靴・ストック・上着をレンタル(約₩2,000–5,000)。',
        '出発前に公園案内センターで無料の紙地図をもらいます。',
        '一番簡単な道(登りなし)：北漢山トゥルレギル、平らな森の道、往復約90分。',
        '朝8時頃に早く出発。9–11時以降は混みます。平日が静か。',
      ],
      warnings: [
        '暗くなる前に下山を。ゲートは約17時(3–11月)・16時(12–2月)に閉まります。',
        '冬(12–2月)は道が凍ります — アイゼン必須(レンタル可)。最適な季節：春と秋。',
      ],
      mapLabel: '地図でコースを見る',
    },
    zh: {
      title: '轻松登山（北汉山）',
      intro: '北汉山是首尔市内的真正的山。这是安全登山的方法。',
      steps: [
        '小背包里装：水1–1.5升、零食、纸巾、垃圾袋、薄外套。',
        '穿舒适的运动鞋(简单路线运动鞋即可)。',
        '乘牛耳新设线到北汉山牛耳站2号出口。',
        '没装备？首尔登山观光中心(步行5分钟)可租鞋/登山杖/外套(约₩2,000–5,000)。',
        '出发前在公园咨询中心领取免费纸质地图。',
        '最简单路线(无攀爬)：北汉山环山路，平坦林道，往返约90分钟。',
        '早上8点左右出发。9–11点后会拥挤，工作日更安静。',
      ],
      warnings: [
        '天黑前下山。公园门约17点(3–11月)、16点(12–2月)关闭。',
        '冬季(12–2月)路面结冰 — 必须穿冰爪(可租)。最佳季节：春秋。',
      ],
      mapLabel: '在地图上查看路线',
    },
  },
};

const GUIDE_HEADING: Record<Language, string> = {
  ko: '활동 가이드',
  en: 'Activity Guide',
  ja: 'アクティビティガイド',
  zh: '活动指南',
};

/**
 * PDF 렌더용 활동 가이드 HTML (2026-06-03) — 화면 ActivityGuideSlide 와 **동일 콘텐츠 SSOT**(ACTIVITY_GUIDES).
 *
 * 오프라인 여행 참조용: 사용자가 다운로드한 PDF 로 현장에서 따라 하므로, 따릉이 외국카드 3D Secure
 * SAFETY 경고가 화면뿐 아니라 PDF 에도 포함돼야 함(#786 화면 전용 → PDF 누락 갭 봉합).
 *
 * 게이트: VITE_FEATURE_ACTIVITY_GUIDE 는 호출자(pdfGenerator)가 검사. 활동 없으면 '' (additive, byte-identical).
 * 이모지 미사용(이모지 금지 + PDF emoji 폰트 회피) — amber 좌측 보더로 경고 표시.
 *
 * @param plan — itinerary.days 를 가진 plan
 * @param lang — ko/en/ja/zh
 * @returns HTML 문자열 (활동 없으면 '')
 */
export function buildActivityGuideHtml(plan: PlanLike | null | undefined, lang: Language): string {
  const acts = detectActivities(plan);
  if (acts.length === 0) return '';
  const seen = new Set<ActivityKind>();
  const unique = acts.filter((a) => (seen.has(a.kind) ? false : (seen.add(a.kind), true)));
  const esc = (s: unknown) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const heading = GUIDE_HEADING[lang] || GUIDE_HEADING.en;
  let html = `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin-bottom:16px;page-break-inside:avoid;break-inside:avoid;">
    <h3 style="font-size:15px;font-weight:700;color:#7C5CFC;margin:0 0 12px;">${esc(heading)}</h3>`;
  for (const a of unique) {
    const byKind = ACTIVITY_GUIDES[a.kind];
    const g = byKind && (byKind[lang] || byKind.en);
    if (!g) continue;
    const mapUrl = buildMapLink(a.startName);
    const steps = g.steps
      .map((s) => `<li style="font-size:11px;color:#374151;margin:0 0 3px;">${esc(s)}</li>`)
      .join('');
    const warns = g.warnings
      .map((w) => `<div style="font-size:10px;color:#92400e;background:rgba(245,158,11,0.10);border-left:3px solid rgba(245,158,11,0.5);border-radius:4px;padding:5px 9px;margin:3px 0;">${esc(w)}</div>`)
      .join('');
    html += `<div style="margin:0 0 14px;page-break-inside:avoid;break-inside:avoid;">
      <h4 style="font-size:13px;font-weight:700;color:#111827;margin:0 0 3px;">${esc(g.title)}</h4>
      <p style="font-size:11px;color:#6b7280;margin:0 0 6px;">${esc(g.intro)}</p>
      <ol style="margin:0 0 6px;padding-left:18px;">${steps}</ol>
      ${warns}
      <a href="${mapUrl}" style="font-size:11px;color:#0369a1;text-decoration:underline;">${esc(g.mapLabel)}</a>
    </div>`;
  }
  html += '</div>';
  return html;
}
