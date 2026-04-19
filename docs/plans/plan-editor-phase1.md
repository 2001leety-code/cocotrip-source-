# Plan Editor Level 1 -- Implementation Plan

> **Phase 0 completed**: `.agent/rules/coding-rules.md`, `.agent/workflows/anti-gravity-handoff.md`, `.agent/workflows/antigravity-4phase.md`, `CLAUDE.md` read and acknowledged.

---

## 1. Goal

Allow customers to **partially edit** their paid itinerary on PlanDetailPage:
- Delete a stop (with confirm dialog)
- Add a new stop to a day (via modal form)
- Reorder stops within the same day (drag handle)
- All behind an **Edit Mode toggle** (default off)
- **Optimistic UI** with Firestore rollback on failure

**NOT in scope** (Level 2+): cross-day move, transit recalculation, AI stop suggestions, undo/redo, budget recalc via server, `api/` changes.

---

## 2. Impact Scope

### 2-A. Modified Files

| File | Current Lines | Expected After | Verdict |
|------|:---:|:---:|:---:|
| `src/pages/PlanDetailPage/index.tsx` | 521 | ~590 (+69) | OK (under 600) |
| `src/pages/PlanDetailPage/components/DayTimeline.tsx` | 29 | ~65 (+36) | OK |
| `src/pages/PlanDetailPage/components/StopCard.tsx` | 179 | ~195 (+16) | OK (props only) |
| `src/i18n/index.ts` | 3726 | ~3790 (+64) | OK (data file, 4 langs x 16 keys) |

### 2-B. New Files

| File | Purpose | Est. Lines |
|------|---------|:---:|
| `src/pages/PlanDetailPage/hooks/usePlanEditor.ts` | Firestore optimistic update hook | ~100 |
| `src/pages/PlanDetailPage/components/EditModeToggle.tsx` | Edit mode on/off button | ~45 |
| `src/pages/PlanDetailPage/components/EditableStopCard.tsx` | StopCard wrapper with delete/drag overlay | ~120 |
| `src/pages/PlanDetailPage/components/AddStopModal.tsx` | New stop input modal | ~180 |
| `src/pages/PlanDetailPage/components/DeleteStopDialog.tsx` | Delete confirmation dialog | ~60 |

### 2-C. DB Schema Changes

**No schema changes.** Existing `plan.itinerary.days[i].stops[]` array is updated in-place. Two new metadata fields added to plan document:

```ts
{
  edited: true,            // boolean flag
  lastEditedAt: number,    // Date.now() timestamp
}
```

### 2-D. New Dependencies

```bash
npm install framer-motion @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

| Package | Purpose | Size (gzip) |
|---------|---------|:-----------:|
| `framer-motion` | AnimatePresence exit animations, layout animations | ~40KB |
| `@dnd-kit/core` | Drag-and-drop engine (touch + mouse + keyboard) | ~15KB |
| `@dnd-kit/sortable` | Sortable list preset | ~8KB |
| `@dnd-kit/utilities` | CSS utilities for transforms | ~2KB |
| **Total** | | **~65KB** |

Acceptable for mobile (current bundle ~380KB gzip, +17% increase).

---

## 3. File Size Pre-Check (Mandatory per antigravity-4phase.md)

| File | Current Lines | Post-edit Est. | Verdict |
|------|:---:|:---:|:---:|
| `index.tsx` | 521 | ~590 | OK (< 600) |
| `DayTimeline.tsx` | 29 | ~65 | OK |
| `StopCard.tsx` | 179 | ~195 | OK |
| `i18n/index.ts` | 3726 | ~3790 | OK (data-only, exempt from 600L limit) |
| `useAutoTranslate.ts` | 62 | 62 (NO CHANGE) | LOCKED |
| `pdfGenerator.ts` | 208 | 208 (NO CHANGE) | LOCKED |

**CAUTION**: `useAutoTranslate.ts` and `pdfGenerator.ts` are LOCKED. Import-only, zero internal modification.

---

## 4. Architecture

### 4-A. Component Tree

```
PlanDetailPage/index.tsx
  |-- EditModeToggle            (NEW)
  |-- DayTimeline               (MODIFIED: accepts editMode props)
  |     |-- SortableContext      (NEW: @dnd-kit wrapper)
  |     |     |-- EditableStopCard    (NEW: wraps StopCard)
  |     |     |     |-- StopCard      (EXISTING: +onDelete prop only)
  |     |     |     |-- [drag handle] (GripVertical icon)
  |     |     |     |-- [delete btn]  (X icon)
  |     |-- AddStopButton       (inline, opens AddStopModal)
  |-- AddStopModal              (NEW: portal/overlay)
  |-- DeleteStopDialog          (NEW: confirm overlay)
