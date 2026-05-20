// ─────────────────────────────────────────────────────────────────────────────
// storage-upload.ts — Firebase Storage 업로드 헬퍼 (Phase 1, 2026-05-19)
//
// 경로 구조 (PHASE0 §C5):
//   tours/{tourId}/thumbnail.{ext}
//   tours/{tourId}/gallery/{ts}-{name}.{ext}
//   tours/{tourId}/stops/{index}/{ts}-{name}.{ext}
//   tours/{tourId}/meeting/{ts}-{name}.{ext}
//
// 보안: storage.rules 가 admin email 검증 + 8MB cap + image/video contentType 강제.
// ─────────────────────────────────────────────────────────────────────────────
import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage';
import { storage } from '@/lib/firebase';
import type { TourPhoto, I18nString } from '@/data/tours';

/** 파일명에서 알파벳/숫자/한글 제외 모두 '-' 로 치환. 확장자는 소문자. */
function sanitizeFilename(name: string): string {
  const dotIdx = name.lastIndexOf('.');
  const base = dotIdx > 0 ? name.slice(0, dotIdx) : name;
  const ext = dotIdx > 0 ? name.slice(dotIdx + 1).toLowerCase() : '';
  // 알파벳/숫자/한글/하이픈만 허용. 나머지는 -.
  const cleanBase = base.replace(/[^a-zA-Z0-9가-힣-]+/g, '-').slice(0, 60) || 'photo';
  return ext ? `${cleanBase}.${ext}` : cleanBase;
}

const EMPTY_I18N: I18nString = { ko: '', en: '', ja: '', zh: '' };

/** 이미지 원본 width/height 측정. 실패 시 undefined 반환 (non-blocking). */
function probeImageSize(file: File): Promise<{ width: number; height: number } | undefined> {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/')) {
      resolve(undefined);
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(undefined);
    };
    img.src = url;
  });
}

/** Firebase Storage 업로드. tourId 가 있으면 정상 path, 없으면 신규 draft 임시 path 사용. */
export async function uploadTourPhoto(
  tourId: string,
  bucket: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<TourPhoto> {
  if (!file) throw new Error('파일이 비어있습니다.');
  if (file.size > 8 * 1024 * 1024) throw new Error('파일이 너무 큽니다 (최대 8MB).');
  if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
    throw new Error('이미지 또는 비디오만 업로드할 수 있습니다.');
  }

  const timestamp = Date.now();
  const cleanName = sanitizeFilename(file.name);
  const safeTourId = tourId && tourId.trim() ? tourId : `_drafts/${timestamp}`;
  const path = `tours/${safeTourId}/${bucket}/${timestamp}-${cleanName}`;
  const storageRef = ref(storage, path);

  const task = uploadBytesResumable(storageRef, file, { contentType: file.type });

  // 진행률 throttle (last update 100ms 이내면 skip)
  let lastEmit = 0;
  return new Promise<TourPhoto>((resolve, reject) => {
    task.on(
      'state_changed',
      (snap) => {
        const pct = snap.totalBytes > 0 ? Math.round((snap.bytesTransferred / snap.totalBytes) * 100) : 0;
        const now = Date.now();
        if (now - lastEmit >= 100 || pct === 100) {
          lastEmit = now;
          onProgress?.(pct);
        }
      },
      (err) => {
        reject(new Error(`업로드 실패: ${err.message || err.code || 'unknown'}`));
      },
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          const dims = await probeImageSize(file);
          resolve({
            url,
            alt: { ...EMPTY_I18N },
            width: dims?.width,
            height: dims?.height,
          });
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      },
    );
  });
}

/** URL 로부터 storage 객체 삭제. 객체 없음 에러는 idempotent 하게 무시. */
export async function deleteTourPhoto(url: string): Promise<void> {
  if (!url || !url.startsWith('http')) return;
  try {
    const objRef = ref(storage, url);
    await deleteObject(objRef);
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    if (code === 'storage/object-not-found') return; // idempotent
    throw err;
  }
}
