import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Bell,
  Bookmark,
  Check,
  ChevronDown,
  Compass,
  Flag,
  Globe2,
  Heart,
  Home,
  ImagePlus,
  Languages,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  PenLine,
  Plus,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Users,
  UserRoundX,
  X,
} from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { usePageMeta } from '@/hooks/usePageMeta';
import { signalAppReady } from '@/lib/appReady';
import type { Language } from '@/i18n';

type Copy = {
  community: string;
  exploreKorea: string;
  search: string;
  latest: string;
  popular: string;
  following: string;
  write: string;
  translate: string;
  showOriginal: string;
  translatedFrom: string;
  replies: string;
  save: string;
  report: string;
  reportTitle: string;
  reportHelp: string;
  reportReasons: string[];
  cancel: string;
  submit: string;
  categories: string;
  trending: string;
  suggested: string;
  follow: string;
  followingLabel: string;
  communityGuide: string;
  guideBody: string;
  navHome: string;
  navExplore: string;
  navCreate: string;
  navAlerts: string;
  navProfile: string;
  back: string;
  comments: string;
  replyPlaceholder: string;
  composeTitle: string;
  composeSubtitle: string;
  postType: string;
  postTypes: string[];
  chooseCategory: string;
  titleLabel: string;
  titlePlaceholder: string;
  bodyLabel: string;
  bodyPlaceholder: string;
  addPhoto: string;
  detectedLanguage: string;
  publish: string;
  preview: string;
  safetyNote: string;
  draftNotice: string;
};

