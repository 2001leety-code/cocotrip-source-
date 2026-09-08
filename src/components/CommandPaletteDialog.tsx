import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Home, Package, Map, FileText, Globe, User, ClipboardList, Shield, ScrollText, MapPin } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty,
  CommandGroup, CommandItem, CommandSeparator,
} from '@/components/ui/command';

// Keep the existing search destinations and ordering; this split changes only
// when the dialog code is downloaded, not the customer's navigation options.
const REGION_IDS = [
  'seoul', 'chuncheon', 'paju', 'ganghwa', 'busan',
  'danyang', 'incheon', 'gyeongju', 'jeonju',
] as const;

export default function CommandPaletteDialog({ open, setOpen }: {
  open: boolean;
  setOpen: (value: boolean) => void;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const cp = t.commandPalette;
  const go = useCallback((to: string) => {
    setOpen(false);
    navigate(to);
  }, [navigate, setOpen]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title={cp.triggerLabel} description={cp.placeholder}>
      <CommandInput data-cocotrip-search-input placeholder={cp.placeholder} aria-label={cp.placeholder} />
      <CommandList>
        <CommandEmpty>{cp.empty}</CommandEmpty>
        <CommandGroup heading={cp.groups.pages}>
          <CommandItem onSelect={() => go('/')}><Home /><span>{cp.items.home}</span></CommandItem>
          <CommandItem onSelect={() => go('/tours')}><Package /><span>{cp.items.tours}</span></CommandItem>
          <CommandItem onSelect={() => go('/charter')}><Map /><span>{cp.items.charter}</span></CommandItem>
          <CommandItem onSelect={() => go('/planner')}><FileText /><span>{cp.items.planner}</span></CommandItem>
          <CommandItem onSelect={() => go('/about')}><Globe /><span>{cp.items.about}</span></CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading={cp.groups.regions}>
          {REGION_IDS.map((id) => {
            const label = (t.regions as Record<string, string>)[id] || id;
            return (
              <CommandItem key={id} value={`${id} ${label}`} onSelect={() => go(`/region/${id}`)}>
                <MapPin /><span>{label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading={cp.groups.account}>
          <CommandItem onSelect={() => go('/mypage')}><User /><span>{cp.items.myPage}</span></CommandItem>
          <CommandItem onSelect={() => go('/my-plans')}><ClipboardList /><span>{cp.items.myPlans}</span></CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading={cp.groups.legal}>
          <CommandItem onSelect={() => go('/terms')}><ScrollText /><span>{cp.items.terms}</span></CommandItem>
          <CommandItem onSelect={() => go('/privacy')}><Shield /><span>{cp.items.privacy}</span></CommandItem>
          <CommandItem onSelect={() => go('/travel-terms')}><ScrollText /><span>{cp.items.travelTerms}</span></CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
