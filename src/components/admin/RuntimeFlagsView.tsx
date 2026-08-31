export interface RuntimeFlagSchema {
  label: string;
  desc: string;
  default: boolean;
}

interface RuntimeFlagsViewProps {
  flags: Record<string, boolean>;
  schema: Record<string, RuntimeFlagSchema>;
  busy?: string | null;
  onlyKeys?: readonly string[];
  onRequestToggle: (key: string, value: boolean) => void;
}

export function RuntimeFlagsView({ flags, schema, busy, onlyKeys, onRequestToggle }: RuntimeFlagsViewProps) {
  const keys = Object.keys(schema).filter((key) => !onlyKeys || onlyKeys.includes(key));
  if (keys.length === 0) return null;

  return (
    <div className="rounded-xl border border-[#7C5CFC]/25 bg-[#7C5CFC]/[0.06] px-3 sm:px-4 py-3 space-y-2.5">
      <p className="text-[12px] font-bold text-white/85 flex items-center gap-1.5 flex-wrap">
        🎛️ 운영 토글
        <span className="text-[10px] font-normal text-white/45">저장 후 다음 백엔드 실행부터 반영</span>
      </p>
      {keys.map((key) => {
        const on = !!flags[key];
        return (
          <div key={key} className="flex items-start justify-between gap-3 pt-1.5 border-t border-white/[0.05] first:border-t-0 first:pt-0">
            <div className="min-w-0">
              <p className="text-[12px] text-white/80 font-medium">{schema[key].label}</p>
              <p className="text-[10.5px] text-white/45 leading-snug">{schema[key].desc}</p>
            </div>
            <button
              type="button"
              onClick={() => onRequestToggle(key, !on)}
              disabled={busy === key}
              aria-pressed={on}
              aria-busy={busy === key}
              className={`min-h-[44px] shrink-0 rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9D86FF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0b14] disabled:opacity-50 ${
                on
                  ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                  : 'bg-white/[0.04] border-white/[0.12] text-white/55 hover:border-white/25'
              }`}
            >
              {busy === key ? '...' : on ? '✓ 켜짐' : '꺼짐'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
