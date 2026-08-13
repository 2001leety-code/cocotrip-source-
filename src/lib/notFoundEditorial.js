export const NOT_FOUND_LANGUAGES = Object.freeze(['en', 'ko', 'ja', 'zh']);

export const NOT_FOUND_COPY = Object.freeze({
  en: Object.freeze({
    eyebrow: 'Navigation note',
    title: 'Page not found',
    subtitle: "The page you're looking for does not exist or has moved.",
    description: 'The requested page could not be found on CocoTrip.',
    home: 'Back to home',
    tours: 'Browse tours',
    charter: 'Charter vehicle',
    recoveryLabel: 'Choose a next step',
    languageLabel: 'Language',
    headerLabel: 'Korea travel concierge',
    footerLabel: 'Korea travel planning',
  }),
  ko: Object.freeze({
    eyebrow: '경로 안내',
    title: '페이지를 찾을 수 없습니다',
    subtitle: '요청하신 페이지가 없거나 다른 주소로 이동되었습니다.',
    description: 'CocoTrip에서 요청하신 페이지를 찾을 수 없습니다.',
    home: '홈으로 돌아가기',
    tours: '투어 둘러보기',
    charter: '전세차량 보기',
    recoveryLabel: '다음 이동 경로',
    languageLabel: '언어',
    headerLabel: '한국 여행 안내',
    footerLabel: '한국 여행 일정 안내',
  }),
  ja: Object.freeze({
    eyebrow: '経路のご案内',
    title: 'ページが見つかりません',
    subtitle: 'お探しのページは存在しないか、別の場所へ移動しました。',
    description: 'CocoTripで該当ページが見つかりませんでした。',
    home: 'ホームへ戻る',
    tours: 'ツアーを見る',
    charter: 'チャーター車両',
    recoveryLabel: '次の移動先',
    languageLabel: '言語',
    headerLabel: '韓国旅行コンシェルジュ',
    footerLabel: '韓国旅行プランニング',
  }),
  zh: Object.freeze({
    eyebrow: '页面导航',
    title: '页面未找到',
    subtitle: '您查找的页面不存在，或已移至其他地址。',
    description: '在CocoTrip上未找到您请求的页面。',
    home: '返回首页',
    tours: '浏览旅游',
    charter: '查看包车',
    recoveryLabel: '选择下一步',
    languageLabel: '语言',
    headerLabel: '韩国旅行礼宾服务',
    footerLabel: '韩国旅行规划',
  }),
});

export const NOT_FOUND_EDITORIAL_CSS = `
body.not-found-standalone {
  margin: 0;
  min-height: 100vh;
  display: grid;
  grid-template-rows: auto 1fr auto;
  background: #F3F1EC;
  color: #14141A;
  font-family: Inter, Pretendard, "Noto Sans KR", "Noto Sans JP", "Noto Sans SC", system-ui, -apple-system, "Segoe UI", sans-serif;
}

.not-found-standalone *,
.not-found-editorial,
.not-found-editorial * {
  box-sizing: border-box;
}

.not-found-standalone__header,
.not-found-standalone__footer {
  width: 100%;
  padding-inline: clamp(20px, 5vw, 72px);
  background: #FFFFFF;
}

.not-found-standalone__header {
  min-height: 72px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid #DFDACF;
}

.not-found-standalone__brand {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: #14141A;
  font-size: 18px;
  font-weight: 750;
  text-decoration: none;
}

.not-found-standalone__brand img {
  width: 32px;
  height: 32px;
  border-radius: 8px;
}

.not-found-standalone__header-label,
.not-found-standalone__footer {
  color: #63636E;
  font-size: 13px;
  letter-spacing: 0.04em;
}

.not-found-standalone__footer {
  min-height: 64px;
  display: flex;
  align-items: center;
  border-top: 1px solid #DFDACF;
}

.not-found-editorial {
  width: 100%;
  min-height: calc(100svh - 200px);
  display: grid;
  place-items: center;
  padding: clamp(48px, 9vw, 128px) clamp(20px, 5vw, 72px);
  background: #F3F1EC;
  background-image: none;
  color: #14141A;
}

.not-found-editorial--app {
  min-height: calc(100svh - 168px);
}

.not-found-editorial__document {
  width: min(100%, 1080px);
  display: grid;
  gap: 32px;
  padding-block: clamp(28px, 5vw, 56px);
  border-top: 1px solid #BEB8AC;
  border-bottom: 1px solid #BEB8AC;
}

.not-found-editorial__index {
  display: grid;
  align-content: space-between;
  gap: 28px;
}

.not-found-editorial__eyebrow {
  margin: 0;
  color: #4E4E59;
  font-size: 12px;
  font-weight: 750;
  letter-spacing: 0.16em;
  line-height: 1.4;
  text-transform: uppercase;
}

.not-found-editorial__figure {
  color: #7B7B86;
  font-size: clamp(72px, 18vw, 168px);
  font-weight: 650;
  letter-spacing: -0.065em;
  line-height: 0.8;
}

.not-found-editorial__content {
  display: grid;
  align-content: center;
  gap: 20px;
}

.not-found-editorial__title {
  max-width: 720px;
  margin: 0;
  color: #14141A;
  font-family: Georgia, "Times New Roman", "Noto Serif KR", "Noto Serif JP", "Noto Serif SC", serif;
  font-size: clamp(34px, 6vw, 68px);
  font-weight: 600;
  letter-spacing: -0.035em;
  line-height: 1.02;
}

.not-found-editorial__body {
  max-width: 620px;
  margin: 0;
  color: #4E4E59;
  font-size: clamp(16px, 2vw, 19px);
  line-height: 1.7;
}

.not-found-editorial__actions {
  display: grid;
  gap: 8px;
  margin-top: 8px;
}

.not-found-editorial__action,
.not-found-editorial__language {
  min-width: 44px;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #BEB8AC;
  border-radius: 4px;
  background: #FFFFFF;
  color: #14141A;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.3;
  text-align: center;
  text-decoration: none;
  transition: background-color 180ms ease, border-color 180ms ease, color 180ms ease;
}

.not-found-editorial__action {
  padding: 11px 18px;
}

.not-found-editorial__action--primary {
  border-color: #5326D6;
  background: #5326D6;
  color: #FFFFFF;
}

.not-found-editorial__action:hover,
.not-found-editorial__language:hover {
  border-color: #5326D6;
}

.not-found-editorial__action--primary:hover {
  border-color: #4B21C9;
  background: #4B21C9;
}

.not-found-editorial__action:focus-visible,
.not-found-editorial__language:focus-visible,
.not-found-standalone__brand:focus-visible,
.refined .not-found-editorial :where(a, button):focus-visible {
  outline: 3px solid #14141A;
  outline-offset: 3px;
  box-shadow: none;
}

.not-found-editorial__languages {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}

.not-found-editorial__language {
  padding: 8px 10px;
  color: #4E4E59;
}

.not-found-editorial__language[aria-current="page"] {
  border-color: #14141A;
  background: #14141A;
  color: #FFFFFF;
}

.not-found-editorial:lang(ko) {
  word-break: keep-all;
  overflow-wrap: break-word;
}

@media (min-width: 640px) {
  .not-found-editorial__actions {
    display: flex;
    flex-wrap: wrap;
  }
}

@media (min-width: 768px) {
  .not-found-editorial__document {
    grid-template-columns: minmax(180px, 0.65fr) minmax(0, 1.35fr);
    gap: clamp(40px, 7vw, 96px);
  }

  .not-found-editorial__content {
    padding-left: clamp(32px, 5vw, 72px);
    border-left: 1px solid #DFDACF;
  }
}

@media (max-width: 639px) {
  .not-found-standalone__header-label {
    display: none;
  }

  .not-found-editorial__action {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .not-found-editorial__action,
  .not-found-editorial__language {
    transition-duration: 0.01ms;
  }
}
`;

