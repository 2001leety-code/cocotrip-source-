import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowUpDown,
  ChevronRight,
  CreditCard,
  ExternalLink,
  Languages,
  Phone,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { AffiliateCard } from '@/components/AffiliateCard';
import { TourCard } from '@/components/tours/TourCard';
import { TourInquireModal } from '@/components/tours/TourInquireModal';
import { EcEmpty } from '@/components/ui/states';
import { buildHotelListLink } from '@/config/affiliateLinks';
import { PACE_ORDER, TOUR_PACE, paceEmoji, paceLabel, type TripPace } from '@/data/tourPace';
import { TOUR_REGIONS, getToursByRegion, isUngroundedBadgeTag } from '@/data/tours';
import type { DriverLanguage, TourRegion, TourTag } from '@/data/tours';
import { useLanguage } from '@/hooks/useLanguage';
import { usePageMeta } from '@/hooks/usePageMeta';
import type { Language } from '@/i18n';
import { trackAffiliateClick } from '@/lib/affiliateTracking';
import { trackEvent } from '@/lib/analytics';
import { matchesTourQuery } from '@/lib/tourSearch';
import { Header } from '@/sections/Header';
import '@/styles/editorial-tours-catalog.css';

type SortKey = 'default' | 'price-asc' | 'price-desc';
type DurationKey = 'All' | 'Day' | 'Short' | 'Long';

