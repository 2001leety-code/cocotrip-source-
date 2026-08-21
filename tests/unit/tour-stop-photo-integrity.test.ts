import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOURS } from '../../src/data/tours';

// 2026-06-10 운영자 신고: 서울나이트 해방촌 stop 이 반포 분수 사진과 동일(파일만 다른 복제본),
// 단양 잔도길/스카이워크가 같은 사진 -> 투어 상세에서 연속 stop 썸네일이 똑같이 보임.
// 규약: (1) 한 투어 안에서 같은 stop 사진 재사용 금지 (2) 사진 파일은 public/ 에 실재.
//
// 2026-08-21 P0 사진 전수 감사: 위 규약만으로는 "명동 stop 에 경복궁 사진" 류를 못 잡았다.
// 실제로 stop 18곳 중 9곳이 다른 장소 사진이었다(파일명이 '서울 (3).jpg' 처럼 내용을 안 담아
// 배선한 사람도 검토한 사람도 확인할 수 없었던 게 근본 원인).
// -> 파일명 문자열 검사 대신 "내용 계약" 3종을 추가한다:
//    A. 모든 stop 사진은 VERIFIED_PHOTO_SUBJECTS 에 등록돼 있어야 한다(= 사람이 열어보고 피사체 기록).
//    B. 등록된 md5 가 public/ 실제 파일과 일치해야 한다(파일이 바뀌면 재확인 강제).
//    C. stop 이름(ko/en)이 그 사진의 허용 토큰을 포함해야 한다(장소 불일치 차단).
//    + 내용 중복도 하드코딩 목록이 아니라 실제 md5 로 계산한다.

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../public');

const stopPhotoPath = (photo: unknown): string | null => {
  if (typeof photo === 'string') return photo;
  if (photo && typeof photo === 'object' && 'url' in photo) {
    const url = (photo as { url: unknown }).url;
    if (typeof url === 'string' && url.startsWith('/')) return url;
  }
  return null;
};

const md5Cache = new Map<string, string>();
const md5Of = (publicPath: string): string => {
  const cached = md5Cache.get(publicPath);
  if (cached) return cached;
  const hash = createHash('md5').update(readFileSync(join(PUBLIC_DIR, publicPath))).digest('hex').toUpperCase();
  md5Cache.set(publicPath, hash);
  return hash;
};

/**
 * 눈으로 확인한 사진 레지스트리 — 파일명이 아니라 **픽셀**을 보고 적은 것.
 *  - subject : 실제로 그 이미지에 찍혀 있는 것
 *  - matches : 이 사진을 붙여도 되는 stop 이름 조각 (stop.name.ko 또는 name.en 에 포함돼야 함)
 *  - md5     : 확인 당시 파일 내용. 파일 교체 시 테스트가 깨져 재확인을 강제한다.
 *
 * 새 stop 사진을 추가하려면: public/ 파일을 **직접 열어보고** 여기에 한 줄 등록한다.
 * (md5 = `certutil -hashfile "<파일>" MD5` 또는 `Get-FileHash -Algorithm MD5`)
 */
