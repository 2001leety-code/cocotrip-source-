import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Bell,
  Check,
  ChevronDown,
  Compass,
  Flag,
  Globe2,
  Heart,
  Home,
  Languages,
  Loader2,
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
  X,
} from 'lucide-react';
import { ImagePlus } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { usePageMeta } from '@/hooks/usePageMeta';
import { signalAppReady } from '@/lib/appReady';
import { uploadCommunityPhoto } from '@/lib/storage-upload';
import { authFetch } from '@/lib/authFetch';
import type { Language } from '@/i18n';

/**
 * 커뮤니티 — UIUX 가이드 P9 실전화 (2026-07-12).
 * 이전 버전은 하드코딩 가짜 글(POSTS)·가짜 알림·가짜 추천 사용자를 노출하는 디자인 셸이었음
 * → 전부 제거하고 실 Firestore 백엔드(api/community-posts·-post-actions·-translate) 연결.
 * 번역 = 원탭(Gemini, 언어당 1회 캐시). 작성 = 로그인 필수 + 연락처 유도 감지 시 운영자 검토.
 */

const LANGUAGES: Language[] = ['en', 'ko', 'ja', 'zh'];
const LANGUAGE_SHORT: Record<Language, string> = { en: 'EN', ko: '한', ja: '日', zh: '中' };
const LANGUAGE_NAME: Record<Language, string> = { en: 'English', ko: '한국어', ja: '日本語', zh: '中文' };

type Copy = {
  community: string; exploreKorea: string; search: string; latest: string; popular: string;
  write: string; translate: string; showOriginal: string; translatedFrom: string; translating: string;
  translateFailed: string; replies: string; save: string; report: string; reportTitle: string;
  reportHelp: string; reportReasons: [string, string, string, string]; reportDone: string;
  cancel: string; submit: string; categories: string; all: string;
  communityGuide: string; guideBody: string;
  navHome: string; navExplore: string; navCreate: string; navAlerts: string; navProfile: string;
  back: string; comments: string; replyPlaceholder: string;
  composeTitle: string; composeSubtitle: string; postType: string;
  postTypes: [string, string, string, string]; chooseCategory: string; titleLabel: string;
  titlePlaceholder: string; bodyLabel: string; bodyPlaceholder: string;
  publish: string; publishing: string; safetyNote: string;
  loginRequired: string; goLogin: string;
  emptyTitle: string; emptyBody: string; loadFailed: string; retry: string;
  postInReview: string; deleteConfirm: string; deleted: string;
  addPhotos: string; photoTooMany: string;
  alertsEmptyTitle: string; alertsEmptyBody: string;
  alertReply: string; alertLike: string;
  justNow: string; minutesAgo: string; hoursAgo: string; daysAgo: string;
};

