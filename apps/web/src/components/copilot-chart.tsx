'use client';

import { useRef, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Download, FileText, Loader2 } from 'lucide-react';

const CHART_COLORS = [
  '#6366f1', // indigo
  '#3b82f6', // blue
  '#22c55e', // green
  '#a855f7', // purple
  '#f97316', // orange
  '#8884d8',
  '#82ca9d',
  '#ffc658',
];

export interface ChartConfig {
  type: 'bar' | 'line' | 'pie' | 'scatter' | 'area' | 'radar';
  title: string;
  xKey?: string;
  yKeys?: string[];
  nameKey?: string;
  valueKey?: string;
  data: Record<string, unknown>[];
}

/**
 * Recursively extract text from React children (handles react-markdown v10
 * which may pass arrays / nested elements instead of a plain string).
 */
export function extractText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (typeof node === 'object' && 'props' in node) {
    return extractText((node as { props: { children?: ReactNode } }).props.children);
  }
  return '';
}

export function parseChartBlock(code: string): ChartConfig | null {
  try {
    // Normalise: strip stray newlines, trim
    const cleaned = code.replace(/\n/g, ' ').trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed.type || !parsed.data || !Array.isArray(parsed.data)) return null;
    const VALID_TYPES = new Set(['bar', 'line', 'pie', 'scatter', 'area', 'radar']);
    if (!VALID_TYPES.has(parsed.type)) return null;
    if (parsed.type === 'pie' && (!parsed.nameKey || !parsed.valueKey)) return null;
    if (parsed.type === 'radar' && (!parsed.xKey || !parsed.yKeys)) return null;
    if (!['pie', 'radar'].includes(parsed.type) && (!parsed.xKey || !parsed.yKeys)) return null;

    // Post-process: sort, limit, truncate — so the chart is always clean
    // regardless of what the LLM sent.
    const config = parsed as ChartConfig;
    preprocessChartData(config);
    return config;
  } catch {
    return null;
  }
}

/** Post-process chart data in the frontend so we don't depend on the LLM
 *  to sort/limit/truncate consistently. */
