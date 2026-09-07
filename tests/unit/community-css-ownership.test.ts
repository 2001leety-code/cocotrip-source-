import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import loadTailwindConfig from 'tailwindcss/loadConfig';
import resolveTailwindConfig from 'tailwindcss/resolveConfig';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sourceRoot = join(root, 'src');
const read = (path: string) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const indexCss = read('src/index.css');
const communityCss = read('src/styles/editorial-community.css');
const editorialMarker = '/* Community public shell — editorial migration layer.';
const editorialStart = communityCss.indexOf(editorialMarker);
const compatibilityMarker = '/* Community lazy CSS compatibility';
const compatibilityStart = communityCss.indexOf(compatibilityMarker);
const touchMarker = '/* Community moderation touch targets';
const touchStart = communityCss.indexOf(touchMarker);
const baseCss = communityCss.slice(0, editorialStart);
const editorialCss = communityCss.slice(editorialStart, compatibilityStart).replace(/\n$/, '');
const compatibilityCss = communityCss.slice(compatibilityStart, touchStart);
const touchCss = communityCss.slice(touchStart);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

const sourceFiles = filesUnder(sourceRoot);
const relevantModules = sourceFiles
  .filter((path) => /\.[jt]sx?$/.test(path))
  .map((path) => ({ path, text: readFileSync(path, 'utf8') }))
  .filter(({ text }) => /CommunityPage|editorial-community\.css|community-/.test(text))
  .map(({ path, text }) => ({
    path: relative(sourceRoot, path).replace(/\\/g, '/'),
    ast: ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true),
  }));

function visit(node: ts.Node, callback: (node: ts.Node) => void) {
  callback(node);
  node.forEachChild((child) => visit(child, callback));
}

const app = relevantModules.find(({ path }) => path === 'App.tsx')!.ast;
const routes = [
  ['/community', 'CommunityPage'],
  ['/community/post/:postId', 'CommunityPostPage'],
  ['/community/new', 'CommunityComposePage'],
  ['/admin/community', 'CommunityModerationPage'],
] as const;

