import type { Language } from '@/i18n';

export interface TourDetailEditorialCopy {
  documentLabel: string;
  factsLabel: string;
  highlightsLabel: string;
  overviewLabel: string;
  includedLabel: string;
  itineraryLabel: string;
  scenesLabel: string;
  cancellationLabel: string;
  faqLabel: string;
  reviewsLabel: string;
  driverLanguagesLabel: string;
  nightTourLabel: string;
  imageUnavailable: string;
  loadingTitle: string;
  errorTitle: string;
  errorBody: string;
  retry: string;
  notFoundTitle: string;
  notFoundBody: string;
  permissionTitle: string;
  permissionBody: string;
  browseTours: string;
  partialTitle: string;
  partialBody: string;
  itineraryEmptyTitle: string;
  itineraryEmptyBody: string;
}

const COPY: Record<Language, TourDetailEditorialCopy> = {
  ko: {
    documentLabel: '투어 안내서',
    factsLabel: '한눈에 보기',
    highlightsLabel: '주요 특징',
    overviewLabel: '상품 설명',
    includedLabel: '포함사항',
    itineraryLabel: '세부 일정',
    scenesLabel: '미리 보는 장면',
    cancellationLabel: '취소 정책',
    faqLabel: '자주 묻는 질문',
    reviewsLabel: '후기',
    driverLanguagesLabel: '기사 가능 언어',
    nightTourLabel: '야간 투어',
    imageUnavailable: '등록된 투어 사진이 없습니다',
    loadingTitle: '투어 정보를 불러오는 중입니다',
    errorTitle: '투어 정보를 불러오지 못했습니다',
    errorBody: '잠시 후 다시 시도하거나 투어 목록에서 다른 일정을 확인해 주세요.',
    retry: '다시 시도',
    notFoundTitle: '투어를 찾을 수 없습니다',
    notFoundBody: '주소가 바뀌었거나 현재 공개되지 않은 투어입니다.',
    permissionTitle: '이 투어를 볼 수 없습니다',
    permissionBody: '현재 공개된 투어 목록에서 이용 가능한 일정을 확인해 주세요.',
    browseTours: '투어 목록 보기',
    partialTitle: '저장된 정보로 먼저 보여드리고 있습니다',
    partialBody: '최신 정보를 불러오지 못해 코드에 저장된 공개 내용을 표시합니다.',
    itineraryEmptyTitle: '상세 동선은 준비 중입니다',
    itineraryEmptyBody: '현재 공개된 설명과 포함 사항을 먼저 확인해 주세요.',
  },
  en: {
    documentLabel: 'Tour brief',
    factsLabel: 'At a glance',
    highlightsLabel: 'Highlights',
    overviewLabel: 'Overview',
    includedLabel: 'Included',
    itineraryLabel: 'Itinerary',
    scenesLabel: 'Scenes',
    cancellationLabel: 'Cancellation',
    faqLabel: 'FAQ',
    reviewsLabel: 'Reviews',
    driverLanguagesLabel: 'Driver languages',
    nightTourLabel: 'Night tour',
    imageUnavailable: 'No tour photo is available',
    loadingTitle: 'Loading tour details',
    errorTitle: 'We could not load this tour',
    errorBody: 'Try again shortly or browse the other published tours.',
    retry: 'Try again',
    notFoundTitle: 'Tour not found',
    notFoundBody: 'The address may have changed, or this tour is not currently published.',
    permissionTitle: 'This tour is not available to view',
    permissionBody: 'Browse the published tours to find an available itinerary.',
    browseTours: 'Browse tours',
    partialTitle: 'Showing the saved version for now',
    partialBody: 'The latest source did not load, so the published copy stored with the site is shown.',
    itineraryEmptyTitle: 'The detailed route is being prepared',
    itineraryEmptyBody: 'Review the published overview and included services in the meantime.',
  },
  ja: {
    documentLabel: 'ツアー案内書',
    factsLabel: '概要',
    highlightsLabel: '見どころ',
    overviewLabel: '商品説明',
    includedLabel: '含まれるもの',
    itineraryLabel: '詳細スケジュール',
    scenesLabel: '旅のシーン',
    cancellationLabel: 'キャンセル',
    faqLabel: 'よくある質問',
    reviewsLabel: 'クチコミ',
    driverLanguagesLabel: 'ドライバー対応言語',
    nightTourLabel: 'ナイトツアー',
    imageUnavailable: 'ツアー写真は登録されていません',
    loadingTitle: 'ツアー情報を読み込んでいます',
    errorTitle: 'ツアー情報を読み込めませんでした',
    errorBody: 'しばらくしてから再試行するか、公開中のツアーをご覧ください。',
    retry: '再試行',
    notFoundTitle: 'ツアーが見つかりません',
    notFoundBody: 'URLが変更されたか、現在公開されていないツアーです。',
    permissionTitle: 'このツアーは表示できません',
    permissionBody: '公開中のツアー一覧から利用可能な日程をご確認ください。',
    browseTours: 'ツアー一覧を見る',
    partialTitle: '保存済みの情報を表示しています',
    partialBody: '最新情報を取得できなかったため、サイトに保存された公開内容を表示します。',
    itineraryEmptyTitle: '詳細ルートは準備中です',
    itineraryEmptyBody: '公開中の商品説明と含まれるサービスを先にご確認ください。',
  },
  zh: {
    documentLabel: '旅游说明',
    factsLabel: '一览',
    highlightsLabel: '亮点',
    overviewLabel: '产品说明',
    includedLabel: '包含项目',
    itineraryLabel: '详细行程',
    scenesLabel: '行程掠影',
    cancellationLabel: '取消政策',
    faqLabel: '常见问题',
    reviewsLabel: '评价',
    driverLanguagesLabel: '司机语言',
    nightTourLabel: '夜间旅游',
    imageUnavailable: '暂无旅游照片',
    loadingTitle: '正在加载旅游信息',
    errorTitle: '无法加载该旅游信息',
    errorBody: '请稍后重试，或查看其他已发布的旅游产品。',
    retry: '重试',
    notFoundTitle: '找不到该旅游产品',
    notFoundBody: '链接可能已更改，或该旅游产品目前尚未公开。',
    permissionTitle: '目前无法查看该旅游产品',
    permissionBody: '请前往已发布的旅游列表查看可用行程。',
    browseTours: '查看旅游列表',
    partialTitle: '当前显示已保存的信息',
    partialBody: '最新来源未能加载，因此先显示网站中保存的公开内容。',
    itineraryEmptyTitle: '详细路线正在准备中',
    itineraryEmptyBody: '您可以先查看已发布的产品说明和包含服务。',
  },
};

export function pickTourDetailEditorialCopy(language: Language): TourDetailEditorialCopy {
  return COPY[language] || COPY.en;
}
