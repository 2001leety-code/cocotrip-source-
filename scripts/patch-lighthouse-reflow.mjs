import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const EXPECTED_LIGHTHOUSE_VERSION = '12.6.1';
const EXPECTED_HANDLER_SHA256 = '9f2a81d885a5102a27f5f41a6169e1ccfed919514376ef44f2ef7edf12621c71';

function replaceExactlyOnce(source, before, after) {
  const count = source.split(before).length - 1;
  assert.equal(count, 1, 'PATCH_ANCHOR_MISMATCH');
  return source.replace(before, after);
}

function warningCount(handler, warningName, events) {
  handler.reset();
  for (const event of events) handler.handleEvent(event);
  return [...(handler.data().perWarning.get(warningName) || [])].length;
}

function reflowTask({ pid = 1, tid = 10, start = 0, layouts = [35000], jsName = 'FunctionCall' } = {}) {
  const events = [
    { name: 'RunTask', pid, tid, ts: start, dur: 100000, args: {} },
    { name: jsName, pid, tid, ts: start + 1000, dur: 90000, args: {} },
  ];
  let time = start + 2000;
  for (const duration of layouts) {
    events.push({ name: 'UpdateLayoutTree', pid, tid, ts: time, dur: duration, args: {} });
    time += duration + 1000;
  }
  events.push({ name: 'RunTask', pid, tid, ts: start + 110000, dur: 1, args: {} });
  return events;
}

function crossThreadEvents({ backgroundPid = 1, backgroundTid = 20 } = {}) {
  return [
    { name: 'RunTask', pid: 1, tid: 10, ts: 0, dur: 100000, args: {} },
    { name: 'v8.parseOnBackground', pid: backgroundPid, tid: backgroundTid, ts: 1000, dur: 80000, args: {} },
    { name: 'UpdateLayoutTree', pid: 1, tid: 10, ts: 2000, dur: 35000, args: {} },
    { name: 'RunTask', pid: 1, tid: 10, ts: 200000, dur: 1, args: {} },
  ];
}

async function selfCheck(handler) {
  assert.equal(warningCount(handler, 'FORCED_REFLOW', crossThreadEvents()), 0, 'CROSS_THREAD_FALSE_POSITIVE');
  assert.equal(warningCount(handler, 'FORCED_REFLOW', reflowTask()), 1, 'SAME_THREAD_POSITIVE');
  assert.equal(warningCount(handler, 'FORCED_REFLOW', reflowTask({ layouts: [29999] })), 0, 'BELOW_THRESHOLD');
  assert.equal(warningCount(handler, 'FORCED_REFLOW', reflowTask({ layouts: [30000] })), 1, 'AT_THRESHOLD');
  assert.equal(warningCount(handler, 'FORCED_REFLOW', reflowTask({ layouts: [15000, 15000] })), 2, 'ACCUMULATED_THRESHOLD');
  assert.equal(warningCount(handler, 'FORCED_REFLOW', crossThreadEvents({ backgroundPid: 2, backgroundTid: 10 })), 0,
    'SAME_THREAD_ID_DIFFERENT_PROCESS');
  const twoTasks = [
    ...reflowTask(),
    ...reflowTask({ start: 200000, layouts: [32000] }),
  ];
  assert.equal(warningCount(handler, 'FORCED_REFLOW', twoTasks), 2, 'INDEPENDENT_TASKS');

  handler.reset();
  handler.handleEvent({ name: 'RunTask', pid: 1, tid: 10, ts: 0, dur: 100000, args: {} });
  handler.handleEvent({ name: 'FunctionCall', pid: 1, tid: 10, ts: 1000, dur: 90000, args: {} });
  handler.handleEvent({ name: 'UpdateLayoutTree', pid: 1, tid: 10, ts: 2000, dur: 35000, args: {} });
  await handler.finalize();
  assert.equal([...(handler.data().perWarning.get('FORCED_REFLOW') || [])].length, 1,
    'FINAL_PENDING_TASK_FLUSH');

  handler.reset();
  handler.handleEvent({ name: 'v8.parseOnBackground', pid: 1, tid: 10, ts: 0, dur: 80000, args: {} });
  handler.reset();
  const noJsMainThread = [
    { name: 'RunTask', pid: 1, tid: 10, ts: 0, dur: 100000, args: {} },
    { name: 'UpdateLayoutTree', pid: 1, tid: 10, ts: 2000, dur: 35000, args: {} },
    { name: 'RunTask', pid: 1, tid: 10, ts: 200000, dur: 1, args: {} },
  ];
  for (const event of noJsMainThread) handler.handleEvent(event);
  assert.equal([...(handler.data().perWarning.get('FORCED_REFLOW') || [])].length, 0, 'RESET_CLEARS_THREAD_STATE');

  handler.reset();
  handler.handleEvent({ name: 'RunTask', pid: 1, tid: 10, ts: 0, dur: 60000, args: {} });
  await handler.finalize();
  assert.equal([...(handler.data().perWarning.get('LONG_TASK') || [])].length, 1, 'LONG_TASK_UNCHANGED');

  handler.reset();
  handler.handleEvent({ name: 'FireIdleCallback', pid: 1, tid: 10, ts: 0, dur: 10000,
    args: { data: { allottedMilliseconds: 5 } } });
  assert.equal([...(handler.data().perWarning.get('IDLE_CALLBACK_OVER_TIME') || [])].length, 1,
    'OTHER_WARNING_UNCHANGED');
  handler.reset();
}

