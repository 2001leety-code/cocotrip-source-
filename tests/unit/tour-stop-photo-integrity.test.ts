import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOURS } from '../../src/data/tours';

// 2026-06-10 운영자 신고: 서울나이트 해방촌 stop 이 반포 분수 사진과 동일(파일만 다른 복제본),
// 단양 잔도길/스카이워크가 같은 사진 -> 투어 상세에서 연속 stop 썸네일이 똑같이 보임.
// 규약: (1) 한 투어 안에서 같은 stop 사진 경로 재사용 금지 (2) 사진 파일은 public/ 에 실재.
// (내용만 같고 경로가 다른 복제본은 path 검사로 못 잡음 -> 신규 사진 추가 시 눈 확인 의무.)

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../public');

const stopPhotoPath = (photo: unknown): string | null => {
  if (typeof photo === 'string') return photo;
  if (photo && typeof photo === 'object' && 'url' in photo) {
    const url = (photo as { url: unknown }).url;
    if (typeof url === 'string' && url.startsWith('/')) return url;
  }
  return null;
};

// public 에 "내용이 동일"한 복제본 파일 그룹 (포맷/파일명만 다름 - 경로 비교로는 못 잡는 중복).
// 2026-06-10 발견: 반포 분수 사진이 4벌 존재 -> 나이트투어 갤러리에 3번 노출됐었음.
// 한 투어의 갤러리(images) 또는 stops 안에서 같은 그룹 2개 이상 사용 금지.
const CONTENT_DUP_GROUPS: string[][] = [
  [
    '/1uA0qa_반포대교(1).webp',
    '/Type1_반포대교_한국관광공사 이범수_1uA0qa(1).jpg',
    '/서울/서울 (11).jpg',
    '/서울/서울 (18).jpg',
  ],
];

const countGroupHits = (paths: string[], group: string[]) =>
  paths.filter((p) => group.includes(p)).length;

describe('투어 stop 사진 정합 (사진 중복/누락 잠금)', () => {
  it('한 투어 안에서 같은 사진 경로 재사용 금지', () => {
    for (const tour of TOURS) {
      const photos = (tour.stops || [])
        .map((s) => stopPhotoPath(s.photo))
        .filter((p): p is string => !!p);
      const dups = photos.filter((p, i) => photos.indexOf(p) !== i);
      expect(dups, `${tour.slug} 에서 stop 사진 중복: ${dups.join(', ')}`).toEqual([]);
    }
  });

  it('투어 갤러리(images) 안에서 같은 사진 경로 재사용 금지', () => {
    for (const tour of TOURS) {
      const imgs = tour.images || [];
      const dups = imgs.filter((p, i) => imgs.indexOf(p) !== i);
      expect(dups, `${tour.slug} 갤러리 경로 중복: ${dups.join(', ')}`).toEqual([]);
    }
  });

  it('내용 동일 복제본 그룹은 한 투어의 갤러리/stops 에 1개까지만', () => {
    for (const tour of TOURS) {
      const gallery = tour.images || [];
      const stopPhotos = (tour.stops || [])
        .map((s) => stopPhotoPath(s.photo))
        .filter((p): p is string => !!p);
      for (const group of CONTENT_DUP_GROUPS) {
        expect(countGroupHits(gallery, group), `${tour.slug} 갤러리에 동일내용 복제본 2+`).toBeLessThanOrEqual(1);
        expect(countGroupHits(stopPhotos, group), `${tour.slug} stops 에 동일내용 복제본 2+`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('stop 사진 파일이 public/ 에 실재 (깨진 경로 차단)', () => {
    for (const tour of TOURS) {
      for (const s of tour.stops || []) {
        const p = stopPhotoPath(s.photo);
        if (!p || !p.startsWith('/')) continue; // Firebase Storage URL 등은 제외
        expect(existsSync(join(PUBLIC_DIR, p)), `${tour.slug}: ${p} 파일 없음`).toBe(true);
      }
    }
  });
});
