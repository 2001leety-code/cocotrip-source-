#!/usr/bin/env node
/**
 * Mechanical, offline derivatives of the existing public photos. No new imagery,
 * network requests, original replacement, or npm/lockfile changes.
 * Run: node scripts/build-responsive-tour-images.mjs --sharp-module=<local sharp module>
 * Without that option an already installed local sharp is used. Generated files
 * are committed; this script is NOT a build/deploy hook. --check verifies bytes.
 * --reuse-existing resumes interrupted generation from recipe-hashed filenames.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = resolve(root, 'public');
const outputRoot = resolve(publicRoot, 'responsive-tour-images');
const manifestPath = resolve(root, 'scripts/responsive-tour-image-manifest.json');
const browserManifestPath = resolve(root, 'src/data/responsiveTourImages.json');
const brandManifestPath = resolve(root, 'src/data/responsiveBrandMark.json');
const sources = JSON.parse(readFileSync(resolve(root, 'scripts/responsive-tour-image-sources.json'), 'utf8'));
const widths = [128, 192, 256, 384, 512, 768, 1024, 1280];
const recipe = { version: 1, format: 'webp', quality: 80, effort: 6, kernel: 'lanczos3', fit: 'inside', withoutEnlargement: true };
const avifRecipe = { version: 1, quality: 55, effort: 6, position: 'centre', chromaSubsampling: '4:4:4' };
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function inside(base, path) {
  const rel = relative(base, path);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('IMAGE_PATH_OUTSIDE_ALLOWED_DIRECTORY');
  return path;
}

const options = process.argv.slice(2);
if (options.some((option) => !['--check', '--reuse-existing'].includes(option) && !option.startsWith('--sharp-module='))) throw new Error('UNKNOWN_IMAGE_TOOL_OPTION');
const sharpPath = options.find((option) => option.startsWith('--sharp-module='))?.slice('--sharp-module='.length);
const sharp = require(sharpPath || 'sharp');
sharp.cache(false);
sharp.concurrency(1);
const check = options.includes('--check');
const reuseExisting = options.includes('--reuse-existing') && !check;
async function encodeOrResume(target, encode) {
  if (!reuseExisting || !existsSync(target)) return encode();
  const data = readFileSync(target);
  const info = await sharp(data).metadata();
  if (!info.width || !info.height || !['avif', 'heif', 'webp'].includes(info.format)) throw new Error('INVALID_RESUMED_IMAGE');
  return { data, info };
}
const manifest = { recipe, encoder: { sharp: sharp.versions.sharp, vips: sharp.versions.vips, webp: sharp.versions.webp }, avifRecipe, images: {} };
let originalBytes = 0;
let generatedBytes = 0;
let generatedCount = 0;

for (const spec of sources) {
  if (typeof spec.source !== 'string' || !spec.source.startsWith('/') || spec.source.includes('\\')
    || !/^[a-z0-9-]+$/.test(spec.name) || Object.hasOwn(manifest.images, spec.source)) throw new Error('INVALID_IMAGE_SOURCE');
  const sourcePath = inside(publicRoot, resolve(publicRoot, `.${spec.source}`));
  const source = readFileSync(sourcePath);
  const metadata = await sharp(source).metadata();
  if (!metadata.width || !metadata.height || (metadata.pages || 1) !== 1) throw new Error('STATIC_IMAGE_REQUIRED');
  const rotated = [5, 6, 7, 8].includes(metadata.orientation);
  const sourceWidth = rotated ? metadata.height : metadata.width;
  const sourceHeight = rotated ? metadata.width : metadata.height;
  const sourceHash = hash(source);
  const token = hash(JSON.stringify({ sourceHash, recipe, encoder: manifest.encoder })).slice(0, 12);
  const targets = [...new Set((spec.widths || widths).map((width) => Math.min(width, sourceWidth)))].sort((a, b) => a - b);
  const variants = [];
  for (const width of targets) {
    if (!Number.isSafeInteger(width) || width <= 0) throw new Error('INVALID_IMAGE_WIDTH');
    const filename = `${spec.name}-${token}-${width}.webp`;
    const target = inside(outputRoot, resolve(outputRoot, filename));
    const { data, info } = await encodeOrResume(target, () => sharp(source).rotate()
      .resize({ width, fit: recipe.fit, withoutEnlargement: recipe.withoutEnlargement, kernel: recipe.kernel })
      .webp({ quality: recipe.quality, effort: recipe.effort }).toBuffer({ resolveWithObject: true }));
    if (info.width !== width || info.height < 1 || info.width > sourceWidth || info.height > sourceHeight) throw new Error('IMAGE_DIMENSION_MISMATCH');
    if (check) {
      if (!existsSync(target) || !readFileSync(target).equals(data)) throw new Error(`IMAGE_REGENERATION_MISMATCH: ${filename}`);
    } else {
      mkdirSync(outputRoot, { recursive: true });
      writeFileSync(target, data);
    }
    variants.push({ width: info.width, height: info.height, src: `/responsive-tour-images/${filename}`, bytes: data.length, sha256: hash(data) });
    generatedBytes += data.length;
    generatedCount++;
  }
  const avif = {};
  if (spec.name !== 'cocotrip-mark') {
    const profiles = { original: null };
    // These crops remove only pixels already hidden by the existing centered
    // object-cover frames. Narrow layouts retain the uncropped original profile.
    if (spec.source === '/hero-banpo.webp' || !spec.source.startsWith('/city-thumbs/') && !['seoul-region', 'busan-region', 'gyeongju-region', 'danyang-region'].includes(spec.name)) profiles.wide = 2;
    if (['seoul-region', 'busan-region', 'gyeongju-region', 'danyang-region'].includes(spec.name)) profiles.region = Math.max(4 / 3, sourceWidth / sourceHeight);
    for (const [profile, ratio] of Object.entries(profiles)) {
      const avifToken = hash(JSON.stringify({ sourceHash, avifRecipe, profile, ratio, encoder: manifest.encoder })).slice(0, 12);
      avif[profile] = [];
      const avifWidths = [...new Set([128, 192, 256, 360, 480, 512, 768, 1024, 1280].map((width) => Math.min(width, sourceWidth)))].sort((a, b) => a - b);
      for (const width of avifWidths) {
        const filename = `${spec.name}-${avifToken}-${profile}-${width}.avif`;
        const target = inside(outputRoot, resolve(outputRoot, filename));
        const { data, info } = await encodeOrResume(target, () => sharp(source).rotate().resize({ width,
          ...(ratio ? { height: Math.round(width / ratio), fit: 'cover', position: 'centre' } : { fit: 'inside' }),
          withoutEnlargement: true, kernel: recipe.kernel,
        }).avif({ quality: avifRecipe.quality, effort: avifRecipe.effort, chromaSubsampling: avifRecipe.chromaSubsampling }).toBuffer({ resolveWithObject: true }));
        if (info.width !== width || Math.abs(info.height - width / (ratio || sourceWidth / sourceHeight)) > 1) throw new Error('AVIF_DIMENSION_MISMATCH');
        if (check) {
          if (!existsSync(target) || !readFileSync(target).equals(data)) throw new Error(`AVIF_REGENERATION_MISMATCH: ${filename}`);
        } else writeFileSync(target, data);
        avif[profile].push({ width: info.width, height: info.height, src: `/responsive-tour-images/${filename}`, bytes: data.length, sha256: hash(data) });
        generatedBytes += data.length;
        generatedCount++;
      }
    }
  }
  // Recheck originals after generation, not just before it. Originals are never written.
  if (hash(readFileSync(sourcePath)) !== sourceHash) throw new Error('ORIGINAL_IMAGE_CHANGED');
  manifest.images[spec.source] = { width: sourceWidth, height: sourceHeight, bytes: source.length, sha256: sourceHash, variants, avif };
  originalBytes += source.length;
}
const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
// Only the URL/width map enters the browser bundle. Hashes, byte accounting and
// generation provenance stay in this offline tooling manifest.
const browserManifest = { images: Object.fromEntries(Object.entries(manifest.images).map(([source, entry]) => [source,
  { variants: entry.variants.map(({ width, src }) => ({ width, src })),
    avif: Object.fromEntries(Object.entries(entry.avif).map(([profile, variants]) => [profile, variants.map(({ width, src }) => ({ width, src }))])) }])) };
const browserSerialized = `${JSON.stringify(browserManifest, null, 2)}\n`;
// Header is shared by every route; it must not pull in the tour photo URL map.
const brandSerialized = `${JSON.stringify({ variants: browserManifest.images['/icons/icon-192.png'].variants }, null, 2)}\n`;
if (check) {
  if (readFileSync(manifestPath, 'utf8') !== serialized) throw new Error('IMAGE_MANIFEST_REGENERATION_MISMATCH');
  if (readFileSync(browserManifestPath, 'utf8') !== browserSerialized) throw new Error('BROWSER_IMAGE_MANIFEST_REGENERATION_MISMATCH');
  if (readFileSync(brandManifestPath, 'utf8') !== brandSerialized) throw new Error('BRAND_IMAGE_MANIFEST_REGENERATION_MISMATCH');
} else {
  writeFileSync(manifestPath, serialized);
  writeFileSync(browserManifestPath, browserSerialized);
  writeFileSync(brandManifestPath, brandSerialized);
}
console.log(JSON.stringify({ checked: check, sourceCount: sources.length, generatedCount, originalBytes, generatedBytes, encoder: manifest.encoder }));
