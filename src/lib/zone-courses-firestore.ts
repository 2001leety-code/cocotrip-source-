// ─────────────────────────────────────────────────────────────────────────────
// zone-courses-firestore.ts — Firestore CRUD for zone_courses (Track C, 2026-05-21)
//
// 컬렉션:
//   zone_courses/{blockId}          — 운영자 검증 완료 block (read=public for
//                                     status!=draft, write=admin only — rules)
//   zone_courses_drafts/{blockId}   — 어드민 작성 중 임시 저장 (admin only)
//
// 패턴: tours-firestore.ts (Phase 2, 2026-05-19) 와 동일 — autosave 1초 throttle
// + draft → publish 흐름 + Timestamp 정규화 + 낙관적 lock (version).
//
// schema: src/data/zone_courses/types.ts → ZoneCourseBlock
// ─────────────────────────────────────────────────────────────────────────────
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
  type DocumentData,
  type QueryConstraint,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type {
  ZoneCourseBlock,
  ZoneCourseCity,
  ZoneCourseSource,
} from '@/data/zone_courses/types';

export type ZoneCourseStatus = 'draft' | 'published' | 'archived';

/** Firestore-extended block — backwards compat 위해 ZoneCourseBlock 의 모든 필드는
 *  optional 처리, status / version / updatedAt 등 운영 metadata 추가. */
export interface ZoneCourseDoc extends Partial<ZoneCourseBlock> {
  status?: ZoneCourseStatus;
  version?: number;
  createdAt?: number;
  updatedAt?: number;
  publishedAt?: number;
  createdBy?: string;
  updatedBy?: string;
  /** Firestore doc id — 호출자 편의를 위해 항상 set. */
  _docId?: string;
}

const COL_BLOCKS = 'zone_courses';
const COL_DRAFTS = 'zone_courses_drafts';

function tsToMs(v: unknown): number | undefined {
  if (v instanceof Timestamp) return v.toMillis();
  if (typeof v === 'number') return v;
  return undefined;
}

function normalizeBlock(docId: string, data: DocumentData): ZoneCourseDoc {
  return {
    ...(data as ZoneCourseDoc),
    id: docId,
    _docId: docId,
    createdAt: tsToMs(data.createdAt),
    updatedAt: tsToMs(data.updatedAt),
    publishedAt: tsToMs(data.publishedAt),
  };
}

/** 단일 block read by docId — admin 페이지에서 status 무관 조회. */
export async function fetchZoneCourseById(blockId: string): Promise<ZoneCourseDoc | null> {
  const snap = await getDoc(doc(db, COL_BLOCKS, blockId));
  if (!snap.exists()) return null;
  return normalizeBlock(snap.id, snap.data());
}

/**
 * 손님 화면용 — 특정 도시의 **published 문서만** 읽는다. (2026-08-02)
 *
 * 🔴 `fetchZoneCoursesList` 를 쓰면 안 되는 이유 두 가지 (둘 다 실측으로 확인):
 *   1) 그 함수는 `orderBy('updatedAt','desc')` 를 건다. 그런데 운영 `zone_courses` 의
 *      시드 문서 40건은 `updatedAt` 필드가 **아예 없다**(`seeded_at` 만 있다).
 *      Firestore 는 정렬 필드가 없는 문서를 결과에서 제외하므로 **항상 빈 배열**이
 *      돌아온다 — 에러도 안 나서 조용히 "코스 없음" 으로 보인다.
 *   2) 보안 규칙이 `resource.data.status != 'draft'` 를 요구한다. 목록 쿼리는 규칙을
 *      쿼리 자체로 증명해야 하므로, status 조건이 없으면 로그인 안 한 손님에게
 *      PERMISSION_DENIED 가 난다.
 *
 * 그래서 여기서는 동등 조건 두 개(city·status)만 걸고 정렬은 호출자가 메모리에서 한다.
 * 동등 조건 두 개는 단일 필드 색인 병합으로 처리되어 복합 색인이 필요 없다.
 *
 * @param city Firestore `city` 값. 운영 데이터에는 `ZoneCourseCity` 유니온에 없는
 *             도시(anseong·changwon 등)도 실제로 들어 있어 `string` 으로 받는다.
 */
export async function fetchPublishedZoneCourses(city: string): Promise<ZoneCourseDoc[]> {
  if (!city) return [];
  const q = query(
    collection(db, COL_BLOCKS),
    where('city', '==', city),
    where('status', '==', 'published'),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => normalizeBlock(d.id, d.data()));
}

/**
 * 문서를 "최근 순"으로 줄 세울 때 쓸 시각(ms). 없으면 0(맨 뒤).
 *
 * 필드가 하나로 통일돼 있지 않다: 운영자가 어드민에서 만든 문서는 `updatedAt`(Timestamp),
 * 시드 스크립트가 넣은 문서는 `seeded_at`(ISO 문자열)만 가진다. 그래서 있는 것부터 차례로 쓴다.
 */
export function recencyMs(data: DocumentData): number {
  // Timestamp/숫자 계열 먼저. `||` 로 이어 붙이지 않는 이유 = 0(1970년)도 형식상 유효한
  // 값이라 건너뛰면 안 된다. nullish 연산자는 이 레포 규칙상 금지라 반복문으로 푼다.
  for (const value of [data.updatedAt, data.publishedAt, data.createdAt]) {
    const ms = tsToMs(value);
    if (ms !== undefined) return ms;
  }
  // 시드 스크립트가 넣은 ISO 문자열 계열.
  for (const key of ['seeded_at', 'verified_at', 'last_review_date']) {
    const raw = data[key];
    if (typeof raw !== 'string') continue;
    const ms = Date.parse(raw);
    if (!Number.isNaN(ms)) return ms;
  }
  return 0;
}

