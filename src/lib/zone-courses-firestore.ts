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
  orderBy,
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

/** 목록 — city / source 필터 + updatedAt desc.
 *  Firestore 인덱스 없는 환경에서도 동작하도록 fallback 처리. */
export async function fetchZoneCoursesList(opts: {
  city?: ZoneCourseCity | 'all';
  source?: ZoneCourseSource | 'all';
} = {}): Promise<ZoneCourseDoc[]> {
  const cons: QueryConstraint[] = [];
  if (opts.city && opts.city !== 'all') cons.push(where('city', '==', opts.city));
  if (opts.source && opts.source !== 'all') cons.push(where('source', '==', opts.source));
  try {
    cons.push(orderBy('updatedAt', 'desc'));
    const q = query(collection(db, COL_BLOCKS), ...cons);
    const snap = await getDocs(q);
    return snap.docs.map((d) => normalizeBlock(d.id, d.data()));
  } catch {
    // 인덱스 누락 시 ordering 없이 재시도 (수동 정렬은 호출자 책임)
    try {
      const fallbackCons: QueryConstraint[] = [];
      if (opts.city && opts.city !== 'all') fallbackCons.push(where('city', '==', opts.city));
      if (opts.source && opts.source !== 'all') fallbackCons.push(where('source', '==', opts.source));
      const q = query(collection(db, COL_BLOCKS), ...fallbackCons);
      const snap = await getDocs(q);
      return snap.docs.map((d) => normalizeBlock(d.id, d.data()));
    } catch {
      return [];
    }
  }
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
