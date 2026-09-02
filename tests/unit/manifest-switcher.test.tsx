// @vitest-environment jsdom

import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ManifestSwitcher } from '../../src/components/ManifestSwitcher';

function createHeadLinks() {
  const manifest = document.createElement('link');
  manifest.setAttribute('rel', 'manifest');
  manifest.setAttribute('href', '/manifest.webmanifest');
  document.head.appendChild(manifest);

  const apple = document.createElement('link');
  apple.setAttribute('rel', 'apple-touch-icon');
  apple.setAttribute('href', '/icons/icon-192.png');
  document.head.appendChild(apple);

  return { manifest, apple };
}

function removeHeadLinks() {
  for (const element of document.querySelectorAll('link[rel="manifest"], link[rel="apple-touch-icon"]')) {
    element.remove();
  }
}

afterEach(() => {
  cleanup();
  removeHeadLinks();
});

describe('ManifestSwitcher', () => {
  it('Owner 경로에서 owner manifest/아이콘으로 바꾼다', async () => {
    const { manifest, apple } = createHeadLinks();
    render(
      <MemoryRouter initialEntries={['/admin/ai-center/dashboard']}>
        <ManifestSwitcher />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(manifest.getAttribute('href')).toBe('/manifest-owner-controller.webmanifest');
      expect(apple.getAttribute('href')).toBe('/icons/icon-192.png');
    });
  });

  it('MOOD 경로에서 MOOD manifest/아이콘으로 바꾼다', async () => {
    const { manifest, apple } = createHeadLinks();
    render(
      <MemoryRouter initialEntries={['/mood/plan']}>
        <ManifestSwitcher />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(manifest.getAttribute('href')).toBe('/manifest-mood.webmanifest');
      expect(apple.getAttribute('href')).toBe('/icons/mood-192.png');
    });
  });

  it('일반 경로는 기본 manifest로 되돌린다', async () => {
    const { manifest, apple } = createHeadLinks();
    render(
      <MemoryRouter initialEntries={['/']}>
        <ManifestSwitcher />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(manifest.getAttribute('href')).toBe('/manifest.webmanifest');
      expect(apple.getAttribute('href')).toBe('/icons/icon-192.png');
    });
  });
});
