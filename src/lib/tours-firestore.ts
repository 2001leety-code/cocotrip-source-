// ─────────────────────────────────────────────────────────────────────────────
// tours-firestore.ts — Firestore 기반 어드민 상품 등록 CRUD (Phase 1, 2026-05-19)
//
// 컬렉션:
//   tours/{tourId}              — published / archived 카탈로그 (read=public, write=admin)
//   tours_drafts/{tourId}       — 어드민 작성 중 임시 저장 (read/write=admin only)
//
// 모든 신규 필드는 optional 이므로 기존 정적 9 투어 (TOURS_RAW) 와 호환.
// `Tour` 타입은 src/data/tours.ts 단일 source — 신규 타입도 거기서 export.
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
import { stripUndefined } from '@/lib/firestore-safe';
import type { Tour, TourPhoto, TourStatus, I18nString } from '@/data/tours';

const COL_TOURS = 'tours';
const COL_DRAFTS = 'tours_drafts';

function isPermissionDenied(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = (error as { code?: unknown }).code;
  return code === 'permission-denied' || code === 'firestore/permission-denied';
}

/** Firestore 도큐먼트 → Tour 객체 정규화.
 *  - serverTimestamp() 가 Timestamp 으로 와서 ms epoch 으로 변환
 *  - source='firestore' 마킹 (정적 폴백과 구분)
 *  - id 가 doc.id 로 강제 (Firestore doc id = 운영자가 정한 slug-like)
 */
function normalizeTour(docId: string, data: DocumentData): Tour {
  const tsToMs = (v: unknown): number | undefined => {
    if (v instanceof Timestamp) return v.toMillis();
    if (typeof v === 'number') return v;
    return undefined;
  };
  return {
    ...(data as Tour),
    id: docId,
    source: 'firestore',
    createdAt: tsToMs(data.createdAt),
    updatedAt: tsToMs(data.updatedAt),
    publishedAt: tsToMs(data.publishedAt),
  };
}