async function main() {
  assert.equal(process.argv.length, 3, 'EXPECTED_ONE_DISTRIBUTION_ROOT_ARGUMENT');
  const requestedRoot = path.resolve(process.argv[2]);
  const rootStat = await lstat(requestedRoot);
  assert.ok(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'DISTRIBUTION_ROOT_INVALID');
  const distributionRoot = await realpath(requestedRoot);
  const lighthousePackagePath = path.join(distributionRoot, 'node_modules/lighthouse/package.json');
  const lighthousePackage = JSON.parse(await readFile(lighthousePackagePath, 'utf8'));
  assert.equal(lighthousePackage.version, EXPECTED_LIGHTHOUSE_VERSION, 'LIGHTHOUSE_VERSION_MISMATCH');

  const handlerPath = path.join(distributionRoot,
    'node_modules/@paulirish/trace_engine/models/trace/handlers/WarningsHandler.js');
  const handlerRealPath = await realpath(handlerPath);
  const relativeHandlerPath = path.relative(distributionRoot, handlerRealPath);
  assert.ok(relativeHandlerPath && !relativeHandlerPath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativeHandlerPath), 'HANDLER_PATH_ESCAPES_DISTRIBUTION');
  const handlerStat = await lstat(handlerPath);
  assert.ok(handlerStat.isFile() && !handlerStat.isSymbolicLink(), 'HANDLER_FILE_INVALID');
  const original = await readFile(handlerPath, 'utf8');
  assert.equal(createHash('sha256').update(original).digest('hex'), EXPECTED_HANDLER_SHA256,
    'HANDLER_HASH_MISMATCH');

  const declarations = `const allEventsStack = [];
/**
 * Tracks the stack formed by JS invocation trace events up to a given point.
 * F.e. FunctionCall, EvaluateScript, V8Execute.
 * Not to be confused with ProfileCalls.
 */
const jsInvokeStack = [];
/**
 * Tracks reflow events in a task.
 */
const taskReflowEvents = [];`;
  let patched = replaceExactlyOnce(original, declarations, 'const taskStatesByThread = new Map();');
  patched = replaceExactlyOnce(patched, `    allEventsStack.length = 0;
    jsInvokeStack.length = 0;
    taskReflowEvents.length = 0;`, '    taskStatesByThread.clear();');
  patched = replaceExactlyOnce(patched, 'function processForcedReflowWarning(event) {\n', `function processForcedReflowWarning(event) {
    const threadKey = \`${'${event.pid}'}:${'${event.tid}'}\`;
    let taskState = taskStatesByThread.get(threadKey);
    if (!taskState) {
        taskState = { allEventsStack: [], jsInvokeStack: [], taskReflowEvents: [] };
        taskStatesByThread.set(threadKey, taskState);
    }
    const { allEventsStack, jsInvokeStack, taskReflowEvents } = taskState;
`);
  patched = replaceExactlyOnce(patched, 'export async function finalize() {\n', `export async function finalize() {
    for (const state of taskStatesByThread.values()) {
        const totalTime = state.taskReflowEvents.reduce((time, event) => time + (event.dur || 0), 0);
        if (totalTime >= FORCED_REFLOW_THRESHOLD) {
            state.taskReflowEvents.forEach(reflowEvent => storeWarning(reflowEvent, 'FORCED_REFLOW'));
        }
    }
    taskStatesByThread.clear();
`);

  const current = await readFile(handlerPath, 'utf8');
  assert.equal(createHash('sha256').update(current).digest('hex'), EXPECTED_HANDLER_SHA256,
    'HANDLER_CHANGED_DURING_PATCH');
  await writeFile(handlerPath, patched);

  const handler = await import(pathToFileURL(handlerPath).href);
  await selfCheck(handler);
  process.stdout.write('LIGHTHOUSE_REFLOW_THREAD_ISOLATION_PASS\n');
}

main().catch((error) => {
  const firstLine = typeof error?.message === 'string' ? error.message.split('\n')[0] : '';
  const message = /^[A-Z0-9_]+$/.test(firstLine) ? firstLine : 'PATCH_OR_SELF_CHECK_FAILED';
  process.stderr.write(`LIGHTHOUSE_REFLOW_THREAD_ISOLATION_FAIL ${message}\n`);
  process.exitCode = 1;
});
