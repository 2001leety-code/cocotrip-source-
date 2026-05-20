// MediaTab — 탭 ② 미디어 (썸네일 + 갤러리 + 영상)
import type { Tour } from '@/data/tours';
import { PhotoUploader } from '@/components/admin/PhotoUploader';

interface Props {
  draft: Partial<Tour>;
  tourId: string;
  onChange: (patch: Partial<Tour>) => void;
}

export function MediaTab({ draft, tourId, onChange }: Props) {
  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-bold text-gray-800 mb-2">썸네일 사진</h3>
        <p className="text-[11px] text-gray-500 mb-3">
          1200×630 권장 (OG/SNS 공유용). 1장만 등록.
        </p>
        <PhotoUploader
          tourId={tourId}
          bucket="thumbnail"
          multiple={false}
          value={draft.thumbnail_photo}
          onChange={(v) => onChange({ thumbnail_photo: v as Tour['thumbnail_photo'] })}
        />
      </section>

      <section>
        <h3 className="text-sm font-bold text-gray-800 mb-2">갤러리 사진</h3>
        <p className="text-[11px] text-gray-500 mb-3">
          최대 10장. 첫 사진이 슬라이드 시작 컷.
        </p>
        <PhotoUploader
          tourId={tourId}
          bucket="gallery"
          multiple
          maxFiles={10}
          value={draft.photos ?? []}
          onChange={(v) => onChange({ photos: (v as Tour['photos']) ?? [] })}
        />
      </section>

      <section>
        <h3 className="text-sm font-bold text-gray-800 mb-2">영상 (선택)</h3>
        <p className="text-[11px] text-gray-500 mb-2">
          YouTube 또는 Vimeo embed URL (예: https://www.youtube.com/embed/abc123)
        </p>
        <input
          type="url"
          value={draft.video_embed_url ?? ''}
          onChange={(e) => onChange({ video_embed_url: e.target.value || undefined })}
          placeholder="https://www.youtube.com/embed/..."
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
        />
        {draft.video_embed_url && (
          <div className="mt-3 rounded-lg overflow-hidden border border-gray-200 bg-gray-50 max-w-md">
            <iframe
              src={draft.video_embed_url}
              className="w-full aspect-video"
              title="preview"
              allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
              allowFullScreen
            />
          </div>
        )}
      </section>
    </div>
  );
}
