/**
 * CommandPalette — 전역 검색 팔레트 (Cmd/Ctrl+K)
 *
 * 여행지(Regions), 주요 페이지, 내 계정, 약관으로 빠르게 이동하는 cmdk 기반 팔레트.
 * `useCommandPalette()` 훅으로 어디서든 열 수 있고, Cmd/Ctrl+K 전역 단축키는
 * CommandPaletteProvider 안에서 자동으로 등록된다.
 */
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Home, Package, Map, FileText, Globe, User, ClipboardList, Shield, ScrollText, MapPin } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from '@/components/ui/command';

// ── Region list must stay in sync with src/sections/Regions.tsx ──
const REGION_IDS = [
  'seoul',
  'chuncheon',
  'paju',
  'ganghwa',
  'busan',
  'danyang',
  'incheon',
  'gyeongju',
  'jeonju',
] as const;

type PaletteContext = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
};

const Ctx = createContext<PaletteContext>({
  open: false,
  setOpen: () => {},
  toggle: () => {},
});

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  // ── Global Cmd/Ctrl+K handler ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <Ctx.Provider value={{ open, setOpen, toggle }}>
      {children}
      <CommandPalette />
    </Ctx.Provider>
  );
}

export function useCommandPalette() {
  return useContext(Ctx);
}

function CommandPalette() {
  const { open, setOpen } = useContext(Ctx);
  const { t } = useLanguage();
  const navigate = useNavigate();
  const cp = t.commandPalette;

  const go = useCallback(
    (to: string) => {
      setOpen(false);
      navigate(to);
    },
    [navigate, setOpen],
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={cp.triggerLabel}
      description={cp.placeholder}
    >
      <CommandInput placeholder={cp.placeholder} />
      <CommandList>
        <CommandEmpty>{cp.empty}</CommandEmpty>

        <CommandGroup heading={cp.groups.pages}>
          <CommandItem onSelect={() => go('/')}>
            <Home />
            <span>{cp.items.home}</span>
          </CommandItem>
          <CommandItem onSelect={() => go('/tours')}>
            <Package />
            <span>{cp.items.tours}</span>
          </CommandItem>
          <CommandItem onSelect={() => go('/charter')}>
            <Map />
            <span>{cp.items.charter}</span>
          </CommandItem>
          <CommandItem onSelect={() => go('/planner')}>
            <FileText />
            <span>{cp.items.planner}</span>
          </CommandItem>
          <CommandItem onSelect={() => go('/about')}>
            <Globe />
            <span>{cp.items.about}</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={cp.groups.regions}>
          {REGION_IDS.map((id) => {
            const label = (t.regions as Record<string, string>)[id] ?? id;
            return (
              <CommandItem
                key={id}
                value={`${id} ${label}`}
                onSelect={() => go(`/region/${id}`)}
              >
                <MapPin />
                <span>{label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={cp.groups.account}>
          <CommandItem onSelect={() => go('/mypage')}>
            <User />
            <span>{cp.items.myPage}</span>
          </CommandItem>
          <CommandItem onSelect={() => go('/my-plans')}>
            <ClipboardList />
            <span>{cp.items.myPlans}</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={cp.groups.legal}>
          <CommandItem onSelect={() => go('/terms')}>
            <ScrollText />
            <span>{cp.items.terms}</span>
          </CommandItem>
          <CommandItem onSelect={() => go('/privacy')}>
            <Shield />
            <span>{cp.items.privacy}</span>
          </CommandItem>
          <CommandItem onSelect={() => go('/travel-terms')}>
            <ScrollText />
            <span>{cp.items.travelTerms}</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