const COPY: Record<Language, Copy> = {
  en: {
    community: 'Community', exploreKorea: 'Korea, shared by people who are here', search: 'Search Korea tips, places and people',
    latest: 'Latest', popular: 'Popular', following: 'Following', write: 'Create post', translate: 'Translate', showOriginal: 'View original',
    translatedFrom: 'Translated from', replies: 'replies', save: 'Save', report: 'Report', reportTitle: 'Why are you reporting this?',
    reportHelp: 'Your report is private. A moderator will review the original post and its translation.',
    reportReasons: ['Spam or advertising', 'Harassment or hate', 'Sexual or unsafe content', 'Scam or false information'],
    cancel: 'Cancel', submit: 'Send report', categories: 'Browse topics', trending: 'Trending in Korea', suggested: 'People to follow', follow: 'Follow',
    followingLabel: 'Following', communityGuide: 'Travel kindly', guideBody: 'Keep personal details private and meet new people in public places.',
    navHome: 'Feed', navExplore: 'Explore', navCreate: 'Post', navAlerts: 'Alerts', navProfile: 'Profile', back: 'Back', comments: 'Comments',
    replyPlaceholder: 'Join the conversation', composeTitle: 'Share with the community', composeSubtitle: 'Ask, recommend, or find people for your Korea trip.',
    postType: 'Post type', postTypes: ['Question', 'Tip', 'Travel buddy', 'Itinerary'], chooseCategory: 'Category', titleLabel: 'Title',
    titlePlaceholder: 'What would you like to share?', bodyLabel: 'Details', bodyPlaceholder: 'Add the details people need to help or join you.',
    addPhoto: 'Add photos', detectedLanguage: 'Writing in English', publish: 'Publish', preview: 'Preview',
    safetyNote: 'Phone numbers and private contact details will be checked before publishing.', draftNotice: 'Design preview: publishing will be connected by Claude.',
  },
  ko: {
    community: '커뮤니티', exploreKorea: '한국에 있는 사람들이 함께 만드는 정보', search: '한국 팁, 장소, 사람 검색',
    latest: '최신', popular: '인기', following: '팔로잉', write: '글쓰기', translate: '번역 보기', showOriginal: '원문 보기',
    translatedFrom: '번역 언어', replies: '댓글', save: '저장', report: '신고', reportTitle: '신고하는 이유를 알려주세요',
    reportHelp: '신고 내용은 공개되지 않으며 운영자가 원문과 번역문을 함께 확인합니다.',
    reportReasons: ['도배 또는 광고', '괴롭힘 또는 혐오 표현', '성적이거나 위험한 내용', '사기 또는 허위 정보'],
    cancel: '취소', submit: '신고 보내기', categories: '주제 둘러보기', trending: '한국에서 인기', suggested: '추천 사용자', follow: '팔로우',
    followingLabel: '팔로잉 중', communityGuide: '안전하게 여행하기', guideBody: '개인정보는 공개하지 말고 새로운 사람과는 공공장소에서 만나세요.',
    navHome: '피드', navExplore: '탐색', navCreate: '작성', navAlerts: '알림', navProfile: '내 정보', back: '뒤로', comments: '댓글',
    replyPlaceholder: '대화에 참여해 보세요', composeTitle: '커뮤니티에 공유하기', composeSubtitle: '한국 여행 질문, 추천, 동행 모집을 올려보세요.',
    postType: '글 종류', postTypes: ['질문', '여행 팁', '동행 모집', '여행 코스'], chooseCategory: '카테고리', titleLabel: '제목',
    titlePlaceholder: '무엇을 공유하고 싶나요?', bodyLabel: '상세 내용', bodyPlaceholder: '사람들이 답하거나 참여하는 데 필요한 내용을 적어주세요.',
    addPhoto: '사진 추가', detectedLanguage: '한국어로 작성 중', publish: '게시하기', preview: '미리보기',
    safetyNote: '전화번호와 개인 연락처는 게시 전에 안전 검사를 진행합니다.', draftNotice: '디자인 미리보기입니다. 실제 게시는 클로드가 연결합니다.',
  },
  ja: {
    community: 'コミュニティ', exploreKorea: '韓国にいる人たちと共有するリアルな情報', search: '韓国の情報・場所・仲間を検索',
    latest: '新着', popular: '人気', following: 'フォロー中', write: '投稿する', translate: '翻訳を見る', showOriginal: '原文を見る',
    translatedFrom: '翻訳元', replies: '件の返信', save: '保存', report: '報告', reportTitle: '報告する理由を選んでください',
    reportHelp: '報告内容は非公開です。モデレーターが原文と翻訳を確認します。',
    reportReasons: ['スパム・広告', '嫌がらせ・差別', '性的・危険な内容', '詐欺・誤情報'],
    cancel: 'キャンセル', submit: '報告を送信', categories: 'トピック', trending: '韓国で話題', suggested: 'おすすめユーザー', follow: 'フォロー',
    followingLabel: 'フォロー中', communityGuide: '安全な旅のために', guideBody: '個人情報を公開せず、初対面の人とは公共の場所で会いましょう。',
    navHome: 'フィード', navExplore: '見つける', navCreate: '投稿', navAlerts: '通知', navProfile: 'プロフィール', back: '戻る', comments: 'コメント',
    replyPlaceholder: 'コメントを書く', composeTitle: 'コミュニティに共有', composeSubtitle: '質問、おすすめ、旅仲間募集を投稿できます。',
    postType: '投稿タイプ', postTypes: ['質問', '旅行情報', '旅仲間', '旅程'], chooseCategory: 'カテゴリー', titleLabel: 'タイトル',
    titlePlaceholder: '何を共有しますか？', bodyLabel: '詳細', bodyPlaceholder: '回答や参加に必要な情報を書いてください。',
    addPhoto: '写真を追加', detectedLanguage: '日本語で入力中', publish: '投稿する', preview: 'プレビュー',
    safetyNote: '電話番号や個人連絡先は投稿前に安全確認されます。', draftNotice: 'デザインプレビューです。投稿機能はClaudeが接続します。',
  },
  zh: {
    community: '社区', exploreKorea: '分享在韩国的真实生活与旅行信息', search: '搜索韩国攻略、地点和同伴',
    latest: '最新', popular: '热门', following: '关注', write: '发布内容', translate: '查看翻译', showOriginal: '查看原文',
    translatedFrom: '翻译自', replies: '条回复', save: '收藏', report: '举报', reportTitle: '请选择举报原因',
    reportHelp: '举报内容不会公开，管理员会同时查看原文和译文。',
    reportReasons: ['垃圾信息或广告', '骚扰或仇恨言论', '色情或危险内容', '诈骗或虚假信息'],
    cancel: '取消', submit: '提交举报', categories: '浏览话题', trending: '韩国热门', suggested: '推荐关注', follow: '关注',
    followingLabel: '已关注', communityGuide: '安全旅行', guideBody: '请勿公开个人信息，与新朋友见面时请选择公共场所。',
    navHome: '动态', navExplore: '发现', navCreate: '发布', navAlerts: '通知', navProfile: '我的', back: '返回', comments: '评论',
    replyPlaceholder: '加入讨论', composeTitle: '分享到社区', composeSubtitle: '发布韩国旅行问题、推荐或寻找同伴。',
    postType: '内容类型', postTypes: ['提问', '旅行攻略', '寻找同伴', '旅行路线'], chooseCategory: '分类', titleLabel: '标题',
    titlePlaceholder: '你想分享什么？', bodyLabel: '详细内容', bodyPlaceholder: '请填写方便他人回答或参与的信息。',
    addPhoto: '添加照片', detectedLanguage: '正在使用中文', publish: '发布', preview: '预览',
    safetyNote: '电话号码和私人联系方式将在发布前进行安全检查。', draftNotice: '这是设计预览，发布功能将由Claude连接。',
  },
};

const LANGUAGE_NAME: Record<Language, string> = { en: 'English', ko: '한국어', ja: '日本語', zh: '中文' };
const LANGUAGE_SHORT: Record<Language, string> = { en: 'EN', ko: 'KO', ja: 'JA', zh: 'ZH' };
const LANGUAGES: Language[] = ['en', 'ko', 'ja', 'zh'];

type Localized = Record<Language, string>;
type Post = {
  id: string;
  author: string;
  handle: string;
  avatar: string;
  country: string;
  originalLanguage: Language;
  time: string;
  category: Localized;
  title: Localized;
  body: Localized;
  image?: string;
  location?: string;
  likes: number;
  replies: number;
  verified?: boolean;
};