const VERIFIED_PHOTO_SUBJECTS: Record<string, { subject: string; matches: string[]; md5: string }> = {
  '/JnR5Ie_경복궁(1).webp': {
    subject: '경복궁 근정문 앞 한복 관람객 (현판 勤政門 판독)',
    matches: ['경복궁', 'Gyeongbokgung'],
    md5: '7A5E04F31D045FA34D217EB6F86DC90D',
  },
  '/3Xgcka_북촌한옥마을(1).webp': {
    subject: '북촌 한옥 골목과 붉은 한복 인물',
    matches: ['북촌', 'Bukchon'],
    md5: '2AE608E2FECB2CACCDB53F0DC012CAAE',
  },
  '/tourists/people-seoul-myeongdong-night.webp': {
    subject: '명동 쇼핑거리 야경 (간판 "명동 1위 빵"·TONYMOLY·노래방 판독)',
    matches: ['명동', 'Myeongdong'],
    md5: 'D48A8BD2E83E8E228CCDB75C7A4CFCDE',
  },
  '/서울/서울 (21).jpg': {
    subject: 'N서울타워 사랑의 자물쇠 (안내판 "N SEOUL TOWER" 판독)',
    matches: ['N서울타워', 'N Seoul Tower', '남산', 'Namsan'],
    md5: 'F60AE92CBDD738719511E95B2C79B332',
  },
  '/Type1_광장시장_한국관광공사 이범수_84cpaa(1).jpg': {
    subject: '전통시장 김밥 좌판 (광장시장 마약김밥)',
    matches: ['광장시장', 'Gwangjang'],
    md5: '4AD614050EC2E39FFB9F8232A4C4AB58',
  },
  '/1uA0qa_반포대교(1).webp': {
    subject: '반포대교 달빛무지개분수 야경',
    matches: ['반포', 'Banpo'],
    md5: '032D8487042E28EFD8F70BE115AF3797',
  },
  '/서울/해방촌-남산야경.jpg': {
    subject: '남산 N서울타워를 품은 서울 야경 광역샷 — 촬영 지점이 해방촌인지는 미확인(파일명 근거만)',
    matches: ['해방촌', 'Haebangchon'],
    md5: '91B803D93364B5F6F7CAEAF2FF3974FB',
  },
  '/Type1_도담삼봉_한국관광공사 김지호_m9M3Ka(2).jpg': {
    subject: '남한강 위 세 봉우리와 정자 — 도담삼봉',
    matches: ['도담삼봉', 'Dodamsambong'],
    md5: 'D46DE6E88014F9EF585AA2B93810346F',
  },
  '/Type1_단양강 잔도_한국관광공사 김지호_6yEHMa(1).jpg': {
    subject: '절벽을 따라 난 데크길과 남한강 — 단양강 잔도',
    matches: ['잔도', 'Cliff Trail'],
    md5: '91AF7D0DD1569079BD2957BBFDAA3ED0',
  },
  '/Type1_만천하스카이워크_한국관광공사 김지호_dAeuea(1).jpg': {
    subject: '나선형 전망탑과 단양강 — 만천하스카이워크',
    matches: ['만천하', 'Mancheonha'],
    md5: '0A9B1C4E801F0C7E540414B0F15CAAF8',
  },
  '/Type1_고수동굴_우창민_OKkx36(1).jpg': {
    subject: '조명 켜진 석회동굴 내부 — 고수동굴',
    matches: ['고수동굴', 'Gosu Cave'],
    md5: 'C3D700F02A59DEA68ACA0385E2816135',
  },
  '/tourists/people-busan-gamcheon.webp': {
    subject: '산비탈 알록달록 마을과 벽화 골목 — 감천문화마을',
    matches: ['감천', 'Gamcheon'],
    md5: '87828AD5A06A97B09C0AC38523F92FC7',
  },
  '/Type1_부산 광안대교_한국관광공사 이범수_BTr8Za(1).jpg': {
    subject: '광안대교 야경 (광안리 해변 쪽 수면 너머 전망)',
    matches: ['광안', 'Gwangal'],
    md5: '5D1CB386C0858A694080BBBFF8B789ED',
  },
  '/tourists/people-busan-haeundae.webp': {
    subject: '해운대 백사장과 마린시티 스카이라인·동백섬',
    matches: ['해운대', 'Haeundae'],
    md5: '63F9C3F190625ED9E8EB2C230A9A58C3',
  },
};

const nameMatchesSubject = (stopNameKo: string, stopNameEn: string, matches: string[]) =>
  matches.some((m) => stopNameKo.includes(m) || stopNameEn.toLowerCase().includes(m.toLowerCase()));