const TL = {
  ko: {
    catalogueLabel: '한국 투어 안내서',
    pageTitle: '여행 방식부터 고르는 한국 투어',
    pageSubtitle: '지역, 기간, 이동 속도를 비교하고 각 일정의 실제 포함 항목을 확인하세요.',
    trustLabel: '예약 전 확인',
    filterTitle: '조건에 맞는 일정 찾기',
    filterBody: '필터는 실제 등록된 상품 정보만 사용합니다.',
    filterLabel: '지역',
    durationLabel: '기간',
    interestLabel: '관심사',
    paceFilterLabel: '여행 속도',
    driverLabel: '기사 언어',
    sortLabel: '정렬',
    searchLabel: '여행지 또는 명소 검색',
    resultsLabel: '현재 일정',
    inquireTitle: '목록에 없는 일정이 필요하신가요?',
    inquireSub: '지역·테마·예산을 알려주시면 맞춤 견적을 안내합니다',
    inquireBtn: '맞춤 문의',
    charterLink: '차터 견적폼',
    hotelCtaText: '투어 전후 숙소도 비교하시나요?',
    hotelCtaBtn: 'Trip.com에서 숙소 보기',
    hotelCtaNew: '새 창에서 Trip.com이 열립니다',
    seoTitle: 'CocoTrip 투어 — 한국 프라이빗 투어',
    seoDesc: '서울·부산·제주 전세차량 투어. 톨비·주차비 포함, PayPal 안심결제.',
    noResults: '선택한 조건의 투어가 없습니다',
    noSearchResults: '검색어와 일치하는 투어가 없습니다',
    emptyBody: '필터를 초기화하거나 다른 지역과 기간을 선택해 보세요.',
    resetFilters: '필터 초기화',
    searchPlaceholder: '여행지·명소 검색',
    clearSearch: '검색어 지우기',
    indexLabel: 'CocoTrip 지역 안내',
    selectorLabel: 'CocoTrip 일정 선택',
    catalogueSectionLabel: 'CocoTrip 투어 목록',
    conciergeLabel: 'CocoTrip 맞춤 안내',
    destinationsLabel: '지역별 둘러보기',
    destinationsBody: '등록된 일정이 있는 지역만 표시합니다.',
    seasonLabel: '이번 계절 안내',
    toursUnit: '투어',
    filterTriggerLabel: '필터',
    closeFiltersLabel: '필터 닫기',
  },
  en: {
    catalogueLabel: 'Korea tour desk',
    pageTitle: 'Choose the way you travel Korea',
    pageSubtitle: 'Compare regions, duration and pace, then check what each itinerary actually includes.',
    trustLabel: 'Before you book',
    filterTitle: 'Find the right itinerary',
    filterBody: 'Filters use information attached to the listed tours.',
    filterLabel: 'Region',
    durationLabel: 'Duration',
    interestLabel: 'Interests',
    paceFilterLabel: 'Travel pace',
    driverLabel: 'Driver language',
    sortLabel: 'Sort',
    searchLabel: 'Search destinations or attractions',
    resultsLabel: 'Available itineraries',
    inquireTitle: 'Need an itinerary not listed here?',
    inquireSub: 'Tell us your region, theme and budget for a tailored quote',
    inquireBtn: 'Inquire',
    charterLink: 'Charter quote form',
    hotelCtaText: 'Comparing a stay before or after your tour?',
    hotelCtaBtn: 'Browse hotels on Trip.com',
    hotelCtaNew: 'Opens Trip.com in a new tab',
    seoTitle: 'CocoTrip Tours — Korea Private Tours',
    seoDesc: 'Seoul, Busan & Jeju private van tours. Tolls and parking included. PayPal secure.',
    noResults: 'No tours match the selected filters',
    noSearchResults: 'No tours match your search',
    emptyBody: 'Reset the filters or try another region and duration.',
    resetFilters: 'Reset filters',
    searchPlaceholder: 'Search destinations or attractions',
    clearSearch: 'Clear search',
    indexLabel: 'CocoTrip index',
    selectorLabel: 'CocoTrip selector',
    catalogueSectionLabel: 'CocoTrip catalogue',
    conciergeLabel: 'CocoTrip concierge',
    destinationsLabel: 'Browse by destination',
    destinationsBody: 'Only regions with listed itineraries are shown.',
    seasonLabel: 'Season note',
    toursUnit: 'tours',
    filterTriggerLabel: 'Filters',
    closeFiltersLabel: 'Close filters',
  },
  ja: {
    catalogueLabel: '韓国ツアー案内',
    pageTitle: '旅のスタイルから選ぶ韓国ツアー',
    pageSubtitle: '地域・日数・移動ペースを比較し、各日程に実際に含まれる内容をご確認ください。',
    trustLabel: '予約前の確認',
    filterTitle: '希望に合う日程を探す',
    filterBody: 'フィルターは掲載ツアーの実データのみを使用します。',
    filterLabel: '地域',
    durationLabel: '期間',
    interestLabel: 'テーマ',
    paceFilterLabel: '旅のペース',
    driverLabel: 'ドライバー言語',
    sortLabel: '並び替え',
    searchLabel: '目的地または観光スポットを検索',
    resultsLabel: '掲載中の日程',
    inquireTitle: '一覧にない日程をご希望ですか？',
    inquireSub: '地域・テーマ・予算をお知らせいただければ、お見積もりをご案内します',
    inquireBtn: 'お問い合わせ',
    charterLink: 'チャーター見積フォーム',
    hotelCtaText: 'ツアー前後の宿泊先も比較しますか？',
    hotelCtaBtn: 'Trip.comでホテルを見る',
    hotelCtaNew: '新しいタブでTrip.comが開きます',
    seoTitle: 'CocoTrip ツアー — 韓国プライベートツアー',
    seoDesc: 'ソウル・釜山・済州の専用バンツアー。通行料・駐車場込み。PayPal安全決済。',
    noResults: '選択した条件に合うツアーがありません',
    noSearchResults: '検索に一致するツアーがありません',
    emptyBody: 'フィルターをリセットするか、別の地域・期間をお試しください。',
    resetFilters: 'フィルターをリセット',
    searchPlaceholder: '目的地・観光スポットを検索',
    clearSearch: '検索をクリア',
    indexLabel: 'CocoTrip 地域案内',
    selectorLabel: 'CocoTrip 日程検索',
    catalogueSectionLabel: 'CocoTrip ツアー一覧',
    conciergeLabel: 'CocoTrip コンシェルジュ',
    destinationsLabel: '地域から探す',
    destinationsBody: '掲載中の日程がある地域のみ表示します。',
    seasonLabel: '季節の案内',
    toursUnit: '件',
    filterTriggerLabel: 'フィルター',
    closeFiltersLabel: 'フィルターを閉じる',
  },
  zh: {
    catalogueLabel: '韩国旅游指南',
    pageTitle: '从旅行方式开始选择韩国行程',
    pageSubtitle: '比较地区、天数和行程节奏，并查看每条路线实际包含的项目。',
    trustLabel: '预订前确认',
    filterTitle: '查找合适的行程',
    filterBody: '筛选条件只使用已上架旅游产品的信息。',
    filterLabel: '地区',
    durationLabel: '天数',
    interestLabel: '主题',
    paceFilterLabel: '行程节奏',
    driverLabel: '司机语言',
    sortLabel: '排序',
    searchLabel: '搜索目的地或景点',
    resultsLabel: '现有行程',
    inquireTitle: '需要列表中没有的行程？',
    inquireSub: '告诉我们地区、主题和预算，我们将提供定制报价',
    inquireBtn: '立即咨询',
    charterLink: '包车报价表',
    hotelCtaText: '还要比较行程前后的住宿吗？',
    hotelCtaBtn: '在Trip.com查看酒店',
    hotelCtaNew: '将在新窗口打开Trip.com',
    seoTitle: 'CocoTrip 旅游 — 韩国私人包车游',
    seoDesc: '首尔、釜山和济州私人包车游览，含过路费·停车费，PayPal安全支付。',
    noResults: '没有符合所选条件的旅游产品',
    noSearchResults: '没有符合搜索的旅游产品',
    emptyBody: '请重置筛选条件，或尝试其他地区和天数。',
    resetFilters: '重置筛选',
    searchPlaceholder: '搜索目的地或景点',
    clearSearch: '清除搜索',
    indexLabel: 'CocoTrip 地区指南',
    selectorLabel: 'CocoTrip 行程筛选',
    catalogueSectionLabel: 'CocoTrip 旅游列表',
    conciergeLabel: 'CocoTrip 定制咨询',
    destinationsLabel: '按地区浏览',
    destinationsBody: '仅显示已有行程的地区。',
    seasonLabel: '本季提示',
    toursUnit: '条',
    filterTriggerLabel: '筛选',
    closeFiltersLabel: '关闭筛选',
  },
} satisfies Record<Language, Record<string, string>>;

