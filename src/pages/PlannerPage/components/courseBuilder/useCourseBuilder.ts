/**
 * useCourseBuilder — 코스 빌더 상태 훅 (2026-07-04 MVP).
 *
 * - 상태: CourseDraft (courseOps 순수 리듀서로만 갱신).
 * - 영속: localStorage 'cocotrip:course:draft:v1' — 게스트 우선(로그인 불필요).
 *   useWizardPersistence 패턴(디바운스 저장, 불량 데이터 무시). 로그인 사용자는
 *   saveToAccount() 로 useItinerary(Firestore users/{uid}/itineraries) 재사용.
 * - 공유: mock URL — 코스를 base64url 로 #course= 해시에 실어 clipboard 복사.
 *   같은 해시로 진입하면 decodeSharedCourse 로 불러오기(백엔드 0).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  COURSE_STORAGE_KEY, type CourseDraft, type CourseStop,
  addDay, addStop, decodeSharedCourse, emptyDraft, encodeCourseForShare,
  moveStopToDay, removeDay, removeStop, reorderStops, updateStop,
} from './courseOps';

const SAVE_DEBOUNCE_MS = 400;

function loadDraft(): CourseDraft {
  try {
    // 공유 링크 진입(#course=...)이 저장본보다 우선 — 링크 받은 사람이 그 코스를 봐야 함.
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    const m = hash.match(/[#&]course=([A-Za-z0-9_-]+)/);
    if (m) {
      const shared = decodeSharedCourse(m[1]);
      if (shared) return shared;
    }
    const raw = localStorage.getItem(COURSE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as CourseDraft;
      if (parsed?.v === 1 && Array.isArray(parsed.days) && parsed.days.length) return parsed;
    }
  } catch { /* 손상 저장본/해시 — 새 코스로 */ }
  return emptyDraft();
}

export function useCourseBuilder() {
  const [draft, setDraft] = useState<CourseDraft>(loadDraft);
  const [activeDayRaw, setActiveDay] = useState(0);
  const saveTimer = useRef<number | null>(null);

  // activeDay 는 파생 클램프 — day 삭제 후 범위 밖이면 마지막 day (effect 내 setState 회피).
  const activeDay = Math.min(activeDayRaw, draft.days.length - 1);

  // 디바운스 localStorage 저장 (quota 초과 등은 무시 — 다음 변경 때 재시도)
  useEffect(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      try { localStorage.setItem(COURSE_STORAGE_KEY, JSON.stringify(draft)); } catch { /* quota */ }
    }, SAVE_DEBOUNCE_MS);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [draft]);

  const actions = {
    addStop: useCallback((dayIdx: number, partial: Omit<CourseStop, 'id'>) => {
      setDraft((d) => addStop(d, dayIdx, partial));
    }, []),
    updateStop: useCallback((dayIdx: number, stopId: string, patch: Partial<Omit<CourseStop, 'id'>>) => {
      setDraft((d) => updateStop(d, dayIdx, stopId, patch));
    }, []),
    removeStop: useCallback((dayIdx: number, stopId: string) => {
      setDraft((d) => removeStop(d, dayIdx, stopId));
    }, []),
    moveStopToDay: useCallback((fromDay: number, stopId: string, toDay: number) => {
      setDraft((d) => moveStopToDay(d, fromDay, stopId, toDay));
    }, []),
    // AI 동선 최적화 결과(새 방문순서 id 배열) 적용. courseOps 가 손실 방지 보장.
    reorderStops: useCallback((dayIdx: number, orderedIds: string[]) => {
      setDraft((d) => reorderStops(d, dayIdx, orderedIds));
    }, []),
    addDay: useCallback(() => { setDraft((d) => addDay(d)); }, []),
    removeDay: useCallback((dayIdx: number) => { setDraft((d) => removeDay(d, dayIdx)); }, []),
    reset: useCallback(() => {
      setDraft(emptyDraft());
      setActiveDay(0);
      try { localStorage.removeItem(COURSE_STORAGE_KEY); } catch { /* noop */ }
    }, []),
  };

  /**
   * 공유 URL 생성 + clipboard 복사. 반환 = 복사된 URL (실패 시 null).
   *
   * 2026-07-04 저장형 업그레이드: /api/course-share 로 저장해 짧은 주소(/s/{id}) 발급.
   * 20곳 코스도 ~40자 — 기존 해시 방식(20곳 ≈ 3,120자)의 메신저 절단 문제 해소.
   * API 실패(오프라인·레이트리밋) 시 기존 해시 방식으로 폴백(공유 자체는 항상 동작).
   */
  const share = useCallback(async (): Promise<string | null> => {
    let url = `${window.location.origin}/planner#course=${encodeCourseForShare(draft)}`; // 폴백
    try {
      const res = await fetch('/api/course-share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ course: { v: draft.v, days: draft.days } }),
      });
      const json = await res.json().catch(() => null);
      if (json?.ok && json.id) url = `${window.location.origin}/s/${json.id}`;
    } catch { /* 폴백 URL 유지 */ }
    if (navigator.share) {
      try {
        await navigator.share({ title: 'CocoTrip Course', url });
        return url;
      } catch { /* 사용자가 닫음 → clipboard 폴백 */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      return url;
    } catch { /* clipboard API 차단(비보안 컨텍스트/구형) → execCommand 폴백 */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok ? url : null;
    } catch {
      return null;
    }
  }, [draft]);

  const totalStops = draft.days.reduce((n, d) => n + d.stops.length, 0);

  return { draft, activeDay, setActiveDay, ...actions, share, totalStops };
}
