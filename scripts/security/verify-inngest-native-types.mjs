// Regenerate only actual schema declarations from the pinned SDK source maps.
// This is an offline development check; deployment installs use the reviewed emitted artifacts.
import { readFileSync, writeFileSync, mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { inspectNativeSdk } from './inngest-native-v4.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const { sdkRoot, applied } = inspectNativeSdk(repo);
if (!applied) throw new Error('Apply the reviewed native SDK patch before checking declarations');
const temporary = mkdtempSync(join(sdkRoot, '.native-schema-types-'));
try {
  const mapSource = (file, suffix) => {
    const map = JSON.parse(readFileSync(join(sdkRoot, file), 'utf8'));
    const index = map.sources.findIndex((name) => name.endsWith(suffix));
    if (index < 0 || !map.sourcesContent[index]) throw new Error(`Missing pinned source ${suffix}`);
    return map.sourcesContent[index];
  };
  const source = mapSource('types.js.map', '/types.ts');
  const ast = ts.createSourceFile('types.ts', source, ts.ScriptTarget.Latest, true);
  const names = new Set(['baseJsonErrorSchema', 'maybeJsonErrorSchema', 'JsonError', 'jsonErrorSchema',
    'incomingOpSchema', 'sendEventResponseSchema', 'concurrencyOptionSchema', 'functionConfigSchema',
    'inBandSyncRequestBodySchema', 'TimeStr', 'ConcurrencyOption']);
  let fragments = 'import { z as nativeZod } from "zod/v4";\nimport { record } from "./_cocotrip-zod-v4.js";\nconst z = { ...nativeZod, record };\n';
  let found = 0;
  for (const statement of ast.statements) {
    const name = statement.name?.text || (ts.isVariableStatement(statement) ? statement.declarationList.declarations[0].name.getText(ast) : '');
    if (!names.has(name)) continue;
    found++;
    const text = statement.getText(ast);
    fragments += (text.startsWith('export ') ? text : `export ${text}`) + '\n';
  }
  if (found !== names.size) throw new Error('Pinned schema declaration selection changed');
  fragments = fragments.replace(/z\.(ZodType|infer)\b/g, 'nativeZod.$1');
  let realtime = mapSource('components/realtime/types.js.map', '/components/realtime/types.ts');
  realtime = realtime.replace('"zod/v3"', '"zod/v4"').replace('data: z.any(),', 'data: z.any().optional(),')
    .replace('.transform((v) => (v ? new Date(v) : undefined)),', '.transform((v) => (v ? new Date(v) : undefined)).optional(),');
  const typesFile = join(temporary, '_native-types-probe.ts');
  const realtimeFile = join(temporary, '_native-realtime-probe.ts');
  writeFileSync(typesFile, fragments);
  writeFileSync(realtimeFile, realtime);
  copyFileSync(new URL('./inngest-native-v4/_cocotrip-zod-v4.d.ts', import.meta.url), join(temporary, '_cocotrip-zod-v4.d.ts'));
  const output = join(temporary, 'emitted');
  const program = ts.createProgram([typesFile, realtimeFile], {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true, skipLibCheck: false, declaration: true, emitDeclarationOnly: true, outDir: output, types: [],
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => repo, getCanonicalFileName: (file) => file, getNewLine: () => '\n',
  }));
  program.emit();
  for (const [generated, artifact] of [['_native-types-probe', '_cocotrip-native-schema-types'], ['_native-realtime-probe', '_cocotrip-native-realtime-types']]) {
    const emitted = readFileSync(join(output, `${generated}.d.ts`), 'utf8');
    for (const extension of ['d.ts', 'd.cts']) {
      if (readFileSync(new URL(`./inngest-native-v4/${artifact}.${extension}`, import.meta.url), 'utf8') !== emitted) throw new Error(`Generated declaration drift: ${artifact}.${extension}`);
    }
  }
  const contract = ts.createProgram([join(repo, 'tests/type-fixtures/inngest-native-v4-contract.ts')], {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true, skipLibCheck: false, noEmit: true, types: [],
  });
  const contractDiagnostics = ts.getPreEmitDiagnostics(contract);
  if (contractDiagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(contractDiagnostics, {
    getCurrentDirectory: () => repo, getCanonicalFileName: (file) => file, getNewLine: () => '\n',
  }));
  console.log('Native SDK schema declarations regenerate exactly; strict diagnostics: 0; Realtime equality and app-used API input/output contract assertions retained');
} finally {
  rmSync(temporary, { recursive: true, force: true }); // Exact directory returned by mkdtemp, beneath this private SDK.
}
