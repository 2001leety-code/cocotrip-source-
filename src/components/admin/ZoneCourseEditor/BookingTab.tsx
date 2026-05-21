// BookingTab — 탭 ⑥ Booking flags (passport / advance booking)
import type { ZoneCourseDoc } from '@/lib/zone-courses-firestore';

interface Props {
  draft: Partial<ZoneCourseDoc>;
  onChange: (patch: Partial<ZoneCourseDoc>) => void;
}

export function BookingTab({ draft, onChange }: Props) {
  return (
    <div className="space-y-4">
      <p className="text-[11px] text-gray-500">
        block 단위 메타 flag. Stops 탭에서 개별 stop 의 reservation_required 도 함께 사용.
      </p>

      <label className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer ${
        draft.passport_required ? 'bg-[#7C5CFC]/5 border-[#7C5CFC]/30' : 'bg-white border-gray-200'
      }`}>
        <input
          type="checkbox"
          checked={!!draft.passport_required}
          onChange={(e) => onChange({ passport_required: e.target.checked })}
          className="mt-0.5"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-base">🛂</span>
            <span className="text-sm font-bold text-gray-800">여권 지참 필요</span>
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5">
            면세점·박물관·정부 시설 등 외국인 여권 확인이 필요한 stop 1 개 이상 포함.
          </p>
        </div>
      </label>

      <label className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer ${
        draft.requires_advance_booking ? 'bg-[#7C5CFC]/5 border-[#7C5CFC]/30' : 'bg-white border-gray-200'
      }`}>
        <input
          type="checkbox"
          checked={!!draft.requires_advance_booking}
          onChange={(e) => onChange({ requires_advance_booking: e.target.checked })}
          className="mt-0.5"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-base">🎫</span>
            <span className="text-sm font-bold text-gray-800">사전 예약 필요</span>
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5">
            전망대/관람 시설 등 사전 예매 필요한 stop 포함. AI 플래너가 사용자에게 예약 안내 추가.
          </p>
        </div>
      </label>
    </div>
  );
}
