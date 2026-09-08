import { createContext, useContext } from 'react';

type PaletteContext = {
  open: boolean;
  setOpen: (value: boolean) => void;
  toggle: () => void;
};

export const CommandPaletteContext = createContext<PaletteContext>({
  open: false,
  setOpen: () => {},
  toggle: () => {},
});

export function useCommandPalette() {
  return useContext(CommandPaletteContext);
}
