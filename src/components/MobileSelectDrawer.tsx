import React, { useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from '@/components/ui/drawer';
import { useIsMobile } from '@/hooks/use-mobile';

interface SelectOption {
  value: string;
  label: string;
  sub?: string; // e.g. price or description
}

interface MobileSelectDrawerProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  title?: string;
  icon?: React.ReactNode;
}

/**
 * On mobile → opens a bottom Drawer with styled options
 * On desktop → renders a styled custom dropdown
 *
 * 2026-08-10 (Korea Editorial Concierge phase 2): converted to the paper system.
 * This is shared chrome — the planner (converted) and `/charter` (not yet) both
 * mount it — so it follows the same rule the header and the bottom nav already
 * follow: shared chrome moves once, and a page still on the dark system shows
 * paper chrome over a dark body until its own conversion lands. That
 * transitional state is documented in docs/DESIGN-EDITORIAL-CONCIERGE.md §6.
 * Behaviour, props and option data are untouched.
 */
export function MobileSelectDrawer({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  title = 'Select',
  icon,
}: MobileSelectDrawerProps) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  const selected = options.find(o => o.value === value);
  const displayText = selected?.label || placeholder;

  const handleSelect = (val: string) => {
    onChange(val);
    setOpen(false);
  };

  // Trigger button (same on both mobile and desktop)
  const triggerButton = (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      aria-expanded={open}
      aria-haspopup="listbox"
      // `ec-field` carries the 16px floor — below that iOS zooms the viewport on focus.
      className={`ec-field flex items-center justify-between gap-2 text-left ${selected ? 'text-ec-ink' : 'text-ec-ink-3'}`}
    >
      <span className="flex items-center gap-2 truncate">
        {icon}
        {displayText}
      </span>
      <ChevronDown
        className="h-4 w-4 shrink-0 text-ec-ink-3 transition-transform"
        style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        aria-hidden
      />
    </button>
  );

  // Mobile: use Drawer
  if (isMobile) {
    return (
      <div className="relative">
        {triggerButton}
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent className="ec-root max-h-[70vh] border-ec-line bg-ec-raised">
            <DrawerHeader className="border-b border-ec-line pb-3">
              <DrawerTitle className="ec-h3 text-center">
                {title}
              </DrawerTitle>
            </DrawerHeader>
            <div role="listbox" className="overflow-y-auto px-2 py-2" style={{ maxHeight: '55vh' }}>
              {options.map(opt => (
                <DrawerClose key={opt.value} asChild>
                  <button
                    type="button"
                    role="option"
                    aria-selected={value === opt.value}
                    onClick={() => handleSelect(opt.value)}
                    className={`w-full min-h-[44px] rounded-ec-sm border px-3.5 py-2.5 text-left transition-colors duration-ec-base mt-0.5 flex items-center justify-between ${value === opt.value ? 'border-ec-brand bg-ec-brand-wash text-ec-ink' : 'border-transparent text-ec-ink-2 hover:border-ec-line'}`}
                  >
                    <span className="flex flex-col items-start gap-0.5">
                      <span className="text-[15px] font-semibold">{opt.label}</span>
                      {opt.sub && (
                        <span className="ec-body-sm text-ec-ink-3">{opt.sub}</span>
                      )}
                    </span>
                    {value === opt.value && (
                      <Check className="h-4 w-4 shrink-0 text-ec-brand" aria-hidden />
                    )}
                  </button>
                </DrawerClose>
              ))}
            </div>
          </DrawerContent>
        </Drawer>
      </div>
    );
  }

  // Desktop: custom dropdown
  return (
    <div className="relative">
      {triggerButton}
      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          {/* Dropdown — floats over content, so it takes the one overlay shadow
              the system defines rather than a blur and a black drop. */}
          <div
            role="listbox"
            className="ec-root absolute left-0 right-0 top-full z-50 mt-1 overflow-y-auto rounded-ec-md border border-ec-line bg-ec-raised p-1 shadow-ec-overlay"
            style={{ maxHeight: '300px' }}
          >
            {options.map(opt => (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={value === opt.value}
                onClick={() => handleSelect(opt.value)}
                className={`w-full min-h-[44px] rounded-ec-sm border px-3.5 py-2.5 text-left transition-colors duration-ec-base mt-0.5 flex items-center justify-between ${value === opt.value ? 'border-ec-brand bg-ec-brand-wash text-ec-ink' : 'border-transparent text-ec-ink-2 hover:border-ec-line'}`}
              >
                <span className="flex flex-col items-start gap-0.5">
                  <span className="text-[15px] font-semibold">{opt.label}</span>
                  {opt.sub && (
                    <span className="ec-body-sm text-ec-ink-3">{opt.sub}</span>
                  )}
                </span>
                {value === opt.value && (
                  <Check className="h-4 w-4 shrink-0 text-ec-brand" aria-hidden />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
