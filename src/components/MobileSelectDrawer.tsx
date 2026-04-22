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
      className="w-full flex items-center justify-between px-4 py-3.5 rounded-xl border border-white/15 bg-white/[0.04] text-sm font-medium outline-none transition-all hover:border-[#B668FC]/40 focus:border-[#B668FC]/60"
      style={{ color: selected ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)' }}
    >
      <span className="flex items-center gap-2 truncate">
        {icon}
        {displayText}
      </span>
      <ChevronDown
        className="w-4 h-4 text-white/30 shrink-0 transition-transform"
        style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
      />
    </button>
  );

  // Mobile: use Drawer
  if (isMobile) {
    return (
      <div className="relative">
        {triggerButton}
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent className="bg-[#0f1220] border-white/10 max-h-[70vh]">
            <DrawerHeader className="border-b border-white/[0.06] pb-3">
              <DrawerTitle className="text-white text-base font-bold text-center">
                {title}
              </DrawerTitle>
            </DrawerHeader>
            <div className="overflow-y-auto px-2 py-2 space-y-0.5" style={{ maxHeight: '55vh' }}>
              {options.map(opt => (
                <DrawerClose key={opt.value} asChild>
                  <button
                    type="button"
                    onClick={() => handleSelect(opt.value)}
                    className="w-full flex items-center justify-between px-4 py-3.5 rounded-xl text-sm transition-all"
                    style={{
                      background: value === opt.value ? 'rgba(182,104,252,0.12)' : 'transparent',
                      color: value === opt.value ? '#B668FC' : 'rgba(255,255,255,0.7)',
                    }}
                  >
                    <div className="flex flex-col items-start gap-0.5">
                      <span className="font-medium">{opt.label}</span>
                      {opt.sub && (
                        <span className="text-xs text-white/30">{opt.sub}</span>
                      )}
                    </div>
                    {value === opt.value && (
                      <Check className="w-4 h-4 text-[#B668FC] shrink-0" />
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
          {/* Dropdown */}
          <div
            className="absolute top-full left-0 right-0 mt-1 z-50 rounded-xl py-1 overflow-y-auto"
            style={{
              maxHeight: '300px',
              background: 'rgba(15,18,32,0.97)',
              backdropFilter: 'blur(16px)',
              border: '1px solid rgba(255,255,255,0.08)',
              boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
            }}
          >
            {options.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleSelect(opt.value)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm transition-all hover:bg-white/[0.04]"
                style={{
                  color: value === opt.value ? '#B668FC' : 'rgba(255,255,255,0.6)',
                  background: value === opt.value ? 'rgba(182,104,252,0.06)' : 'transparent',
                }}
              >
                <div className="flex flex-col items-start gap-0.5">
                  <span className="font-medium">{opt.label}</span>
                  {opt.sub && (
                    <span className="text-xs text-white/25">{opt.sub}</span>
                  )}
                </div>
                {value === opt.value && (
                  <Check className="w-4 h-4 text-[#B668FC] shrink-0" />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
