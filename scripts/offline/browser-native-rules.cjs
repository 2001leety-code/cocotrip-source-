'use strict';
// Pure argv/options validator for the two native executables of the browser capture profile.
// No I/O, no env, no execution, no network: guard.cjs hashes this file, requires it by a fixed
// path and calls validateNativeInvocation before a pinned chromium/ffmpeg launch. See BROWSER.md.
// Every expected argument below was read from the installed Playwright 1.62.1
// node_modules/playwright-core/lib/coreBundle.js; any other Playwright version must fail closed.
const win = require('path').win32;

const PLAYWRIGHT_VERSION = '1.62.1';

// coreBundle.js:34606 disabledFeatures, joined as chromiumSwitches() does.
const DISABLED_FEATURES = [
  'AvoidUnnecessaryBeforeUnloadCheckSync', 'BoundaryEventDispatchTracksNodeRemoval', 'DestroyProfileOnBrowserClose',
  'DialMediaRouteProvider', 'GlobalMediaControls', 'HttpsUpgrades', 'LensOverlay', 'MediaRouter', 'PaintHolding',
  'ThirdPartyStoragePartitioning', 'BlockOriginHeaderModificationOnRedirect', 'Translate', 'AutoDeElevate',
  'OptimizationHints', 'msForceBrowserSignIn', 'msEdgeUpdateLaunchServicesPreferredVersion',
].join(',');

// coreBundle.js:34639 chromiumSwitches() (PLAYWRIGHT_LEGACY_SCREENSHOT unset, not android).
const CHROMIUM_SWITCHES = [
  '--disable-field-trial-config', '--disable-background-networking', '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows', '--disable-back-forward-cache', '--disable-breakpad',
  '--disable-client-side-phishing-detection', '--disable-component-extensions-with-background-pages',
  '--disable-component-update', '--no-default-browser-check', '--disable-default-apps', '--disable-dev-shm-usage',
  '--disable-edgeupdater', '--disable-extensions', '--disable-features=' + DISABLED_FEATURES,
  '--enable-features=CDPScreenshotNewSurface', '--allow-pre-commit-input', '--disable-hang-monitor',
  '--disable-ipc-flooding-protection', '--disable-popup-blocking', '--disable-prompt-on-repost',
  '--disable-renderer-backgrounding', '--disable-updater-scheduler', '--force-color-profile=srgb',
  '--metrics-recording-only', '--no-first-run', '--password-store=basic', '--use-mock-keychain',
  '--no-service-autorun', '--export-tagged-pdf', '--disable-search-engine-choice-screen',
  '--unsafely-disable-devtools-self-xss-warnings', '--edge-skip-compat-layer-relaunch', '--disable-infobars',
  '--disable-search-engine-choice-screen', '--disable-sync',
];

// coreBundle.js:43066-43076 _innerDefaultArgs: headless, chromiumSandbox not set.
const HEADLESS_ARGS = [
  '--enable-unsafe-swiftshader', '--headless', '--hide-scrollbars', '--mute-audio',
  '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4',
  '--no-sandbox',
];

// customer-capture-20261017.mjs chromium.launch({ args }).
const HARNESS_ARGS = [
  '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-default-apps',
  '--disable-domain-reliability', '--no-pings', '--no-first-run', '--no-default-browser-check',
];

const DEAD_PROXY = '--proxy-server=http://127.0.0.1:9';
const USER_DATA_PREFIX = '--user-data-dir=';
// coreBundle.js:39508 mkdtemp(os.tmpdir(), 'playwright_chromiumdev_profile-'); TEMP = <runRoot>\tmp.
const USER_DATA_NAME = /^playwright_chromiumdev_profile-[A-Za-z0-9]{6}$/;

// customer-capture-20261017.mjs VIDEO_CELLS + HEIGHTS: recordVideo size per representative cell.
const VIDEO_SIZES = { '390-en': [390, 844], '1440-ko': [1440, 1000] };
// <runRoot>\capture\videos\<flow>\<width>-<lang>-<motion>\raw\<page guid>.webm (coreBundle.js:36792).
const VIDEO_REL = /^capture\\videos\\(home|planner|charter|tours)\\(390-en|1440-ko)-(no-preference|reduce)\\raw\\page@[0-9a-f]{32}\.webm$/;

// coreBundle.js:36869 FfmpegVideoRecorder._launch; -vf is the recorder's own default (36868):
// CRPage (37032) has no getFFmpegVideoFilterArgs, the scale filter at 41847 belongs to BidiPage.
function ffmpegArgs(w, h, output) {
  const vf = `pad=${w}:${h}:0:0:gray,crop=${w}:${h}:0:0`;
  return ['-loglevel', 'error', '-f', 'matroska', '-fpsprobesize', '0', '-probesize', '32', '-analyzeduration', '0',
    '-i', 'pipe:0', '-y', '-an', '-r', '25', '-c:v', 'vp8', '-qmin', '0', '-qmax', '50', '-crf', '8', '-deadline',
    'realtime', '-speed', '8', '-b:v', '1M', '-threads', '1', '-vf', vf, output];
}

// coreBundle.js:8899 launchProcess: stdio "pipe" (browser) vs anything else (ffmpeg "stdin").
const STDIO = { chromium: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'], ffmpeg: ['pipe', 'pipe', 'pipe'] };
const OPTION_KEYS = ['detached', 'env', 'cwd', 'shell', 'stdio'];

const fail = (reason) => ({ ok: false, reason });
const sameList = (a, b) => Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);

