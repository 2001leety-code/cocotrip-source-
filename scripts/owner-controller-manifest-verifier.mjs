import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ANDROID = 'http://schemas.android.com/apk/res/android:';
const MANAGE_ACTIVITY = 'com.google.androidbrowserhelper.trusted.ManageDataLauncherActivity';
const MANAGE_URL_KEY = 'android.support.customtabs.trusted.MANAGE_SPACE_URL';
const POST_NOTIFICATIONS = 'android.permission.POST_NOTIFICATIONS';
const NOTIFICATION_ACTIVITY = 'com.google.androidbrowserhelper.trusted.NotificationPermissionRequestActivity';
const DELEGATION_SERVICE = 'com.google.androidbrowserhelper.trusted.DelegationService';
const DELEGATION_ACTION = 'android.support.customtabs.trusted.TRUSTED_WEB_ACTIVITY_SERVICE';

// Parse aapt2's compiled XML tree, not the source Manifest. Attributes must belong
// to the right element; a sibling activity's exported flag or metadata cannot pass.
function parseTree(dump) {
  const roots = [];
  const stack = [];
  for (const line of String(dump || '').split(/\r?\n/)) {
    const element = line.match(/^(\s*)E: ([\w-]+)(?: \(line=\d+\))?\s*$/);
    const attribute = line.match(/^(\s*)A: ([^=]+)=(.*)$/);
    if (!element && !attribute) continue;
    const indent = (element || attribute)[1].length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1];
    if (element) {
      const node = { name: element[2], indent, attributes: new Map(), children: [] };
      (parent ? parent.children : roots).push(node);
      stack.push(node);
    } else {
      if (!parent) throw new Error('Attribute without an element');
      const name = attribute[2].replace(/\(0x[\da-f]+\)\s*$/i, '');
      if (parent.attributes.has(name)) throw new Error('Duplicate attribute');
      const raw = attribute[3].trim();
      const quoted = raw.match(/^"([^"\\]*)"(?: \(Raw: "[^"\\]*"\))?$/);
      parent.attributes.set(name, quoted ? quoted[1] : raw);
    }
  }
  return roots;
}

// Inspect the compiled hierarchy: a name on a sibling or alias is not evidence.
// The exported ABH service verifies the calling browser with its TokenStore.
function verifyNotificationComponents(manifest, application) {
  const named = (parent, type, name) => parent.children.filter((node) => node.name === type
    && node.attributes.get(`${ANDROID}name`) === name);
  const enabled = (node) => !node.attributes.has(`${ANDROID}enabled`)
    || node.attributes.get(`${ANDROID}enabled`) === 'true';
  const launchers = named(application, 'activity', 'com.cocotrip.owner.OwnerLauncherActivity');
  if (launchers.length !== 1) return { ok: false, reason: 'APK requires exactly one owner launcher activity' };
  const browserMetadata = [
    ['android.support.customtabs.trusted.LAUNCHING_BROWSER', 'com.android.chrome'],
    ['android.support.customtabs.trusted.LAUNCHING_BROWSER_NAME', 'Chrome'],
  ];
  for (const [name, value] of browserMetadata) {
    const metadata = named(launchers[0], 'meta-data', name);
    if (metadata.length !== 1 || metadata[0].attributes.get(`${ANDROID}value`) !== value
      || metadata[0].attributes.has(`${ANDROID}resource`)) {
      return { ok: false, reason: 'APK requires the app-scoped Chrome notification provider on its launcher' };
    }
  }
  const permissions = named(manifest, 'uses-permission', POST_NOTIFICATIONS);
  if (permissions.length !== 1 || permissions[0].attributes.has(`${ANDROID}maxSdkVersion`)) {
    return { ok: false, reason: 'APK requires POST_NOTIFICATIONS without an SDK cap' };
  }
  const activities = named(application, 'activity', NOTIFICATION_ACTIVITY);
  if (activities.length !== 1 || activities[0].attributes.get(`${ANDROID}exported`) !== 'false'
    || !enabled(activities[0]) || activities[0].children.some((node) => node.name === 'intent-filter')
    || application.children.some((node) => node.name === 'activity-alias'
      && (node.attributes.get(`${ANDROID}name`) === NOTIFICATION_ACTIVITY
        || node.attributes.get(`${ANDROID}targetActivity`) === NOTIFICATION_ACTIVITY))) {
    return { ok: false, reason: 'APK requires a private, enabled notification permission activity without aliases or intent filters' };
  }
  const services = named(application, 'service', DELEGATION_SERVICE);
  if (services.length !== 1 || services[0].attributes.get(`${ANDROID}exported`) !== 'true'
    || !enabled(services[0]) || services[0].attributes.has(`${ANDROID}permission`)) {
    return { ok: false, reason: 'APK requires the enabled ABH notification service with verified-browser binding' };
  }
  const filters = services[0].children.filter((node) => node.name === 'intent-filter');
  if (filters.length !== 1 || filters[0].children.length !== 2
    || named(filters[0], 'action', DELEGATION_ACTION).length !== 1
    || named(filters[0], 'category', 'android.intent.category.DEFAULT').length !== 1) {
    return { ok: false, reason: 'APK requires the exact trusted notification service intent filter' };
  }
  return { ok: true, reason: 'APK includes notification permission, private request activity and verified-browser delegation service' };
}

