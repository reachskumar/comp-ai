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
    return parsed as ChartConfig;
  } catch {
    return null;
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
        <rc.ResponsiveContainer width="100%" height={220}>
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
const MARGIN = { top: 5, right: 10, left: 0, bottom: 5 };

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
        <YA tick={TICK} />
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
        <YA tick={TICK} />
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

  // Default: bar chart
  return (
    <rc.BarChart data={data} margin={MARGIN}>
      <CG strokeDasharray="3 3" className="stroke-muted" />
      <XA dataKey={xKey} tick={TICK} />
      <YA tick={TICK} />
      <TT contentStyle={TT_STYLE} />
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
