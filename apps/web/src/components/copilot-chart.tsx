'use client';

import { useRef, useCallback } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Download, FileText } from 'lucide-react';

const CHART_COLORS = [
  'hsl(var(--primary))',
  'hsl(220, 70%, 50%)',
  'hsl(150, 60%, 45%)',
  'hsl(280, 65%, 55%)',
  'hsl(30, 80%, 55%)',
  '#8884d8',
  '#82ca9d',
  '#ffc658',
];

export interface ChartConfig {
  type: 'bar' | 'line' | 'pie';
  title: string;
  xKey?: string;
  yKeys?: string[];
  nameKey?: string;
  valueKey?: string;
  data: Record<string, unknown>[];
}

export function parseChartBlock(code: string): ChartConfig | null {
  try {
    const parsed = JSON.parse(code);
    if (!parsed.type || !parsed.data || !Array.isArray(parsed.data)) return null;
    if (parsed.type === 'pie' && (!parsed.nameKey || !parsed.valueKey)) return null;
    if (parsed.type !== 'pie' && (!parsed.xKey || !parsed.yKeys)) return null;
    return parsed as ChartConfig;
  } catch {
    return null;
  }
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
  const handleCSV = useCallback(() => exportCSV(config), [config]);
  const handlePDF = useCallback(() => exportPDF(chartRef.current, config.title), [config.title]);

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
        <ResponsiveContainer width="100%" height={220}>
          {renderChart(config)}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function renderChart(config: ChartConfig): React.ReactElement {
  const { type, data, xKey, yKeys, nameKey, valueKey } = config;

  if (type === 'pie') {
    return (
      <PieChart>
        <Pie
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
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--background))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '8px',
            fontSize: '11px',
          }}
        />
        <Legend wrapperStyle={{ fontSize: '10px' }} />
      </PieChart>
    );
  }

  if (type === 'line') {
    return (
      <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey={xKey}
          className="text-[10px]"
          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
        />
        <YAxis
          className="text-[10px]"
          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--background))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '8px',
            fontSize: '11px',
          }}
        />
        <Legend wrapperStyle={{ fontSize: '10px' }} />
        {(yKeys ?? []).map((key, i) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={CHART_COLORS[i % CHART_COLORS.length]}
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        ))}
      </LineChart>
    );
  }

  // Default: bar chart
  return (
    <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
      <XAxis
        dataKey={xKey}
        className="text-[10px]"
        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
      />
      <YAxis
        className="text-[10px]"
        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
      />
      <Tooltip
        contentStyle={{
          backgroundColor: 'hsl(var(--background))',
          border: '1px solid hsl(var(--border))',
          borderRadius: '8px',
          fontSize: '11px',
        }}
      />
      <Legend wrapperStyle={{ fontSize: '10px' }} />
      {(yKeys ?? []).map((key, i) => (
        <Bar
          key={key}
          dataKey={key}
          fill={CHART_COLORS[i % CHART_COLORS.length]}
          radius={[4, 4, 0, 0]}
        />
      ))}
    </BarChart>
  );
}
