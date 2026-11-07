import { CASE_AREAS, toothInfo } from '@app/shared';
import type { CaseArea, Quadrant } from '@app/shared';
import type { TFunction } from 'i18next';
import { Maximize2, X } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { ToothWork } from '../draft';
import './chart.css';
import { badgeCenter, badgeRadius, chartLayout } from './geometry';
import type { ChartView } from './geometry';
import { isQuadrantSelected, moveFocus } from './selection';
import type { Selection, SelectionAction } from './selection';

const VIEW_KEY = 'dentallab.chartView';

/** The chosen chart model, remembered in this browser (a per-viewer convenience, SPEC §1.1). */
export function useChartView(): [ChartView, (v: ChartView) => void] {
  const [view, setView] = useState<ChartView>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'rows' ? 'rows' : 'mouth';
    } catch {
      return 'mouth';
    }
  });
  const change = useCallback((v: ChartView) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Storage blocked: the choice lasts for this visit only.
    }
  }, []);
  return [view, change];
}

/** «سن 13، ناب علوي يمين» — number, kind and the patient's side. */
export function toothLabel(t: TFunction, no: number): string {
  const info = toothInfo(no);
  const POSITION = {
    upper: { right: 'upperRight', left: 'upperLeft' },
    lower: { right: 'lowerRight', left: 'lowerLeft' },
  } as const;
  const position = POSITION[info.arch][info.side];
  return t('chart.toothLabel', {
    no,
    kind: t(`chart.kind.${info.kind}`),
    position: t(`chart.position.${position}`),
  });
}

interface SvgProps {
  view: ChartView;
  selection: Selection;
  onToggle: (tooth: number) => void;
  work: ReadonlyMap<number, ToothWork>;
  disabledTeeth?: ReadonlySet<number> | undefined;
  /** 16 px badges, 14 px on very short screens outside the expanded dialog (SPEC §1.1). */
  expanded?: boolean | undefined;
}

/**
 * The chart itself: three separate layers over one parametric layout — artwork (decorative,
 * replaceable), hotspots (role=checkbox, roving tabindex, arrows and Space), badges (numbers).
 */
