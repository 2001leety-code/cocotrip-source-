// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminChannelReadiness, type ChannelResponseReadiness } from '@/components/AdminChannelReadiness';
void React;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const gate = { ready: false, reason: 'DISABLED', delivery: 'not-verified' as const };
const fixture: ChannelResponseReadiness = {
  autoAck: gate,
  channels: (['webform', 'webchat', 'email', 'whatsapp', 'instagram', 'tiktok'] as const).map((channel) => ({
    channel, implementation: 'fixture', supported: channel !== 'instagram' && channel !== 'tiktok',
    intake: { status: channel === 'instagram' || channel === 'tiktok' ? 'not_implemented' : 'not_ready', detail: 'fixture' },
    autoAck: gate, ownerPush: { ...gate, ready: true, inbox: gate },
  })),
};
describe('channel readiness presentation', () => {
  it.each(['ko', 'en', 'ja', 'zh'] as const)('renders all six channels in %s without any external calls', (language) => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    render(<AdminChannelReadiness data={fixture} language={language} />);
    expect(screen.getByTestId('channel-readiness').querySelectorAll('section')).toHaveLength(6);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not promote a missing/stale snapshot to active', () => {
    render(<AdminChannelReadiness data={null} language="ko" />);
    expect(screen.getByText(/현재 설정을 확인하지 못했습니다/)).toBeTruthy();
    expect(screen.queryByText('설정 준비')).toBeNull();
  });
  it('requires the inbox gate as well as owner push readiness', () => {
    render(<AdminChannelReadiness data={fixture} language="ko" />);
    const whatsapp = screen.getByRole('region', { name: 'WhatsApp', hidden: true });
    expect(within(whatsapp).getByText('꺼짐 / 설정 필요')).toBeTruthy();
    expect(within(whatsapp).getByText(/자동답장 없음/)).toBeTruthy();
    expect(screen.getByText('실제 전달 미검증')).toBeTruthy();
  });
});