const stopPhotoEntries = () =>
  TOURS.flatMap((tour) =>
    (tour.stops || []).map((stop) => ({ tour, stop, path: stopPhotoPath(stop.photo) })),
  ).filter((e): e is { tour: (typeof TOURS)[number]; stop: NonNullable<(typeof TOURS)[number]['stops']>[number]; path: string } =>
    !!e.path && e.path.startsWith('/'),
  );

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

  // 하드코딩 목록이 아니라 public/ 실제 파일 md5 로 계산 — 새 복제본이 추가돼도 자동으로 잡힌다.
  it('한 투어의 갤러리/stops 안에 내용이 같은 사진(파일명만 다른 복제본) 금지', () => {
    const dupReport: string[] = [];
    for (const tour of TOURS) {
      const lists: Array<[string, string[]]> = [
        ['갤러리', (tour.images || []).filter((p) => p.startsWith('/'))],
        [
          'stops',
          (tour.stops || [])
            .map((s) => stopPhotoPath(s.photo))
            .filter((p): p is string => !!p && p.startsWith('/')),
        ],
      ];
      for (const [label, paths] of lists) {
        const byHash = new Map<string, string[]>();
        for (const p of paths) {
          if (!existsSync(join(PUBLIC_DIR, p))) continue; // 실재 검사는 아래 케이스가 담당
          const h = md5Of(p);
          byHash.set(h, [...(byHash.get(h) || []), p]);
        }
        for (const [h, paths2] of byHash) {
          if (paths2.length > 1) dupReport.push(`${tour.slug} ${label}: ${paths2.join(' == ')} (md5 ${h})`);
        }
      }
    }
    expect(dupReport, `내용 동일 사진이 한 투어 안에 2번 이상 실림:\n${dupReport.join('\n')}`).toEqual([]);
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

describe('투어 stop 사진 내용 계약 (P0 2026-08-21 — 장소 오배선 잠금)', () => {
  it('A. 모든 stop 사진이 검증본 레지스트리에 등록돼 있다', () => {
    const unregistered = stopPhotoEntries()
      .filter((e) => !VERIFIED_PHOTO_SUBJECTS[e.path])
      .map((e) => `${e.tour.slug} / ${e.stop.name.ko} -> ${e.path}`);
    expect(
      unregistered,
      `사진을 직접 열어 피사체를 확인하고 VERIFIED_PHOTO_SUBJECTS 에 등록할 것:\n${unregistered.join('\n')}`,
    ).toEqual([]);
  });

  it('B. 레지스트리 md5 가 public/ 실제 파일과 일치한다 (파일 교체 시 재확인 강제)', () => {
    const drift: string[] = [];
    for (const [path, entry] of Object.entries(VERIFIED_PHOTO_SUBJECTS)) {
      if (!existsSync(join(PUBLIC_DIR, path))) {
        drift.push(`${path}: 파일 없음`);
        continue;
      }
      const actual = md5Of(path);
      if (actual !== entry.md5) drift.push(`${path}: 등록 ${entry.md5} != 실제 ${actual}`);
    }
    expect(drift, `사진 내용이 바뀌었다. 다시 눈으로 확인하고 subject/md5 를 갱신할 것:\n${drift.join('\n')}`).toEqual([]);
  });

  it('C. stop 이름이 그 사진의 피사체와 일치한다 (명동에 경복궁 사진 차단)', () => {
    const mismatched: string[] = [];
    for (const e of stopPhotoEntries()) {
      const entry = VERIFIED_PHOTO_SUBJECTS[e.path];
      if (!entry) continue; // 케이스 A 가 담당
      const ko = e.stop.name.ko || '';
      const en = e.stop.name.en || '';
      if (!nameMatchesSubject(ko, en, entry.matches)) {
        mismatched.push(`${e.tour.slug} / "${ko}" 에 "${entry.subject}" 사진이 걸려 있다 (${e.path})`);
      }
    }
    expect(mismatched, `stop 과 사진 피사체 불일치:\n${mismatched.join('\n')}`).toEqual([]);
  });
});