/** 단일 투어 read — slug 또는 docId 매칭. published 만 공개. */
export async function fetchTourBySlug(slug: string): Promise<Tour | null> {
  // 1) docId === slug 인 케이스가 가장 흔함 (어드민이 slug 를 docId 로 입력)
  const directRef = doc(db, COL_TOURS, slug);
  try {
    const directSnap = await getDoc(directRef);
    if (directSnap.exists()) {
      const data = directSnap.data();
      if (data.status === 'published') return normalizeTour(directSnap.id, data);
    }
  } catch (error) {
    if (!isPermissionDenied(error)) throw error;
  }
  // 2) slug 필드가 docId 와 다를 수 있음 → where 쿼리
  const q = query(
    collection(db, COL_TOURS),
    where('slug', '==', slug),
    where('status', '==', 'published'),
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return normalizeTour(d.id, d.data());
}

/** 단일 투어 read by docId — admin 페이지에서 status 무관 조회용. */
export async function fetchTourById(tourId: string): Promise<Tour | null> {
  const snap = await getDoc(doc(db, COL_TOURS, tourId));
  if (!snap.exists()) return null;
  return normalizeTour(snap.id, snap.data());
}

/** 목록 — region/status 필터 + publishedAt desc. */
export async function fetchToursList(opts: {
  region?: string;
  status?: TourStatus;
} = {}): Promise<Tour[]> {
  const cons: QueryConstraint[] = [];
  if (opts.region && opts.region !== 'All') cons.push(where('region', '==', opts.region));
  if (opts.status) cons.push(where('status', '==', opts.status));
  cons.push(orderBy('publishedAt', 'desc'));
  const q = query(collection(db, COL_TOURS), ...cons);
  const snap = await getDocs(q);
  return snap.docs.map((d) => normalizeTour(d.id, d.data()));
}

/** Draft (어드민 임시저장) read */
export async function fetchDraft(tourId: string): Promise<Tour | null> {
  const snap = await getDoc(doc(db, COL_DRAFTS, tourId));
  if (!snap.exists()) return null;
  return normalizeTour(snap.id, snap.data());
}

/** Draft 저장 (1초 throttle 호출용 — 호출자 책임). admin only by rules.
 *
 * 🔴 stripUndefined 필수: 어드민 폼은 "값을 비웠다"를 `undefined` 로 표현한다
 *    (`e.target.value ? Number(...) : undefined`). Firestore 는 undefined 를 거부(throw)하므로
 *    입장료를 0 으로 두거나 stop 좌표를 지우기만 해도 자동저장이 통째로 실패한다.
 *    FieldValue(serverTimestamp)는 strip 하면 망가지므로 **strip 뒤에** 붙인다.
 */
export async function saveDraft(tourId: string, draft: Partial<Tour>, uid: string): Promise<void> {
  const ref = doc(db, COL_DRAFTS, tourId);
  await setDoc(ref, {
    ...stripUndefined(draft),
    id: tourId,
    status: 'draft' as TourStatus,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  }, { merge: true });
}

/** Draft → tours/{id} publish. version 낙관적 lock. */
export async function publishDraft(tourId: string, uid: string): Promise<void> {
  const draftSnap = await getDoc(doc(db, COL_DRAFTS, tourId));
  if (!draftSnap.exists()) throw new Error(`draft not found: ${tourId}`);
  const draft = draftSnap.data() as Tour;

  // 기존 published 의 version 확인 (낙관적 lock — 다른 어드민이 동시 publish 했으면 reject)
  const existingSnap = await getDoc(doc(db, COL_TOURS, tourId));
  const existingVersion = (existingSnap.exists() && (existingSnap.data() as Tour).version) || 0;
  if (draft.version !== undefined && draft.version !== existingVersion) {
    throw new Error(`version conflict: draft=${draft.version}, current=${existingVersion}`);
  }
  const nextVersion = existingVersion + 1;

  // 기존 문서에 createdAt/createdBy 가 없으면 undefined 가 그대로 실린다 → strip 대상.
  // (merge:false 라 한 필드만 undefined 여도 publish 전체가 거부된다.)
  const carriedCreatedAt = existingSnap.exists() ? (existingSnap.data() as Tour).createdAt : undefined;
  const carriedCreatedBy = existingSnap.exists() ? (existingSnap.data() as Tour).createdBy : undefined;

  await setDoc(doc(db, COL_TOURS, tourId), {
    ...stripUndefined({
      ...draft,
      id: tourId,
      status: 'published' as TourStatus,
      version: nextVersion,
      createdBy: carriedCreatedBy || uid,
      ...(carriedCreatedAt !== undefined ? { createdAt: carriedCreatedAt } : {}),
    }),
    // FieldValue 는 strip 후 부착 (strip 이 클래스 인스턴스를 평범한 객체로 분해해버린다).
    publishedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
    ...(carriedCreatedAt === undefined ? { createdAt: serverTimestamp() } : {}),
  }, { merge: false });
}

/** 상태 변경 — archive / unarchive. */
export async function setTourStatus(tourId: string, status: TourStatus, uid: string): Promise<void> {
  await setDoc(doc(db, COL_TOURS, tourId), {
    status,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  }, { merge: true });
}

/** Draft 삭제 (실제 tours/{id} 는 archive 로) */
export async function deleteDraft(tourId: string): Promise<void> {
  await deleteDoc(doc(db, COL_DRAFTS, tourId));
}

/** /public 경로 또는 https URL → 단일 src.
 *  TourPhoto 객체면 legacy_public_path 폴백, 문자열이면 그대로 반환.
 *  Firebase Storage URL 마이그 도중 호환성 유지.
 *
 *  P109 (2026-05-20): preferredWidth 인자 추가 — TourPhoto.variants[N] 매칭 우선.
 *  Firebase Extension storage-resize-images 미설치 환경 / variants 누락 시
 *  자동 원본 폴백. 기존 호출 (preferredWidth 미전달) 무영향. */
export function resolvePhotoUrl(
  photo: { url: string; legacy_public_path?: string; variants?: Record<string, string | undefined> } | string | undefined,
  preferredWidth?: '400' | '800' | '1600',
): string {
  if (!photo) return '';
  if (typeof photo === 'string') return photo;
  if (preferredWidth && photo.variants?.[preferredWidth]) {
    return photo.variants[preferredWidth] as string;
  }
  if (photo.url?.startsWith('http')) return photo.url;
  return photo.legacy_public_path || photo.url || '';
}

/**
 * P109: srcset 문자열 builder — `<img srcSet>` 직접 주입 가능 포맷.
 * variants 가 1+ 존재할 때만 string 반환, 없거나 빈 객체면 undefined → 호출자
 * 가 srcSet attribute 자체 omit (브라우저 src 만 fallback).
 *
 * 예) buildPhotoSrcSet(photo) → "https://.../400.webp 400w, https://.../800.webp 800w"
 */
export function buildPhotoSrcSet(
  photo: { variants?: Record<string, string | undefined> } | string | undefined,
): string | undefined {
  if (!photo || typeof photo === 'string') return undefined;
  const variants = photo.variants;
  if (!variants) return undefined;
  const parts: string[] = [];
  for (const w of ['400', '800', '1600'] as const) {
    const url = variants[w];
    if (typeof url === 'string' && url) parts.push(`${url} ${w}w`);
  }
  return parts.length > 0 ? parts.join(', ') : undefined;
}

const EMPTY_I18N: I18nString = { ko: '', en: '', ja: '', zh: '' };

/** /public 경로 → TourPhoto 객체. legacy_public_path 에 원본 경로 보존. */
function legacyToTourPhoto(legacyPath: string): TourPhoto {
  return {
    url: legacyPath,
    legacy_public_path: legacyPath,
    alt: { ...EMPTY_I18N },
  };
}

/** 정적 tours.ts 의 Tour 1개 → Firestore tours_drafts 로 import.
 *  thumbnail/images[] → thumbnail_photo/photos[] 로 변환 (legacy_public_path 보존).
 *  TourStop[] 의 photo string → TourPhoto 로 변환.
 *
 *  이미 같은 docId 의 draft 가 있으면 덮어쓰기 (운영자 confirm 책임).
 *  publish 는 별도 액션 — import 후 어드민이 검토 → publish.
 */
export async function importStaticTour(staticTour: Tour, uid: string): Promise<string> {
  const tourId = staticTour.id;

  // 사진 변환 (legacy → TourPhoto)
  const thumbnail_photo: TourPhoto | undefined = staticTour.thumbnail
    ? legacyToTourPhoto(staticTour.thumbnail)
    : undefined;

  const photos: TourPhoto[] = (staticTour.images || []).map(legacyToTourPhoto);

  // Stops 의 photo 도 변환 (string → TourPhoto)
  const stops = staticTour.stops?.map((s) => ({
    ...s,
    photo: typeof s.photo === 'string' ? legacyToTourPhoto(s.photo) : s.photo,
  }));

  const draftBody: Partial<Tour> = {
    ...staticTour,
    thumbnail_photo,
    photos,
    stops,
    source: 'firestore',
    status: 'draft',
    version: 0,
  };

  // tours_drafts/{tourId} 에 저장 (publish 는 운영자 후속 액션)
  // 정적 투어에도 optional 미설정 필드(thumbnail 없음 등)가 있어 undefined 가 실린다 → strip.
  await setDoc(doc(db, 'tours_drafts', tourId), {
    ...stripUndefined(draftBody),
    id: tourId,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
    // import 의 출처 기록 — 향후 디버깅용
    importedFromStaticAt: serverTimestamp(),
  }, { merge: true });

  return tourId;
}
