// ⚠️ 셰뱅(#!)을 넣지 않는다 — 이 파일을 import 하는 vitest 테스트가
//   "SyntaxError: Invalid or unexpected token" 으로 **수집 단계에서** 죽는다.
//   (2026-07-30 확인: tests/unit/firestore-indexes-deployable.test.ts 가 그 상태로
//    통째로 실행되지 않고 있었다. 워크플로 호출은 `node scripts/...` 라 셰뱅은 불필요.)
/**
 * Firestore 색인을 Firebase CLI의 Service Usage 사전 검사 없이 직접 배포한다.
 *
 * 안전 원칙:
 * - firestore.indexes.json에 선언된 색인만 추가한다.
 * - 기존 복합 색인과 단일 필드 색인은 삭제하지 않는다.
 * - --apply 없이는 읽기 전용 점검만 한다.
 * - 서비스 계정 비밀값과 OAuth 토큰은 출력하지 않는다.
 */

import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_ROOT = 'https://firestore.googleapis.com/v1';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DEFAULT_WAIT_MS = 12 * 60 * 1000;
const POLL_MS = 5_000;

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

export function collectionGroupFromName(name) {
  const match = String(name || '').match(/\/collectionGroups\/([^/]+)\//);
  return match ? decodeURIComponent(match[1]) : '';
}

function fieldMode(field) {
  return field.order || field.arrayConfig || field.vectorConfig || '';
}

export function canonicalIndex(index, collectionGroup = '') {
  const fields = (index.fields || [])
    .filter((field) => field.fieldPath !== '__name__')
    .map((field) => ({
      fieldPath: field.fieldPath || '',
      mode: fieldMode(field),
    }));

  return JSON.stringify({
    collectionGroup: collectionGroup || index.collectionGroup || collectionGroupFromName(index.name),
    queryScope: index.queryScope || 'COLLECTION',
    fields,
  });
}

export function toRestCompositeIndex(index) {
  if (!index.collectionGroup || (index.fields || []).length < 2) {
    throw new Error('복합 색인에는 collectionGroup과 2개 이상의 fields가 필요합니다.');
  }

  return {
    queryScope: index.queryScope || 'COLLECTION',
    fields: index.fields.map((field) => {
      const result = { fieldPath: field.fieldPath };
      if (field.order) result.order = field.order;
      if (field.arrayConfig) result.arrayConfig = field.arrayConfig;
      if (!field.order && !field.arrayConfig) {
        throw new Error(`${index.collectionGroup}.${field.fieldPath}: order 또는 arrayConfig가 필요합니다.`);
      }
      return result;
    }),
  };
}

export function findMissingCompositeIndexes(desired, current) {
  const currentKeys = new Set(current.map((index) => canonicalIndex(index)));
  return desired.filter((index) => !currentKeys.has(canonicalIndex(index)));
}

export function toRestSingleFieldIndex(override, index) {
  const field = { fieldPath: override.fieldPath };
  if (index.order) field.order = index.order;
  if (index.arrayConfig) field.arrayConfig = index.arrayConfig;
  if (!index.order && !index.arrayConfig) {
    throw new Error(`${override.collectionGroup}.${override.fieldPath}: order 또는 arrayConfig가 필요합니다.`);
  }
  return {
    queryScope: index.queryScope || 'COLLECTION',
    fields: [field],
  };
}

export function unionSingleFieldIndexes(override, currentIndexes = []) {
  const writableCurrent = currentIndexes.map((index) => ({
    queryScope: index.queryScope || 'COLLECTION',
    ...(index.apiScope ? { apiScope: index.apiScope } : {}),
    fields: (index.fields || []).map((field) => ({
      fieldPath: field.fieldPath,
      ...(field.order ? { order: field.order } : {}),
      ...(field.arrayConfig ? { arrayConfig: field.arrayConfig } : {}),
      ...(field.vectorConfig ? { vectorConfig: field.vectorConfig } : {}),
    })),
  }));
  const currentKeys = new Set(
    writableCurrent.map((index) => canonicalIndex(index, override.collectionGroup)),
  );
  const additions = (override.indexes || [])
    .map((index) => toRestSingleFieldIndex(override, index))
    .filter((index) => !currentKeys.has(canonicalIndex(index, override.collectionGroup)));
  return [...writableCurrent, ...additions];
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(serviceAccount.private_key, 'base64url')}`;
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.access_token) {
    throw new Error(`Google OAuth 토큰 발급 실패 (${response.status}, ${json.error || 'unknown'})`);
  }
  return json.access_token;
}

async function requestJson(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      `Firestore Admin API 실패 (${response.status}, ${body.error?.status || 'unknown'}): ${body.error?.message || '응답 없음'}`,
    );
    error.status = response.status;
    error.apiStatus = body.error?.status || '';
    throw error;
  }
  return body;
}

function databaseBase(projectId) {
  return `projects/${encodeURIComponent(projectId)}/databases/(default)`;
}

async function listCompositeIndexes(projectId, token, collectionGroups) {
  const all = new Map();
  for (const collectionGroup of collectionGroups) {
    const parent = `${databaseBase(projectId)}/collectionGroups/${encodeURIComponent(collectionGroup)}`;
    const body = await requestJson(`${API_ROOT}/${parent}/indexes`, token);
    for (const index of body.indexes || []) {
      all.set(index.name || canonicalIndex(index), index);
    }
  }
  return [...all.values()];
}

async function createCompositeIndex(projectId, token, index) {
  const parent = `${databaseBase(projectId)}/collectionGroups/${encodeURIComponent(index.collectionGroup)}`;
  try {
    return await requestJson(`${API_ROOT}/${parent}/indexes`, token, {
      method: 'POST',
      body: JSON.stringify(toRestCompositeIndex(index)),
    });
  } catch (error) {
    if (error.status === 409 || error.apiStatus === 'ALREADY_EXISTS') return null;
    throw error;
  }
}

async function getField(projectId, token, override) {
  const name = `${databaseBase(projectId)}/collectionGroups/${encodeURIComponent(override.collectionGroup)}/fields/${encodeURIComponent(override.fieldPath)}`;
  try {
    return await requestJson(`${API_ROOT}/${name}`, token);
  } catch (error) {
    if (error.status === 404) return { name, indexConfig: { indexes: [] } };
    throw error;
  }
}

async function patchFieldIndexes(projectId, token, field, indexes) {
  return requestJson(`${API_ROOT}/${field.name}?updateMask=indexConfig`, token, {
    method: 'PATCH',
    body: JSON.stringify({
      name: field.name,
      indexConfig: { indexes },
    }),
  });
}

async function waitForOperation(operation, token, deadline) {
  if (!operation || !operation.name) return;
  let current = operation;
  while (!current.done) {
    if (Date.now() >= deadline) {
      throw new Error(`색인 생성 대기 시간이 초과됐습니다: ${operation.name.split('/').pop()}`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, POLL_MS));
    current = await requestJson(`${API_ROOT}/${operation.name}`, token);
  }
  if (current.error) {
    throw new Error(`색인 생성 실패: ${current.error.message || '원인 없음'}`);
  }
}

function parseArgs(argv) {
  const valueAfter = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] || '' : '';
  };
  const credentialsValue = valueAfter('--credentials') || process.env.GOOGLE_APPLICATION_CREDENTIALS || '';
  return {
    apply: argv.includes('--apply'),
    wait: argv.includes('--wait'),
    projectId: valueAfter('--project') || process.env.FIREBASE_PROJECT_ID || '',
    configPath: resolve(valueAfter('--config') || 'firestore.indexes.json'),
    credentialsPath: credentialsValue ? resolve(credentialsValue) : '',
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.projectId) throw new Error('--project 또는 FIREBASE_PROJECT_ID가 필요합니다.');
  const config = await readJson(args.configPath);
  const desired = config.indexes || [];
  const fieldOverrides = config.fieldOverrides || [];
  const serviceAccount = args.credentialsPath
    ? await readJson(args.credentialsPath)
    : {
        client_email: process.env.FIREBASE_CLIENT_EMAIL || '',
        private_key: String(process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      };
  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('서비스 계정 파일 또는 FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY가 필요합니다.');
  }
  const token = await getAccessToken(serviceAccount);
  const groups = [...new Set(desired.map((index) => index.collectionGroup).filter(Boolean))];
  const current = await listCompositeIndexes(args.projectId, token, groups);
  const missing = findMissingCompositeIndexes(desired, current);
  const fieldPlans = [];
  for (const override of fieldOverrides) {
    const field = await getField(args.projectId, token, override);
    const currentIndexes = field.indexConfig?.indexes || [];
    const nextIndexes = unionSingleFieldIndexes(override, currentIndexes);
    fieldPlans.push({ override, field, currentIndexes, nextIndexes });
  }
  const pendingFieldAdditions = fieldPlans.reduce(
    (count, plan) => count + plan.nextIndexes.length - plan.currentIndexes.length,
    0,
  );

  console.log(`복합 색인: 선언 ${desired.length} / 현재 ${current.length} / 추가 필요 ${missing.length}`);
  if (!args.apply) {
    for (const index of missing) {
      console.log(`DRY-RUN 추가: ${index.collectionGroup} (${index.fields.map((field) => field.fieldPath).join(', ')})`);
    }
    console.log(`단일 필드 색인: 선언 ${fieldOverrides.length} / 추가 필요 ${pendingFieldAdditions}`);
    return;
  }

  const operations = [];
  for (const index of missing) {
    const operation = await createCompositeIndex(args.projectId, token, index);
    if (operation) operations.push(operation);
    console.log(`추가 요청: ${index.collectionGroup} (${index.fields.map((field) => field.fieldPath).join(', ')})`);
  }

  let fieldAdditionCount = 0;
  for (const plan of fieldPlans) {
    if (plan.nextIndexes.length === plan.currentIndexes.length) continue;
    operations.push(await patchFieldIndexes(args.projectId, token, plan.field, plan.nextIndexes));
    fieldAdditionCount += plan.nextIndexes.length - plan.currentIndexes.length;
  }
  console.log(`단일 필드 색인 추가 요청: ${fieldAdditionCount}`);

  if (args.wait && operations.length > 0) {
    const waitMs = Number(process.env.FIRESTORE_INDEX_WAIT_MS || DEFAULT_WAIT_MS);
    const deadline = Date.now() + waitMs;
    for (const operation of operations) {
      await waitForOperation(operation, token, deadline);
    }
    console.log(`색인 준비 완료: ${operations.length}개 작업`);
  }

  const after = await listCompositeIndexes(args.projectId, token, groups);
  const remaining = findMissingCompositeIndexes(desired, after);
  if (remaining.length > 0) {
    throw new Error(`배포 후에도 복합 색인 ${remaining.length}개를 찾지 못했습니다.`);
  }
  console.log('Firestore 색인 배포 검증 완료');
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