```

### 4-B. Data Flow

```
User Action (delete/add/reorder)
       |
       v
  usePlanEditor hook
       |
       +--> 1. Clone current plan state (for rollback)
       +--> 2. Optimistic setPlan() (instant UI update)
       +--> 3. Firestore updateDoc()
       |         |
       |         +--> Success: done
       |         +--> Failure: setPlan(rollback) + show error toast
       v
  React re-render (via plan state)
```

### 4-C. Edit Mode State

```tsx
// index.tsx:
const [editMode, setEditMode] = useState(false);
const editor = usePlanEditor(planId, plan, setPlan);

// Pass down:
<EditModeToggle editMode={editMode} onToggle={setEditMode} />
<DayTimeline
  day={days[activeDay]}
  dayIndex={activeDay}
  editMode={editMode}
  onDeleteStop={editor.deleteStop}
  onAddStop={editor.addStop}
  onReorderStops={editor.reorderStops}
/>
```

---

## 5. i18n Keys (ko/en/ja/zh)

All 16 keys added under `t.planner.editor`:

| Key | ko | en |
|-----|----|----|
| `editToggle` | Edit plan | Edit Itinerary |
| `editModeOn` | Editing ON | Editing ON |
| `editModeOff` | Done editing | Done Editing |
| `addStop` | Add place | Add Stop |
| `deleteStop` | Delete | Delete |
| `confirmDeleteTitle` | Delete this place? | Delete this stop? |
| `confirmDeleteMsg` | (removed from itinerary) | (removed from itinerary) |
| `confirmDeleteBtn` | Delete | Delete |
| `cancelBtn` | Cancel | Cancel |
| `stopName` | Place name | Place name |
| `stopAddress` | Address (optional) | Address (optional) |
| `stopTime` | Start time | Start time |
| `stayMinutes` | Duration (min) | Duration (min) |
| `category` | Category | Category |
| `addStopBtn` | Add | Add |
| `editSaved` | Changes saved | Changes saved |

> ja/zh translations will be provided in full in T2. All 4 languages added simultaneously per coding-rules.md.

---

## 6. Risks and Mitigations

### 6-A. Optimistic UI Failure

| Risk | Mitigation |
|------|------------|
| Firestore write fails after UI update | `usePlanEditor` stores `prevPlan` clone before optimistic update. On catch, `setPlan(prevPlan)` restores. |
| Network offline | Firestore SDK offline persistence queues writes. No special handling needed. |

### 6-B. Drag on Mobile Touch

| Risk | Mitigation |
|------|------------|
| Drag conflicts with scroll | `@dnd-kit` touch sensor with `distance: 8` activation constraint. Vertical scroll unaffected. |
| Drag handle too small | Handle = 40x40px min touch target (iOS HIG compliant). |

### 6-C. PDF Generation After Edit

| Risk | Mitigation |
|------|------------|
| Edited stops missing `transit_from_prev` | StopCard already handles missing transit gracefully (skips TransitArrow). |
| `pdfGenerator.ts` reads DOM | No change. Reads whatever DOM state exists at generation time. |

### 6-D. Auto-translate After Edit

| Risk | Mitigation |
|------|------------|
| `useAutoTranslate` overwrites edits on language change | `originalItineraryRef` set on first load only. Subsequent translates use `plan.itinerary` which includes edits. Existing code handles this correctly. |

### 6-E. CLAUDE.md Violations Check

| Rule | Status |
|------|--------|
| `_food_index.json` deletion | Not touched |
| Stop field schema | New stops use `name`/`display_name`/`tip` |
| PDF container positioning | LOCKED, not touched |
| Gemini prompt `verified` | Not touched |
| Emoji usage | Zero -- lucide icons only |

---

## 7. Firestore Update Strategy

```ts
// usePlanEditor.ts
await updateDoc(doc(db, 'plans', planId), {
  'itinerary.days': updatedDays,
  edited: true,
  lastEditedAt: Date.now(),
});
```

**Why full `itinerary.days` array replacement?**
- Firestore has no array-element-by-index update
- `arrayUnion`/`arrayRemove` incompatible with reorder
- Array is small (3-7 days x 4-8 stops = max ~56 objects)

---

## 8. Master Task List

### Execution Graph

```
[T1: npm install]
       |
