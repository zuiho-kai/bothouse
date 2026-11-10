// #225: 深色风格下向导页的字看不清，按钮还显示「下一个」风格。
// 两条都靠契约守住：向导的文字色只能从 index.css 的 --ui-* 墨色阶梯取（浅/深/黄白各有一套，
// 深色那套在 index.css 的 .dark 里），深色下 Tailwind 的 gray-500/400 必须被接到那套阶梯上；
// 顶栏风格按钮显示的是当前风格。
// @ts-expect-error The project intentionally does not depend on Node type declarations.
import { readFileSync } from 'node:fs';
declare const process: { cwd: () => string };
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Header from '@/components/Layout/Header';
import { useThemeStore } from '@/store/theme';
import { wizardTexts } from './texts';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh', changeLanguage: vi.fn() } }),
}));

// vitest runs with bridge/web as the working directory (package.json "test").
const setupCss = readFileSync(`${process.cwd()}/src/pages/Setup/setup.css`, 'utf8');
const indexCss = readFileSync(`${process.cwd()}/src/index.css`, 'utf8');

/** The declarations inside `selector { … }` blocks of a stylesheet, selector by selector. */
function blocks(css: string): { selector: string; body: string }[] {
  return Array.from(css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g))
    .map((m) => ({ selector: m[1].trim(), body: m[2] }));
}

/** Custom properties a block defines, as `--name` → value. */
function vars(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const rootVars = (selector: string) => vars(blocks(indexCss).filter((b) => b.selector === selector).map((b) => b.body).join(';'));

/** `#rrggbb` or `r g b` → `r g b`, so both stylesheets can be compared. */
function hex(color: string): string {
  const h = color.trim().replace('#', '');
  if (/^[0-9a-f]{6}$/i.test(h)) return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(' ');
  return color
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .join(' ');
}

/** Contrast ratio of two `r g b` token values, WCAG 2.x. */
function contrast(a: string, b: string): number {
  const lum = (rgb: string) => {
    const [r, g, bl] = rgb.trim().split(/\s+/).map(Number).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('wizard dark style', () => {
  it('takes wizard text colors from the token layer, never from a literal hex', () => {
    // A literal color on a text rule is exactly what left the dark wizard washed out: #272938 stayed
    // on the card and only h1/intro got a .dark patch. Shadows and the two page gradients may stay
    // literal. The only allowed exception is the yellow-white promo ink, which is a light-only style
    // and must still clear 4.5:1 on its own cream canvas.
    const textColors = blocks(setupCss)
      .flatMap((b) => Array.from(b.body.matchAll(/(?:^|;)\s*color\s*:\s*([^;]+);/g), (m) => ({ selector: b.selector, value: m[1].trim() })));
    expect(textColors.length).toBeGreaterThan(4); // the parser really saw the wizard's text rules
    const literal = textColors.filter((c) => !c.value.includes('var(--'));
    expect(literal.filter((c) => !c.selector.startsWith('.theme-yellow')).map((c) => `${c.selector} → ${c.value}`)).toEqual([]);
    const cream = hex(rootVars('.theme-yellow')['--ui-canvas']);
    for (const c of literal) expect(contrast(hex(c.value), cream), `${c.selector} on the yellow canvas`).toBeGreaterThanOrEqual(4.5);
  });

  it('gives the card its own surface and hairline in dark, not an inherited light #fff', () => {
    // #225: the card used to take #fff from a :root:not(.dark) rule, so in dark it had no surface of
    // its own. Its own rule is unconditional now and both styles carry a --ui-surface step.
    const card = blocks(setupCss).find((b) => /(^|,)\s*\.setup-card\s*(,|$)/.test(b.selector) && b.body.includes('background'));
    expect(card?.body).toContain('--ui-surface');
    expect(card?.body).toContain('--ui-hairline');
    expect(card?.selector ?? '').not.toContain('not(.dark)');
    expect(rootVars('.dark')['--ui-surface']).toBeDefined();
  });

  it('routes the wizard gray-500/400 captions onto the dark ink ramp', () => {
    const dark = blocks(setupCss).filter((b) => b.selector.startsWith('.dark '));
    const ruleFor = (cls: string) => dark.find((b) => b.selector.includes(`.setup-layout .${cls}`));
    expect(ruleFor('text-gray-500')?.body).toContain('--ui-ink-soft');
    expect(ruleFor('text-gray-400')?.body).toContain('--ui-ink-mute');
  });

  it('gives every token the wizard reads a dark value with 4.5:1 or more on dark surface and canvas', () => {
    const light = rootVars(':root');
    const dark = rootVars('.dark');
    const used = new Set<string>([...setupCss.matchAll(/var\((--ui-[a-z-]+)\)/g)].map((m: RegExpMatchArray) => m[1]));
    const missing = [...used].filter((name) => !(name in dark));
    expect(missing).toEqual([]);
    expect(used.size).toBeGreaterThan(3); // setup.css really does read the ramp, not one token by luck
    for (const name of used) {
      if (!name.startsWith('--ui-ink')) continue; // only text tokens carry a contrast floor
      expect(dark[name]).not.toBe(light[name]); // dark has its own step, not the light one inherited
      for (const bg of ['--ui-surface', '--ui-canvas']) {
        expect(contrast(dark[name], dark[bg]), `${name} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

const zh = wizardTexts('zh');
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const containers: HTMLDivElement[] = [];
const roots: ReturnType<typeof createRoot>[] = [];
beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
  // jsdom has no matchMedia; the wizard never uses 'system', so a light OS is enough here.
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
});
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  containers.splice(0).forEach((c) => c.remove());
  vi.resetAllMocks();
});

async function renderHeader() {
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<MemoryRouter initialEntries={['/setup']}><Header /></MemoryRouter>);
  });
  return container;
}

const label = (container: HTMLElement) => container.querySelector('[data-testid="theme-toggle"] span')?.textContent;
const clickStyle = async (container: HTMLElement) => {
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[data-testid="theme-toggle"]')?.click();
  });
};

describe('wizard style button', () => {
  it.each([['yellow', zh.yellowStyle], ['light', zh.lightStyle], ['dark', zh.darkStyle]] as const)(
    'names the style the wizard is in (%s), not the one a click would switch to',
    async (theme, expected) => {
      useThemeStore.getState().setTheme(theme);
      const container = await renderHeader();
      expect(label(container)).toBe(expected);
    },
  );

  it('still cycles yellow → light → dark → yellow when clicked', async () => {
    useThemeStore.getState().setTheme('yellow');
    const container = await renderHeader();
    expect(label(container)).toBe(zh.yellowStyle);
    await clickStyle(container);
    expect(useThemeStore.getState().theme).toBe('light');
    expect(label(container)).toBe(zh.lightStyle);
    await clickStyle(container);
    expect(useThemeStore.getState().theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(label(container)).toBe(zh.darkStyle);
    await clickStyle(container);
    expect(useThemeStore.getState().theme).toBe('yellow');
    expect(label(container)).toBe(zh.yellowStyle);
  });
});