describe('community CSS belongs to its lazy route module', () => {
  it('preserves the complete base block and existing editorial overrides in that order', () => {
    expect(communityCss.startsWith('/* CocoTrip Community design shell')).toBe(true);
    expect(editorialStart).toBeGreaterThan(0);
    expect(compatibilityStart).toBeGreaterThan(editorialStart);
    expect(touchStart).toBeGreaterThan(compatibilityStart);
    // Migration baseline: be5f3825 src/index.css:855–2646, including admin and reduced motion.
    // Normalize line endings only. Deliberate future community style changes must review these baselines.
    expect(Buffer.byteLength(baseCss)).toBe(35_900);
    expect(hash(baseCss)).toBe('0940c6d7a1ff889bb8e1f36bbeb525206e9bfe1d3bd23523a647c24365fd4895');
    expect(hash(editorialCss)).toBe('91c45e41c267ffdd3d25e4a05e142f40862ceb369c77b7e11eebeddbd3c9cf5b');
  });

  it('enlarges only the three measured moderation control classes to at least 44px', () => {
    const rules: Array<{ selectors: string[]; declarations: string[] }> = [];
    const css = postcss.parse(touchCss);
    css.walkRules((rule) => {
      const declarations: string[] = [];
      rule.walkDecls((declaration) => { declarations.push(`${declaration.prop}:${declaration.value}`); });
      rules.push({ selectors: rule.selectors, declarations });
    });
    expect(rules).toEqual([{
      selectors: [
        '.community-moderation-app .community-brand',
        '.community-moderation-app .community-secondary-button',
        '.community-moderation-app .community-danger-button',
      ],
      declarations: ['min-width:44px', 'min-height:44px'],
    }]);
    expect(css.nodes.filter((node) => node.type === 'atrule')).toEqual([]);
  });

  it('preserves Tailwind md:hidden only for the existing community header icon button', () => {
    const md = resolveTailwindConfig(loadTailwindConfig(join(root, 'tailwind.config.js'))).theme.screens.md;
    expect(md).toBe('768px');
    const rules: Array<{ selector: string; declarations: string[]; media: string }> = [];
    const css = postcss.parse(compatibilityCss);
    css.walkRules((rule) => {
      const declarations: string[] = [];
      rule.walkDecls((declaration) => { declarations.push(`${declaration.prop}:${declaration.value}`); });
      const parent = rule.parent;
      rules.push({ selector: rule.selector, declarations, media: parent?.type === 'atrule' ? parent.params : '' });
    });
    expect(rules).toEqual([{
      selector: '.community-app .community-header .community-icon-button.md\\:hidden',
      declarations: ['display:none'],
      media: `(min-width: ${md})`,
    }]);
  });

  it('does not leave community rules in the initial global CSS', () => {
    const selectors: string[] = [];
    postcss.parse(indexCss).walkRules((rule) => { selectors.push(...rule.selectors); });
    expect(selectors.filter((selector) => selector.includes('.community-'))).toEqual([]);
    expect(read('src/main.tsx')).toContain("import './index.css'");
  });

  it('keeps every moved selector scoped to community, including its separate admin shell', () => {
    const selectors: string[] = [];
    const media: string[] = [];
    const css = postcss.parse(baseCss);
    css.walkRules((rule) => { selectors.push(...rule.selectors); });
    css.walkAtRules('media', (rule) => { media.push(rule.params); });
    expect(selectors.length).toBeGreaterThan(286);
    expect(selectors.filter((selector) => !selector.includes('.community-'))).toEqual([]);
    expect(selectors).toContain('.community-app');
    expect(selectors).toContain('.community-moderation-app');
    expect(media).toEqual([
      '(max-width: 1050px)', '(max-width: 767px)', '(max-width: 760px)', '(prefers-reduced-motion: reduce)',
    ]);
  });

  it('loads the complete stylesheet through CommunityPage only, with no eager page import', () => {
    const cssImporters: string[] = [];
    const eagerPageImporters: string[] = [];
    for (const { path, ast } of relevantModules) {
      visit(ast, (node) => {
        if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) return;
        const module = node.moduleSpecifier;
        if (!module || !ts.isStringLiteral(module)) return;
        if (module.text.endsWith('/editorial-community.css')) cssImporters.push(path);
        const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly : node.isTypeOnly;
        if (!typeOnly && /\/CommunityPage(?:\.tsx)?$/.test(module.text)) eagerPageImporters.push(path);
      });
    }
    expect(cssImporters).toEqual(['pages/CommunityPage.tsx']);
    expect(eagerPageImporters).toEqual([]);
    for (const path of sourceFiles.filter((file) => file.endsWith('.css'))) {
      postcss.parse(readFileSync(path, 'utf8')).walkAtRules('import', (rule) => {
        expect(rule.params, path).not.toContain('editorial-community');
      });
    }
  });

  it('keeps all community class consumers inside the CSS-owning page module', () => {
    const consumers = new Set<string>();
    for (const { path, ast } of relevantModules) {
      visit(ast, (node) => {
        if (!ts.isJsxAttribute(node) || node.name.getText(ast) !== 'className') return;
        if (node.initializer?.getText(ast).includes('community-')) consumers.add(path);
      });
    }
    expect([...consumers]).toEqual(['pages/CommunityPage.tsx']);
  });

  it.each(routes)('%s imports the CSS owner before rendering %s', (path, component) => {
    let lazyOwner = false;
    let routeElement = '';
    visit(app, (node) => {
      if (ts.isVariableDeclaration(node) && node.name.getText(app) === component) {
        const initializer = node.initializer;
        expect(initializer && ts.isCallExpression(initializer)).toBe(true);
        if (!initializer || !ts.isCallExpression(initializer)) return;
        expect(initializer.expression.getText(app)).toBe('lazy');
        visit(initializer, (child) => {
          if (!ts.isCallExpression(child) || child.expression.kind !== ts.SyntaxKind.ImportKeyword) return;
          const module = child.arguments[0];
          if (module && ts.isStringLiteral(module) && module.text === '@/pages/CommunityPage') lazyOwner = true;
        });
      }
      if (!ts.isJsxSelfClosingElement(node) || node.tagName.getText(app) !== 'Route') return;
      const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
      const routePath = attributes.find((attribute) => attribute.name.getText(app) === 'path')?.initializer;
      if (!routePath || !ts.isStringLiteral(routePath) || routePath.text !== path) return;
      routeElement = attributes.find((attribute) => attribute.name.getText(app) === 'element')?.initializer?.getText(app) || '';
    });
    expect(lazyOwner).toBe(true);
    expect(routeElement).toContain(`<${component}`);
    expect(routeElement).toContain('<Suspense');
    if (path.startsWith('/admin/')) expect(routeElement).toContain('<AdminRoute>');
  });
});