const COPY: Record<Language, Copy> = {
  en: {
    community: 'Community', exploreKorea: 'Korea, shared by people who are here', search: 'Search Korea tips, places and people',
    latest: 'Latest', popular: 'Popular', write: 'Create post', translate: 'Translate', showOriginal: 'View original',
    translatedFrom: 'Translated from', translating: 'Translating…', translateFailed: 'Translation failed — showing original',
    replies: 'replies', save: 'Save', report: 'Report', reportTitle: 'Why are you reporting this?',
    reportHelp: 'Your report is private. A moderator will review the original post and its translation.',
    reportReasons: ['Spam or advertising', 'Harassment or hate', 'Sexual or unsafe content', 'Scam or false information'],
    reportDone: 'Report received. Thank you for keeping the community safe.',
    cancel: 'Cancel', submit: 'Send report', categories: 'Browse topics', all: 'All',
    communityGuide: 'Travel kindly', guideBody: 'Keep personal details private and meet new people in public places.',
    navHome: 'Feed', navExplore: 'Explore', navCreate: 'Post', navAlerts: 'Alerts', navProfile: 'Profile', back: 'Back', comments: 'Comments',
    replyPlaceholder: 'Join the conversation', composeTitle: 'Share with the community', composeSubtitle: 'Ask, recommend, or find people for your Korea trip.',
    postType: 'Post type', postTypes: ['Question', 'Tip', 'Travel buddy', 'Itinerary'], chooseCategory: 'Category', titleLabel: 'Title',
    titlePlaceholder: 'What would you like to share?', bodyLabel: 'Details', bodyPlaceholder: 'Add the details people need to help or join you.',
    publish: 'Publish', publishing: 'Publishing…',
    safetyNote: 'Phone numbers and private contact details are checked before publishing.',
    loginRequired: 'Sign in to join the conversation.', goLogin: 'Sign in',
    emptyTitle: 'Be the first to post', emptyBody: 'Ask a question or share a tip about traveling Korea — travelers and locals are here to help.',
    loadFailed: 'Could not load the community feed.', retry: 'Try again',
    postInReview: 'Your post is being reviewed for safety and will appear once approved.',
    deleteConfirm: 'Delete this post?', deleted: 'Deleted.',
    addPhotos: 'Add photos', photoTooMany: 'Up to 3 photos (5MB each).',
    alertsEmptyTitle: 'No alerts yet', alertsEmptyBody: 'Replies and likes on your posts will show up here.',
    alertReply: '{name} replied to "{title}"', alertLike: '{name} liked "{title}"',
    justNow: 'just now', minutesAgo: 'm', hoursAgo: 'h', daysAgo: 'd',
  },
  ko: {
    community: '커뮤니티', exploreKorea: '한국에 있는 사람들이 함께 만드는 정보', search: '한국 팁, 장소, 사람 검색',
    latest: '최신', popular: '인기', write: '글쓰기', translate: '번역 보기', showOriginal: '원문 보기',
    translatedFrom: '번역 언어', translating: '번역 중…', translateFailed: '번역에 실패했어요 — 원문을 표시합니다',
    replies: '댓글', save: '저장', report: '신고', reportTitle: '신고하는 이유를 알려주세요',
    reportHelp: '신고 내용은 공개되지 않으며 운영자가 원문과 번역문을 함께 확인합니다.',
    reportReasons: ['도배 또는 광고', '괴롭힘 또는 혐오 표현', '성적이거나 위험한 내용', '사기 또는 허위 정보'],
    reportDone: '신고가 접수됐어요. 안전한 커뮤니티를 만들어 주셔서 감사합니다.',
    cancel: '취소', submit: '신고 보내기', categories: '주제 둘러보기', all: '전체',
    communityGuide: '안전하게 여행하기', guideBody: '개인정보는 공개하지 말고 새로운 사람과는 공공장소에서 만나세요.',
    navHome: '피드', navExplore: '탐색', navCreate: '작성', navAlerts: '알림', navProfile: '내 정보', back: '뒤로', comments: '댓글',
    replyPlaceholder: '대화에 참여해 보세요', composeTitle: '커뮤니티에 공유하기', composeSubtitle: '한국 여행 질문, 추천, 동행 모집을 올려보세요.',
    postType: '글 종류', postTypes: ['질문', '여행 팁', '동행 모집', '여행 코스'], chooseCategory: '카테고리', titleLabel: '제목',
    titlePlaceholder: '무엇을 공유하고 싶나요?', bodyLabel: '상세 내용', bodyPlaceholder: '사람들이 답하거나 참여하는 데 필요한 내용을 적어주세요.',
    publish: '게시하기', publishing: '게시 중…',
    safetyNote: '전화번호와 개인 연락처는 게시 전에 안전 검사를 진행합니다.',
    loginRequired: '대화에 참여하려면 로그인하세요.', goLogin: '로그인',
    emptyTitle: '첫 글의 주인공이 되어보세요', emptyBody: '한국 여행 질문이나 팁을 올려보세요 — 여행자와 현지인이 함께 답해드립니다.',
    loadFailed: '커뮤니티 피드를 불러오지 못했어요.', retry: '다시 시도',
    postInReview: '안전 검토 후 공개됩니다. 승인되면 피드에 표시돼요.',
    deleteConfirm: '이 글을 삭제할까요?', deleted: '삭제됐어요.',
    addPhotos: '사진 추가', photoTooMany: '사진은 최대 3장(각 5MB)까지예요.',
    alertsEmptyTitle: '아직 알림이 없어요', alertsEmptyBody: '내 글에 달린 댓글과 좋아요가 여기에 표시됩니다.',
    alertReply: '{name}님이 "{title}"에 댓글을 남겼어요', alertLike: '{name}님이 "{title}"을 좋아합니다',
    justNow: '방금', minutesAgo: '분 전', hoursAgo: '시간 전', daysAgo: '일 전',
  },
  ja: {
    community: 'コミュニティ', exploreKorea: '韓国にいる人たちと共有するリアルな情報', search: '韓国の情報・場所・仲間を検索',
    latest: '新着', popular: '人気', write: '投稿する', translate: '翻訳を見る', showOriginal: '原文を見る',
    translatedFrom: '翻訳元', translating: '翻訳中…', translateFailed: '翻訳に失敗しました — 原文を表示します',
    replies: '返信', save: '保存', report: '報告', reportTitle: '報告する理由を教えてください',
    reportHelp: '報告内容は公開されません。運営者が原文と翻訳を確認します。',
    reportReasons: ['スパム・広告', '嫌がらせ・ヘイト', '性的・危険な内容', '詐欺・虚偽情報'],
    reportDone: '報告を受け付けました。安全なコミュニティへのご協力ありがとうございます。',
    cancel: 'キャンセル', submit: '報告を送信', categories: 'トピックを見る', all: 'すべて',
    communityGuide: '安全に旅する', guideBody: '個人情報は公開せず、新しい人とは公共の場所で会いましょう。',
    navHome: 'フィード', navExplore: '探索', navCreate: '投稿', navAlerts: '通知', navProfile: 'プロフィール', back: '戻る', comments: 'コメント',
    replyPlaceholder: '会話に参加しましょう', composeTitle: 'コミュニティに共有', composeSubtitle: '韓国旅行の質問、おすすめ、旅仲間の募集を投稿しましょう。',
    postType: '投稿の種類', postTypes: ['質問', '旅のヒント', '旅仲間募集', '旅程'], chooseCategory: 'カテゴリー', titleLabel: 'タイトル',
    titlePlaceholder: '何を共有しますか？', bodyLabel: '詳細', bodyPlaceholder: '回答や参加に必要な情報を書いてください。',
    publish: '投稿する', publishing: '投稿中…',
    safetyNote: '電話番号や個人の連絡先は、公開前に安全チェックを行います。',
    loginRequired: '会話に参加するにはサインインしてください。', goLogin: 'サインイン',
    emptyTitle: '最初の投稿者になりましょう', emptyBody: '韓国旅行の質問やヒントを投稿してみてください — 旅行者と現地の人が答えます。',
    loadFailed: 'フィードを読み込めませんでした。', retry: '再試行',
    postInReview: '安全確認の後に公開されます。承認されるとフィードに表示されます。',
    deleteConfirm: 'この投稿を削除しますか？', deleted: '削除しました。',
    addPhotos: '写真を追加', photoTooMany: '写真は最大3枚（各5MB）までです。',
    alertsEmptyTitle: 'まだ通知はありません', alertsEmptyBody: '投稿への返信やいいねがここに表示されます。',
    alertReply: '{name}さんが「{title}」に返信しました', alertLike: '{name}さんが「{title}」にいいねしました',
    justNow: 'たった今', minutesAgo: '分前', hoursAgo: '時間前', daysAgo: '日前',
  },
  zh: {
    community: '社区', exploreKorea: '由在韩国的人们共同分享的真实信息', search: '搜索韩国攻略、地点和伙伴',
    latest: '最新', popular: '热门', write: '发帖', translate: '查看翻译', showOriginal: '查看原文',
    translatedFrom: '翻译自', translating: '翻译中…', translateFailed: '翻译失败 — 显示原文',
    replies: '回复', save: '收藏', report: '举报', reportTitle: '请告诉我们举报原因',
    reportHelp: '举报内容不会公开，管理员会同时查看原文和译文。',
    reportReasons: ['垃圾信息或广告', '骚扰或仇恨言论', '色情或危险内容', '诈骗或虚假信息'],
    reportDone: '已收到举报。感谢你共同维护安全的社区。',
    cancel: '取消', submit: '发送举报', categories: '浏览话题', all: '全部',
    communityGuide: '安全出行', guideBody: '请勿公开个人信息，与新朋友见面请选择公共场所。',
    navHome: '动态', navExplore: '探索', navCreate: '发布', navAlerts: '通知', navProfile: '我的', back: '返回', comments: '评论',
    replyPlaceholder: '参与讨论吧', composeTitle: '与社区分享', composeSubtitle: '发布韩国旅行问题、推荐或寻找同伴。',
    postType: '帖子类型', postTypes: ['提问', '旅行贴士', '寻找同伴', '行程'], chooseCategory: '分类', titleLabel: '标题',
    titlePlaceholder: '想分享什么？', bodyLabel: '详情', bodyPlaceholder: '写下别人帮助你或加入你所需要的信息。',
    publish: '发布', publishing: '发布中…',
    safetyNote: '电话号码和私人联系方式会在发布前进行安全检查。',
    loginRequired: '登录后即可参与讨论。', goLogin: '登录',
    emptyTitle: '来发布第一条帖子吧', emptyBody: '发布一个关于韩国旅行的问题或贴士 — 旅行者和当地人都会来帮你。',
    loadFailed: '无法加载社区动态。', retry: '重试',
    postInReview: '你的帖子正在安全审核中，通过后将显示在动态里。',
    deleteConfirm: '删除这条帖子？', deleted: '已删除。',
    addPhotos: '添加照片', photoTooMany: '最多3张照片（每张5MB）。',
    alertsEmptyTitle: '暂无通知', alertsEmptyBody: '你帖子收到的回复和点赞会显示在这里。',
    alertReply: '{name}回复了"{title}"', alertLike: '{name}赞了"{title}"',
    justNow: '刚刚', minutesAgo: '分钟前', hoursAgo: '小时前', daysAgo: '天前',
  },
};

