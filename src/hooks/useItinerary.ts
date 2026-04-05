/**
 * useItinerary — 나만의 일정 관리 훅
 *
 * Firestore users/{uid}/itineraries 컬렉션
 * 날짜별 슬롯에 투어 상품 배치/삭제/이동
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import {
  collection, doc, setDoc, deleteDoc, onSnapshot,
  query, orderBy,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface ItinerarySlot {
  slotId: string;
  productId: string;
  productType: 'charter' | 'tour' | 'planner';
  name: string;
  timeStart?: string;  // "09:00"
  timeEnd?: string;    // "12:00"
  priceUSD?: number;
  notes?: string;
}

export interface ItineraryDay {
  dayNumber: number;
  date: string;       // "2026-05-01"
  slots: ItinerarySlot[];
}

export interface Itinerary {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  days: ItineraryDay[];
  createdAt: number;
  updatedAt: number;
}

const genId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function useItinerary() {
  const { user } = useAuth();
  const [itineraries, setItineraries] = useState<Itinerary[]>([]);
  const [loading, setLoading] = useState(true);

  // ── 실시간 구독 ──
  useEffect(() => {
    if (!user?.uid) {
      setItineraries([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, 'users', user.uid, 'itineraries'),
      orderBy('updatedAt', 'desc'),
    );
    const unsub = onSnapshot(q, (snap) => {
      setItineraries(
        snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Itinerary, 'id'>) }))
      );
      setLoading(false);
    });

    return () => unsub();
  }, [user?.uid]);

  // ── 일정 생성 ──
  const createItinerary = useCallback(async (
    title: string,
    startDate: string,
    endDate: string,
  ) => {
    if (!user?.uid) return null;

    const id = genId();
    const start = new Date(startDate);
    const end = new Date(endDate);
    const dayCount = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    const days: ItineraryDay[] = Array.from({ length: dayCount }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return {
        dayNumber: i + 1,
        date: d.toISOString().slice(0, 10),
        slots: [],
      };
    });

    const itinerary = {
      title,
      startDate,
      endDate,
      days,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await setDoc(doc(db, 'users', user.uid, 'itineraries', id), itinerary);
    return id;
  }, [user?.uid]);

  // ── 슬롯 추가 ──
  const addSlot = useCallback(async (
    itineraryId: string,
    dayIndex: number,
    slot: Omit<ItinerarySlot, 'slotId'>,
  ) => {
    if (!user?.uid) return;

    const it = itineraries.find(i => i.id === itineraryId);
    if (!it) return;

    const updated = { ...it };
    updated.days = [...updated.days];
    updated.days[dayIndex] = {
      ...updated.days[dayIndex],
      slots: [...updated.days[dayIndex].slots, { ...slot, slotId: genId() }],
    };
    updated.updatedAt = Date.now();

    await setDoc(doc(db, 'users', user.uid, 'itineraries', itineraryId), updated);
  }, [user?.uid, itineraries]);

  // ── 슬롯 삭제 ──
  const removeSlot = useCallback(async (
    itineraryId: string,
    dayIndex: number,
    slotId: string,
  ) => {
    if (!user?.uid) return;

    const it = itineraries.find(i => i.id === itineraryId);
    if (!it) return;

    const updated = { ...it };
    updated.days = [...updated.days];
    updated.days[dayIndex] = {
      ...updated.days[dayIndex],
      slots: updated.days[dayIndex].slots.filter(s => s.slotId !== slotId),
    };
    updated.updatedAt = Date.now();

    await setDoc(doc(db, 'users', user.uid, 'itineraries', itineraryId), updated);
  }, [user?.uid, itineraries]);

  // ── 일정 삭제 ──
  const deleteItinerary = useCallback(async (itineraryId: string) => {
    if (!user?.uid) return;
    await deleteDoc(doc(db, 'users', user.uid, 'itineraries', itineraryId));
  }, [user?.uid]);

  return {
    itineraries,
    loading,
    createItinerary,
    addSlot,
    removeSlot,
    deleteItinerary,
  };
}
