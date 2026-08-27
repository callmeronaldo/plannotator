import { afterEach, describe, expect, test } from 'bun:test';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DiffHunkNavigator } from './DiffHunkNavigator';

const hasDom = typeof document !== 'undefined';

describe.if(hasDom)('DiffHunkNavigator (DOM)', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = null;
    host?.remove();
    host = null;
  });

  test('jumps between diff blocks and wraps in both directions', async () => {
    const viewport = document.createElement('div');
    let scrollTop = 0;
    const scrollCalls: number[] = [];
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1000 },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => { scrollTop = value; },
      },
      scrollTo: {
        configurable: true,
        value: ({ top }: ScrollToOptions) => {
          scrollTop = top ?? 0;
          scrollCalls.push(scrollTop);
        },
      },
    });

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(
        <DiffHunkNavigator
          viewport={viewport}
          marks={[
            { top: 0.1, height: 0.01, additions: 1, deletions: 0 },
            { top: 0.5, height: 0.01, additions: 1, deletions: 1 },
            { top: 0.9, height: 0.01, additions: 0, deletions: 1 },
          ]}
        />,
      );
    });

    expect(host.textContent).toContain('1/3');
    const next = host.querySelector<HTMLButtonElement>('button[aria-label="Next diff block"]')!;
    const previous = host.querySelector<HTMLButtonElement>('button[aria-label="Previous diff block"]')!;

    await act(async () => next.click());
    expect(scrollCalls.at(-1)).toBe(400);
    expect(host.textContent).toContain('2/3');

    await act(async () => previous.click());
    await act(async () => previous.click());
    expect(scrollCalls.at(-1)).toBe(720);
    expect(host.textContent).toContain('3/3');
  });
});
