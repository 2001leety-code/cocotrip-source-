// AdminTranslations — 운영자 번역 캐시 검수 UI (PR-S Layer 4)
// 한국어 admin 정책 — i18n 키 X, 인라인 한국어. 사용자 미노출.
// 모바일 친화 — PR-M 패턴 (full-width card list, 좌측 ArrowLeft 홈 링크).
//
// 기능:
//   - 검색 (originalText 또는 translatedText 부분 매칭)
//   - 필터: 언어 (en/ja/zh), source (mapping/gemini/manual)
//   - 각 row: 원문 / 번역 / source / 수정 / 삭제
//   - 수정 모달: 번역 직접 편집 → PATCH /api/admin-translations (source='manual')
//   - 삭제: DELETE /api/admin-translations (다음 호출 시 Gemini 재번역)
import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Edit2, Trash2, Save, X, Search, RefreshCw } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

interface TranslationItem {
  id: string;
  lang: 'en' | 'ja' | 'zh';
  originalText: string;
  translatedText: string;
  source: 'mapping' | 'gemini' | 'manual';
  updatedAt: string | null;
  updatedBy: string | null;
}

interface ListResponse {
  items: TranslationItem[];
  total: number;
  offset: number;
  limit: number;
  generatedAt: string;
}

const SOURCE_LABEL: Record<string, string> = {
  mapping: '매핑(Layer 3)',
  gemini: 'Gemini',
  manual: '수동',
};

const SOURCE_COLOR: Record<string, string> = {
  mapping: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  gemini: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  manual: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
};

const LANG_LABEL: Record<string, string> = {
  en: '영어',
  ja: '일본어',
  zh: '중국어',
};