const POSTS: Post[] = [
  {
    id: 'seoul-first-week', author: 'Mika', handle: '@mika_in_seoul', avatar: 'M', country: 'JP', originalLanguage: 'ja', time: '12m',
    category: { en: 'Living in Korea', ko: '한국생활', ja: '韓国生活', zh: '韩国生活' },
    title: { en: 'What I wish I knew during my first week in Seoul', ko: '서울 첫 일주일에 미리 알았으면 좋았을 것들', ja: 'ソウル生活の最初の1週間で知っておきたかったこと', zh: '在首尔第一周希望早点知道的事' },
    body: {
      en: 'Get a transport card at the airport, save your address in Korean, and do not be afraid to ask station staff. Here are five small things that made my first week much easier.',
      ko: '공항에서 교통카드를 사고, 숙소 주소는 한국어로 저장하고, 역무원에게 편하게 물어보세요. 첫 일주일을 훨씬 편하게 해준 다섯 가지를 정리했어요.',
      ja: '空港で交通カードを買うこと、滞在先の住所を韓国語で保存すること、駅員さんに気軽に聞くこと。最初の1週間が楽になった5つのことをまとめました。',
      zh: '在机场购买交通卡、用韩文保存住宿地址，也不要害怕向地铁工作人员求助。这里整理了让我第一周轻松很多的五件小事。',
    },
    image: '/hero-seoul-real.webp', location: 'Seoul', likes: 284, replies: 39, verified: true,
  },
  {
    id: 'busan-food-route', author: 'Daniel', handle: '@danieltravels', avatar: 'D', country: 'US', originalLanguage: 'en', time: '34m',
    category: { en: 'Food & Cafes', ko: '맛집·카페', ja: 'グルメ・カフェ', zh: '美食·咖啡' },
    title: { en: 'My one-day Busan food route without rushing', ko: '서두르지 않고 즐긴 부산 하루 맛집 코스', ja: '急がず楽しむ釜山1日グルメコース', zh: '不赶时间的釜山一日美食路线' },
    body: {
      en: 'Jagalchi in the morning, a quiet coffee near Huinnyeoul, then Gwangalli after sunset. The route worked well by public transport and left enough time to enjoy each stop.',
      ko: '아침에는 자갈치시장, 오후에는 흰여울 근처 조용한 카페, 해가 진 뒤에는 광안리로 갔어요. 대중교통으로 무리 없고 장소마다 충분히 머물 수 있는 코스였습니다.',
      ja: '朝はチャガルチ市場、午後はヒンヨウル近くの静かなカフェ、日没後は広安里へ。公共交通で無理なく、それぞれの場所をゆっくり楽しめました。',
      zh: '早上去札嘎其市场，下午在白浅文化村附近喝咖啡，日落后前往广安里。公共交通很方便，每一站也有充足时间。',
    },
    image: '/hero-busan-real.webp', location: 'Busan', likes: 167, replies: 22,
  },
  {
    id: 'gyeongju-buddy', author: 'Yuxin', handle: '@yuxin_go', avatar: 'Y', country: 'CN', originalLanguage: 'zh', time: '1h',
    category: { en: 'Find a travel buddy', ko: '동행 찾기', ja: '旅仲間募集', zh: '寻找同伴' },
    title: { en: 'Looking for a Gyeongju day-trip buddy this Saturday', ko: '이번 토요일 경주 당일치기 동행을 찾아요', ja: '今週土曜日、慶州日帰り旅行の仲間を募集', zh: '寻找本周六庆州一日游同伴' },
    body: {
      en: 'I plan to start near Singyeongju Station at 9:30 and visit Bulguksa, Hwangridan-gil, and Donggung Palace at night. Two seats are still open.',
      ko: '오전 9시 30분 신경주역 근처에서 출발해 불국사, 황리단길, 저녁 동궁과 월지를 갈 예정이에요. 두 자리 남았습니다.',
      ja: '午前9時30分に新慶州駅付近を出発し、仏国寺、皇理団通り、夜の東宮と月池を回る予定です。あと2名参加できます。',
      zh: '计划上午9:30从新庆州站附近出发，游览佛国寺、皇理团路，晚上去东宫与月池。还剩两个名额。',
    },
    location: 'Gyeongju', likes: 48, replies: 17,
  },
];

const TOPICS = [
  { icon: MapPin, labels: { en: 'Seoul', ko: '서울', ja: 'ソウル', zh: '首尔' }, count: '18.4K' },
  { icon: Compass, labels: { en: 'Travel tips', ko: '여행 팁', ja: '旅行情報', zh: '旅行攻略' }, count: '12.8K' },
  { icon: Users, labels: { en: 'Travel buddies', ko: '동행 찾기', ja: '旅仲間', zh: '寻找同伴' }, count: '8.2K' },
  { icon: MessageCircle, labels: { en: 'Living in Korea', ko: '한국생활', ja: '韓国生活', zh: '韩国生活' }, count: '7.6K' },
];

