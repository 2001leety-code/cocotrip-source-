// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useIsMobile } from '../../src/hooks/use-mobile';
import { Carousel, CarouselNext, CarouselPrevious } from '../../src/components/ui/carousel';
import { SidebarMenuSkeleton } from '../../src/components/ui/sidebar';

const embla = vi.hoisted(() => {
  const listeners = new Map<string, Set<() => void>>();
  const api = {
    canScrollPrev: vi.fn(() => false), canScrollNext: vi.fn(() => true),
    scrollPrev: vi.fn(), scrollNext: vi.fn(),
    on: vi.fn((event: string, callback: () => void) => {
      const handlers = listeners.get(event) || new Set<() => void>();
      handlers.add(callback); listeners.set(event, handlers); return api;
    }),
    off: vi.fn((event: string, callback: () => void) => { listeners.get(event)?.delete(callback); return api; }),
  };
  return { api, listeners };
});
vi.mock('embla-carousel-react', () => ({ default: () => [() => {}, embla.api] }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); embla.listeners.clear(); });

describe('external UI subscriptions', () => {
  it('uses the matching media query snapshot, updates on breakpoint changes, and unsubscribes', () => {
    let isMobile = true;
    const listeners = new Set<(event: Event) => void>();
    const addEventListener = vi.fn((_event: string, callback: (event: Event) => void) => listeners.add(callback));
    const removeEventListener = vi.fn((_event: string, callback: (event: Event) => void) => listeners.delete(callback));
    const innerWidth = vi.fn(() => 390);
    const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
    Object.defineProperty(window, 'innerWidth', { configurable: true, get: innerWidth });
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query === '(max-width: 767px)' && isMobile,
      addEventListener,
      removeEventListener,
    })));

    try {
      const hook = renderHook(() => useIsMobile());
      expect(hook.result.current).toBe(true);
      expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 767px)');
      expect(innerWidth).not.toHaveBeenCalled();
      act(() => { isMobile = false; listeners.forEach(callback => callback(new Event('change'))); });
      expect(hook.result.current).toBe(false);
      act(() => { isMobile = true; listeners.forEach(callback => callback(new Event('change'))); });
      expect(hook.result.current).toBe(true);
      hook.unmount();
      expect(listeners.size).toBe(0);
      expect(removeEventListener).toHaveBeenCalledTimes(1);
    } finally {
      if (originalInnerWidth) Object.defineProperty(window, 'innerWidth', originalInnerWidth);
      else delete (window as unknown as Record<string, unknown>).innerWidth;
    }
  });

  it('keeps carousel controls in sync with selection/reinitialization and removes both listeners', () => {
    const view = render(<Carousel><CarouselPrevious /><CarouselNext /></Carousel>);
    expect(screen.getByRole('button', { name: 'Previous slide' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next slide' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }));
    expect(embla.api.scrollNext).toHaveBeenCalledOnce();
    act(() => {
      embla.api.canScrollPrev.mockReturnValue(true); embla.api.canScrollNext.mockReturnValue(false);
      embla.listeners.get('select')?.forEach(callback => callback());
    });
    expect(screen.getByRole('button', { name: 'Previous slide' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next slide' })).toBeDisabled();
    act(() => {
      embla.api.canScrollNext.mockReturnValue(true);
      embla.listeners.get('reInit')?.forEach(callback => callback());
    });
    expect(screen.getByRole('button', { name: 'Next slide' })).toBeEnabled();
    view.unmount();
    expect(embla.listeners.get('select')?.size).toBe(0);
    expect(embla.listeners.get('reInit')?.size).toBe(0);
  });

  it('keeps the skeleton width stable across rerenders', () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.25).mockReturnValue(0.75);
    const view = render(<SidebarMenuSkeleton />);
    const width = () => (view.container.querySelector('[data-sidebar="menu-skeleton-text"]') as HTMLElement).style.getPropertyValue('--skeleton-width');
    expect(width()).toBe('60%');
    view.rerender(<SidebarMenuSkeleton showIcon />);
    expect(width()).toBe('60%');
  });
});