// 카테고리 (서버 enum 과 1:1)
const TOPICS: { key: 'seoul' | 'tips' | 'buddies' | 'living'; icon: typeof MapPin; labels: Record<Language, string> }[] = [
  { key: 'seoul', icon: MapPin, labels: { en: 'Seoul', ko: '서울', ja: 'ソウル', zh: '首尔' } },
  { key: 'tips', icon: Compass, labels: { en: 'Travel tips', ko: '여행 팁', ja: '旅行情報', zh: '旅行攻略' } },
  { key: 'buddies', icon: Users, labels: { en: 'Travel buddies', ko: '동행 찾기', ja: '旅仲間', zh: '寻找同伴' } },
  { key: 'living', icon: MessageCircle, labels: { en: 'Living in Korea', ko: '한국생활', ja: '韓国生活', zh: '韩国生活' } },
];
const POST_TYPE_KEYS = ['question', 'tip', 'buddy', 'itinerary'] as const;
const REPORT_REASON_KEYS = ['spam', 'harassment', 'unsafe', 'scam'] as const;

// ── API 타입/클라이언트 ──
type ApiPost = {
  id: string; title: string; body: string; lang: Language; type: string; category: string;
  authorName: string; authorUid: string; likeCount: number; replyCount: number;
  createdAt: number | null; translations: Partial<Record<Language, { title: string | null; body: string }>>;
  images?: string[];
};
type ApiReply = {
  id: string; body: string; lang: Language; authorName: string; authorUid: string;
  createdAt: number | null; translations: Partial<Record<Language, { title: string | null; body: string }>>;
};

async function apiGet(path: string) {
  const res = await fetch(path);
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data.data;
}
async function apiPost(path: string, body: unknown, token?: string | null) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`) as Error & { code?: string };
    err.code = data && data.code;
    throw err;
  }
  return data.data;
}

function timeAgo(ms: number | null, copy: Copy): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return copy.justNow;
  if (min < 60) return `${min}${copy.minutesAgo}`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}${copy.hoursAgo}`;
  return `${Math.floor(h / 24)}${copy.daysAgo}`;
}

function displayName(user: { displayName?: string | null; email?: string | null } | null): string {
  if (!user) return 'Traveler';
  return user.displayName || (user.email ? user.email.split('@')[0] : 'Traveler');
}

function categoryLabel(key: string, language: Language): string {
  const t = TOPICS.find((topic) => topic.key === key);
  return t ? t.labels[language] : key;
}

// ── 공통 셸 ──
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
  const location = useLocation();
  // 2026-07-17: 장식용이던 검색 input 실배선 — Enter 시 /community?q= 로 이동,
  // 피드(CommunityPage)가 q 로 로드된 글을 클라이언트 필터. 초기값=현재 ?q=.
  const initialQ = new URLSearchParams(location.search).get('q') || '';
  const [searchQ, setSearchQ] = useState(initialQ);
  const submitSearch = () => {
    const q = searchQ.trim();
    navigate(q ? `/community?q=${encodeURIComponent(q)}` : '/community');
  };
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
          <input
            aria-label={copy.search}
            placeholder={copy.search}
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitSearch(); }}
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <LanguageButton />
          <Link to="/community?tab=alerts" className="community-icon-button" aria-label={copy.navAlerts}><Bell size={18} /></Link>
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
        <div className="community-section-title"><span>{copy.categories}</span></div>
        {TOPICS.map(({ key, icon: Icon, labels }) => (
          <Link to={`/community?topic=${key}`} className="community-trend" key={key}>
            <span className="flex items-center gap-2"><Icon size={15} />{labels[language]}</span>
          </Link>
        ))}
      </section>
      <section className="community-safety-card">
        <ShieldCheck size={21} />
        <div><strong>{copy.communityGuide}</strong><p>{copy.guideBody}</p></div>
      </section>
    </aside>
  );
}