export function ToothChartSvg({ view, selection, onToggle, work, disabledTeeth, expanded = false }: SvgProps) {
  const { t } = useTranslation();
  const layout = chartLayout(view);
  const hintId = useId();
  const gradientId = 'tc-enamel';
  const boxRef = useRef<HTMLDivElement>(null);
  const hotRefs = useRef(new Map<number, SVGPathElement>());
  const [scale, setScale] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [active, setActive] = useState<number>(() => selection[0] ?? 11);

  // Scale of the drawn chart (px per unit), so the badges reach their minimum size on screen.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const { width, height } = box.getBoundingClientRect();
      setScale(Math.min(width / layout.viewBox.w, height / layout.viewBox.h));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [layout]);
  const short = typeof window !== 'undefined' && window.innerHeight < 600 && !expanded;
  const r = badgeRadius(layout, scale, short ? 14 : 16);

  const onKeyDown = (e: KeyboardEvent<SVGPathElement>, no: number) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!disabledTeeth?.has(no)) onToggle(no);
      return;
    }
    const next = moveFocus(no, e.key);
    if (next === null) return;
    e.preventDefault();
    setActive(next);
    hotRefs.current.get(next)?.focus();
  };

  const isOn = (no: number) => selection.includes(no);
  const { x, y, w, h } = layout.viewBox;
  const label = (no: number) => {
    const base = toothLabel(t, no);
    const names = work.get(no)?.names;
    return names ? `${base}${t('chart.hasWork', { works: names.join('، ') })}` : base;
  };

  return (
    <div ref={boxRef} className="relative size-full min-h-0 min-w-0">
      <p id={hintId} className="sr-only">
        {t('chart.hint')}
      </p>
      <svg
        viewBox={`${x} ${y} ${w} ${h}`}
        preserveAspectRatio="xMidYMid meet"
        className="tc-svg absolute inset-0 size-full"
        role="group"
        aria-label={t('chart.label')}
        aria-describedby={hintId}
        data-view={view}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fffdf7" />
            <stop offset="1" stopColor="#efe5cc" />
          </linearGradient>
        </defs>

        {/* Layer 1 — artwork (our own drawing; replaceable by licensed artwork later). */}
        <g aria-hidden="true" data-layer="artwork">
          {layout.gum.map((g, i) =>
            g.width === null ? (
              <path key={i} d={g.d} className="tc-gum-band" />
            ) : (
              <path key={i} d={g.d} className="tc-gum-line" strokeWidth={g.width} />
            ),
          )}
          {layout.teeth.map((tooth) => tooth.roots && <path key={tooth.no} d={tooth.roots} className="tc-root" />)}
          {view === 'rows' &&
            layout.gum.map((g, i) => <path key={`band-${i}`} d={g.d} className="tc-gum-band" opacity={0.55} />)}
          {layout.teeth.map((tooth) => (
            <g key={tooth.no}>
              <path d={tooth.crown} className="tc-crown" />
              <path d={tooth.details} className="tc-detail" />
            </g>
          ))}
          {layout.midline.map(([a, b], i) => (
            <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="tc-midline" />
          ))}
          <g className="tc-label" fontSize={layout.labels.size}>
            <text x={layout.labels.patientRight.x} y={layout.labels.patientRight.y} textAnchor="start">
              {t('chart.patientRight')}
            </text>
            <text x={layout.labels.patientLeft.x} y={layout.labels.patientLeft.y} textAnchor="end">
              {t('chart.patientLeft')}
            </text>
            {layout.labels.upper && (
              <text x={layout.labels.upper.x} y={layout.labels.upper.y} textAnchor="middle" opacity={0.8}>
                {t('chart.upperArch')}
              </text>
            )}
            {layout.labels.lower && (
              <text x={layout.labels.lower.x} y={layout.labels.lower.y} textAnchor="middle" opacity={0.8}>
                {t('chart.lowerArch')}
              </text>
            )}
          </g>
        </g>

        {/* Layer 2 — hotspots: all interaction and accessibility. */}
        <g data-layer="hotspots">
          {layout.teeth.map((tooth) => {
            const no = tooth.no;
            const disabled = disabledTeeth?.has(no) ?? false;
            const w = work.get(no);
            return (
              <path
                key={no}
                ref={(el) => {
                  if (el) hotRefs.current.set(no, el);
                  else hotRefs.current.delete(no);
                }}
                d={tooth.hit}
                className="tc-hot"
                role="checkbox"
                aria-checked={isOn(no)}
                aria-disabled={disabled || undefined}
                aria-label={label(no)}
                tabIndex={active === no ? 0 : -1}
                data-tooth={no}
                data-work={w ? '' : undefined}
                data-hover={hover === no ? '' : undefined}
                style={w ? ({ '--wc': w.color } as React.CSSProperties) : undefined}
                onClick={() => !disabled && onToggle(no)}
                onKeyDown={(e) => onKeyDown(e, no)}
                onFocus={() => setActive(no)}
                onPointerEnter={() => setHover(no)}
                onPointerLeave={() => setHover((c) => (c === no ? null : c))}
              />
            );
          })}
        </g>

        {/* Layer 3 — number badges (pointer convenience; the hotspot carries the name). */}
        <g aria-hidden="true" data-layer="badges">
          {layout.teeth.map((tooth) => {
            const no = tooth.no;
            const c = badgeCenter(tooth, r);
            const w = work.get(no);
            const disabled = disabledTeeth?.has(no) ?? false;
            return (
              <g
                key={no}
                className="tc-badge"
                data-badge={no}
                data-selected={isOn(no) ? '' : undefined}
                data-work={w ? '' : undefined}
                data-hover={hover === no ? '' : undefined}
                data-disabled={disabled ? '' : undefined}
                style={w ? ({ '--wc': w.color } as React.CSSProperties) : undefined}
                onClick={() => !disabled && onToggle(no)}
                onPointerEnter={() => setHover(no)}
                onPointerLeave={() => setHover((cur) => (cur === no ? null : cur))}
              >
                <circle cx={c.x} cy={c.y} r={r} />
                <text
                  x={c.x}
                  y={c.y}
                  fontSize={r * 1.08}
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {no}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

function ToolGroup({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-1.5">
      <span id={id} className="text-[12.5px] font-bold text-muted">
        {title}
      </span>
      <div className="grid grid-cols-2 gap-1.5">{children}</div>
    </div>
  );
}

const toolButton = 'h-8 justify-center rounded-lg px-2 text-[13px]';

export interface ToothChartPanelProps {
  view: ChartView;
  onViewChange: (v: ChartView) => void;
  selection: Selection;
  dispatch: (a: SelectionAction) => void;
  work: ReadonlyMap<number, ToothWork>;
  legend: { name: string; color: string }[];
  disabledTeeth?: ReadonlySet<number>;
  /** Whole-arch buttons: add an area line with the current work type (shown when given). */
  onArchWork?: (area: CaseArea) => void;
  /** Shows the «تكبير المخطط» button (when the panel is short). */
  onExpand?: (() => void) | undefined;
  expanded?: boolean;
  className?: string;
}

/** The chart panel: title, model toggle, the chart, selection tools, legend and chips. */
export function ToothChartPanel({
  view,
  onViewChange,
  selection,
  dispatch,
  work,
  legend,
  disabledTeeth,
  onArchWork,
  onExpand,
  expanded = false,
  className,
}: ToothChartPanelProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const chipRefs = useRef(new Map<number, HTMLButtonElement>());
  const [chipFocus, setChipFocus] = useState<number | null>(null);

  // After a chip is removed, keep the keyboard on the chips (next one) instead of losing focus.
  useEffect(() => {
    if (chipFocus === null) return;
    const next = selection.find((n) => n === chipFocus) ?? selection[0];
    if (next !== undefined) chipRefs.current.get(next)?.focus();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChipFocus(null);
  }, [chipFocus, selection]);

  const tools = (
    <div className={cn('flex gap-3', view === 'mouth' ? 'flex-col' : 'flex-row flex-wrap items-start')}>
      <ToolGroup title={t('chart.selection')}>
        <Button variant="secondary" className={toolButton} onClick={() => dispatch({ type: 'all' })}>
          {t('chart.selectAll')}
        </Button>
        <Button variant="secondary" className={toolButton} onClick={() => dispatch({ type: 'clear' })}>
          {t('chart.clear')}
        </Button>
      </ToolGroup>
      <ToolGroup title={t('chart.quadrants')}>
        {([1, 2, 4, 3] as Quadrant[]).map((q) => (
          <Button
            key={q}
            variant="secondary"
            className={cn(toolButton, isQuadrantSelected(selection, q) && 'border-blue bg-info-bg')}
            aria-pressed={isQuadrantSelected(selection, q)}
            onClick={() => dispatch({ type: 'quadrant', quadrant: q })}
          >
            {t(`chart.quadrant.${q}`)}
          </Button>
        ))}
      </ToolGroup>
      {onArchWork && (
        <ToolGroup title={t('chart.wholeArch')}>
          {CASE_AREAS.map((area) => (
            <Button
              key={area}
              variant="secondary"
              className={toolButton}
              onClick={() => onArchWork(area)}
            >
              {t(`chart.arch.${area}`)}
            </Button>
          ))}
        </ToolGroup>
      )}
      <div className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-bold text-muted">{t('chart.legend')}</span>
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[12.5px]">
          <li className="flex items-center gap-1.5">
            <i aria-hidden="true" className="size-3 rounded-full bg-blue" />
            {t('chart.legendSelected')}
          </li>
          {legend.map((l) => (
            <li key={l.name} className="flex items-center gap-1.5" dir="auto">
              <i aria-hidden="true" className="size-3 rounded-full" style={{ background: l.color }} />
              {l.name}
            </li>
          ))}
          <li className="flex items-center gap-1.5">
            <i aria-hidden="true" className="size-3 rounded-full border border-ink bg-card" />
            {t('chart.legendNoWork')}
          </li>
        </ul>
      </div>
    </div>
  );

  const chips = (
    <div className="flex flex-wrap items-center gap-1.5 text-[13px]" aria-live="polite">
      {selection.length === 0 ? (
        <span className="text-muted">{t('chart.noneSelected')}</span>
      ) : (
        <>
          <span className="text-muted">{t('chart.selectedTeeth')}</span>
          {selection.map((no) => (
            <span
              key={no}
              className="num inline-flex items-center gap-1 rounded-md bg-info-bg ps-2 pe-1 font-bold text-st-in_progress-ink"
            >
              {no}
              <button
                type="button"
                ref={(el) => {
                  if (el) chipRefs.current.set(no, el);
                  else chipRefs.current.delete(no);
                }}
                aria-label={t('chart.unselect', { no })}
                className="grid size-5 place-items-center rounded hover:bg-white"
                onClick={() => {
                  const i = selection.indexOf(no);
                  dispatch({ type: 'remove', tooth: no });
                  setChipFocus(selection[i + 1] ?? selection[i - 1] ?? null);
                }}
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </span>
          ))}
        </>
      )}
    </div>
  );

  const chart = (
    <ToothChartSvg
      view={view}
      selection={selection}
      onToggle={(tooth) => dispatch({ type: 'toggle', tooth })}
      work={work}
      disabledTeeth={disabledTeeth}
      expanded={expanded}
    />
  );

  return (
    <section
      aria-labelledby={titleId}
      className={cn('flex min-h-0 flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-card p-4', className)}
      data-testid="tooth-chart-panel"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={titleId} className="text-[17px] font-extrabold">
          {t('chart.title')}
        </h2>
        <span className="flex-1" />
        <div role="group" aria-label={t('chart.views')} className="flex rounded-lg border border-control p-0.5">
          {(['mouth', 'rows'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => onViewChange(v)}
              className={cn(
                'rounded-md px-2.5 py-1 text-[13px] font-bold',
                view === v ? 'bg-navy text-white' : 'text-ink hover:bg-hover',
              )}
            >
              {v === 'mouth' ? t('chart.viewMouth') : t('chart.viewRows')}
            </button>
          ))}
        </div>
        {onExpand && (
          <Button variant="secondary" size="sm" onClick={onExpand}>
            <Maximize2 aria-hidden="true" />
            {t('chart.expand')}
          </Button>
        )}
      </div>
      {view === 'mouth' ? (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(150px,200px)_minmax(0,1fr)] gap-3">
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pe-1">
            {tools}
            {chips}
          </div>
          {chart}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="min-h-[140px] flex-1">{chart}</div>
          <div className="flex max-h-[45%] flex-col gap-2 overflow-y-auto">
            {tools}
            {chips}
          </div>
        </div>
      )}
    </section>
  );
}