const INTEREST_CHIPS: ReadonlyArray<{ key: TourTag; label: Record<Language, string> }> = ([
  { key: 'Nature' as TourTag, label: { ko: '자연', en: 'Nature', ja: '自然', zh: '自然' } },
  { key: 'History' as TourTag, label: { ko: '역사·문화', en: 'History', ja: '歴史・文化', zh: '历史文化' } },
  { key: 'Night Tour' as TourTag, label: { ko: '야경', en: 'Night view', ja: '夜景', zh: '夜景' } },
  { key: 'Multi-City' as TourTag, label: { ko: '다도시', en: 'Multi-city', ja: '複数都市', zh: '多城市' } },
]).filter(({ key }) => !isUngroundedBadgeTag(key));

const REGION_IMAGE: Record<string, string> = {
  Seoul: '/region-seoul.jpg',
  Busan: '/region-busan.webp',
  Gyeongju: '/region-gyeongju.jpg',
  Danyang: '/region-danyang.webp',
};

const DURATION_OPTIONS: ReadonlyArray<{ key: DurationKey; label: Record<Language, string> }> = [
  { key: 'All', label: { ko: '전체 기간', en: 'All', ja: '全期間', zh: '全部' } },
  { key: 'Day', label: { ko: '당일', en: 'Day', ja: '日帰り', zh: '当天' } },
  { key: 'Short', label: { ko: '2~3일', en: '2-3 Days', ja: '2~3日', zh: '2~3天' } },
  { key: 'Long', label: { ko: '4일 이상', en: '4+ Days', ja: '4日以上', zh: '4天+' } },
];

const DRIVER_OPTIONS: ReadonlyArray<{ key: DriverLanguage; label: Record<Language, string> }> = [
  { key: 'en', label: { ko: '영어 기사', en: 'English driver', ja: '英語ドライバー', zh: '英语司机' } },
  { key: 'ja', label: { ko: '일본어 기사', en: 'Japanese driver', ja: '日本語ドライバー', zh: '日语司机' } },
  { key: 'zh', label: { ko: '중국어 기사', en: 'Chinese driver', ja: '中国語ドライバー', zh: '中文司机' } },
];