function ReportSheet({ postId, replyId, onClose }: { postId: string; replyId?: string; onClose: () => void }) {
  const { language } = useLanguage();
  const copy = COPY[language];
  const [reason, setReason] = useState(0);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setSending(true);
    try {
      await apiPost('/api/community-post-actions', { action: 'report', postId, replyId, reason: REPORT_REASON_KEYS[reason] });
      setDone(true);
      setTimeout(onClose, 1600);
    } catch {
      onClose();
    }
  };

  return (
    <div className="community-sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="community-sheet" role="dialog" aria-modal="true" aria-labelledby="report-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="community-sheet-handle" />
        <div className="community-sheet-heading">
          <div><h2 id="report-title">{copy.reportTitle}</h2><p>{done ? copy.reportDone : copy.reportHelp}</p></div>
          <button type="button" className="community-icon-button" onClick={onClose} aria-label={copy.cancel}><X size={19} /></button>
        </div>
        {!done && (
          <>
            <div className="community-report-options">
              {copy.reportReasons.map((item, index) => (
                <button type="button" key={item} onClick={() => setReason(index)} className={reason === index ? 'is-selected' : ''}>
                  <span>{item}</span>{reason === index && <Check size={17} />}
                </button>
              ))}
            </div>
            <div className="community-sheet-actions">
              <button type="button" className="community-secondary-button" onClick={onClose}>{copy.cancel}</button>
              <button type="button" className="community-primary-button" disabled={sending} onClick={submit}>
                {sending ? <Loader2 size={16} className="animate-spin" /> : <Flag size={16} />}{copy.submit}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// ── 글 카드 (실데이터 + 원탭 번역) ──
function PostCard({ post, expanded = false, onDeleted }: { post: ApiPost; expanded?: boolean; onDeleted?: () => void }) {
  const { language } = useLanguage();
  const { user } = useAuth();
  const copy = COPY[language];
  const navigate = useNavigate();
  const [translated, setTranslated] = useState(false);
  const [translation, setTranslation] = useState<{ title: string | null; body: string } | null>(post.translations[language] || null);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState(false);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [reportOpen, setReportOpen] = useState(false);
  const isTranslationAvailable = language !== post.lang;
  const isMine = !!user && user.uid === post.authorUid;

  const toggleTranslate = async () => {
    if (translated) { setTranslated(false); return; }
    if (translation) { setTranslated(true); return; }
    setTranslating(true);
    setTranslateError(false);
    try {
      const result = await apiPost('/api/community-translate', { postId: post.id, targetLang: language });
      setTranslation({ title: result.title, body: result.body });
      setTranslated(true);
    } catch {
      setTranslateError(true);
    } finally {
      setTranslating(false);
    }
  };

  const toggleLike = async () => {
    if (!user) { navigate('/mypage'); return; }
    const next = !liked;
    setLiked(next);
    setLikeCount((c) => Math.max(0, c + (next ? 1 : -1)));
    try {
      const token = await user.getIdToken();
      const result = await apiPost('/api/community-post-actions', { action: next ? 'like' : 'unlike', postId: post.id }, token);
      setLiked(result.liked);
      setLikeCount(result.likeCount);
    } catch {
      setLiked(!next);
      setLikeCount((c) => Math.max(0, c + (next ? -1 : 1)));
    }
  };

  const deletePost = async () => {
    if (!user || !window.confirm(copy.deleteConfirm)) return;
    try {
      const token = await user.getIdToken();
      await apiPost('/api/community-post-actions', { action: 'delete', postId: post.id }, token);
      if (onDeleted) onDeleted();
    } catch { /* silent */ }
  };

  const shownTitle = translated && translation ? (translation.title || post.title) : post.title;
  const shownBody = translated && translation ? translation.body : post.body;

  return (
    <article className={`community-post-card ${expanded ? 'is-expanded' : ''}`}>
      <div className="community-post-head">
        <span className="community-avatar">{post.authorName.slice(0, 1).toUpperCase()}</span>
        <div className="community-author">
          <div><strong>{post.authorName}</strong></div>
          <span>{timeAgo(post.createdAt, copy)}</span>
        </div>
        {isMine ? (
          <button type="button" className="community-icon-button" onClick={deletePost} aria-label="Delete"><Trash2 size={17} /></button>
        ) : (
          <button type="button" className="community-icon-button" onClick={() => setReportOpen(true)} aria-label={copy.report}><MoreHorizontal size={19} /></button>
        )}
      </div>
      <Link to={`/community/post/${post.id}`} className="community-post-content">
        <div className="community-post-meta">
          <span>{categoryLabel(post.category, language)}</span>
        </div>
        <h2>{shownTitle}</h2>
        <p>{shownBody}</p>
        {(post.images || []).length > 0 && (
          <div className="community-post-images" data-count={post.images!.length}>
            {post.images!.map((src) => <img key={src} src={src} alt="" loading="lazy" />)}
          </div>
        )}
      </Link>
      {isTranslationAvailable && (
        <button type="button" className="community-translate-button" onClick={toggleTranslate} disabled={translating}>
          {translating ? <Loader2 size={15} className="animate-spin" /> : <Languages size={15} />}
          <span>{translating ? copy.translating : translated ? copy.showOriginal : copy.translate}</span>
          {translated && <small>{copy.translatedFrom} {LANGUAGE_NAME[post.lang] || post.lang}</small>}
          {translateError && <small>{copy.translateFailed}</small>}
        </button>
      )}
      <div className="community-post-actions">
        <button type="button" className={liked ? 'is-active is-liked' : ''} onClick={toggleLike} aria-label="Like">
          <Heart size={18} fill={liked ? 'currentColor' : 'none'} /><span>{likeCount}</span>
        </button>
        <Link to={`/community/post/${post.id}`}><MessageCircle size={18} /><span>{post.replyCount} {copy.replies}</span></Link>
        <button type="button" onClick={() => setReportOpen(true)} aria-label={copy.report}><Flag size={17} /></button>
      </div>
      {reportOpen && <ReportSheet postId={post.id} onClose={() => setReportOpen(false)} />}
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

function FeedState({ icon: Icon, title, body, action }: { icon: typeof Sparkles; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="community-post-card" style={{ textAlign: 'center', padding: '36px 20px' }}>
      <Icon size={28} style={{ margin: '0 auto 10px', color: '#7C5CFF' }} />
      <h2 style={{ fontSize: 17, fontWeight: 800 }}>{title}</h2>
      <p style={{ marginTop: 6, fontSize: 13, color: '#6E6A8F' }}>{body}</p>
      {action && <div style={{ marginTop: 14, display: 'flex', justifyContent: 'center' }}>{action}</div>}
    </div>
  );
}

// ── 피드 ──
export default function CommunityPage() {
  const { language } = useLanguage();
  const copy = COPY[language];
  const location = useLocation();
  const [tab, setTab] = useState<'latest' | 'popular'>('latest');
  const [topic, setTopic] = useState<string | null>(null);
  const [posts, setPosts] = useState<ApiPost[] | null>(null);
  const [error, setError] = useState(false);
  const params = new URLSearchParams(location.search);
  const requestedView = params.get('tab');
  const searchQ = (params.get('q') || '').trim().toLowerCase();
  const activeRail = requestedView === 'alerts' ? 'alerts' : requestedView === 'popular' ? 'explore' : 'feed';

  // usePageMeta 가 '| CocoTrip' 접미사를 붙임 — 중복 방지 위해 여기선 안 붙인다.
  usePageMeta({ title: copy.community, description: copy.exploreKorea });
  useEffect(() => { signalAppReady(); }, []);
  useEffect(() => {
    if (requestedView === 'popular') setTab('popular');
    const topicParam = params.get('topic');
    if (topicParam) setTopic(topicParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  const load = useCallback(async (sort: 'latest' | 'popular') => {
    setError(false);
    setPosts(null);
    try {
      const data = await apiGet(`/api/community-posts?sort=${sort}`);
      setPosts(data.posts);
    } catch {
      setError(true);
      setPosts([]);
    }
  }, []);

  useEffect(() => { void load(tab); }, [tab, load]);

  const visible = useMemo(() => {
    if (!posts) return null;
    let list = topic ? posts.filter((p) => p.category === topic) : posts;
    // 2026-07-17: 헤더 검색(?q=) 배선 — 로드된 글의 제목/본문/작성자 대소문자 무시 매칭.
    // 서버측 전문검색은 글 누적 후 별도(현재 피드 자체가 최신 30~60건 클라 필터 구조와 동일 층위).
    if (searchQ) {
      list = list.filter((p) =>
        (p.title || '').toLowerCase().includes(searchQ)
        || (p.body || '').toLowerCase().includes(searchQ)
        || (p.authorName || '').toLowerCase().includes(searchQ));
    }
    return list;
  }, [posts, topic, searchQ]);

  return (
    <CommunityLayout active={activeRail}>
      {requestedView === 'alerts' ? (
        <CommunityAlertsView copy={copy} />
      ) : (
        <>
          <section className="community-intro">
            <div><span className="community-eyebrow"><Sparkles size={14} />CocoTrip Together</span><h1>{copy.community}</h1><p>{copy.exploreKorea}</p></div>
            <Link to="/community/new" className="community-primary-button"><PenLine size={17} />{copy.write}</Link>
          </section>
          <section className="community-mobile-topics md:hidden">
            <div className="community-section-title"><span>{copy.categories}</span><SlidersHorizontal size={17} /></div>
            <div className="community-topic-scroll">
              <button type="button" className={!topic ? 'is-active' : ''} onClick={() => setTopic(null)}><span>{copy.all}</span></button>
              {TOPICS.map(({ key, icon: Icon, labels }) => (
                <button type="button" key={key} className={topic === key ? 'is-active' : ''} onClick={() => setTopic(topic === key ? null : key)}>
                  <Icon size={16} /><span>{labels[language]}</span>
                </button>
              ))}
            </div>
          </section>
          <div className="community-tabs" role="tablist">
            {(['latest', 'popular'] as const).map((key) => (
              <button type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'is-active' : ''} key={key} onClick={() => setTab(key)}>
                {copy[key]}
              </button>
            ))}
          </div>
          <div className="community-feed">
            {visible === null && (
              <div className="community-post-card" style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
                <Loader2 size={22} className="animate-spin" style={{ color: '#7C5CFF' }} />
              </div>
            )}
            {visible !== null && error && (
              <FeedState icon={Flag} title={copy.loadFailed} body="" action={
                <button type="button" className="community-primary-button" onClick={() => load(tab)}>{copy.retry}</button>
              } />
            )}
            {visible !== null && !error && visible.length === 0 && (
              <FeedState icon={Sparkles} title={copy.emptyTitle} body={copy.emptyBody} action={
                <Link to="/community/new" className="community-primary-button"><PenLine size={16} />{copy.write}</Link>
              } />
            )}
            {visible !== null && visible.map((post) => (
              <PostCard key={post.id} post={post} onDeleted={() => setPosts((prev) => prev ? prev.filter((p) => p.id !== post.id) : prev)} />
            ))}
          </div>
        </>
      )}
    </CommunityLayout>
  );
}

// ── 알림 (2026-07-13 MVP): 내 글의 댓글·좋아요 — community_notifications 실데이터 ──
type ApiNotification = { id: string; type: 'reply' | 'like'; postId: string; postTitle: string; fromName: string; read: boolean; createdAt: number };

function CommunityAlertsView({ copy }: { copy: Copy }) {
  const { user } = useAuth();
  const [items, setItems] = useState<ApiNotification[] | null>(null);

  useEffect(() => {
    if (!user) { setItems([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/community-notifications', { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        if (cancelled || !data.ok) { if (!cancelled) setItems([]); return; }
        setItems(data.data.items);
        // 표시 직후 읽음 처리 (뱃지 소거) — 실패해도 무해
        if (data.data.unread > 0) {
          void apiPost('/api/community-notifications', { action: 'markAllRead' }, token).catch(() => {});
        }
      } catch { if (!cancelled) setItems([]); }
    })();
    return () => { cancelled = true; };
  }, [user]);

  return (
    <section className="community-alerts-page">
      <div className="community-intro"><div><span className="community-eyebrow"><Bell size={14} />CocoTrip Together</span><h1>{copy.navAlerts}</h1></div></div>
      {!user && (
        <FeedState icon={Users} title={copy.loginRequired} body="" action={
          <Link to="/mypage" className="community-primary-button">{copy.goLogin}</Link>
        } />
      )}
      {user && items === null && (
        <div className="community-post-card" style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
          <Loader2 size={20} className="animate-spin" style={{ color: '#7C5CFF' }} />
        </div>
      )}
      {user && items !== null && items.length === 0 && (
        <FeedState icon={Bell} title={copy.alertsEmptyTitle} body={copy.alertsEmptyBody} />
      )}
      {user && items !== null && items.length > 0 && (
        <div className="community-alert-list">
          {items.map((n) => (
            <Link to={`/community/post/${n.postId}`} key={n.id} className="community-alert-row" style={!n.read ? { background: 'rgba(124,92,255,0.06)' } : undefined}>
              <span className={`community-alert-icon is-${n.type === 'like' ? 'pink' : 'purple'}`}>
                {n.type === 'like' ? <Heart size={18} /> : <MessageCircle size={18} />}
              </span>
              <span>
                <strong>
                  {(n.type === 'like' ? copy.alertLike : copy.alertReply)
                    .replace('{name}', n.fromName)
                    .replace('{title}', n.postTitle)}
                </strong>
                <small>{timeAgo(n.createdAt, copy)}</small>
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

// ── 글 상세 + 댓글 ──
export function CommunityPostPage() {
  const { language } = useLanguage();
  const { user } = useAuth();
  const copy = COPY[language];
  const { postId } = useParams();
  const navigate = useNavigate();
  const [post, setPost] = useState<ApiPost | null>(null);
  const [replies, setReplies] = useState<ApiReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [replyNotice, setReplyNotice] = useState<string | null>(null);

  usePageMeta({ title: post ? post.title : copy.community, description: post ? post.body.slice(0, 140) : copy.exploreKorea });

  const load = useCallback(async () => {
    if (!postId) return;
    setLoading(true);
    try {
      const data = await apiGet(`/api/community-posts?id=${encodeURIComponent(postId)}`);
      setPost(data.post);
      setReplies(data.replies);
    } catch {
      setPost(null);
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => { void load(); }, [load]);

  const submitReply = async () => {
    if (!post || !reply.trim()) return;
    if (!user) { navigate('/mypage'); return; }
    setSending(true);
    setReplyNotice(null);
    try {
      const token = await user.getIdToken();
      const result = await apiPost('/api/community-post-actions', {
        action: 'reply', postId: post.id, body: reply.trim(), authorName: displayName(user),
      }, token);
      setReply('');
      if (result.status === 'review') setReplyNotice(copy.postInReview);
      else await load();
    } catch (err) {
      setReplyNotice((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <CommunityLayout backTo="/community">
      <div className="community-detail-title">
        <button type="button" onClick={() => navigate('/community')} className="community-icon-button"><ArrowLeft size={20} /></button>
        <strong>{copy.back}</strong>
      </div>
      {loading && (
        <div className="community-post-card" style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <Loader2 size={22} className="animate-spin" style={{ color: '#7C5CFF' }} />
        </div>
      )}
      {!loading && !post && <FeedState icon={Flag} title={copy.loadFailed} body="" />}
      {!loading && post && (
        <>
          <PostCard post={post} expanded onDeleted={() => navigate('/community')} />
          <section className="community-comments">
            <h2>{copy.comments} <span>{replies.length}</span></h2>
            {user ? (
              <div className="community-reply-box">
                <span className="community-avatar">{displayName(user).slice(0, 1).toUpperCase()}</span>
                <input value={reply} onChange={(event) => setReply(event.target.value)} placeholder={copy.replyPlaceholder} maxLength={500}
                  onKeyDown={(event) => { if (event.key === 'Enter') void submitReply(); }} />
                <button type="button" className="community-icon-button" disabled={!reply.trim() || sending} onClick={submitReply} aria-label={copy.submit}>
                  {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                </button>
              </div>
            ) : (
              <div className="community-reply-box" style={{ justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: '#6E6A8F' }}>{copy.loginRequired}</span>
                <Link to="/mypage" className="community-primary-button">{copy.goLogin}</Link>
              </div>
            )}
            {replyNotice && <p style={{ fontSize: 12.5, color: '#7C5CFF', marginTop: 8 }}>{replyNotice}</p>}
            {replies.map((item) => <CommentCard key={item.id} postId={post.id} comment={item} onDeleted={load} />)}
          </section>
        </>
      )}
    </CommunityLayout>
  );
}

function CommentCard({ postId, comment, onDeleted }: { postId: string; comment: ApiReply; onDeleted: () => void }) {
  const { language } = useLanguage();
  const { user } = useAuth();
  const copy = COPY[language];
  const [translated, setTranslated] = useState(false);
  const [translation, setTranslation] = useState<string | null>(
    comment.translations[language] ? comment.translations[language]!.body : null
  );
  const [translating, setTranslating] = useState(false);
  const isMine = !!user && user.uid === comment.authorUid;

  const toggleTranslate = async () => {
    if (translated) { setTranslated(false); return; }
    if (translation) { setTranslated(true); return; }
    setTranslating(true);
    try {
      const result = await apiPost('/api/community-translate', { postId, replyId: comment.id, targetLang: language });
      setTranslation(result.body);
      setTranslated(true);
    } catch { /* 원문 유지 */ } finally {
      setTranslating(false);
    }
  };

  const remove = async () => {
    if (!user || !window.confirm(copy.deleteConfirm)) return;
    try {
      const token = await user.getIdToken();
      await apiPost('/api/community-post-actions', { action: 'delete', postId, replyId: comment.id }, token);
      onDeleted();
    } catch { /* silent */ }
  };

  return (
    <article className="community-comment">
      <span className="community-avatar is-small">{comment.authorName.slice(0, 1).toUpperCase()}</span>
      <div>
        <header><strong>{comment.authorName}</strong><span>{timeAgo(comment.createdAt, copy)}</span></header>
        <p>{translated && translation ? translation : comment.body}</p>
        {language !== comment.lang && (
          <button type="button" className="community-translate-button" onClick={toggleTranslate} disabled={translating}>
            {translating ? <Loader2 size={14} className="animate-spin" /> : <Languages size={14} />}
            {translating ? copy.translating : translated ? copy.showOriginal : copy.translate}
          </button>
        )}
        {isMine && (
          <div className="community-comment-actions">
            <button type="button" onClick={remove}><Trash2 size={15} />{copy.cancel === '취소' ? '삭제' : 'Delete'}</button>
          </div>
        )}
      </div>
    </article>
  );
}

// ── 작성 ──
export function CommunityComposePage() {
  const { language } = useLanguage();
  const { user } = useAuth();
  const copy = COPY[language];
  const navigate = useNavigate();
  const [type, setType] = useState(0);
  const [category, setCategory] = useState<string>(TOPICS[1].key);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // 사진 첨부 (UIUX P9, 2026-07-13) — 최대 3장, 게시 시점에 Storage 업로드
  const [photos, setPhotos] = useState<{ file: File; preview: string }[]>([]);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  usePageMeta({ title: copy.composeTitle, description: copy.composeSubtitle });

  // object URL 누수 방지 (리뷰 fix): 언마운트·발행이동 시 남은 미리보기 blob 해제.
  // photosRef 로 최신 previews 를 추적 → cleanup 이 stale 클로저를 잡지 않게.
  const photosRef = useRef(photos);
  photosRef.current = photos;
  useEffect(() => () => { photosRef.current.forEach((p) => URL.revokeObjectURL(p.preview)); }, []);

  const addPhotos = (files: FileList | null) => {
    if (!files) return;
    setNotice(null);
    const next = [...photos];
    for (const file of Array.from(files)) {
      if (next.length >= 3 || file.size > 5 * 1024 * 1024 || !file.type.startsWith('image/')) {
        setNotice(copy.photoTooMany);
        continue;
      }
      next.push({ file, preview: URL.createObjectURL(file) });
    }
    setPhotos(next.slice(0, 3));
  };

  const removePhoto = (index: number) => {
    setPhotos((prev) => {
      URL.revokeObjectURL(prev[index]?.preview || '');
      return prev.filter((_, i) => i !== index);
    });
  };

  const publish = async () => {
    if (!user) { navigate('/mypage'); return; }
    setPublishing(true);
    setNotice(null);
    try {
      // 1) 사진 업로드 (본인 community/{uid}/ 경로 — 서버가 경로 재검증)
      const images: string[] = [];
      for (let i = 0; i < photos.length; i++) {
        setUploadPct(Math.round((i / photos.length) * 100));
        images.push(await uploadCommunityPhoto(user.uid, photos[i].file));
      }
      setUploadPct(null);
      // 2) 글 작성
      const token = await user.getIdToken();
      const result = await apiPost('/api/community-posts', {
        title: title.trim(), body: body.trim(),
        type: POST_TYPE_KEYS[type], category, authorName: displayName(user),
        images,
      }, token);
      // 성공 시 미리보기 blob 해제 (review 유지·게시 이동 양쪽 — 리뷰 fix: navigate 전 revoke)
      photos.forEach((p) => URL.revokeObjectURL(p.preview));
      setPhotos([]);
      if (result.status === 'review') {
        setNotice(copy.postInReview);
        setTitle(''); setBody('');
      } else {
        navigate(`/community/post/${result.postId}`);
      }
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setUploadPct(null);
      setPublishing(false);
    }
  };

  return (
    <CommunityLayout active="create" backTo="/community">
      <section className="community-compose-heading">
        <div><h1>{copy.composeTitle}</h1><p>{copy.composeSubtitle}</p></div>
        <span><Languages size={15} />{LANGUAGE_NAME[language]}</span>
      </section>
      {!user && (
        <FeedState icon={Users} title={copy.loginRequired} body="" action={
          <Link to="/mypage" className="community-primary-button">{copy.goLogin}</Link>
        } />
      )}
      {user && (
        <section className="community-compose-form">
          <label>{copy.postType}</label>
          <div className="community-segmented-control">
            {copy.postTypes.map((item, index) => <button type="button" key={item} className={type === index ? 'is-active' : ''} onClick={() => setType(index)}>{item}</button>)}
          </div>
          <label htmlFor="community-category">{copy.chooseCategory}</label>
          <div className="community-select-wrap">
            <select id="community-category" value={category} onChange={(event) => setCategory(event.target.value)}>
              {TOPICS.map((topicItem) => <option key={topicItem.key} value={topicItem.key}>{topicItem.labels[language]}</option>)}
            </select>
            <ChevronDown size={17} />
          </div>
          <label htmlFor="community-title">{copy.titleLabel}</label>
          <input id="community-title" className="community-field" value={title} onChange={(event) => setTitle(event.target.value)} placeholder={copy.titlePlaceholder} maxLength={100} />
          <div className="community-field-counter">{title.length}/100</div>
          <label htmlFor="community-body">{copy.bodyLabel}</label>
          <textarea id="community-body" className="community-field" value={body} onChange={(event) => setBody(event.target.value)} placeholder={copy.bodyPlaceholder} rows={8} maxLength={2000} />
          <div className="community-field-counter">{body.length}/2000</div>

          {/* 사진 첨부 (UIUX P9) — 최대 3장, 게시 시 본인 Storage 경로 업로드 */}
          <label>{copy.addPhotos}</label>
          <div className="community-photo-grid">
            {photos.map((p, index) => (
              <div key={p.preview} className="community-photo-thumb">
                <img src={p.preview} alt="" />
                <button type="button" onClick={() => removePhoto(index)} aria-label={copy.cancel}><X size={14} /></button>
              </div>
            ))}
            {photos.length < 3 && (
              <label className="community-photo-add">
                <ImagePlus size={22} />
                <span>{copy.addPhotos}</span>
                <input type="file" accept="image/*" multiple hidden onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }} />
              </label>
            )}
          </div>
          <div className="community-field-counter">{photos.length}/3</div>

          <div className="community-compose-safety"><ShieldCheck size={19} /><p>{copy.safetyNote}</p></div>
          {notice && <div className="community-draft-notice"><Sparkles size={17} /><span>{notice}</span></div>}
          <div className="community-compose-actions">
            <button type="button" className="community-secondary-button" onClick={() => navigate('/community')}>{copy.cancel}</button>
            <button type="button" className="community-primary-button" disabled={!title.trim() || !body.trim() || publishing} onClick={publish}>
              {publishing ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              {publishing ? (uploadPct !== null ? `${uploadPct}%` : copy.publishing) : copy.publish}
            </button>
          </div>
        </section>
      )}
    </CommunityLayout>
  );
}

// ── 어드민 모더레이션 (UIUX P9 실배선 2026-07-13 — /api/community-admin, 어드민 게이트 하위) ──
const MODERATION_COPY: Record<Language, {
  title: string; subtitle: string; pending: string; openReports: string; queue: string; reportsTitle: string;
  post: string; images: string; approve: string; hide: string; resolve: string; reportedFor: string;
  empty: string; loadFailed: string; retry: string; done: string; reasonLabels: Record<string, string>;
}> = {
  en: {
    title: 'Community moderation', subtitle: 'Review held posts and reports, then approve or hide.',
    pending: 'Pending review', openReports: 'Open reports', queue: 'Held for review', reportsTitle: 'Reports',
    post: 'Post', images: 'photos', approve: 'Approve', hide: 'Hide', resolve: 'Mark resolved', reportedFor: 'Reported for',
    empty: 'Nothing needs review right now.', loadFailed: 'Could not load the moderation queue.', retry: 'Try again', done: 'Done',
    reasonLabels: { spam: 'Spam / advertising', harassment: 'Harassment', unsafe: 'Unsafe content', scam: 'Scam / fraud' },
  },
  ko: {
    title: '커뮤니티 안전 관리', subtitle: '검토 대기 글과 신고를 확인하고 승인 또는 숨김 처리하세요.',
    pending: '검토 대기', openReports: '열린 신고', queue: '검토 대기 글', reportsTitle: '신고',
    post: '게시글', images: '사진', approve: '승인', hide: '숨김', resolve: '처리 완료', reportedFor: '신고 사유',
    empty: '지금 검토할 항목이 없어요.', loadFailed: '검토 목록을 불러오지 못했어요.', retry: '다시 시도', done: '완료',
    reasonLabels: { spam: '도배·광고', harassment: '괴롭힘', unsafe: '위험한 내용', scam: '사기·허위' },
  },
  ja: {
    title: 'コミュニティ管理', subtitle: '確認待ちの投稿と報告を確認し、承認または非表示にします。',
    pending: '確認待ち', openReports: '未対応の報告', queue: '確認待ち投稿', reportsTitle: '報告',
    post: '投稿', images: '写真', approve: '承認', hide: '非表示', resolve: '対応済み', reportedFor: '報告理由',
    empty: '現在確認が必要な項目はありません。', loadFailed: 'リストを読み込めませんでした。', retry: '再試行', done: '完了',
    reasonLabels: { spam: 'スパム・広告', harassment: '嫌がらせ', unsafe: '危険な内容', scam: '詐欺・虚偽' },
  },
  zh: {
    title: '社区安全管理', subtitle: '查看待审帖子和举报，然后通过或隐藏。',
    pending: '待审核', openReports: '未处理举报', queue: '待审帖子', reportsTitle: '举报',
    post: '帖子', images: '照片', approve: '通过', hide: '隐藏', resolve: '标记已处理', reportedFor: '举报原因',
    empty: '目前没有需要审核的内容。', loadFailed: '无法加载审核列表。', retry: '重试', done: '完成',
    reasonLabels: { spam: '垃圾·广告', harassment: '骚扰', unsafe: '危险内容', scam: '诈骗·虚假' },
  },
};

type ModQueueItem = {
  postId: string; title: string; body: string; lang: Language; category: string;
  authorName: string; authorEmail: string | null; images: string[]; createdAt: number | null;
};
type ModReport = {
  reportId: string; postId: string; replyId: string | null; reason: string; createdAt: number | null;
  post: { title: string; body: string; status: string; authorName: string } | null;
};

export function CommunityModerationPage() {
  const { language } = useLanguage();
  const { user } = useAuth();
  const copy = MODERATION_COPY[language];
  const [queue, setQueue] = useState<ModQueueItem[]>([]);
  const [reports, setReports] = useState<ModReport[]>([]);
  const [stats, setStats] = useState<{ pendingReview: number; openReports: number }>({ pendingReview: 0, openReports: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  usePageMeta({ title: `${copy.title} — Admin`, description: copy.subtitle });

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await authFetch('/api/community-admin');
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setQueue(data.data.queue || []);
      setReports(data.data.reports || []);
      setStats(data.data.stats || { pendingReview: 0, openReports: 0 });
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (user) load(); }, [user, load]);

  const act = async (body: Record<string, unknown>, key: string) => {
    setBusyId(key);
    try {
      const res = await authFetch('/api/community-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      await load();
    } catch { /* keep item — 재시도 가능 */ } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="community-moderation-app">
      <header className="community-moderation-header">
        <CommunityBrand />
        <div><h1>{copy.title}</h1><p>{copy.subtitle}</p></div>
        <Link to="/admin" className="community-secondary-button"><ArrowLeft size={16} />Admin</Link>
      </header>
      <main>
        <section className="community-moderation-stats">
          <article><span><MessageCircle size={19} /></span><div><strong>{stats.pendingReview}</strong><small>{copy.pending}</small></div></article>
          <article><span className="is-urgent"><Flag size={19} /></span><div><strong>{stats.openReports}</strong><small>{copy.openReports}</small></div></article>
          <article><span className="is-safe"><ShieldCheck size={19} /></span><div><strong>{queue.length + reports.length}</strong><small>{copy.queue}</small></div></article>
        </section>

        {loading ? (
          <div className="community-moderation-empty"><Loader2 size={22} className="animate-spin" /></div>
        ) : error ? (
          <div className="community-moderation-empty">
            <p>{copy.loadFailed}</p>
            <button type="button" className="community-secondary-button" onClick={load}>{copy.retry}</button>
          </div>
        ) : queue.length === 0 && reports.length === 0 ? (
          <div className="community-moderation-empty"><ShieldCheck size={26} /><p>{copy.empty}</p></div>
        ) : (
          <section className="community-moderation-list">
            {queue.length > 0 && (
              <div className="community-mod-group">
                <div className="community-section-title"><span>{copy.queue}</span><SlidersHorizontal size={17} /></div>
                {queue.map((item) => (
                  <article key={item.postId} className="community-mod-card">
                    <header>
                      <div><strong>{item.title}</strong><small>{item.authorName}{item.authorEmail ? ` · ${item.authorEmail}` : ''} · {timeAgo(item.createdAt, COPY[language] as unknown as Copy)}</small></div>
                      <span className="community-risk-badge is-high"><Flag size={13} />{copy.pending}</span>
                    </header>
                    <p className="community-mod-body">{item.body}</p>
                    {item.images.length > 0 && <div className="community-mod-thumbs">{item.images.map((src) => <img key={src} src={src} alt="" loading="lazy" />)}</div>}
                    <footer>
                      <button type="button" className="community-secondary-button" disabled={busyId === item.postId} onClick={() => act({ action: 'approve', postId: item.postId }, item.postId)}><Check size={16} />{copy.approve}</button>
                      <button type="button" className="community-danger-button" disabled={busyId === item.postId} onClick={() => act({ action: 'hide', postId: item.postId }, item.postId)}><Trash2 size={16} />{copy.hide}</button>
                    </footer>
                  </article>
                ))}
              </div>
            )}
            {reports.length > 0 && (
              <div className="community-mod-group">
                <div className="community-section-title"><span>{copy.reportsTitle}</span><Flag size={17} /></div>
                {reports.map((r) => (
                  <article key={r.reportId} className="community-mod-card">
                    <header>
                      <div><strong>{r.post?.title || r.postId}</strong><small>{copy.reportedFor}: {copy.reasonLabels[r.reason] || r.reason} · {timeAgo(r.createdAt, COPY[language] as unknown as Copy)}</small></div>
                      <span className="community-risk-badge is-medium"><Flag size={13} />{r.reason}</span>
                    </header>
                    {r.post && <p className="community-mod-body">{r.post.body}</p>}
                    <footer>
                      {r.post && r.post.status === 'active' && !r.replyId && (
                        <button type="button" className="community-danger-button" disabled={busyId === r.reportId} onClick={() => act({ action: 'hide', postId: r.postId }, r.reportId)}><Trash2 size={16} />{copy.hide}</button>
                      )}
                      <button type="button" className="community-secondary-button" disabled={busyId === r.reportId} onClick={() => act({ action: 'resolve_report', reportId: r.reportId }, r.reportId)}><Check size={16} />{copy.resolve}</button>
                    </footer>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
