import { useId } from 'react';
import { cn } from '@/lib/utils';

// Charts here are hand-drawn SVG on purpose: bridge/web has no charting dependency
// (package.json), and adding one would ship ~40kB gzipped for four tiny sparklines. The
// primitives below read the same accent/ink tokens as the rest of the kit, so light, dark and
// the yellow-white theme all recolour them without per-chart code (#98 U13).

export interface BarDatum {
  label: string;
  value: number;
  /** Rendered to the right of the bar; defaults to the raw value. */
  display?: string;
}

interface BarsProps {
  data: BarDatum[];
  /** Width of the label column in px. 96 matches the widest role name in the roster UI. */
  labelWidth?: number;
  className?: string;
}

// Horizontal bars, one row per datum. Bar length is value/max, so the biggest row always fills
// the track and the rest stay comparable — no axis needed for short categorical lists.
export function Bars({ data, labelWidth = 96, className }: BarsProps) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className={cn('space-y-2', className)}>
      {data.map((d) => {
        const pct = Math.round((d.value / max) * 100);
        return (
          <li key={d.label} className="flex items-center gap-3">
            <span
              className="shrink-0 truncate text-xs text-ink-soft"
              style={{ width: labelWidth }}
              title={d.label}
            >
              {d.label}
            </span>
            <span className="relative h-2 flex-1 overflow-hidden rounded-pill bg-surface-sunken">
              <span
                className="absolute inset-y-0 left-0 rounded-pill bg-accent/80 transition-[width] duration-state ease-ui-out"
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="shrink-0 tabular-nums text-xs text-ink-soft">
              {d.display ?? d.value}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

interface SparklineProps {
  values: number[];
  /** Pixel height of the plot box; width follows the container. */
  height?: number;
  /** Fill the area under the line with a 12%-accent wash. */
  area?: boolean;
  className?: string;
  label?: string;
}

// Trend line for a series of counts (daily tokens, hourly responses). A missing/zero series
// draws a flat baseline instead of nothing, so the card never collapses to empty space.
export function Sparkline({ values, height = 56, area = true, className, label }: SparklineProps) {
  const gid = useId().replace(/:/g, '');
  const w = 100; // viewBox units, scaled by preserveAspectRatio="none"
  const data = values.length ? values : [0];
  const max = Math.max(1, ...data);
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const points = data.map((v, i) => {
    const x = i * step;
    const y = height - (v / max) * (height - 4) - 2; // 2px top/bottom breathing room
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const line = points.join(' ');
  const fill = `0,${height} ${line} ${w},${height}`;

  return (
    <div className={cn('w-full', className)}>
      {label && <p className="mb-1 text-xs text-ink-mute">{label}</p>}
      <svg
        viewBox={`0 0 ${w} ${height}`}
        preserveAspectRatio="none"
        className="block w-full"
        style={{ height }}
        role="img"
        aria-label={label}
      >
        <defs>
          <linearGradient id={`sp-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--color-accent) / 0.18)" />
            <stop offset="100%" stopColor="rgb(var(--color-accent) / 0)" />
          </linearGradient>
        </defs>
        {area && <polygon points={fill} fill={`url(#sp-${gid})`} />}
        <polyline
          points={line}
          fill="none"
          stroke="rgb(var(--color-accent-text) / 0.9)"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

interface RingProps {
  /** 0–1 share; clamped. */
  ratio: number;
  size?: number;
  stroke?: number;
  label?: string;
  display?: string;
  className?: string;
}

// Single-value share ring (online members, priced responses). Accent track + hairline rail so it
// stays legible on the warm theme where accent contrast drops.
export function Ring({ ratio, size = 72, stroke = 6, label, display, className }: RingProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0));
  return (
    <div className={cn('inline-flex items-center gap-3', className)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgb(var(--ui-hairline))"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgb(var(--color-accent-text))"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(c * clamped).toFixed(2)} ${c.toFixed(2)}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="transition-[stroke-dasharray] duration-state ease-ui-out"
        />
        <text
          x="50%"
          y="50%"
          dominantBaseline="central"
          textAnchor="middle"
          className="fill-ink text-[13px] font-semibold tabular-nums"
        >
          {display ?? `${Math.round(clamped * 100)}%`}
        </text>
      </svg>
      {label && <span className="text-xs text-ink-mute">{label}</span>}
    </div>
  );
}