const SEASON_TIPS = {
  spring: {
    emoji: '🌸',
    ko: '봄 — 벚꽃 시즌은 보통 3월 말부터 4월입니다. 아침저녁 일교차에 대비해 겉옷을 챙기세요.',
    en: 'Spring — cherry-blossom season is usually late March through April. Pack a layer for cooler mornings and evenings.',
    ja: '春 — 桜の時期は通常3月末から4月です。朝晩の寒暖差に備えて上着をお持ちください。',
    zh: '春季 — 樱花季通常为3月底至4月。早晚温差较大，请携带外套。',
  },
  summer: {
    emoji: '☀️',
    ko: '여름 — 덥고 습하며 6월 말부터 7월에는 비가 잦습니다. 야외 일정은 물과 우산을 준비하세요.',
    en: 'Summer — expect heat, humidity and frequent rain from late June into July. Carry water and rain protection for outdoor days.',
    ja: '夏 — 蒸し暑く、6月末から7月は雨が多い時期です。屋外の日程には水分と雨具をご用意ください。',
    zh: '夏季 — 炎热潮湿，6月底至7月降雨较多。户外行程请准备饮水和雨具。',
  },
  autumn: {
    emoji: '🍁',
    ko: '가을 — 단풍은 보통 10월부터 11월에 이어집니다. 인기 지역은 도로가 혼잡할 수 있습니다.',
    en: 'Autumn — foliage usually runs from October into November. Roads around well-known viewing areas can be busy.',
    ja: '秋 — 紅葉は通常10月から11月に続きます。名所周辺の道路は混雑する場合があります。',
    zh: '秋季 — 红叶季通常为10月至11月。热门观赏地区周边道路可能拥堵。',
  },
  winter: {
    emoji: '❄️',
    ko: '겨울 — 춥고 건조하며 눈이 오면 이동 시간이 늘어날 수 있습니다. 방한복과 여유 있는 일정을 준비하세요.',
    en: 'Winter — cold, dry weather and snow can extend driving times. Bring warm layers and leave room in the schedule.',
    ja: '冬 — 寒く乾燥し、雪の日は移動時間が延びる場合があります。防寒着と余裕のある日程をご用意ください。',
    zh: '冬季 — 天气寒冷干燥，降雪时行车时间可能延长。请注意保暖并预留充足时间。',
  },
} as const;

