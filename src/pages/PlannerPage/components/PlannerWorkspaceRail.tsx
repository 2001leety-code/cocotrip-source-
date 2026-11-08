import type { PlannerCopy } from '../plannerCopy';
import { PlannerMasthead } from './PlannerMasthead';
type PlannerModeKey = 'ai' | 'course';
type PlannerWorkspaceRailProps = {
  copy: PlannerCopy;
  modes: ReadonlyArray<{ key: PlannerModeKey; title: string }>;
  selectedMode: PlannerModeKey;
  showModes: boolean;
  onModeChange: (mode: PlannerModeKey) => void;
};
export function PlannerWorkspaceRail({
  copy,
  modes,
  selectedMode,
  showModes,
  onModeChange,
}: PlannerWorkspaceRailProps) {
  return (
    <div className="planner-rail">
      <PlannerMasthead copy={copy} />
      {/* Mode choice — two one-line buttons. The long description of the
          chosen mode sits in a native disclosure below the form (with the
          other supporting notes) and still describes the pressed button;
          full cards pushed the first question to y=901 on a 390×844
          screen (2026-08-06), and on this page nothing outranks the first
          question. */}
      {showModes && (
        <section aria-labelledby="planner-mode-heading" className="planner-modes">
          <h2 id="planner-mode-heading" className="ec-eyebrow">{copy.modes.heading}</h2>
          <div className="planner-mode-row">
            {modes.map(({ key, title }) => {
              const active = selectedMode === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  aria-describedby={active ? 'planner-mode-desc' : undefined}
                  onClick={() => onModeChange(key)}
                  className={`planner-mode-btn ${active ? 'is-selected' : ''}`}
                >
                  {title}
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