// Absolute drive path, backslashes only, no empty/./.. segments; compared case-insensitively.
function canonicalPath(p) {
  if (typeof p !== 'string' || !/^[A-Za-z]:\\[^\0/]+$/.test(p) || p.endsWith('\\')) return false;
  return p.slice(3).split('\\').every((s) => s !== '' && s !== '.' && s !== '..' && !/[<>:"|?*]/.test(s));
}

// Returns the path below root ('' if equal), or null when p is not inside root.
function relativeInside(root, p) {
  if (!canonicalPath(p)) return null;
  const r = root.toLowerCase();
  const q = p.toLowerCase();
  if (q === r) return '';
  return q.startsWith(r + '\\') ? p.slice(root.length + 1) : null;
}

function checkPolicy(policy) {
  if (!policy || typeof policy !== 'object') return 'policy missing';
  if (!canonicalPath(policy.runRoot)) return 'policy.runRoot is not a canonical absolute path';
  if (typeof policy.origin !== 'string' || !/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(policy.origin)) return 'policy.origin must be http://127.0.0.1:<port>';
  const port = Number(policy.origin.slice('http://127.0.0.1:'.length));
  if (port < 1024 || port > 65535) return 'policy.origin port out of range';
  for (const [key, exe] of [['browserPath', 'chrome-headless-shell.exe'], ['ffmpegPath', 'ffmpeg-win64.exe']]) {
    const p = policy[key];
    if (!canonicalPath(p) || win.basename(p).toLowerCase() !== exe) return `policy.${key} must be an absolute path to ${exe}`;
    if (relativeInside(policy.runRoot, p) !== null) return `policy.${key} must not be inside runRoot`;
  }
  return '';
}

// env is replaced by the guard with a rebuilt clean env; only its shape is checked here.
function checkOptions(kind, options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return 'options must be an object';
  for (const k of Object.keys(options)) if (OPTION_KEYS.indexOf(k) === -1) return 'unexpected option ' + k;
  if (options.detached !== false) return 'detached must be false (win32 launchProcess)';
  if (options.shell !== undefined && options.shell !== false) return 'shell is not allowed';
  if (options.cwd !== undefined) return 'cwd must be unset';
  if (options.env !== undefined && (!options.env || typeof options.env !== 'object' || Array.isArray(options.env))) return 'env must be an object';
  if (!sameList(options.stdio, STDIO[kind])) return 'stdio must be exactly ' + STDIO[kind].join(',');
  return '';
}

function checkChromium(argv, policy) {
  const port = policy.origin.slice('http://127.0.0.1:'.length);
  // Raw harness args (no launch proxy option, so Playwright adds no proxy flags of its own).
  // <-loopback> first removes Chromium's implicit loopback bypass; the exact origin last re-adds
  // only that host:port. Every other loopback port goes to the dead proxy.
  const expected = [...CHROMIUM_SWITCHES, ...HEADLESS_ARGS, DEAD_PROXY, `--proxy-bypass-list=<-loopback>;127.0.0.1:${port}`,
    ...HARNESS_ARGS, USER_DATA_PREFIX, '--remote-debugging-pipe', '--no-startup-window'];
  if (argv.length !== expected.length) return `chromium argv length ${argv.length}, expected ${expected.length}`;
  for (let i = 0; i < expected.length; i++) {
    if (expected[i] !== USER_DATA_PREFIX) {
      if (argv[i] !== expected[i]) return `chromium argv[${i}] unexpected`;
      continue;
    }
    if (argv[i].indexOf(USER_DATA_PREFIX) !== 0) return `chromium argv[${i}] is not --user-data-dir`;
    const dir = argv[i].slice(USER_DATA_PREFIX.length);
    const rel = relativeInside(policy.runRoot, dir);
    if (rel === null || win.dirname(rel).toLowerCase() !== 'tmp' || !USER_DATA_NAME.test(win.basename(rel))) {
      return 'chromium --user-data-dir must be a fresh playwright profile directly under <runRoot>\\tmp';
    }
  }
  return '';
}

function checkFfmpeg(argv, policy) {
  const output = argv[argv.length - 1];
  const rel = relativeInside(policy.runRoot, output);
  const m = rel === null ? null : VIDEO_REL.exec(rel);
  if (!m) return 'ffmpeg output must be <runRoot>\\capture\\videos\\<flow>\\<cell>-<motion>\\raw\\page@<guid>.webm';
  const [w, h] = VIDEO_SIZES[m[2]];
  if (!sameList(argv, ffmpegArgs(w, h, output))) return `ffmpeg argv differs from the ${w}x${h} pipe:0 -> webm recorder`;
  return '';
}

/**
 * kind: 'chromium' | 'ffmpeg'. argv: arguments after the executable. options: the spawn options
 * Playwright passed. policy: { runRoot, origin, browserPath, ffmpegPath } from the hashed guard
 * config. The executable path and its hash are checked by the guard, not here.
 */
function validateNativeInvocation(kind, argv, options, policy) {
  if (kind !== 'chromium' && kind !== 'ffmpeg') return fail('unknown kind');
  const policyProblem = checkPolicy(policy);
  if (policyProblem) return fail(policyProblem);
  if (!Array.isArray(argv) || argv.length === 0 || argv.some((a) => typeof a !== 'string' || a.indexOf('\0') !== -1)) {
    return fail('argv must be a non-empty array of strings');
  }
  const optionProblem = checkOptions(kind, options);
  if (optionProblem) return fail(optionProblem);
  const argProblem = kind === 'chromium' ? checkChromium(argv, policy) : checkFfmpeg(argv, policy);
  return argProblem ? fail(argProblem) : { ok: true };
}

module.exports = Object.freeze({ PLAYWRIGHT_VERSION, validateNativeInvocation });
