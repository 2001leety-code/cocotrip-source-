// 어드민 MOOD 주소록 관리 모달 — /api/mood-places 재사용 (geocode·director 유일성 서버 유지).
// 자주 가는 곳(직원 집·이사님 댁)을 이름→주소로 저장. isDirector=true 는 차량 판별 기준(한 명만).
// 목록 조회 + 각 항목 삭제(DELETE {id}) + 하단 추가(POST). 주소 geocode 실패 시 서버 400 메시지 표시.
// 운영자 전용 화면이라 한국어 단일.
import { useCallback, useEffect, useState } from 'react';
import { X, MapPin, Loader2, Plus, Trash2, Crown } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface Place {
  id: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  isDirector: boolean;
}

export function MoodPlacesManager({ open, onClose }: Props) {
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // 추가 폼
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [isDirector, setIsDirector] = useState(false);
  const [adding, setAdding] = useState(false);

  // 삭제 진행 중인 id
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const res = await authFetch('/api/mood-places');
      const json = await res.json().catch(() => ({}));
      if (!json?.ok) {
        setLoadErr(json?.error || `주소록 조회 실패 (${res.status})`);
        setPlaces([]);
        return;
      }
      setPlaces(
        (Array.isArray(json.places) ? json.places : []).map((p: Partial<Place>) => ({
          id: String(p.id || ''),
          name: p.name || '',
          address: p.address || '',
          lat: typeof p.lat === 'number' ? p.lat : null,
          lng: typeof p.lng === 'number' ? p.lng : null,
          isDirector: p.isDirector === true,
        })),
      );
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : '주소록 조회 실패');
      setPlaces([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // 모달 열릴 때마다: 상태 초기화 + 목록 로드
  useEffect(() => {
    if (!open) return;
    setName('');
    setAddress('');
    setIsDirector(false);
    setMsg(null);
    void load();
  }, [open, load]);

  const submitAdd = useCallback(async () => {
    const trimmedName = name.trim();
    const trimmedAddress = address.trim();
    if (!trimmedName) {
      setMsg({ kind: 'err', text: '이름을 입력하세요.' });
      return;
    }
    if (!trimmedAddress) {
      setMsg({ kind: 'err', text: '주소를 입력하세요.' });
      return;
    }
    setAdding(true);
    setMsg(null);
    try {
      const res = await authFetch('/api/mood-places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName, address: trimmedAddress, isDirector }),
      });
      const json = await res.json().catch(() => ({}));
      if (json?.ok) {
        setMsg({ kind: 'ok', text: `${json.data?.updated ? '수정' : '추가'} 완료 — ${trimmedName}` });
        setName('');
        setAddress('');
        setIsDirector(false);
        await load();
      } else {
        // geocode 실패 = 400 "주소를 좌표로 변환할 수 없습니다 (주소 확인)".
        setMsg({ kind: 'err', text: json?.error || `추가 실패 (${res.status})` });
      }
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : '추가 실패' });
    } finally {
      setAdding(false);
    }
  }, [name, address, isDirector, load]);

  const remove = useCallback(
    async (place: Place) => {
      setDeletingId(place.id);
      setMsg(null);
      try {
        const res = await authFetch('/api/mood-places', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: place.id }),
        });
        const json = await res.json().catch(() => ({}));
        if (json?.ok) {
          setMsg({ kind: 'ok', text: `삭제 완료 — ${place.name}` });
          await load();
        } else {
          setMsg({ kind: 'err', text: json?.error || `삭제 실패 (${res.status})` });
        }
      } catch (e) {
        setMsg({ kind: 'err', text: e instanceof Error ? e.message : '삭제 실패' });
      } finally {
        setDeletingId(null);
      }
    },
    [load],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center"
      onClick={onClose}
      translate="no"
    >
      <div
        className="flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl border border-purple-300/20 bg-[#181b22] shadow-[0_18px_60px_rgba(0,0,0,0.4)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-[#7C5CFC]" />
            <h2 className="text-sm font-bold text-white">MOOD 주소록</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="flex h-9 w-9 items-center justify-center text-slate-400 transition-colors hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-col gap-5 overflow-y-auto p-5">
          {/* 목록 */}
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-slate-300">
              <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…
            </p>
          ) : loadErr ? (
            <p className="rounded-xl border border-rose-400/25 bg-rose-400/[0.08] px-3 py-2 text-sm text-rose-200">
              {loadErr}
            </p>
          ) : places.length === 0 ? (
            <p className="text-sm text-slate-500">등록된 주소가 없습니다.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {places.map((place) => {
                const deleting = deletingId === place.id;
                return (
                  <li
                    key={place.id}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${
                      place.isDirector
                        ? 'border-[#EA537E]/35 bg-[#EA537E]/[0.08]'
                        : 'border-white/10 bg-white/[0.04]'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-bold text-white" title={place.name}>
                          {place.name}
                        </span>
                        {place.isDirector && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#EA537E]/20 px-1.5 py-0.5 text-[10px] font-bold text-[#EA537E]">
                            <Crown className="h-3 w-3" /> 이사님
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-slate-400" title={place.address}>
                        {place.address}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void remove(place)}
                      disabled={!!deletingId}
                      aria-label={`${place.name} 삭제`}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-rose-400/10 hover:text-rose-300 disabled:opacity-40"
                    >
                      {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* 추가 폼 */}
          <div className="flex flex-col gap-2 border-t border-white/[0.06] pt-4">
            <h3 className="text-xs font-bold text-slate-300">주소 추가</h3>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder="이름 (예: 이사님 댁, 김대리 집)"
              disabled={!!loadErr}
              className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-[#7C5CFC]/50 focus:outline-none disabled:opacity-50"
            />
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              maxLength={200}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitAdd();
              }}
              placeholder="주소 (예: 서울시 강남구 …)"
              disabled={!!loadErr}
              className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-[#7C5CFC]/50 focus:outline-none disabled:opacity-50"
            />
            <label className="flex cursor-pointer items-center gap-2 px-1 py-1 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={isDirector}
                onChange={(e) => setIsDirector(e.target.checked)}
                disabled={!!loadErr}
                className="h-4 w-4 rounded border-white/20 bg-white/[0.04] text-[#EA537E] focus:ring-0 focus:ring-offset-0"
              />
              <span className="flex items-center gap-1">
                <Crown className="h-3.5 w-3.5 text-[#EA537E]" />
                이사님 (차량 판별 기준 · 한 명만)
              </span>
            </label>
            <button
              type="button"
              onClick={() => void submitAdd()}
              disabled={!!loadErr || adding || !name.trim() || !address.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-white transition-all hover:brightness-110 disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #EA537E, #7C5CFC)' }}
            >
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {adding ? '추가 중…' : '추가'}
            </button>
          </div>

          {msg && (
            <p className={`text-center text-sm ${msg.kind === 'ok' ? 'text-emerald-300' : 'text-rose-300'}`}>
              {msg.text}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