function AdminTranslations() {
  const { user } = useAuth();
  const [items, setItems] = useState<TranslationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filterLang, setFilterLang] = useState<string>('');
  const [filterSource, setFilterSource] = useState<string>('');
  const [editingItem, setEditingItem] = useState<TranslationItem | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const limit = 50;

  // ── 데이터 로드 ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function fetchList() {
      setLoading(true);
      setError(null);
      try {
        if (!user) {
          if (!cancelled) setError('admin 인증 필요 — 로그인 후 다시 시도하세요.');
          return;
        }
        const idToken = await user.getIdToken();
        const params = new URLSearchParams();
        if (filterLang) params.set('lang', filterLang);
        if (filterSource) params.set('source', filterSource);
        if (search) params.set('search', search);
        params.set('limit', String(limit));
        const res = await fetch(`/api/admin-translations?${params.toString()}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const j = await res.json();
        if (!res.ok) {
          if (!cancelled) setError(j?.error || '조회 실패');
          return;
        }
        const data = j as ListResponse;
        if (!cancelled) {
          setItems(data.items || []);
          setTotal(data.total || 0);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'unknown');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void fetchList();
    return () => { cancelled = true; };
  }, [user, search, filterLang, filterSource, reloadKey]);

  // ── 검색 적용 ─────────────────────────────────────────────────────────────
  const handleSearchSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput.trim());
  }, [searchInput]);

  // ── 수정 모달 ────────────────────────────────────────────────────────────
  const handleEdit = useCallback((it: TranslationItem) => {
    setEditingItem(it);
    setEditValue(it.translatedText);
  }, []);

  const handleSave = useCallback(async () => {
    if (!editingItem || !user) return;
    const trimmed = editValue.trim();
    if (!trimmed) {
      alert('번역값이 비어있습니다.');
      return;
    }
    setSaving(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin-translations', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          originalText: editingItem.originalText,
          lang: editingItem.lang,
          translatedText: trimmed,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        alert(`수정 실패: ${j?.error || res.status}`);
        return;
      }
      setEditingItem(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      alert(`수정 에러: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setSaving(false);
    }
  }, [editingItem, editValue, user]);

  // ── 삭제 ─────────────────────────────────────────────────────────────────
  const handleDelete = useCallback(async (it: TranslationItem) => {
    if (!user) return;
    if (!confirm(`"${it.originalText}" → "${it.translatedText}" 항목을 삭제하시겠습니까?\n다음 호출 시 Gemini 가 재번역합니다.`)) {
      return;
    }
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin-translations', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ docId: it.id }),
      });
      const j = await res.json();
      if (!res.ok) {
        alert(`삭제 실패: ${j?.error || res.status}`);
        return;
      }
      setReloadKey((k) => k + 1);
    } catch (e) {
      alert(`삭제 에러: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }, [user]);

  // ── 렌더 ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0a0b14] text-white p-4 md:p-6 space-y-5">
      {/* 상단 — 홈 링크 + 새로고침 */}
      <div className="flex items-center justify-between gap-3">
        <Link
          to="/admin"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 hover:border-amber-500/50 text-sm font-medium transition-all duration-200 min-h-[44px]"
        >
          <ArrowLeft className="w-4 h-4 shrink-0" /> 어드민 홈으로
        </Link>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="inline-flex items-center gap-1 text-xs text-white/70 hover:text-white px-2 py-1 rounded border border-white/15"
        >
          <RefreshCw className="w-3.5 h-3.5" /> 새로고침
        </button>
      </div>

      <h1 className="text-xl md:text-2xl font-bold">번역 캐시 검수</h1>
      <p className="text-xs text-white/55">
        외국인 사용자에게 노출되는 한국 장소명 번역. 매핑 테이블 → Gemini 순으로 자동 생성됩니다.
        잘못된 번역은 직접 수정하면 <span className="font-semibold text-emerald-300">manual</span> 로 마킹되어 Gemini 재번역에서 제외됩니다.
      </p>

      {/* 필터 + 검색 */}
      <section className="bg-white/[0.04] rounded-2xl p-4 border border-white/10 space-y-3">
        <form onSubmit={handleSearchSubmit} className="flex flex-col md:flex-row gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="원문 또는 번역 검색..."
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-white/[0.06] border border-white/15 text-sm text-white outline-none focus:border-[#B668FC]/50"
            />
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
          </div>
          <button
            type="submit"
            className="px-4 py-2 rounded-lg text-sm font-medium text-white"
            style={{ background: 'linear-gradient(135deg, #B668FC, #FF6B9D)' }}
          >
            검색
          </button>
        </form>
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2 text-xs">
            <span className="text-white/60">언어</span>
            <select
              value={filterLang}
              onChange={(e) => setFilterLang(e.target.value)}
              className="bg-white/[0.08] border border-white/15 rounded px-2 py-1 text-xs text-white"
            >
              <option value="">전체</option>
              <option value="en">영어 (en)</option>
              <option value="ja">일본어 (ja)</option>
              <option value="zh">중국어 (zh)</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <span className="text-white/60">출처</span>
            <select
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value)}
              className="bg-white/[0.08] border border-white/15 rounded px-2 py-1 text-xs text-white"
            >
              <option value="">전체</option>
              <option value="mapping">매핑 (Layer 3)</option>
              <option value="gemini">Gemini</option>
              <option value="manual">수동 (Layer 4)</option>
            </select>
          </label>
        </div>
      </section>

      {/* 결과 */}
      {loading && <p className="text-white/70">로딩 중...</p>}
      {error && (
        <div className="bg-red-500/15 border border-red-500/40 rounded-xl p-4">
          <p className="text-red-300 text-sm">에러: {error}</p>
        </div>
      )}

      {!loading && !error && (
        <>
          <p className="text-xs text-white/55">
            총 {total}건 표시 (limit {limit})
          </p>
          {items.length === 0 ? (
            <p className="text-sm text-white/55 py-8 text-center">표시할 번역이 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {items.map((it) => (
                <article
                  key={it.id}
                  className="bg-white/[0.04] rounded-xl p-3 md:p-4 border border-white/10"
                >
                  <div className="flex flex-col md:flex-row md:items-start gap-3">
                    {/* 좌: 텍스트 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-white/[0.06] text-white/70 font-mono">
                          {LANG_LABEL[it.lang] || it.lang}
                        </span>
                        <span
                          className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border ${SOURCE_COLOR[it.source] || ''}`}
                        >
                          {SOURCE_LABEL[it.source] || it.source}
                        </span>
                        {it.updatedAt && (
                          <span className="text-[10px] text-white/40">
                            {new Date(it.updatedAt).toLocaleString('ko-KR')}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-white/95 font-medium break-all">
                        {it.originalText}
                      </p>
                      <p className="text-xs text-white/65 mt-0.5 break-all">
                        → <span className="text-white/85">{it.translatedText}</span>
                      </p>
                      {it.updatedBy && (
                        <p className="text-[10px] text-white/35 mt-1">
                          업데이트: {it.updatedBy}
                        </p>
                      )}
                    </div>
                    {/* 우: 액션 */}
                    <div className="flex md:flex-col gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleEdit(it)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs text-white/85 border border-white/20 hover:bg-white/[0.06] rounded-lg"
                      >
                        <Edit2 className="w-3 h-3" /> 수정
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(it)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs text-red-300 border border-red-500/40 hover:bg-red-500/10 rounded-lg"
                      >
                        <Trash2 className="w-3 h-3" /> 삭제
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {/* 수정 모달 */}
      {editingItem && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={() => !saving && setEditingItem(null)}
        >
          <div
            className="bg-[#1a1a1a] border border-white/15 rounded-2xl w-full max-w-md p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-base font-semibold">번역 수정</h2>
              <button
                type="button"
                onClick={() => !saving && setEditingItem(null)}
                className="text-white/55 hover:text-white"
                aria-label="닫기"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2">
              <p className="text-xs text-white/55">원문 ({LANG_LABEL[editingItem.lang]})</p>
              <p className="text-sm text-white/90 px-3 py-2 bg-white/[0.04] rounded-lg break-all">
                {editingItem.originalText}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-white/55">번역</label>
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/15 text-sm text-white outline-none focus:border-[#B668FC]/50 resize-none"
                disabled={saving}
              />
            </div>
            <p className="text-[10px] text-white/40">
              저장하면 source 가 <span className="text-emerald-300">manual</span> 로 변경되어 Gemini 재번역에서 제외됩니다.
            </p>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #B668FC, #FF6B9D)' }}
              >
                <Save className="w-3.5 h-3.5" /> {saving ? '저장 중...' : '저장'}
              </button>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                disabled={saving}
                className="flex-1 py-2 rounded-lg text-sm font-medium text-white/85 border border-white/20 hover:bg-white/[0.06] disabled:opacity-50"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminTranslations;
