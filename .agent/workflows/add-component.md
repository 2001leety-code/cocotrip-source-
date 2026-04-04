---
description: How to add a new UI component to the project
---

## Add New Component

### 1. Create the component file
- Path: `src/components/YourComponent.tsx`
- File name: **PascalCase** (e.g. `BookingModal.tsx`)

### 2. Component template
```tsx
import { useLanguage } from '@/hooks/useLanguage';
import { SomeIcon } from 'lucide-react';

interface YourComponentProps {
  // Define typed props
}

export function YourComponent({ ...props }: YourComponentProps) {
  const { t, language } = useLanguage();
  const p = t.planner; // or relevant i18n section

  return (
    <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-6">
      {/* Use i18n keys for all text */}
      <h2 className="text-lg font-bold text-white">{p.yourTitle}</h2>
      {/* Use lucide-react for icons */}
      <SomeIcon className="w-5 h-5 text-[#7C5CFC]" />
    </div>
  );
}
```

### 3. i18n keys
- Open `src/i18n/index.ts`
- Add your keys to ALL 4 language sections: `ko`, `en`, `ja`, `zh`
- Key naming: `sectionPrefix_descriptiveName` (e.g. `charter_title`, `planner_submit`)

### 4. Style guidelines
- **Background**: `bg-white/[0.04]` or `bg-gradient-to-br from-[#0f111a] to-[#1a0f18]`
- **Borders**: `border border-white/[0.08]` or `border-[#7C5CFC]/30`
- **Text hierarchy**:
  - Title: `text-white font-bold`
  - Body: `text-white/70`
  - Caption: `text-white/40 text-sm`
  - Muted: `text-white/25 text-xs`
- **CTA buttons**: `bg-gradient-to-r from-[#7C5CFC] to-[#EA537E] text-white font-bold rounded-xl`
- **Card rounding**: `rounded-2xl`
- **Transitions**: `transition-all duration-200`
- **Glow**: `shadow-[0_0_15px_rgba(124,92,252,0.5)]`

### 5. Icons
- Only `lucide-react` — never emoji
- Standard size: `w-4 h-4` or `w-5 h-5`
- Color: `text-[#7C5CFC]` (purple) or `text-white/50`

### 6. Verify
- Build: `npm run build` — must pass with NO errors
- Check for unused imports (TS6133 will fail the build)
- Test all 4 languages by switching via Header language selector
