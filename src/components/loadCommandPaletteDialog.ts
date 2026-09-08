// Separate import function allows deterministic offline failure/retry tests.
// Calling it, not importing it, starts the dialog request.
export function loadCommandPaletteDialog() {
  return import('./CommandPaletteDialog');
}