function preprocessChartData(config: ChartConfig): void {
  if (!config.data || config.data.length === 0) return;

  const MAX_ITEMS = 12;
  const MAX_LABEL_LEN = 20;

  // For bar/line/area charts with a numeric Y-axis: sort descending by primary Y key
  if (['bar', 'line', 'area'].includes(config.type) && config.yKeys?.length) {
    const primaryY = config.yKeys[0]!;
    config.data.sort((a, b) => {
      const aVal = Number(a[primaryY] ?? 0);
      const bVal = Number(b[primaryY] ?? 0);
      return bVal - aVal;
    });

    // Outlier removal: if the top value is 5x+ the median of the rest,
    // it squashes all other bars to near-zero making the chart unreadable.
    // Remove outliers and add a note to the title.
    if (config.data.length >= 3) {
      const values = config.data.map((d) => Number(d[primaryY] ?? 0)).filter((v) => v > 0);
      if (values.length >= 3) {
        const sorted = [...values].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)]!;
        const topValue = values[0]!;
        if (median > 0 && topValue / median > 5) {
          // Remove all outliers (values > 5x median)
          const threshold = median * 5;
          const outliers = config.data.filter((d) => Number(d[primaryY] ?? 0) > threshold);
          config.data = config.data.filter((d) => Number(d[primaryY] ?? 0) <= threshold);
          if (outliers.length > 0 && config.data.length >= 2) {
            const outlierNames = outliers
              .map((d) => config.xKey ? String(d[config.xKey] ?? '') : '')
              .filter(Boolean)
              .join(', ');
            const outlierVal = outliers.map((d) => Number(d[primaryY] ?? 0));
            const maxOutlier = Math.max(...outlierVal);
            const formatted = maxOutlier >= 10000000
              ? `${(maxOutlier / 10000000).toFixed(1)}Cr`
              : maxOutlier >= 100000
                ? `${(maxOutlier / 100000).toFixed(1)}L`
                : maxOutlier.toLocaleString('en-IN');
            config.title += ` (excl. ${outlierNames}: ₹${formatted})`;
          }
        }
      }
    }
  }

  // Limit to MAX_ITEMS
  if (['bar', 'pie'].includes(config.type) && config.data.length > MAX_ITEMS) {
    config.data = config.data.slice(0, MAX_ITEMS);
  }

  // Truncate long X-axis labels
  if (config.xKey) {
    for (const row of config.data) {
      const label = String(row[config.xKey] ?? '');
      if (label.length > MAX_LABEL_LEN) {
        row[config.xKey] = label.substring(0, MAX_LABEL_LEN) + '…';
      }
    }
  }

  // Same for pie chart nameKey
  if (config.nameKey) {
    for (const row of config.data) {
      const label = String(row[config.nameKey] ?? '');
      if (label.length > MAX_LABEL_LEN) {
        row[config.nameKey] = label.substring(0, MAX_LABEL_LEN) + '…';
      }
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRC = React.ComponentType<any>;

interface RC {
  BarChart: AnyRC;
  Bar: AnyRC;
  LineChart: AnyRC;
  Line: AnyRC;
  PieChart: AnyRC;
  Pie: AnyRC;
  Cell: AnyRC;
  ScatterChart: AnyRC;
  Scatter: AnyRC;
  AreaChart: AnyRC;
  Area: AnyRC;
  RadarChart: AnyRC;
  Radar: AnyRC;
  PolarGrid: AnyRC;
  PolarAngleAxis: AnyRC;
  PolarRadiusAxis: AnyRC;
  XAxis: AnyRC;
  YAxis: AnyRC;
  CartesianGrid: AnyRC;
  Tooltip: AnyRC;
  ResponsiveContainer: AnyRC;
  Legend: AnyRC;
}

function exportCSV(config: ChartConfig) {
  const { data, title } = config;
  if (!data.length) return;
  const headers = Object.keys(data[0]!);
  const rows = data.map((row) => headers.map((h) => String(row[h] ?? '')).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.replace(/[^a-zA-Z0-9]/g, '_')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportPDF(chartRef: HTMLDivElement | null, title: string) {
  if (!chartRef) return;
  // Use browser print to generate PDF from the chart area
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;
  const svg = chartRef.querySelector('svg');
  if (!svg) return;
  const svgData = new XMLSerializer().serializeToString(svg);
  printWindow.document.write(`
    <!DOCTYPE html><html><head><title>${title}</title>
    <style>body{display:flex;flex-direction:column;align-items:center;padding:40px;font-family:system-ui,sans-serif}
    h1{font-size:18px;margin-bottom:20px}svg{max-width:100%}
    @media print{body{padding:20px}}</style></head>
    <body><h1>${title}</h1>${svgData}</body></html>
  `);
  printWindow.document.close();
  setTimeout(() => {
    printWindow.print();
  }, 300);
}

export function CopilotChart({ config }: { config: ChartConfig }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [rc, setRc] = useState<RC | null>(null);
  const handleCSV = useCallback(() => exportCSV(config), [config]);
  const handlePDF = useCallback(() => exportPDF(chartRef.current, config.title), [config.title]);

  // Dynamic import — SSR-safe (matches codebase pattern)
  useEffect(() => {
    import('recharts').then((mod) => {
      setRc({
        BarChart: mod.BarChart,
        Bar: mod.Bar,
        LineChart: mod.LineChart,
        Line: mod.Line,
        PieChart: mod.PieChart,
        Pie: mod.Pie,
        Cell: mod.Cell,
        ScatterChart: mod.ScatterChart,
        Scatter: mod.Scatter,
        AreaChart: mod.AreaChart,
        Area: mod.Area,
        RadarChart: mod.RadarChart,
        Radar: mod.Radar,
        PolarGrid: mod.PolarGrid,
        PolarAngleAxis: mod.PolarAngleAxis,
        PolarRadiusAxis: mod.PolarRadiusAxis,
        XAxis: mod.XAxis,
        YAxis: mod.YAxis,
        CartesianGrid: mod.CartesianGrid,
        Tooltip: mod.Tooltip,
        ResponsiveContainer: mod.ResponsiveContainer,
        Legend: mod.Legend,
      });
    });
  }, []);

  if (!rc) {
    return (
      <div className="my-2 rounded-lg border border-border/60 bg-background p-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold">{config.title}</h4>
        </div>
        <div className="flex items-center justify-center h-[220px] text-muted-foreground text-xs">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading chart…
        </div>
      </div>
    );
  }

  return (
    <div className="my-2 rounded-lg border border-border/60 bg-background p-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold">{config.title}</h4>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={handleCSV}>
            <Download className="h-3 w-3 mr-1" /> CSV
          </Button>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={handlePDF}>
            <FileText className="h-3 w-3 mr-1" /> PDF
          </Button>
        </div>
      </div>
      <div ref={chartRef} className="w-full">
        <rc.ResponsiveContainer width="100%" height={300}>
          {renderChart(config, rc)}
        </rc.ResponsiveContainer>
      </div>
    </div>
  );
}

const TT_STYLE = {
  backgroundColor: 'hsl(var(--background))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '8px',
  fontSize: '11px',
};
const TICK = { fill: 'hsl(var(--muted-foreground))', fontSize: 10 };
const ANGLED_TICK = { fill: 'hsl(var(--muted-foreground))', fontSize: 9 };
const MARGIN = { top: 5, right: 10, left: 0, bottom: 5 };
const BAR_MARGIN = { top: 5, right: 10, left: 0, bottom: 60 };

/** Truncate long labels for chart axes */
function truncateLabel(value: unknown, maxLen = 18): string {
  const s = String(value ?? '');
  return s.length > maxLen ? s.substring(0, maxLen) + '…' : s;
}

/** Format large numbers in Indian notation for Y-axis */
function formatIndianNumber(v: number | string): string {
  const n = Number(v);
  if (isNaN(n)) return String(v);
  if (n >= 10000000) return `${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return String(n);
}

/** Format values as ₹ with Indian locale for tooltips */
function formatIndianCurrency(value: number | string): string {
  const n = Number(value);
  if (isNaN(n)) return String(value);
  return `₹${n.toLocaleString('en-IN')}`;
}

function renderChart(config: ChartConfig, rc: RC): React.ReactElement {
  const { type, data, xKey, yKeys, nameKey, valueKey } = config;
  const { CartesianGrid: CG, XAxis: XA, YAxis: YA, Tooltip: TT, Legend: LG } = rc;

  if (type === 'pie') {
    return (
      <rc.PieChart>
        <rc.Pie
          data={data}
          dataKey={valueKey!}
          nameKey={nameKey!}
          cx="50%"
          cy="50%"
          outerRadius={80}
          label={({ name, percent }: { name?: string; percent?: number }) =>
            `${name ?? ''}: ${((percent ?? 0) * 100).toFixed(0)}%`
          }
        >
          {data.map((_, i) => (
            <rc.Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </rc.Pie>
        <TT contentStyle={TT_STYLE} />
        <LG wrapperStyle={{ fontSize: '10px' }} />
      </rc.PieChart>
    );
  }

  if (type === 'line') {
    return (
      <rc.LineChart data={data} margin={MARGIN}>
        <CG strokeDasharray="3 3" className="stroke-muted" />
        <XA dataKey={xKey} tick={TICK} />
        <YA tick={TICK} tickFormatter={formatIndianNumber} width={55} />
        <TT contentStyle={TT_STYLE} />
        <LG wrapperStyle={{ fontSize: '10px' }} />
        {(yKeys ?? []).map((key, i) => (
          <rc.Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={CHART_COLORS[i % CHART_COLORS.length]}
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        ))}
      </rc.LineChart>
    );
  }

  if (type === 'scatter') {
    return (
      <rc.ScatterChart margin={MARGIN}>
        <CG strokeDasharray="3 3" className="stroke-muted" />
        <XA dataKey={xKey} name={xKey} tick={TICK} />
        <YA dataKey={(yKeys ?? [])[0]} name={(yKeys ?? [])[0]} tick={TICK} />
        <TT contentStyle={TT_STYLE} cursor={{ strokeDasharray: '3 3' }} />
        <LG wrapperStyle={{ fontSize: '10px' }} />
        <rc.Scatter
          name={(yKeys ?? [])[0] ?? 'Value'}
          data={data}
          fill={CHART_COLORS[0]}
          shape="circle"
        />
      </rc.ScatterChart>
    );
  }

  if (type === 'area') {
    return (
      <rc.AreaChart data={data} margin={MARGIN}>
        <defs>
          {(yKeys ?? []).map((key, i) => (
            <linearGradient key={key} id={`gradient-${key}`} x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="5%"
                stopColor={CHART_COLORS[i % CHART_COLORS.length]}
                stopOpacity={0.3}
              />
              <stop
                offset="95%"
                stopColor={CHART_COLORS[i % CHART_COLORS.length]}
                stopOpacity={0}
              />
            </linearGradient>
          ))}
        </defs>
        <CG strokeDasharray="3 3" className="stroke-muted" />
        <XA dataKey={xKey} tick={TICK} />
        <YA tick={TICK} tickFormatter={formatIndianNumber} width={55} />
        <TT contentStyle={TT_STYLE} />
        <LG wrapperStyle={{ fontSize: '10px' }} />
        {(yKeys ?? []).map((key, i) => (
          <rc.Area
            key={key}
            type="monotone"
            dataKey={key}
            stroke={CHART_COLORS[i % CHART_COLORS.length]}
            fill={`url(#gradient-${key})`}
            strokeWidth={2}
          />
        ))}
      </rc.AreaChart>
    );
  }

  if (type === 'radar') {
    return (
      <rc.RadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
        <rc.PolarGrid />
        <rc.PolarAngleAxis dataKey={xKey} tick={TICK} />
        <rc.PolarRadiusAxis tick={TICK} />
        <TT contentStyle={TT_STYLE} />
        <LG wrapperStyle={{ fontSize: '10px' }} />
        {(yKeys ?? []).map((key, i) => (
          <rc.Radar
            key={key}
            name={key}
            dataKey={key}
            stroke={CHART_COLORS[i % CHART_COLORS.length]}
            fill={CHART_COLORS[i % CHART_COLORS.length]}
            fillOpacity={0.25}
          />
        ))}
      </rc.RadarChart>
    );
  }

  // Default: bar chart — angled labels, INR formatting, sorted data
  return (
    <rc.BarChart data={data} margin={BAR_MARGIN}>
      <CG strokeDasharray="3 3" className="stroke-muted" />
      <XA
        dataKey={xKey}
        tick={{ ...ANGLED_TICK, angle: -35, textAnchor: 'end' }}
        interval={0}
        height={60}
      />
      <YA
        tick={TICK}
        tickFormatter={formatIndianNumber}
        width={55}
      />
      <TT
        contentStyle={TT_STYLE}
        formatter={(value: number | string) => [`₹${Number(value).toLocaleString('en-IN')}`, '']}
      />
      <LG wrapperStyle={{ fontSize: '10px' }} />
      {(yKeys ?? []).map((key, i) => (
        <rc.Bar
          key={key}
          dataKey={key}
          fill={CHART_COLORS[i % CHART_COLORS.length]}
          radius={[4, 4, 0, 0]}
        />
      ))}
    </rc.BarChart>
  );
}
