import { describe, expect, it } from 'vitest';
import { scan } from './rtl-guard.ts';

const matches = (text: string, kind: 'tsx' | 'css' = 'tsx') => scan('f', text, kind).map((f) => f.match);

describe('RTL guard', () => {
  it.each([
    'ml-2',
    'md:mr-4',
    '-ml-px',
    'pl-[3px]',
    'pr-6',
    'left-0',
    'right-1/2',
    'text-left',
    'text-right',
    'float-left',
    'border-l',
    'border-r-2',
    'rounded-l-lg',
    'rounded-tr',
  ])('rejects the physical class %s', (cls) => {
    // A variant prefix (md:) is reported as the bare class.
    expect(matches(`<div className="flex ${cls} gap-2" />`)).toEqual([cls.replace(/^\w+:/, '')]);
  });

  it.each([
    'ms-2',
    'me-4',
    'ps-3',
    'pe-6',
    'start-0',
    '-start-3.5',
    'end-2',
    'text-start',
    'text-end',
    'border-s',
    'border-e-2',
    'rounded-s-lg',
    'rounded-ee',
    'inset-x-0',
  ])('accepts the logical class %s', (cls) => {
    expect(matches(`<div className="${cls}" />`)).toEqual([]);
  });

  it('does not confuse words that only contain the letters', () => {
    expect(matches('const footer = "copyright-notice"; const sample = "ample-room";')).toEqual([]);
  });

  it('rejects physical CSS properties and accepts logical ones', () => {
    expect(matches('a { margin-left: 4px; left: 0; text-align: right; }', 'css')).toEqual([
      'margin-left:',
      'left:',
      'text-align: right',
    ]);
    expect(matches('a { margin-inline-start: 4px; inset-inline-end: 0; text-align: start; }', 'css')).toEqual(
      [],
    );
  });

  it('skips a line marked rtl-guard-ignore', () => {
    expect(matches('<svg className="left-0" /> {/* rtl-guard-ignore: anatomical chart */}')).toEqual([]);
  });
});