/**
 * 어드민 목록 — city / source 필터 + 최근 순.
 *
 * 🔴 `orderBy('updatedAt','desc')` 를 다시 넣지 말 것 (2026-08-02).
 *   운영 `zone_courses` 의 시드 문서는 `updatedAt` 필드가 **아예 없다**(`seeded_at` 만 있다).
 *   Firestore 는 정렬 기준 필드가 없는 문서를 결과에서 제외하므로, 그 orderBy 하나 때문에
 *   어드민 화면이 **"전체 0 · 발행됨 0 · 등록된 존 코스가 없습니다"** 로 보였다(실측 2026-08-02,
 *   실제로는 published 40건 이상 존재). 에러가 안 나서 "데이터가 없다" 로 오해하기 쉽다.
 *
 *   그래서 정렬은 Firestore 에 맡기지 않고 메모리에서 한다. 어드민 목록은 수십 건 규모라
 *   비용 문제가 없고, 동등 조건만 남아 복합 색인도 필요 없어진다.
 *
 * ⚠️ 어드민 전용(status 무관 전체). 손님 화면은 위 `fetchPublishedZoneCourses` 를 쓸 것.
 */
export async function fetchZoneCoursesList(opts: {
  city?: ZoneCourseCity | 'all';
  source?: ZoneCourseSource | 'all';
} = {}): Promise<ZoneCourseDoc[]> {
  const cons: QueryConstraint[] = [];
  if (opts.city && opts.city !== 'all') cons.push(where('city', '==', opts.city));
  if (opts.source && opts.source !== 'all') cons.push(where('source', '==', opts.source));
  const snap = await getDocs(query(collection(db, COL_BLOCKS), ...cons));
  return snap.docs
    .map((d) => ({ doc: normalizeBlock(d.id, d.data()), at: recencyMs(d.data()) }))
    // 최근 순. 시각이 같거나 둘 다 없으면 id 로 안정 정렬(목록 순서가 새로고침마다 흔들리지 않게).
    .sort((a, b) => b.at - a.at || a.doc.id!.localeCompare(b.doc.id!))
    .map((entry) => entry.doc);
}

/** Draft read */
export async function fetchDraft(blockId: string): Promise<ZoneCourseDoc | null> {
  const snap = await getDoc(doc(db, COL_DRAFTS, blockId));
  if (!snap.exists()) return null;
  return normalizeBlock(snap.id, snap.data());
}

/** Draft 저장 — 1초 throttle 호출자 책임. admin only by rules. */
export async function saveDraft(
  blockId: string,
  draft: Partial<ZoneCourseDoc>,
  uid: string,
): Promise<void> {
  // _docId 는 내부 helper 필드 — Firestore 에 저장하지 않음.
  const { _docId, ...payload } = draft;
  void _docId;
  await setDoc(doc(db, COL_DRAFTS, blockId), {
    ...payload,
    id: blockId,
    status: 'draft' as ZoneCourseStatus,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  }, { merge: true });
}

/** Draft → zone_courses/{id} publish. 낙관적 lock (version). */
export async function publishDraft(blockId: string, uid: string): Promise<void> {
  const draftSnap = await getDoc(doc(db, COL_DRAFTS, blockId));
  if (!draftSnap.exists()) throw new Error(`draft not found: ${blockId}`);
  const draftData = draftSnap.data() as ZoneCourseDoc;

  const existingSnap = await getDoc(doc(db, COL_BLOCKS, blockId));
  const existingVersion = (existingSnap.exists() && (existingSnap.data() as ZoneCourseDoc).version) || 0;
  if (draftData.version !== undefined && draftData.version !== existingVersion) {
    throw new Error(`version conflict: draft=${draftData.version}, current=${existingVersion}`);
  }
  const nextVersion = existingVersion + 1;

  const { _docId, ...payload } = draftData;
  void _docId;

  await setDoc(doc(db, COL_BLOCKS, blockId), {
    ...payload,
    id: blockId,
    status: 'published' as ZoneCourseStatus,
    version: nextVersion,
    publishedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
    createdAt: existingSnap.exists()
      ? (existingSnap.data() as ZoneCourseDoc).createdAt || serverTimestamp()
      : serverTimestamp(),
    createdBy: existingSnap.exists()
      ? (existingSnap.data() as ZoneCourseDoc).createdBy || uid
      : uid,
  }, { merge: false });
}

/** 상태 변경 — archive / publish 토글. */
export async function setBlockStatus(
  blockId: string,
  status: ZoneCourseStatus,
  uid: string,
): Promise<void> {
  await setDoc(doc(db, COL_BLOCKS, blockId), {
    status,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  }, { merge: true });
}

/** Draft 삭제 (zone_courses/{id} 본체는 archive 로 처리). */
export async function deleteDraft(blockId: string): Promise<void> {
  await deleteDoc(doc(db, COL_DRAFTS, blockId));
}

/** UI 라벨 표시용 헬퍼 — block 한 줄 요약. */
export function blockSummary(b: ZoneCourseDoc): string {
  const city = b.city || '?';
  const zone = b.zone || '?';
  const theme = b.theme || '?';
  const intensity = b.intensity || '?';
  return `${city.toUpperCase()} · ${zone} · ${theme} (${intensity})`;
}
