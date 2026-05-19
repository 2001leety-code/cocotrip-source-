// MeetingPointTab — 탭 ④ 미팅 포인트
import { Plus, Trash2 } from 'lucide-react';
import type { Tour, MeetingPoint, PickupZone } from '@/data/tours';
import { I18nField, I18nTextarea } from './I18nField';
import { PhotoUploader } from '@/components/admin/PhotoUploader';

interface Props {
  draft: Partial<Tour>;
  tourId: string;
  onChange: (patch: Partial<Tour>) => void;
}

function genZoneId(): string {
  return `zone_${Math.random().toString(36).slice(2, 8)}`;
}

export function MeetingPointTab({ draft, tourId, onChange }: Props) {
  const mp: MeetingPoint = draft.meeting_point ?? { kind: 'fixed_address' };

  const update = (patch: Partial<MeetingPoint>) => {
    onChange({ meeting_point: { ...mp, ...patch } });
  };

  const updateZone = (id: string, patch: Partial<PickupZone>) => {
    const zones = mp.zones ?? [];
    const next = zones.map((z) => (z.id === id ? { ...z, ...patch } : z));
    update({ zones: next });
  };

  const addZone = () => {
    const newZone: PickupZone = {
      id: genZoneId(),
      name: { ko: '', en: '', ja: '', zh: '' },
      area_label: { ko: '', en: '', ja: '', zh: '' },
    };
    update({ zones: [...(mp.zones ?? []), newZone] });
  };

  const removeZone = (id: string) => {
    update({ zones: (mp.zones ?? []).filter((z) => z.id !== id) });
  };

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-xs font-semibold text-gray-700 mb-2">유형</label>
        <div className="flex gap-2">
          {([
            { v: 'hotel_pickup', label: '호텔 픽업' },
            { v: 'fixed_address', label: '고정 주소' },
            { v: 'multi_zone', label: '다중 픽업 존' },
          ] as const).map((opt) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => update({ kind: opt.v })}
              className={`px-4 py-2 rounded-lg text-xs font-semibold ${
                mp.kind === opt.v ? 'bg-[#7C5CFC] text-white' : 'bg-gray-50 text-gray-600 border border-gray-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {mp.kind !== 'multi_zone' && (
        <>
          <I18nField label="주소" value={mp.address} onChange={(v) => update({ address: v })} required />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">위도 (lat)</label>
              <input
                type="number"
                step="0.0001"
                value={mp.lat ?? ''}
                onChange={(e) => update({ lat: e.target.value ? parseFloat(e.target.value) : undefined })}
                placeholder="37.5796"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">경도 (lng)</label>
              <input
                type="number"
                step="0.0001"
                value={mp.lng ?? ''}
                onChange={(e) => update({ lng: e.target.value ? parseFloat(e.target.value) : undefined })}
                placeholder="126.9770"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">네이버 지도 URL (선택)</label>
              <input
                type="url"
                value={mp.naver_map_url ?? ''}
                onChange={(e) => update({ naver_map_url: e.target.value || undefined })}
                placeholder="https://map.naver.com/..."
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">Google Maps URL (선택)</label>
              <input
                type="url"
                value={mp.google_maps_url ?? ''}
                onChange={(e) => update({ google_maps_url: e.target.value || undefined })}
                placeholder="https://maps.google.com/..."
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
              />
            </div>
          </div>

          <div>
            <p className="block text-xs font-semibold text-gray-700 mb-1.5">안내 사진 (선택)</p>
            <PhotoUploader
              tourId={tourId}
              bucket="meeting"
              multiple={false}
              value={mp.photo}
              onChange={(v) => update({ photo: v as MeetingPoint['photo'] })}
            />
          </div>
        </>
      )}

      <I18nTextarea
        label="미팅 안내문"
        value={mp.instructions}
        onChange={(v) => update({ instructions: v })}
        rows={3}
        hint='예: "기사가 CocoTrip 사인을 들고 있어요. 출발 10분 전 도착 권장."'
      />

      {mp.kind === 'multi_zone' && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-gray-800">픽업 가능 지역</h3>
            <button
              type="button"
              onClick={addZone}
              className="flex items-center gap-1.5 text-xs font-bold text-[#7C5CFC] bg-[#7C5CFC]/5 px-3 py-1.5 rounded-lg hover:bg-[#7C5CFC]/10"
            >
              <Plus className="w-3.5 h-3.5" />
              지역 추가
            </button>
          </div>

          {(mp.zones ?? []).length === 0 && (
            <div className="text-center py-6 text-xs text-gray-400 border border-dashed border-gray-200 rounded-lg">
              픽업 지역이 없습니다.
            </div>
          )}

          {(mp.zones ?? []).map((z) => (
            <div key={z.id} className="border border-gray-200 rounded-lg p-3 mb-2 bg-gray-50/50">
              <div className="flex items-start gap-3">
                <div className="flex-1 space-y-2">
                  <I18nField label="이름 (예: 강남)" value={z.name} onChange={(v) => updateZone(z.id, { name: v })} />
                  <I18nField label="안내 라벨" value={z.area_label} onChange={(v) => updateZone(z.id, { area_label: v })} optional />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">픽업 시각</label>
                      <input
                        type="text"
                        value={z.pickup_time ?? ''}
                        onChange={(e) => updateZone(z.id, { pickup_time: e.target.value || undefined })}
                        placeholder="08:30"
                        className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">추가 요금 (KRW)</label>
                      <input
                        type="number"
                        value={z.surcharge_krw ?? 0}
                        onChange={(e) => updateZone(z.id, { surcharge_krw: parseInt(e.target.value || '0', 10) || undefined })}
                        className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-xs"
                      />
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeZone(z.id)}
                  className="p-1.5 rounded hover:bg-red-50"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-500" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