export function resolveNotFoundLanguage(value) {
  const normalized = String(value || '').trim().toLowerCase().split('-')[0];
  return NOT_FOUND_LANGUAGES.includes(normalized) ? normalized : 'en';
}

export function resolveNotFoundRequestLanguage(request) {
  const rawQuery = request && request.query ? request.query.lang : '';
  const queryLanguage = Array.isArray(rawQuery) ? rawQuery[0] : rawQuery;
  if (queryLanguage && NOT_FOUND_LANGUAGES.includes(String(queryLanguage).toLowerCase())) {
    return resolveNotFoundLanguage(queryLanguage);
  }

  const acceptLanguage = String(request && request.headers ? request.headers['accept-language'] || '' : '').toLowerCase();
  for (const entry of acceptLanguage.split(',')) {
    const candidate = entry.trim().split(';')[0].split('-')[0];
    if (candidate === 'ja' || candidate === 'zh' || candidate === 'en') return candidate;
  }
  return 'en';
}

export function renderNotFoundHtml(languageValue) {
  const language = resolveNotFoundLanguage(languageValue);
  const copy = NOT_FOUND_COPY[language] || NOT_FOUND_COPY.en;
  const languageLinks = NOT_FOUND_LANGUAGES.map((item) => (
    `<a class="not-found-editorial__language" data-language-link href="?lang=${item}"${item === language ? ' aria-current="page"' : ''}>${item.toUpperCase()}</a>`
  )).join('');

  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<meta name="description" content="${copy.description}" />
<title>${copy.title} | CocoTrip</title>
<style>${NOT_FOUND_EDITORIAL_CSS}</style>
</head>
<body class="not-found-standalone">
<header class="not-found-standalone__header">
  <a class="not-found-standalone__brand" href="/" aria-label="CocoTrip — ${copy.home}">
    <img src="/icons/icon-192.png" alt="" aria-hidden="true" width="32" height="32" />
    <span>CocoTrip</span>
  </a>
  <span class="not-found-standalone__header-label">${copy.headerLabel}</span>
</header>
<main class="not-found-editorial not-found-editorial--standalone" data-testid="not-found-server" aria-labelledby="not-found-title">
  <section class="not-found-editorial__document">
    <div class="not-found-editorial__index">
      <p class="not-found-editorial__eyebrow">${copy.eyebrow}</p>
      <div class="not-found-editorial__figure" aria-hidden="true">404</div>
    </div>
    <div class="not-found-editorial__content">
      <h1 class="not-found-editorial__title" id="not-found-title">${copy.title}</h1>
      <p class="not-found-editorial__body">${copy.subtitle}</p>
      <nav class="not-found-editorial__actions" aria-label="${copy.recoveryLabel}">
        <a class="not-found-editorial__action not-found-editorial__action--primary" data-recovery-link href="/">${copy.home}</a>
        <a class="not-found-editorial__action" data-recovery-link href="/tours">${copy.tours}</a>
        <a class="not-found-editorial__action" data-recovery-link href="/charter">${copy.charter}</a>
      </nav>
      <nav class="not-found-editorial__languages" aria-label="${copy.languageLabel}">${languageLinks}</nav>
    </div>
  </section>
</main>
<footer class="not-found-standalone__footer">CocoTrip · ${copy.footerLabel}</footer>
</body>
</html>
`;
}
