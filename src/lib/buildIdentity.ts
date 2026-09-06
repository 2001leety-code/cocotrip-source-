const SAFE_COMMIT_SHA = /^[0-9a-f]{7,64}$/;
const NAVIGATION_TYPES = ['navigate', 'reload', 'back_forward', 'prerender'] as const;

export type BuildNavigationType = typeof NAVIGATION_TYPES[number] | 'unknown';

export function normalizeBuildIdentifier(value: string | undefined): string {
  const normalized = String(value || '').trim().toLowerCase();
  return SAFE_COMMIT_SHA.test(normalized) ? normalized : 'local';
}

export function resolveBuildIdentifier(env: Record<string, string | undefined>): string {
  return normalizeBuildIdentifier(env.VERCEL_GIT_COMMIT_SHA || env.GITHUB_SHA || 'local');
}

export function injectBuildIdentifierIntoHtml(html: string, buildIdentifier: string): string {
  const normalized = normalizeBuildIdentifier(buildIdentifier);
  const htmlWithData = /data-cocotrip-build="[^"]*"/i.test(html)
    ? html.replace(/data-cocotrip-build="[^"]*"/i, `data-cocotrip-build="${normalized}"`)
    : html.replace(/<html\b/i, `<html data-cocotrip-build="${normalized}"`);

  const htmlWithMeta = /<meta\s+name="cocotrip-build"/i.test(htmlWithData)
    ? htmlWithData.replace(
      /<meta\s+name="cocotrip-build"\s+content="[^"]*"\s*\/?\s*>/i,
      `<meta name="cocotrip-build" content="${normalized}">`,
    )
    : htmlWithData.replace(
      /<head>/i,
      `<head>\n    <meta name="cocotrip-build" content="${normalized}">`,
    );

  if (htmlWithMeta.includes('dataset.cocotripNavigation=value')) return htmlWithMeta;
  const navigationScript = `<script>(function(){var allowed=['navigate','reload','back_forward','prerender'];var value='unknown';try{var entry=performance.getEntriesByType('navigation')[0];var type=entry&&entry.type;value=allowed.indexOf(type)>=0?type:'unknown'}catch(error){}document.documentElement.dataset.cocotripNavigation=value})()</script>`;
  return htmlWithMeta.replace('</head>', `    ${navigationScript}\n  </head>`);
}

export function normalizeNavigationType(value: unknown): BuildNavigationType {
  return typeof value === 'string' && NAVIGATION_TYPES.includes(value as typeof NAVIGATION_TYPES[number])
    ? value as BuildNavigationType
    : 'unknown';
}

interface BuildMetaElement {
  name: string;
  content: string;
}

interface BuildIdentityDocument {
  documentElement: { dataset: { cocotripBuild?: string; cocotripNavigation?: string } };
  head: {
    querySelector(selector: string): BuildMetaElement | null;
    appendChild(node: BuildMetaElement): unknown;
  };
  createElement(tagName: string): BuildMetaElement;
}

interface NavigationPerformance {
  getEntriesByType(type: string): Array<{ type?: unknown }>;
}

export function exposeBuildIdentifier(target: unknown, buildIdentifier: string): void {
  const documentTarget = target as BuildIdentityDocument;
  const normalized = normalizeBuildIdentifier(buildIdentifier);
  documentTarget.documentElement.dataset.cocotripBuild = normalized;

  let meta = documentTarget.head.querySelector('meta[name="cocotrip-build"]');
  if (!meta) {
    meta = documentTarget.createElement('meta');
    meta.name = 'cocotrip-build';
    documentTarget.head.appendChild(meta);
  }
  meta.content = normalized;
}

export function exposeNavigationDiagnostic(target: unknown, performanceTarget: unknown): void {
  const documentTarget = target as BuildIdentityDocument;
  let navigationType: unknown;
  try {
    const entries = (performanceTarget as NavigationPerformance).getEntriesByType('navigation');
    navigationType = entries[0]?.type;
  } catch {
    navigationType = undefined;
  }
  documentTarget.documentElement.dataset.cocotripNavigation = normalizeNavigationType(navigationType);
}