function CommunityBrand({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/community" className="community-brand" aria-label="CocoTrip Community">
      <img src="/icons/icon-192.png" alt="" className={compact ? 'h-8 w-8' : 'h-9 w-9'} />
      <span>CocoTrip</span>
    </Link>
  );
}

function LanguageButton() {
  const { language, changeLanguage } = useLanguage();
  const nextLanguage = () => changeLanguage(LANGUAGES[(LANGUAGES.indexOf(language) + 1) % LANGUAGES.length]);
  return (
    <button type="button" className="community-icon-button community-language-button" onClick={nextLanguage} title={LANGUAGE_NAME[language]}>
      <Globe2 size={18} />
      <span>{LANGUAGE_SHORT[language]}</span>
    </button>
  );
}

function CommunityHeader({ backTo }: { backTo?: string }) {
  const { language } = useLanguage();
  const copy = COPY[language];
  const navigate = useNavigate();
  return (
    <header className="community-header">
      <div className="community-header-inner">
        {backTo ? (
          <button type="button" className="community-icon-button md:hidden" onClick={() => navigate(backTo)} aria-label={copy.back}>
            <ArrowLeft size={20} />
          </button>
        ) : <CommunityBrand compact />}
        {backTo && <div className="hidden md:block"><CommunityBrand compact /></div>}
        <div className="community-search hidden md:flex">
          <Search size={17} />
          <input aria-label={copy.search} placeholder={copy.search} />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <LanguageButton />
          <button type="button" className="community-icon-button" aria-label={copy.navAlerts}><Bell size={18} /></button>
          <Link to="/community/new" className="community-primary-button hidden sm:inline-flex"><PenLine size={17} />{copy.write}</Link>
        </div>
      </div>
    </header>
  );
}