function currentSeason(month: number): keyof typeof SEASON_TIPS {
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

export default function ToursPage() {
  const { language, t, changeLanguage } = useLanguage();
  const tl = TL[language] || TL.en;
  const [searchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') || '');
  const [activeRegion, setActiveRegion] = useState<TourRegion | 'All'>('All');
  const [activeDuration, setActiveDuration] = useState<DurationKey>('All');
  const [activeTags, setActiveTags] = useState<Set<TourTag>>(new Set());
  const [activeLangs, setActiveLangs] = useState<Set<DriverLanguage>>(new Set());
  const [activePace, setActivePace] = useState<Set<TripPace>>(new Set());
  const [sortBy, setSortBy] = useState<SortKey>('default');
  const [inquireOpen, setInquireOpen] = useState(false);
  const filterDialogRef = useRef<HTMLDialogElement>(null);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);

  const hotelCityMap: Partial<Record<TourRegion, string>> = {
    Seoul: 'seoul',
    Busan: 'busan',
    Jeju: 'jeju',
    Gyeongju: 'gyeongju',
    Chuncheon: 'chuncheon',
    Danyang: 'danyang',
    Incheon: 'incheon',
    Ganghwa: 'seoul',
    DMZ: 'seoul',
    'Multi-City': 'seoul',
  };
  const hotelCityKey = activeRegion === 'All' ? undefined : hotelCityMap[activeRegion];
  const hotelSearchUrl = buildHotelListLink(hotelCityKey);
  const inquireDefaultRegion: '' | 'seoul' | 'busan' | 'jeju' | 'other' =
    activeRegion === 'All' ? '' :
      activeRegion === 'Seoul' ? 'seoul' :
        activeRegion === 'Busan' ? 'busan' :
          activeRegion === 'Jeju' ? 'jeju' : 'other';

  const toggleLang = (driverLanguage: DriverLanguage) => {
    setActiveLangs((previous) => {
      const next = new Set(previous);
      if (next.has(driverLanguage)) next.delete(driverLanguage);
      else next.add(driverLanguage);
      return next;
    });
  };

  const toggleTag = (tag: TourTag) => {
    setActiveTags((previous) => {
      const next = new Set(previous);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const togglePace = (pace: TripPace) => {
    setActivePace((previous) => {
      const next = new Set(previous);
      if (next.has(pace)) next.delete(pace);
      else next.add(pace);
      return next;
    });
  };

  const resetFilters = () => {
    setSearchQuery('');
    setActiveRegion('All');
    setActiveDuration('All');
    setActiveTags(new Set());
    setActiveLangs(new Set());
    setActivePace(new Set());
    setSortBy('default');
  };

  const activeFilterCount =
    (activeRegion !== 'All' ? 1 : 0) +
    (activeDuration !== 'All' ? 1 : 0) +
    activeTags.size +
    activeLangs.size +
    activePace.size +
    (searchQuery.trim() ? 1 : 0);

  const openFilterDialog = () => filterDialogRef.current?.showModal();
  const closeFilterDialog = () => filterDialogRef.current?.close();
  const handleFilterDialogBackdropClick = (event: ReactMouseEvent<HTMLDialogElement>) => {
    if (event.target === filterDialogRef.current) closeFilterDialog();
  };

  useEffect(() => {
    const dialog = filterDialogRef.current;
    if (!dialog) return;
    const returnFocus = () => filterTriggerRef.current?.focus();
    dialog.addEventListener('close', returnFocus);
    return () => dialog.removeEventListener('close', returnFocus);
  }, []);

  const filteredTours = getToursByRegion(activeRegion).filter((tour) => {
    if (!matchesTourQuery(tour, searchQuery)) return false;
    if (activeDuration === 'Day' && tour.durationDays !== 1) return false;
    if (activeDuration === 'Short' && !(tour.durationDays === 2 || tour.durationDays === 3)) return false;
    if (activeDuration === 'Long' && tour.durationDays < 4) return false;
    if (activeLangs.size > 0) {
      const languages = tour.driverLanguages && tour.driverLanguages.length > 0
        ? tour.driverLanguages
        : (['en'] as DriverLanguage[]);
      if (!Array.from(activeLangs).every((driverLanguage) => languages.includes(driverLanguage))) return false;
    }
    if (activeTags.size > 0 && !tour.tags.some((tag) => activeTags.has(tag))) return false;
    if (activePace.size > 0) {
      const pace = TOUR_PACE[tour.id];
      if (!pace || !activePace.has(pace)) return false;
    }
    return true;
  });

  const visibleTours = [...filteredTours];
  if (sortBy === 'price-asc') visibleTours.sort((left, right) => left.priceFrom - right.priceFrom);
  if (sortBy === 'price-desc') visibleTours.sort((left, right) => right.priceFrom - left.priceFrom);

  const renderFilterFields = () => (
    <>
      <label className="tours-catalog-search">
        <span>{tl.searchLabel}</span>
        <span className="tours-catalog-search-field">
          <Search aria-hidden />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={tl.searchPlaceholder}
            enterKeyHint="search"
            className="min-h-[44px]"
          />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery('')} aria-label={tl.clearSearch}>
              <X aria-hidden />
            </button>
          )}
        </span>
      </label>

      <div className="tours-catalog-filter-groups">
        <fieldset>
          <legend>{tl.filterLabel}</legend>
          <div className="tours-catalog-chip-row">
            {TOUR_REGIONS.map(({ key, label }) => {
              const isActive = activeRegion === key;
              return (
                <button
                  type="button"
                  key={key}
                  onClick={() => setActiveRegion(key)}
                  aria-pressed={isActive}
                  className="tour-chip tours-catalog-chip min-h-[44px]"
                >
                  {label[language] || label.en}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend>{tl.durationLabel}</legend>
          <div className="tours-catalog-chip-row">
            {DURATION_OPTIONS.map(({ key, label }) => (
              <button
                type="button"
                key={key}
                onClick={() => setActiveDuration(key)}
                aria-pressed={activeDuration === key}
                className="tour-chip tours-catalog-chip min-h-[44px]"
              >
                {label[language] || label.en}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>{tl.interestLabel}</legend>
          <div className="tours-catalog-chip-row">
            {INTEREST_CHIPS.map(({ key, label }) => (
              <button
                type="button"
                key={key}
                onClick={() => toggleTag(key)}
                aria-pressed={activeTags.has(key)}
                className="tour-chip tours-catalog-chip min-h-[44px]"
              >
                {label[language] || label.en}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>{tl.paceFilterLabel}</legend>
          <div className="tours-catalog-chip-row">
            {PACE_ORDER.map((pace) => (
              <button
                type="button"
                key={pace}
                onClick={() => togglePace(pace)}
                aria-pressed={activePace.has(pace)}
                className="tour-chip tours-catalog-chip min-h-[44px]"
              >
                <span aria-hidden>{paceEmoji(pace)}</span>
                {paceLabel(pace, language)}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>{tl.driverLabel}</legend>
          <div className="tours-catalog-chip-row">
            {DRIVER_OPTIONS.map(({ key, label }) => (
              <button
                type="button"
                key={key}
                onClick={() => toggleLang(key)}
                aria-pressed={activeLangs.has(key)}
                className="tour-chip tours-catalog-chip min-h-[44px]"
              >
                <Languages aria-hidden />
                {label[language] || label.en}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="tours-catalog-sort-fieldset">
          <legend>{tl.sortLabel}</legend>
          <label className="tours-catalog-sort">
            <ArrowUpDown aria-hidden />
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as SortKey)}
              aria-label={tl.sortLabel}
              className="min-h-[44px]"
            >
              <option value="default">{language === 'ko' ? '추천순' : language === 'ja' ? 'おすすめ順' : language === 'zh' ? '推荐排序' : 'Recommended'}</option>
              <option value="price-asc">{language === 'ko' ? '가격 낮은순' : language === 'ja' ? '価格安い順' : language === 'zh' ? '价格升序' : 'Price ↑'}</option>
              <option value="price-desc">{language === 'ko' ? '가격 높은순' : language === 'ja' ? '価格高い順' : language === 'zh' ? '价格降序' : 'Price ↓'}</option>
            </select>
          </label>
        </fieldset>
      </div>
    </>
  );

  usePageMeta({ title: tl.seoTitle, description: tl.seoDesc });

  const trustFacts = [
    {
      icon: ShieldCheck,
      label: language === 'ko' ? '톨비·주차비 포함' : language === 'ja' ? '通行料・駐車場込み' : language === 'zh' ? '含过路费·停车费' : 'Tolls & Parking Incl.',
      sub: language === 'ko' ? '식사·입장료 별도' : language === 'ja' ? '食事・入場料は別' : language === 'zh' ? '餐费·门票另计' : 'Meals & Admission Extra',
    },
    {
      icon: CreditCard,
      label: 'PayPal',
      sub: language === 'ko' ? 'PayPal 안심결제' : language === 'ja' ? 'PayPal 安全決済' : language === 'zh' ? 'PayPal 安全支付' : 'Secure Payment',
    },
    {
      icon: Phone,
      label: language === 'ko' ? '평일 10~18시' : language === 'ja' ? '平日10~18時' : language === 'zh' ? '工作日10-18点' : 'Weekdays 10am–6pm',
      sub: language === 'ko' ? '영어 지원' : language === 'ja' ? '英語サポート' : language === 'zh' ? '英语客服' : 'English Support',
    },
  ];

  const seasonTip = SEASON_TIPS[currentSeason(new Date().getMonth() + 1)];
  const featuredTour = getToursByRegion('All')[0];

  return (
    <div
      className="ec-root tours-catalog-editorial"
      data-testid="tours-editorial-shell"
      lang={language}
    >
      <Header language={language} t={t} onLanguageChange={changeLanguage} />

      <main>
        <header className="ec-container tours-catalog-masthead">
          <div className="tours-catalog-masthead-copy">
            <p className="ec-eyebrow">{tl.catalogueLabel}</p>
            <h1 className="ec-display">{tl.pageTitle}</h1>
            <p className="ec-body ec-measure tours-catalog-deck">{tl.pageSubtitle}</p>
          </div>
          {featuredTour && (
            <aside className="tours-catalog-featured" aria-label={tl.catalogueSectionLabel}>
              <p className="ec-eyebrow">{tl.catalogueSectionLabel}</p>
              <TourCard tour={featuredTour} language={language} />
            </aside>
          )}
        </header>

        <section className="tours-catalog-trust" aria-labelledby="tours-trust-title">
          <div className="ec-container">
            <p id="tours-trust-title" className="ec-eyebrow">{tl.trustLabel}</p>
            <div data-testid="tours-trust-badges" className="tours-catalog-trust-grid">
              {trustFacts.map(({ icon: Icon, label, sub }, index) => (
                <article key={label} data-testid={`tours-trust-badge-${index}`} className="tours-catalog-trust-item">
                  <Icon aria-hidden />
                  <div>
                    <h2>{label}</h2>
                    <p>{sub}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="ec-container tours-catalog-season" aria-labelledby="tours-season-title">
          <p id="tours-season-title" className="ec-eyebrow">{tl.seasonLabel}</p>
          <div className="tours-catalog-season-note">
            <span aria-hidden>{seasonTip.emoji}</span>
            <p>{seasonTip[language] || seasonTip.en}</p>
          </div>
        </section>

        <section className="ec-container tours-catalog-destinations" aria-labelledby="tours-destinations-title">
          <div className="tours-catalog-section-heading">
            <div>
              <p className="ec-eyebrow">{tl.indexLabel}</p>
              <h2 id="tours-destinations-title" className="ec-h2">{tl.destinationsLabel}</h2>
            </div>
            <p className="ec-body-sm">{tl.destinationsBody}</p>
          </div>
          <div data-testid="tours-region-rail" className="tours-catalog-region-rail">
            {TOUR_REGIONS.filter((region) => region.key !== 'All').map(({ key, label }) => {
              const count = getToursByRegion(key).length;
              if (count === 0) return null;
              const isActive = activeRegion === key;
              const regionLabel = label[language] || label.en;
              const image = REGION_IMAGE[key];
              return (
                <button
                  type="button"
                  key={key}
                  onClick={() => setActiveRegion(key)}
                  aria-pressed={isActive}
                  aria-label={`${regionLabel} — ${count} ${tl.toursUnit}`}
                  className="tours-catalog-region-card"
                >
                  {image ? <img src={image} alt="" loading="lazy" /> : <span className="tours-catalog-region-placeholder" aria-hidden />}
                  <span className="tours-catalog-region-copy">
                    <strong>{regionLabel}</strong>
                    <small>{count} {tl.toursUnit}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="tours-catalog-filter-section" aria-labelledby="tours-filter-title">
          <div className="ec-container">
            <div className="tours-catalog-section-heading tours-catalog-filter-heading">
              <div>
                <p className="ec-eyebrow">{tl.selectorLabel}</p>
                <h2 id="tours-filter-title" className="ec-h2">{tl.filterTitle}</h2>
              </div>
              <p className="ec-body-sm">{tl.filterBody}</p>
            </div>

            <div data-testid="tours-filter-panel" className="tours-catalog-filter-panel">
              <div className="tours-catalog-filter-bar">
                <button
                  type="button"
                  ref={filterTriggerRef}
                  data-testid="tours-filter-trigger"
                  onClick={openFilterDialog}
                  aria-haspopup="dialog"
                  aria-label={`${tl.filterTriggerLabel}${activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}`}
                  className="tours-catalog-filter-trigger min-h-[44px]"
                >
                  <SlidersHorizontal aria-hidden />
                  <span aria-hidden>{tl.filterTriggerLabel}</span>
                  {activeFilterCount > 0 && (
                    <span data-testid="tours-filter-count" className="tours-catalog-filter-count" aria-hidden>
                      {activeFilterCount}
                    </span>
                  )}
                </button>
                <label className="tours-catalog-bar-sort">
                  <ArrowUpDown aria-hidden />
                  <select
                    value={sortBy}
                    onChange={(event) => setSortBy(event.target.value as SortKey)}
                    aria-label={tl.sortLabel}
                    className="min-h-[44px]"
                  >
                    <option value="default">{language === 'ko' ? '추천순' : language === 'ja' ? 'おすすめ順' : language === 'zh' ? '推荐排序' : 'Recommended'}</option>
                    <option value="price-asc">{language === 'ko' ? '가격 낮은순' : language === 'ja' ? '価格安い順' : language === 'zh' ? '价格升序' : 'Price ↑'}</option>
                    <option value="price-desc">{language === 'ko' ? '가격 높은순' : language === 'ja' ? '価格高い順' : language === 'zh' ? '价格降序' : 'Price ↓'}</option>
                  </select>
                </label>
              </div>

              <div className="tours-catalog-filter-fields">
                {renderFilterFields()}
              </div>
            </div>
          </div>
        </section>

        <dialog
          ref={filterDialogRef}
          data-testid="tours-filter-dialog"
          className="tours-catalog-filter-dialog"
          aria-labelledby="tours-filter-dialog-title"
          onClick={handleFilterDialogBackdropClick}
        >
          <div className="tours-catalog-filter-dialog-head">
            <h2 id="tours-filter-dialog-title" className="ec-h3">{tl.filterTitle}</h2>
            <button
              type="button"
              data-testid="tours-filter-dialog-close"
              onClick={closeFilterDialog}
              aria-label={tl.closeFiltersLabel}
              className="tours-catalog-filter-dialog-close min-h-[44px] min-w-[44px]"
            >
              <X aria-hidden />
            </button>
          </div>
          <div data-testid="tours-filter-dialog-body" className="tours-catalog-filter-dialog-body">
            {renderFilterFields()}
          </div>
        </dialog>

        <section className="ec-container tours-catalog-results" aria-labelledby="tours-results-title">
          <p className="tours-catalog-season-mobile">
            <span aria-hidden>{seasonTip.emoji}</span>{' '}
            <span className="sr-only">{tl.seasonLabel}: </span>
            {seasonTip[language] || seasonTip.en}
          </p>

          <div className="tours-catalog-results-heading">
            <div>
              <p className="ec-eyebrow">{tl.catalogueSectionLabel}</p>
              <h2 id="tours-results-title" className="ec-h2">{tl.resultsLabel}</h2>
            </div>
            <p aria-live="polite"><strong>{visibleTours.length}</strong> {tl.toursUnit}</p>
          </div>

          {visibleTours.length === 0 ? (
            <div className="tours-catalog-empty">
              <EcEmpty
                title={searchQuery.trim() ? tl.noSearchResults : tl.noResults}
                body={tl.emptyBody}
                action={(
                  <button type="button" className="ec-btn ec-btn-secondary" onClick={resetFilters}>
                    {tl.resetFilters}
                  </button>
                )}
              />
            </div>
          ) : (
            <div data-testid="tours-grid" className="tours-catalog-grid">
              {visibleTours.map((tour) => <TourCard key={tour.id} tour={tour} language={language} />)}
            </div>
          )}
        </section>

        <section className="tours-catalog-concierge" aria-labelledby="tours-concierge-title">
          <div className="ec-container tours-catalog-concierge-inner">
            <div>
              <p className="ec-eyebrow">{tl.conciergeLabel}</p>
              <h2 id="tours-concierge-title" className="ec-h2">{tl.inquireTitle}</h2>
              <p className="ec-body">{tl.inquireSub}</p>
              <Link to="/charter" className="tours-catalog-charter-link">{tl.charterLink}</Link>
            </div>
            <button
              type="button"
              data-testid="tours-inquire-cta"
              onClick={() => {
                trackEvent('tour_custom_inquiry_open', { region: activeRegion });
                setInquireOpen(true);
              }}
              className="ec-btn ec-btn-primary"
            >
              {tl.inquireBtn}
              <ChevronRight aria-hidden />
            </button>
          </div>
        </section>

        <section className="ec-container tours-catalog-hotel" aria-label={tl.hotelCtaText}>
          <AffiliateCard
            className="tours-catalog-hotel-card"
            payload={{ product: 'hotel', placement: 'tours_page_bottom', language, city: hotelCityKey }}
          >
            <p>{tl.hotelCtaText}</p>
            <a
              data-testid="tours-hotel-cta"
              href={hotelSearchUrl}
              target="_blank"
              rel="noopener noreferrer sponsored"
              title={tl.hotelCtaNew}
              aria-label={`${tl.hotelCtaBtn} — ${tl.hotelCtaNew}`}
              onClick={() => trackAffiliateClick({
                product: 'hotel',
                placement: 'tours_page_bottom',
                language,
                city: hotelCityKey,
              })}
            >
              {tl.hotelCtaBtn}
              <ExternalLink aria-hidden />
            </a>
          </AffiliateCard>
        </section>
      </main>

      <TourInquireModal
        open={inquireOpen}
        onClose={() => setInquireOpen(false)}
        language={language}
        defaultRegion={inquireDefaultRegion}
      />
    </div>
  );
}
