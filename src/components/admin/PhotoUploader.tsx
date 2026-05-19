// ─────────────────────────────────────────────────────────────────────────────
// PhotoUploader — 어드민 사진 업로드 (Phase 1, 2026-05-19)
//   - multiple=false: 단일 사진 (썸네일, 미팅 포인트 사진)
//   - multiple=true: 갤러리 (드래그·드롭 정렬은 ↑↓ 버튼으로 대체)
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Upload, Trash2, Edit2, ChevronUp, ChevronDown, Loader2, Image as ImageIcon } from 'lucide-react';
import type { TourPhoto, I18nString } from '@/data/tours';
import type { Language } from '@/i18n';
import { uploadTourPhoto, deleteTourPhoto } from '@/lib/storage-upload';
import { AltEditorModal } from '@/components/admin/AltEditorModal';

type Value = TourPhoto[] | TourPhoto | undefined;

interface Props {
  tourId: string;
  bucket: string;
  multiple?: boolean;
  value: Value;
  onChange: (value: Value) => void;
  maxFiles?: number;
  language?: Language;
}

function altText(alt: I18nString | undefined, lang: Language): string {
  if (!alt) return '';
  return alt[lang] || alt.en || alt.ko || '';
}

export function PhotoUploader({
  tourId,
  bucket,
  multiple = false,
  value,
  onChange,
  maxFiles = 10,
  language = 'ko',
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progressMap, setProgressMap] = useState<Record<string, number>>({});
  const [editingAlt, setEditingAlt] = useState<{ photo: TourPhoto; index: number } | null>(null);

  const valueArr: TourPhoto[] = multiple
    ? (Array.isArray(value) ? value : [])
    : (value && !Array.isArray(value) ? [value] : []);

  const updateValue = useCallback((next: TourPhoto[]) => {
    if (multiple) {
      onChange(next);
    } else {
      onChange(next[0]);
    }
  }, [multiple, onChange]);

  const handleFiles = useCallback(async (files: FileList) => {
    const fileArr = Array.from(files);
    if (!multiple && fileArr.length > 1) {
      toast.warning('단일 사진만 업로드 가능합니다.');
      return;
    }
    const remaining = multiple ? maxFiles - valueArr.length : 1;
    if (fileArr.length > remaining) {
      toast.warning(`최대 ${maxFiles}장까지 업로드 가능합니다.`);
      return;
    }

    for (const file of fileArr) {
      const key = `${file.name}-${file.size}-${Date.now()}`;
      setProgressMap((m) => ({ ...m, [key]: 0 }));
      try {
        const photo = await uploadTourPhoto(tourId, bucket, file, (pct) => {
          setProgressMap((m) => ({ ...m, [key]: pct }));
        });
        const newArr = multiple ? [...valueArr, photo] : [photo];
        updateValue(newArr);
        toast.success(`업로드 완료: ${file.name}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '업로드 실패');
      } finally {
        setProgressMap((m) => {
          const next = { ...m };
          delete next[key];
          return next;
        });
      }
    }
  }, [bucket, maxFiles, multiple, tourId, updateValue, valueArr]);

  const handleDelete = async (index: number) => {
    const photo = valueArr[index];
    if (!photo) return;
    if (!window.confirm(`사진을 삭제할까요?\n${altText(photo.alt, language) || photo.url}`)) return;
    try {
      await deleteTourPhoto(photo.url);
    } catch (err) {
      console.warn('[PhotoUploader] storage delete failed (계속 진행):', err);
    }
    const next = valueArr.filter((_, i) => i !== index);
    updateValue(next);
  };

  const move = (index: number, direction: -1 | 1) => {
    const newIdx = index + direction;
    if (newIdx < 0 || newIdx >= valueArr.length) return;
    const next = [...valueArr];
    [next[index], next[newIdx]] = [next[newIdx], next[index]];
    updateValue(next);
  };

  const updateAlt = (index: number, newAlt: I18nString) => {
    const next = [...valueArr];
    next[index] = { ...next[index], alt: newAlt };
    updateValue(next);
  };

  const isFull = valueArr.length >= maxFiles && multiple;
  const showDropZone = multiple || valueArr.length === 0;

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          e.target.value = ''; // reset
        }}
      />

      {multiple ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {valueArr.map((photo, i) => (
            <PhotoThumb
              key={photo.url + i}
              photo={photo}
              index={i}
              total={valueArr.length}
              language={language}
              onDelete={() => handleDelete(i)}
              onEditAlt={() => setEditingAlt({ photo, index: i })}
              onMoveUp={() => move(i, -1)}
              onMoveDown={() => move(i, 1)}
            />
          ))}

          {!isFull && (
            <DropZone
              dragging={dragging}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
            />
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {valueArr[0] && (
            <div className="relative">
              <img
                src={valueArr[0].url}
                alt={altText(valueArr[0].alt, language)}
                className="w-full max-h-72 object-contain rounded-2xl border border-gray-200 bg-gray-50"
              />
              <div className="absolute top-2 right-2 flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setEditingAlt({ photo: valueArr[0], index: 0 })}
                  className="p-1.5 rounded-lg bg-white/90 shadow hover:bg-white"
                  title="Alt 편집"
                >
                  <Edit2 className="w-3.5 h-3.5 text-gray-700" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(0)}
                  className="p-1.5 rounded-lg bg-white/90 shadow hover:bg-red-50"
                  title="삭제"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-500" />
                </button>
              </div>
            </div>
          )}

          {showDropZone && (
            <DropZone
              dragging={dragging}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
            />
          )}
        </div>
      )}

      {/* 진행 중 업로드 */}
      {Object.keys(progressMap).length > 0 && (
        <div className="mt-3 space-y-2">
          {Object.entries(progressMap).map(([key, pct]) => (
            <div key={key} className="flex items-center gap-2 text-xs text-gray-600">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#7C5CFC]" />
              <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full bg-[#7C5CFC] transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-10 text-right tabular-nums">{pct}%</span>
            </div>
          ))}
        </div>
      )}

      {editingAlt && (
        <AltEditorModal
          photo={editingAlt.photo}
          open
          onSave={(newAlt) => updateAlt(editingAlt.index, newAlt)}
          onClose={() => setEditingAlt(null)}
        />
      )}
    </div>
  );
}

function PhotoThumb({
  photo, index, total, language, onDelete, onEditAlt, onMoveUp, onMoveDown,
}: {
  photo: TourPhoto;
  index: number;
  total: number;
  language: Language;
  onDelete: () => void;
  onEditAlt: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <div className="relative group rounded-xl overflow-hidden border border-gray-200 bg-gray-50 aspect-square">
      <img
        src={photo.url}
        alt={altText(photo.alt, language)}
        className="w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-all opacity-0 group-hover:opacity-100">
        <div className="absolute inset-0 flex flex-col justify-between p-2">
          <div className="flex justify-between">
            <span className="px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] font-bold">
              {index + 1}/{total}
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={onMoveUp}
                disabled={index === 0}
                className="p-1 rounded bg-white/90 hover:bg-white disabled:opacity-40"
                title="앞으로"
              >
                <ChevronUp className="w-3 h-3 text-gray-700" />
              </button>
              <button
                type="button"
                onClick={onMoveDown}
                disabled={index === total - 1}
                className="p-1 rounded bg-white/90 hover:bg-white disabled:opacity-40"
                title="뒤로"
              >
                <ChevronDown className="w-3 h-3 text-gray-700" />
              </button>
            </div>
          </div>
          <div className="flex justify-between">
            <button
              type="button"
              onClick={onEditAlt}
              className="p-1.5 rounded-lg bg-white/90 hover:bg-white"
              title="Alt 편집"
            >
              <Edit2 className="w-3 h-3 text-gray-700" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="p-1.5 rounded-lg bg-white/90 hover:bg-red-50"
              title="삭제"
            >
              <Trash2 className="w-3 h-3 text-red-500" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DropZone({
  dragging, onDragOver, onDragLeave, onDrop, onClick,
}: {
  dragging: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`w-full aspect-square sm:aspect-auto sm:min-h-[160px] flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed transition-all ${
        dragging
          ? 'border-[#7C5CFC] bg-[#7C5CFC]/5'
          : 'border-gray-200 bg-gray-50 hover:border-[#7C5CFC]/50 hover:bg-[#7C5CFC]/5'
      }`}
    >
      <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${
        dragging ? 'bg-[#7C5CFC]/15' : 'bg-white'
      }`}>
        {dragging ? <Upload className="w-5 h-5 text-[#7C5CFC]" /> : <ImageIcon className="w-5 h-5 text-gray-400" />}
      </div>
      <p className="text-xs font-medium text-gray-600">
        {dragging ? '여기에 놓으세요' : '클릭 또는 드래그로 업로드'}
      </p>
      <p className="text-[10px] text-gray-400">JPG · PNG · WebP · GIF (최대 8MB)</p>
    </button>
  );
}