function CommunityRail({ active = 'feed' }: { active?: 'feed' | 'explore' | 'create' | 'alerts' | 'profile' }) {
  const { language } = useLanguage();
  const copy = COPY[language];
  const items = [
    { key: 'feed', label: copy.navHome, icon: Home, to: '/community' },
    { key: 'explore', label: copy.navExplore, icon: Compass, to: '/community?tab=popular' },
    { key: 'create', label: copy.navCreate, icon: Plus, to: '/community/new' },
    { key: 'alerts', label: copy.navAlerts, icon: Bell, to: '/community?tab=alerts' },
    { key: 'profile', label: copy.navProfile, icon: Users, to: '/mypage' },
  ] as const;
  return (
    <>
      <aside className="community-left-rail">
        <nav aria-label={copy.community}>
          {items.map(({ key, label, icon: Icon, to }) => (
            <Link key={key} to={to} className={active === key ? 'is-active' : ''}><Icon size={20} /><span>{label}</span></Link>
          ))}
        </nav>
        <Link to="/community/new" className="community-primary-button w-full justify-center"><PenLine size={17} />{copy.write}</Link>
      </aside>
      <nav className="community-bottom-nav" aria-label={copy.community}>
        {items.map(({ key, label, icon: Icon, to }) => (
          <Link key={key} to={to} className={active === key ? 'is-active' : ''} aria-label={label}>
            <Icon size={key === 'create' ? 22 : 19} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}

function RightRail() {
  const { language } = useLanguage();
  const copy = COPY[language];
  return (
    <aside className="community-right-rail">
      <section>
        <div className="community-section-title"><span>{copy.trending}</span><MoreHorizontal size={18} /></div>
        {['#CherryBlossomNight', '#SeoulCafe', '#KoreaTransit'].map((tag, index) => (
          <button type="button" className="community-trend" key={tag}>
            <span>{tag}</span><small>{[2480, 1720, 936][index].toLocaleString()} posts</small>
          </button>
        ))}
      </section>
      <section>
        <div className="community-section-title"><span>{copy.suggested}</span></div>
        {[['S', 'Seoul Local', 'KO'], ['A', 'Aiko in Korea', 'JP'], ['J', 'Jin Travels', 'US']].map(([avatar, name, country]) => (
          <div className="community-person" key={name}>
            <span className="community-avatar is-small">{avatar}</span>
            <div><strong>{name}</strong><small>{country}</small></div>
            <button type="button">{copy.follow}</button>
          </div>
        ))}
      </section>
      <section className="community-safety-card">
        <ShieldCheck size={21} />
        <div><strong>{copy.communityGuide}</strong><p>{copy.guideBody}</p></div>
      </section>
    </aside>
  );
}

function ReportSheet({ onClose }: { onClose: () => void }) {
  const { language } = useLanguage();
  const copy = COPY[language];
  const [reason, setReason] = useState(0);
  return (
    <div className="community-sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="community-sheet" role="dialog" aria-modal="true" aria-labelledby="report-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="community-sheet-handle" />
        <div className="community-sheet-heading">
          <div><h2 id="report-title">{copy.reportTitle}</h2><p>{copy.reportHelp}</p></div>
          <button type="button" className="community-icon-button" onClick={onClose} aria-label={copy.cancel}><X size={19} /></button>
        </div>
        <div className="community-report-options">
          {copy.reportReasons.map((item, index) => (
            <button type="button" key={item} onClick={() => setReason(index)} className={reason === index ? 'is-selected' : ''}>
              <span>{item}</span>{reason === index && <Check size={17} />}
            </button>
          ))}
        </div>
        <div className="community-sheet-actions">
          <button type="button" className="community-secondary-button" onClick={onClose}>{copy.cancel}</button>
          <button type="button" className="community-primary-button" onClick={onClose}><Flag size={16} />{copy.submit}</button>
        </div>
      </section>
    </div>
  );
}

function PostCard({ post, expanded = false }: { post: Post; expanded?: boolean }) {
  const { language } = useLanguage();
  const copy = COPY[language];
  const [translated, setTranslated] = useState(language !== post.originalLanguage);
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const displayLanguage = translated ? language : post.originalLanguage;
  const isTranslationAvailable = language !== post.originalLanguage;

  return (
    <article className={`community-post-card ${expanded ? 'is-expanded' : ''}`}>
      <div className="community-post-head">
        <span className="community-avatar">{post.avatar}</span>
        <div className="community-author">
          <div><strong>{post.author}</strong>{post.verified && <ShieldCheck size={14} />}</div>
          <span>{post.handle} · {post.country} · {post.time}</span>
        </div>
        <button type="button" className="community-icon-button" onClick={() => setReportOpen(true)} aria-label={copy.report}><MoreHorizontal size={19} /></button>
      </div>
      <Link to={`/community/post/${post.id}`} className="community-post-content">
        <div className="community-post-meta">
          <span>{post.category[language]}</span>
          {post.location && <span><MapPin size={12} />{post.location}</span>}
        </div>
        <h2>{post.title[displayLanguage]}</h2>
        <p>{post.body[displayLanguage]}</p>
        {post.image && <img src={post.image} alt="" className="community-post-image" />}
      </Link>
      {isTranslationAvailable && (
        <button type="button" className="community-translate-button" onClick={() => setTranslated((value) => !value)}>
          <Languages size={15} />
          <span>{translated ? copy.showOriginal : copy.translate}</span>
          {translated && <small>{copy.translatedFrom} {LANGUAGE_NAME[post.originalLanguage]}</small>}
        </button>
      )}
      <div className="community-post-actions">
        <button type="button" className={liked ? 'is-active is-liked' : ''} onClick={() => setLiked((value) => !value)} aria-label="Like">
          <Heart size={18} fill={liked ? 'currentColor' : 'none'} /><span>{post.likes + (liked ? 1 : 0)}</span>
        </button>
        <Link to={`/community/post/${post.id}`}><MessageCircle size={18} /><span>{post.replies} {copy.replies}</span></Link>
        <button type="button" className={saved ? 'is-active' : ''} onClick={() => setSaved((value) => !value)} aria-label={copy.save}>
          <Bookmark size={18} fill={saved ? 'currentColor' : 'none'} /><span>{copy.save}</span>
        </button>
        <button type="button" onClick={() => setReportOpen(true)} aria-label={copy.report}><Flag size={17} /></button>
      </div>
      {reportOpen && <ReportSheet onClose={() => setReportOpen(false)} />}
    </article>
  );
}

function CommunityLayout({ children, active = 'feed', backTo }: { children: React.ReactNode; active?: 'feed' | 'explore' | 'create' | 'alerts' | 'profile'; backTo?: string }) {
  return (
    <div className="community-app">
      <CommunityHeader backTo={backTo} />
      <div className="community-layout">
        <CommunityRail active={active} />
        <main className="community-main">{children}</main>
        <RightRail />
      </div>
    </div>
  );
}

export default function CommunityPage() {
  const { language } = useLanguage();
  const copy = COPY[language];
  const location = useLocation();
  const [tab, setTab] = useState<'latest' | 'popular' | 'following'>('latest');
  const [selectedTopic, setSelectedTopic] = useState(0);
  const posts = useMemo(() => tab === 'popular' ? [...POSTS].sort((a, b) => b.likes - a.likes) : POSTS, [tab]);
  const requestedView = new URLSearchParams(location.search).get('tab');
  const activeRail = requestedView === 'alerts' ? 'alerts' : requestedView === 'popular' ? 'explore' : 'feed';

  usePageMeta({ title: `${copy.community} | CocoTrip`, description: copy.exploreKorea });
  useEffect(() => { signalAppReady(); }, []);
  useEffect(() => {
    if (requestedView === 'popular') setTab('popular');
  }, [requestedView]);

  return (
    <CommunityLayout active={activeRail}>
      {requestedView === 'alerts' ? (
        <CommunityAlerts copy={copy} />
      ) : (
      <>
      <section className="community-intro">
        <div><span className="community-eyebrow"><Sparkles size={14} />CocoTrip Together</span><h1>{copy.community}</h1><p>{copy.exploreKorea}</p></div>
        <Link to="/community/new" className="community-primary-button"><PenLine size={17} />{copy.write}</Link>
      </section>
      <div className="community-search community-mobile-search md:hidden"><Search size={17} /><input aria-label={copy.search} placeholder={copy.search} /></div>
      <section className="community-mobile-topics md:hidden">
        <div className="community-section-title"><span>{copy.categories}</span><SlidersHorizontal size={17} /></div>
        <div className="community-topic-scroll">
          {TOPICS.map(({ icon: Icon, labels }, index) => (
            <button type="button" key={labels.en} className={selectedTopic === index ? 'is-active' : ''} onClick={() => setSelectedTopic(index)}>
              <Icon size={16} /><span>{labels[language]}</span>
            </button>
          ))}
        </div>
      </section>
      <div className="community-tabs" role="tablist">
        {(['latest', 'popular', 'following'] as const).map((key) => (
          <button type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'is-active' : ''} key={key} onClick={() => setTab(key)}>
            {copy[key]}
          </button>
        ))}
      </div>
      <div className="community-feed">{posts.map((post) => <PostCard key={post.id} post={post} />)}</div>
      </>
      )}
    </CommunityLayout>
  );
}

function CommunityAlerts({ copy }: { copy: Copy }) {
  const { language } = useLanguage();
  const alerts = [
    { icon: Heart, tone: 'pink', title: { en: 'Mika liked your Busan cafe list', ko: 'Mika님이 부산 카페 목록을 좋아합니다', ja: 'Mikaさんが釜山カフェリストにいいねしました', zh: 'Mika赞了你的釜山咖啡清单' }, time: '8m' },
    { icon: MessageCircle, tone: 'purple', title: { en: 'Daniel replied to your Seoul transport question', ko: 'Daniel님이 서울 교통 질문에 답했습니다', ja: 'Danielさんがソウル交通の質問に返信しました', zh: 'Daniel回复了你的首尔交通问题' }, time: '24m' },
    { icon: ShieldCheck, tone: 'green', title: { en: 'Your report was reviewed by the community team', ko: '커뮤니티 운영팀이 신고를 검토했습니다', ja: 'コミュニティ運営チームが報告を確認しました', zh: '社区管理团队已审核你的举报' }, time: '2h' },
  ];
  return (
    <section className="community-alerts-page">
      <div className="community-intro"><div><span className="community-eyebrow"><Bell size={14} />CocoTrip Together</span><h1>{copy.navAlerts}</h1><p>{copy.communityGuide}</p></div></div>
      <div className="community-alert-list">
        {alerts.map(({ icon: Icon, tone, title, time }) => (
          <button type="button" key={title.en} className="community-alert-row">
            <span className={`community-alert-icon is-${tone}`}><Icon size={18} /></span>
            <span><strong>{title[language]}</strong><small>{time}</small></span>
            <ChevronDown size={17} />
          </button>
        ))}
      </div>
    </section>
  );
}

export function CommunityPostPage() {
  const { language } = useLanguage();
  const copy = COPY[language];
  const { postId } = useParams();
  const post = POSTS.find((item) => item.id === postId) || POSTS[0];
  const [reply, setReply] = useState('');
  usePageMeta({ title: `${post.title[language]} | CocoTrip`, description: post.body[language] });

  const comments = [
    { avatar: 'L', name: 'Leo', country: 'SG', original: 'This is exactly what I needed before arriving. Saving the Korean address was a lifesaver.', translated: { ko: '한국에 도착하기 전에 딱 필요했던 정보예요. 한국어 주소를 저장해 둔 것이 정말 큰 도움이 됐어요.', ja: '到着前にまさに必要だった情報です。韓国語の住所を保存しておいて本当に助かりました。', zh: '这正是我抵达前需要的信息，保存韩文地址真的非常有用。', en: 'This is exactly what I needed before arriving. Saving the Korean address was a lifesaver.' } },
    { avatar: 'H', name: 'Hana', country: 'KR', original: 'You can also use the help intercom near subway ticket machines. Most major stations support English.', translated: { ko: '지하철 발권기 근처 도움 호출 버튼도 사용할 수 있어요. 주요 역은 대부분 영어 안내가 가능합니다.', ja: '地下鉄の券売機近くにある案内インターホンも使えます。主要駅では英語対応も可能です。', zh: '也可以使用地铁售票机旁的求助对讲机，大多数主要车站都支持英语。', en: 'You can also use the help intercom near subway ticket machines. Most major stations support English.' } },
  ];

  return (
    <CommunityLayout backTo="/community">
      <div className="community-detail-title"><button type="button" onClick={() => history.back()} className="community-icon-button"><ArrowLeft size={20} /></button><strong>{copy.back}</strong></div>
      <PostCard post={post} expanded />
      <section className="community-comments">
        <h2>{copy.comments} <span>{post.replies}</span></h2>
        <div className="community-reply-box">
          <span className="community-avatar">T</span>
          <input value={reply} onChange={(event) => setReply(event.target.value)} placeholder={copy.replyPlaceholder} />
          <button type="button" className="community-icon-button" disabled={!reply.trim()} aria-label={copy.submit}><Send size={18} /></button>
        </div>
        {comments.map((comment) => <CommentCard key={comment.name} comment={comment} />)}
      </section>
    </CommunityLayout>
  );
}

function CommentCard({ comment }: { comment: { avatar: string; name: string; country: string; original: string; translated: Localized } }) {
  const { language } = useLanguage();
  const copy = COPY[language];
  const [translated, setTranslated] = useState(language !== 'en');
  return (
    <article className="community-comment">
      <span className="community-avatar is-small">{comment.avatar}</span>
      <div>
        <header><strong>{comment.name}</strong><span>{comment.country} · 8m</span></header>
        <p>{translated ? comment.translated[language] : comment.original}</p>
        {language !== 'en' && <button type="button" className="community-translate-button" onClick={() => setTranslated((value) => !value)}><Languages size={14} />{translated ? copy.showOriginal : copy.translate}</button>}
        <div className="community-comment-actions"><button type="button"><Heart size={15} />18</button><button type="button"><MessageCircle size={15} />{copy.replies}</button><button type="button"><MoreHorizontal size={16} /></button></div>
      </div>
    </article>
  );
}

export function CommunityComposePage() {
  const { language } = useLanguage();
  const copy = COPY[language];
  const [type, setType] = useState(0);
  const [category, setCategory] = useState(TOPICS[0].labels[language]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState(false);
  usePageMeta({ title: `${copy.composeTitle} | CocoTrip`, description: copy.composeSubtitle });

  return (
    <CommunityLayout active="create" backTo="/community">
      <section className="community-compose-heading"><div><h1>{copy.composeTitle}</h1><p>{copy.composeSubtitle}</p></div><span><Languages size={15} />{copy.detectedLanguage}</span></section>
      <section className="community-compose-form">
        <label>{copy.postType}</label>
        <div className="community-segmented-control">
          {copy.postTypes.map((item, index) => <button type="button" key={item} className={type === index ? 'is-active' : ''} onClick={() => setType(index)}>{item}</button>)}
        </div>
        <label htmlFor="community-category">{copy.chooseCategory}</label>
        <div className="community-select-wrap"><select id="community-category" value={category} onChange={(event) => setCategory(event.target.value)}>{TOPICS.map((topic) => <option key={topic.labels.en}>{topic.labels[language]}</option>)}</select><ChevronDown size={17} /></div>
        <label htmlFor="community-title">{copy.titleLabel}</label>
        <input id="community-title" className="community-field" value={title} onChange={(event) => setTitle(event.target.value)} placeholder={copy.titlePlaceholder} maxLength={100} />
        <div className="community-field-counter">{title.length}/100</div>
        <label htmlFor="community-body">{copy.bodyLabel}</label>
        <textarea id="community-body" className="community-field" value={body} onChange={(event) => setBody(event.target.value)} placeholder={copy.bodyPlaceholder} rows={8} maxLength={2000} />
        <div className="community-field-counter">{body.length}/2000</div>
        <button type="button" className="community-upload-button"><ImagePlus size={21} /><span>{copy.addPhoto}</span><small>JPG, PNG · max 10</small></button>
        <div className="community-compose-safety"><ShieldCheck size={19} /><p>{copy.safetyNote}</p></div>
        {preview && <div className="community-draft-notice"><Sparkles size={17} /><span>{copy.draftNotice}</span></div>}
        <div className="community-compose-actions">
          <button type="button" className="community-secondary-button" onClick={() => setPreview((value) => !value)}>{copy.preview}</button>
          <button type="button" className="community-primary-button" disabled={!title.trim() || !body.trim()} onClick={() => setPreview(true)}><Send size={16} />{copy.publish}</button>
        </div>
      </section>
    </CommunityLayout>
  );
}

const MODERATION_COPY: Record<Language, { title: string; subtitle: string; pending: string; urgent: string; blocked: string; queue: string; original: string; translation: string; approve: string; hide: string; warn: string; risk: string; links: string; similar: string; accountAge: string }> = {
  en: { title: 'Community moderation', subtitle: 'Review original content and translations before taking action.', pending: 'Pending review', urgent: 'High priority', blocked: 'Bots blocked today', queue: 'Review queue', original: 'Original', translation: 'Translation', approve: 'Approve', hide: 'Hide post', warn: 'Warn user', risk: 'Detected risk', links: 'links detected', similar: 'similar posts', accountAge: 'account age' },
  ko: { title: '커뮤니티 안전 관리', subtitle: '조치하기 전에 원문과 번역문을 함께 확인합니다.', pending: '검토 대기', urgent: '긴급 검토', blocked: '오늘 차단한 봇', queue: '검토 목록', original: '원문', translation: '번역문', approve: '승인', hide: '글 숨김', warn: '사용자 경고', risk: '감지된 위험', links: '외부 링크 감지', similar: '유사 게시글', accountAge: '계정 생성 후' },
  ja: { title: 'コミュニティ管理', subtitle: '対応前に原文と翻訳を一緒に確認します。', pending: '確認待ち', urgent: '優先確認', blocked: '本日ブロックしたBot', queue: '確認リスト', original: '原文', translation: '翻訳', approve: '承認', hide: '非表示', warn: '警告', risk: '検出リスク', links: 'リンクを検出', similar: '類似投稿', accountAge: 'アカウント期間' },
  zh: { title: '社区安全管理', subtitle: '处理前同时检查原文与译文。', pending: '待审核', urgent: '优先审核', blocked: '今日拦截机器人', queue: '审核列表', original: '原文', translation: '译文', approve: '通过', hide: '隐藏内容', warn: '警告用户', risk: '检测风险', links: '检测到链接', similar: '相似内容', accountAge: '账号注册时间' },
};

export function CommunityModerationPage() {
  const { language } = useLanguage();
  const copy = MODERATION_COPY[language];
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState<'pending' | 'approved' | 'hidden'>('pending');
  const cases = [
    { id: 'MOD-0184', risk: { en: 'Spam / external contact', ko: '광고·외부 연락 유도', ja: 'スパム・外部連絡', zh: '广告·引导外部联系' }, score: 94, author: '@best_korea_deal', country: 'US', original: 'Best Korea tour! Contact me now on Telegram for a private discount.', translation: '한국 최고의 투어! 텔레그램으로 지금 연락하면 개인 할인을 드립니다.', age: '2m', tone: 'high' },
    { id: 'MOD-0183', risk: { en: 'Harassment', ko: '괴롭힘·공격', ja: '嫌がらせ', zh: '骚扰·攻击' }, score: 81, author: '@citywalker', country: 'JP', original: 'その人の投稿は全部うそ。二度とここに書くな。', translation: '저 사람의 글은 전부 거짓말입니다. 다시는 여기에 글을 쓰지 마세요.', age: '7m', tone: 'high' },
    { id: 'MOD-0182', risk: { en: 'Repeated content', ko: '같은 내용 반복', ja: '同一内容の繰り返し', zh: '重复内容' }, score: 68, author: '@seoul_room', country: 'CN', original: '首尔短租房，有兴趣请私信。首尔短租房，有兴趣请私信。', translation: '서울 단기 임대, 관심 있으면 개인 메시지를 보내세요. 같은 문구가 반복되었습니다.', age: '16m', tone: 'medium' },
  ];
  const activeCase = cases[selected];

  usePageMeta({ title: `${copy.title} | CocoTrip Admin`, description: copy.subtitle });

  return (
    <div className="community-moderation-app">
      <header className="community-moderation-header"><CommunityBrand /><div><h1>{copy.title}</h1><p>{copy.subtitle}</p></div><Link to="/admin" className="community-secondary-button"><ArrowLeft size={16} />Admin</Link></header>
      <main>
        <section className="community-moderation-stats">
          <article><span><MessageCircle size={19} /></span><div><strong>18</strong><small>{copy.pending}</small></div></article>
          <article><span className="is-urgent"><Flag size={19} /></span><div><strong>3</strong><small>{copy.urgent}</small></div></article>
          <article><span className="is-safe"><ShieldCheck size={19} /></span><div><strong>42</strong><small>{copy.blocked}</small></div></article>
        </section>
        <section className="community-moderation-workspace">
          <aside>
            <div className="community-section-title"><span>{copy.queue}</span><SlidersHorizontal size={17} /></div>
            {cases.map((item, index) => (
              <button type="button" key={item.id} className={selected === index ? 'is-active' : ''} onClick={() => { setSelected(index); setStatus('pending'); }}>
                <span className={`community-risk-dot is-${item.tone}`} />
                <div><strong>{item.risk[language]}</strong><small>{item.author} · {item.age}</small></div>
                <b>{item.score}</b>
              </button>
            ))}
          </aside>
          <article className="community-moderation-detail">
            <header><div><span>{activeCase.id}</span><h2>{activeCase.author} <small>{activeCase.country}</small></h2></div><span className={`community-risk-badge is-${activeCase.tone}`}><Flag size={13} />{copy.risk}: {activeCase.risk[language]} · {activeCase.score}%</span></header>
            <div className="community-moderation-copy"><section><label>{copy.original}</label><p>{activeCase.original}</p></section><section><label>{copy.translation}</label><p>{activeCase.translation}</p></section></div>
            <div className="community-moderation-evidence">
              <div><strong>3</strong><span>{copy.links}</span></div><div><strong>5</strong><span>{copy.similar}</span></div><div><strong>1d</strong><span>{copy.accountAge}</span></div>
            </div>
            {status !== 'pending' && <div className={`community-moderation-status is-${status}`}><Check size={17} />{status === 'approved' ? copy.approve : copy.hide}</div>}
            <footer>
              <button type="button" className="community-secondary-button" onClick={() => setStatus('approved')}><Check size={16} />{copy.approve}</button>
              <button type="button" className="community-secondary-button"><UserRoundX size={16} />{copy.warn}</button>
              <button type="button" className="community-danger-button" onClick={() => setStatus('hidden')}><Trash2 size={16} />{copy.hide}</button>
            </footer>
          </article>
        </section>
      </main>
    </div>
  );
}
