// @vitest-environment jsdom
import React, { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ko from '../../src/i18n/locales/ko.json';
import en from '../../src/i18n/locales/en.json';
import ja from '../../src/i18n/locales/ja.json';
import zh from '../../src/i18n/locales/zh.json';
const lang = vi.hoisted(() => ({ value: 'en', t: {} as typeof en }));
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ language: lang.value, t: lang.t }) }));
import { AddStopModal } from '../../src/pages/PlanDetailPage/components/AddStopModal';
const locales = { ko, en, ja, zh };
function deferred() { let resolve!: () => void; let reject!: (e: unknown) => void; const promise = new Promise<void>((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; }
beforeEach(() => { lang.value = 'en'; lang.t = en; });
afterEach(cleanup);
function fill() { fireEvent.change(screen.getByLabelText(lang.t.planDetail.editor.nameLabel), { target: { value: 'Synthetic venue' } }); fireEvent.change(screen.getByLabelText(lang.t.planDetail.editor.addressLabel), { target: { value: 'Synthetic address' } }); }
function submit() { fireEvent.submit(screen.getByLabelText(lang.t.planDetail.editor.nameLabel).closest('form')!); }
describe('AddStopModal async save boundary', () => {
  it.each(['ko', 'en', 'ja', 'zh'] as const)('preserves draft on failure and renders existing %s error', async lng => {
    lang.value = lng; lang.t = locales[lng]; const d = deferred(); const onAdd = vi.fn(() => d.promise), onClose = vi.fn();
    render(<AddStopModal open onAdd={onAdd} onClose={onClose} />); fill();
    act(() => { submit(); submit(); });
    expect(onAdd).toHaveBeenCalledTimes(1); expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText(lang.t.planDetail.editor.nameLabel)).toBeDisabled();
    await act(async () => { d.reject(new Error('synthetic denied')); });
    expect(screen.getByRole('alert')).toHaveTextContent(lang.t.planDetail.editor.saveFailed);
    expect(screen.getByLabelText(lang.t.planDetail.editor.nameLabel)).toHaveValue('Synthetic venue');
    expect(screen.getByLabelText(lang.t.planDetail.editor.addressLabel)).toHaveValue('Synthetic address');
    expect(screen.getByLabelText(lang.t.planDetail.editor.nameLabel)).toBeEnabled(); expect(onClose).not.toHaveBeenCalled();
  });
  it('awaits actual success before reset and close under StrictMode', async () => {
    const d = deferred(), onClose = vi.fn(), onAdd = vi.fn(() => d.promise);
    render(<StrictMode><AddStopModal open onAdd={onAdd} onClose={onClose} /></StrictMode>); fill(); submit();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { d.resolve(); });
    expect(onClose).toHaveBeenCalledTimes(1); expect(screen.getByLabelText(en.planDetail.editor.nameLabel)).toHaveValue('');
  });
  it.each(['resolve', 'reject'] as const)('late %s cannot clear/close or show error in reopened session', async outcome => {
    const d = deferred(), onAdd = vi.fn(() => d.promise), onClose = vi.fn();
    const view = render(<AddStopModal open onAdd={onAdd} onClose={onClose} />); fill(); submit();
    fireEvent.keyDown(document, { key: 'Escape' }); expect(onClose).toHaveBeenCalledTimes(1);
    view.rerender(<AddStopModal open={false} onAdd={onAdd} onClose={onClose} />);
    view.rerender(<AddStopModal open onAdd={onAdd} onClose={onClose} />);
    submit(); expect(onAdd).toHaveBeenCalledTimes(1);
    await act(async () => { if (outcome === 'resolve') d.resolve(); else d.reject(new Error('denied')); });
    expect(onClose).toHaveBeenCalledTimes(1); expect(screen.getByLabelText(en.planDetail.editor.nameLabel)).toHaveValue('Synthetic venue');
    expect(screen.queryByRole('alert')).toBeNull(); expect(screen.getByLabelText(en.planDetail.editor.nameLabel)).toBeEnabled();
  });
});

vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../../src/pages/PlanDetailPage/lib/optimizeSuggestions', () => ({ buildOptimizeSuggestions: () => [{ type: 'time', proposedOrder: [1, 0], currentKm: 10, proposedKm: 5, savingPct: 50 }] }));
import { OptimizePanel } from '../../src/pages/PlanDetailPage/components/OptimizePanel';
it('real OptimizePanel consumes rejected apply and re-enables its button', async () => {
  const d = deferred(), apply = vi.fn(() => d.promise);
  render(<OptimizePanel day={{ day: 1, stops: [] }} dayIndex={0} onApplyOrder={apply} />);
  const button = screen.getByRole('button', { name: en.planDetail.optimize.timeApply });
  fireEvent.click(button); expect(button).toBeDisabled();
  expect(apply).toHaveBeenCalledWith(0, [1, 0]);
  await act(async () => { d.reject(new Error('synthetic permission-denied')); });
  expect(button).toBeEnabled(); expect(apply).toHaveBeenCalledTimes(1);
});

it.each(['resolve', 'reject'] as const)('unmount ignores late %s without close', async outcome => {
  const d = deferred(), onClose = vi.fn();
  const view = render(<AddStopModal open onAdd={() => d.promise} onClose={onClose} />);
  fill(); submit(); view.unmount();
  await act(async () => { if (outcome === 'resolve') d.resolve(); else d.reject(new Error('synthetic denied')); });
  expect(onClose).not.toHaveBeenCalled();
});

it('uncertain save locks the draft and ordinary submit but keeps same-request confirmation usable',async()=>{
 const d=deferred(),onAdd=vi.fn(()=>d.promise),onClose=vi.fn(),retry=vi.fn(async()=>{});
 const view=render(<AddStopModal open onAdd={onAdd} onClose={onClose}/>);fill();submit();
 await act(async()=>{d.reject(Error('response lost'));});
 view.rerender(<AddStopModal open onAdd={onAdd} onClose={onClose} onRetrySave={retry} saveFailureMessage={en.planDetail.editor.saveUncertain}/>);
 expect(screen.getByLabelText(en.planDetail.editor.nameLabel)).toBeDisabled();
 expect(screen.getByRole('button',{name:en.planDetail.editor.addBtn,exact:true})).toBeDisabled();
 submit();expect(onAdd).toHaveBeenCalledTimes(1);
 expect(screen.getByRole('button',{name:en.planDetail.editor.saveRetry})).toBeEnabled();
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:en.planDetail.editor.saveRetry}));});
 expect(retry).toHaveBeenCalledTimes(1);expect(onClose).toHaveBeenCalledTimes(1);
});