[T2: i18n keys]  ---|--- (parallel)
[T3: usePlanEditor] |
       |
[T4: DeleteStopDialog]  \
[T5: AddStopModal]        |-- parallel (no mutual imports)
[T6: EditableStopCard]   /
[T7: EditModeToggle]    /
       |
[T8: DayTimeline mod] -- depends on T6, T7
       |
[T9: StopCard mod] -- depends on T6
       |
[T10: index.tsx mod] -- depends on T3, T7, T8
       |
[T11: tsc --noEmit]
[T12: mojibake scan]
```

### T1. Install Dependencies
- **Command**: `npm install framer-motion @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`
- **Verify**: `npx tsc --noEmit`

### T2. i18n Keys (4 languages)
- **File**: `src/i18n/index.ts`
- **Change**: Add `editor: { ... }` inside `planner` for ko/en/ja/zh
- **Est**: +64 lines
- **Parallel**: T3

### T3. `usePlanEditor.ts`
- **File**: NEW `src/pages/PlanDetailPage/hooks/usePlanEditor.ts`
- **Functions**: `deleteStop`, `addStop`, `reorderStops`
- **Est**: ~100 lines
- **Parallel**: T2

### T4. `DeleteStopDialog.tsx`
- **File**: NEW
- **Props**: `open`, `stopName`, `onConfirm`, `onCancel`
- **Est**: ~60 lines
- **Deps**: T2

### T5. `AddStopModal.tsx`
- **File**: NEW
- **Props**: `open`, `onAdd(stopData)`, `onClose`
- **Est**: ~180 lines
- **Deps**: T2

### T6. `EditableStopCard.tsx`
- **File**: NEW
- **Wraps**: StopCard + drag handle + delete btn
- **Est**: ~120 lines
- **Deps**: T1

### T7. `EditModeToggle.tsx`
- **File**: NEW
- **Est**: ~45 lines
- **Deps**: T2

### T8. `DayTimeline.tsx` Modification
- **Change**: Accept edit props, SortableContext, EditableStopCard, + Add Stop btn
- **Est**: 29 -> ~65 lines
- **Deps**: T6, T7

### T9. `StopCard.tsx` Modification
- **Change**: Add optional `onDelete`, `editMode` props. Dashed border in edit mode. NO JSX logic changes.
- **Est**: 179 -> ~195 lines
- **Deps**: T6

### T10. `index.tsx` Modification
- **Change**: editMode state, import hook/components, wire to DayTimeline
- **Est**: 521 -> ~590 lines
- **Deps**: T3, T7, T8

### T11. TypeScript Validation
- **Command**: `npx tsc --noEmit` -- must exit 0

### T12. Mojibake Scan
- **Command**: Scan all modified/new files per coding-rules.md 1.5
- **DoD**: All CLEAN

---

## 9. Approval Checklist

- [ ] User approval for this plan
- [ ] File size limits pass (all under 600L)
- [ ] i18n 4 languages prepared (ko/en/ja/zh)
- [ ] LOCKED files untouched (useAutoTranslate.ts, pdfGenerator.ts)
- [ ] No api/ serverless function changes
- [ ] No ODsay/Naver/Gemini API calls added
- [ ] New dependency bundle impact acceptable (~65KB gzip)
- [ ] Ready to proceed to Phase 3 execution

---

**Phase 1 complete. Review and approve to proceed to Phase 3 (task execution). Any modifications needed?**