export function verifyOwnerManifestDump(dump) {
  try {
    const roots = parseTree(dump);
    const manifest = roots[0];
    if (roots.length !== 1 || manifest.name !== 'manifest'
      || manifest.attributes.get('package') !== 'com.cocotrip.owner') {
      return { ok: false, reason: 'Owner APK manifest/package missing or invalid' };
    }
    const applications = manifest.children.filter((node) => node.name === 'application');
    if (applications.length !== 1) return { ok: false, reason: 'APK application missing or duplicated' };
    const activities = applications[0].children.filter((node) => node.name === 'activity'
      && node.attributes.get(`${ANDROID}name`) === MANAGE_ACTIVITY);
    if (activities.length !== 1) return { ok: false, reason: 'ManageDataLauncherActivity missing or duplicated in APK' };
    const activity = activities[0];
    if (activity.attributes.get(`${ANDROID}exported`) !== 'false'
      || (activity.attributes.has(`${ANDROID}enabled`) && activity.attributes.get(`${ANDROID}enabled`) !== 'true')
      || activity.children.some((node) => node.name === 'intent-filter')) {
      return { ok: false, reason: 'ManageDataLauncherActivity must be private, enabled and without intent filters in APK' };
    }
    const metadata = activity.children.filter((node) => node.name === 'meta-data'
      && node.attributes.get(`${ANDROID}name`) === MANAGE_URL_KEY);
    if (metadata.length !== 1 || metadata[0].attributes.get(`${ANDROID}value`) !== 'https://cocotripkr.com'
      || metadata[0].attributes.has(`${ANDROID}resource`)) {
      return { ok: false, reason: 'ManageDataLauncherActivity must have the fixed production origin in APK' };
    }
    return verifyNotificationComponents(manifest, applications[0]);
  } catch {
    return { ok: false, reason: 'Compiled APK manifest could not be parsed safely' };
  }
}

export function verifyOwnerApkManifest({ aapt2, apkPath, env = process.env, spawn = spawnSync } = {}) {
  if (!aapt2 || !apkPath) return { ok: false, reason: 'aapt2 and APK paths are required' };
  try {
    const result = spawn(aapt2, ['dump', 'xmltree', apkPath, '--file', 'AndroidManifest.xml'], {
      encoding: 'utf8', env: { ...env, LC_ALL: 'C', LANG: 'C' }, windowsHide: true, shell: false,
    });
    if (result.status !== 0 || result.error) return { ok: false, reason: 'aapt2 could not inspect the compiled APK manifest' };
    return verifyOwnerManifestDump(result.stdout);
  } catch {
    return { ok: false, reason: 'aapt2 could not inspect the compiled APK manifest' };
  }
}

// Unsigned CI builds use this entry point; no keystore, credentials or network.
export function main(argv = process.argv, { verify = verifyOwnerApkManifest, log = console.log } = {}) {
  const args = argv.slice(2);
  if (args.length !== 4 || args[0] !== '--aapt2' || args[2] !== '--apk') {
    log('FAIL: usage: node scripts/owner-controller-manifest-verifier.mjs --aapt2 <path> --apk <path>');
    return 1;
  }
  const result = verify({ aapt2: args[1], apkPath: args[3] });
  log(`${result.ok ? 'PASS' : 'FAIL'}: ${result.reason}`);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
