import { useEffect, useState, useMemo, useRef } from "react";
import {
  BarChart3,
  Boxes,
  CheckCircle2,
  GitFork,
  Lightbulb,
  PackageCheck,
  Plus,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  TrendingUp,
  Users,
  Layers,
  Sparkles,
  DollarSign,
  Crown,
  Award,
  Shield,
  Clock,
  ArrowUpDown,
  Download,
  Scale,
  FileSpreadsheet,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  FileText
} from "lucide-react";
import { Link } from "react-router-dom";
import api from "../../lib/api";
import StatCard from "../../components/StatCard";
import { formatINR } from "../../lib/currency";

const rows = (value) => (Array.isArray(value) ? value : []);
const number = (value) => new Intl.NumberFormat("en-IN").format(Number(value) || 0);
const percent = (value) => `${((Number(value) || 0) * 100).toFixed(1)}%`;
const storageKey = "shopsense_inventory_thresholds_v4";
const defaults = { lowThreshold: 5, mediumThreshold: 20, minSupport: 0.0002, minConfidence: 0.1 };

function getSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
    return {
      ...defaults,
      ...Object.fromEntries(
        Object.keys(defaults).map((name) => [
          name,
          Number.isFinite(Number(saved[name])) ? Number(saved[name]) : defaults[name]
        ])
      )
    };
  } catch {
    return defaults;
  }
}

function Empty({ message }) {
  return (
    <p className="rounded-xl p-6 text-center text-sm" style={{ background: "var(--surface)", color: "var(--ink-soft)" }}>
      {message}
    </p>
  );
}

function Badge({ children, tone = "default" }) {
  const colors = {
    default: ["var(--surface)", "var(--ink-soft)"],
    success: ["var(--success-soft)", "var(--success)"],
    warning: ["var(--accent-soft)", "#7a5719"],
    danger: ["var(--danger-soft)", "var(--danger)"],
    primary: ["rgba(14, 75, 68, 0.12)", "var(--primary)"],
    gold: ["rgba(217, 119, 6, 0.15)", "#B45309"],
    purple: ["rgba(124, 58, 237, 0.12)", "#6D28D9"]
  };
  const [background, color] = colors[tone] || colors.default;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background, color }}>
      {children}
    </span>
  );
}

function Metric({ label, value, currency = false, tone = "default" }) {
  const backgrounds = {
    default: "var(--surface)",
    success: "var(--success-soft)",
    warning: "var(--accent-soft)",
    danger: "var(--danger-soft)",
    primary: "rgba(14, 75, 68, 0.08)"
  };
  return (
    <div className="insights-metric rounded-xl p-3.5" style={{ background: backgrounds[tone] || backgrounds.default }}>
      <p className="text-[10px] font-bold uppercase tracking-[.12em]" style={{ color: "var(--ink-soft)" }}>
        {label}
      </p>
      <p className="mt-1 font-mono-stat text-lg font-semibold">{currency ? formatINR(value) : number(value)}</p>
    </div>
  );
}

function Panel({ icon: Icon, eyebrow, title, description, action, children }) {
  return (
    <section className="insights-section rounded-2xl p-5 sm:p-6" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="insights-section-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-bold" style={{ background: "var(--success-soft)", color: "var(--primary)" }}>
            <Icon size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-[10px] font-bold uppercase tracking-[.16em]" style={{ color: "var(--accent)" }}>
                {eyebrow}
              </p>
            </div>
            <h2 className="mt-1 font-display text-base font-bold sm:text-lg">{title}</h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed" style={{ color: "var(--ink-soft)" }}>
              {description}
            </p>
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Table({ headers, data, empty }) {
  if (!data.length) return <Empty message={empty} />;
  return (
    <div className="overflow-x-auto">
      <table className="insights-table w-full min-w-[520px] text-left text-xs">
        <thead style={{ color: "var(--ink-soft)" }}>
          <tr>
            {headers.map((header) => (
              <th className="px-3 pb-3 font-semibold first:pl-0" key={header}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((line, row) => (
            <tr key={`${line[0]}-${row}`} className="border-t border-black/5 hover:bg-black/[0.01] transition-colors">
              {line.map((cell, column) => (
                <td className="max-w-[280px] break-words px-3 py-3 align-middle first:pl-0" key={column}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Generate smooth cubic bezier spline SVG path
function getSmoothSplinePath(points) {
  if (!points || points.length === 0) return "";
  if (points.length === 1) return `M${points[0].x} ${points[0].y}`;
  if (points.length === 2) return `M${points[0].x} ${points[0].y} L${points[1].x} ${points[1].y}`;

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    path += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return path;
}

// Vendor vs Marketplace Benchmark Component
function VendorBenchmarkPanel({ benchmark }) {
  if (!benchmark || !benchmark.benchmarks) {
    return <Empty message="Benchmarking metrics are currently calculating..." />;
  }

  const { benchmarks, overallPerformance, insights, marketplace, vendor } = benchmark;
  const { revenue, orders, unitsSold, productCount } = benchmarks;

  const items = [
    { key: "revenue", data: revenue, icon: DollarSign, isCurr: true },
    { key: "orders", data: orders, icon: ShoppingCart, isCurr: false },
    { key: "unitsSold", data: unitsSold, icon: Boxes, isCurr: false },
    { key: "productCount", data: productCount, icon: Layers, isCurr: false }
  ];

  return (
    <div className="space-y-6">
      {/* Benchmark Header Summary */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-700/10 text-emerald-800 font-bold">
            <Scale size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-display font-bold text-sm sm:text-base">{vendor?.businessName || "Your Business"} vs Marketplace Benchmark</h3>
              <Badge tone={overallPerformance?.includes("Above") ? "success" : overallPerformance?.includes("Competitive") ? "gold" : "default"}>
                {overallPerformance}
              </Badge>
            </div>
            <p className="text-xs text-[var(--ink-soft)] mt-0.5">
              Compared against the average performance across all approved vendors in the marketplace ({marketplace?.totalVendors || 1} vendors).
            </p>
          </div>
        </div>
      </div>

      {/* 4 Metric Benchmark Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(({ key, data, icon: Icon, isCurr }) => {
          if (!data) return null;
          const isAbove = data.status === "above";
          const isBelow = data.status === "below";
          return (
            <div
              key={key}
              className="rounded-2xl p-4 border transition-all flex flex-col justify-between"
              style={{ background: "var(--surface)", borderColor: "var(--border)" }}
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[var(--ink-soft)]">
                    <Icon size={14} className="text-[var(--primary)]" /> {data.label}
                  </span>
                  <span
                    className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                      isAbove
                        ? "bg-emerald-100 text-emerald-800"
                        : isBelow
                        ? "bg-amber-100 text-amber-800"
                        : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {isAbove ? <ArrowUpRight size={13} /> : isBelow ? <ArrowDownRight size={13} /> : null}
                    {data.formattedDiff} {isAbove ? "Above" : isBelow ? "Below" : "Avg"}
                  </span>
                </div>

                {/* Values */}
                <div className="mt-3 flex items-baseline justify-between">
                  <div>
                    <p className="text-[10px] uppercase font-bold text-[var(--ink-soft)]">You</p>
                    <p className="font-mono-stat text-xl font-bold text-[var(--ink)]">
                      {isCurr ? formatINR(data.vendorValue) : number(data.vendorValue)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase font-bold text-[var(--ink-soft)]">Marketplace Avg</p>
                    <p className="font-mono-stat text-base font-semibold text-[var(--ink-soft)]">
                      {isCurr ? formatINR(data.marketplaceAverage) : number(data.marketplaceAverage)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Comparative Dual Bar */}
              <div className="mt-4 pt-3 border-t border-black/5 space-y-1.5">
                <div className="flex justify-between text-[10px] text-[var(--ink-soft)]">
                  <span>Relative Performance</span>
                  <span className="font-semibold font-mono-stat">{data.formattedDiff}</span>
                </div>
                <div className="h-2 w-full rounded-full overflow-hidden bg-black/5 flex">
                  {(() => {
                    const max = Math.max(1, data.vendorValue, data.marketplaceAverage);
                    const vendorPct = Math.min(100, Math.round((data.vendorValue / max) * 100));
                    return (
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.max(8, vendorPct)}%`,
                          background: isAbove ? "var(--primary)" : isBelow ? "#D97706" : "#64748B"
                        }}
                      />
                    );
                  })()}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Strategic Insights */}
      {insights && insights.length > 0 && (
        <div className="rounded-xl p-4 border border-emerald-700/20 bg-emerald-900/5">
          <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-900 flex items-center gap-1.5 mb-2">
            <Lightbulb size={14} className="text-emerald-700" /> Key Benchmark Insights
          </h4>
          <ul className="space-y-1.5 text-xs text-emerald-950">
            {insights.map((insight, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="text-emerald-700 font-bold">•</span>
                <span>{insight}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// 3. Spacious Sales Performance Graph (Day, Week, Month)
function SpaciousSalesChart({ data, timeframe: externalTimeframe, onTimeframeChange }) {
  const [timeframe, setTimeframe] = useState(externalTimeframe || "30d");
  const [metric, setMetric] = useState("revenue"); // "revenue", "units", "orders", "aov"
  const [hoverIndex, setHoverIndex] = useState(null);
  const svgRef = useRef(null);

  // Sync with external timeframe
  useEffect(() => {
    if (externalTimeframe) {
      setTimeframe(externalTimeframe);
    }
  }, [externalTimeframe]);

  const handleTimeframeChange = (newTimeframe) => {
    setTimeframe(newTimeframe);
    if (onTimeframeChange) {
      onTimeframeChange(newTimeframe);
    }
  };

  const series = useMemo(() => {
    if (!data) return [];
    const fromReportingApi = Array.isArray(data.data);
    if (fromReportingApi) {
      return data.data.map((item) => {
        // Format labels based on timeframe
        let displayLabel = item.label || "";
        if (timeframe === "month" && /^\d{4}-\d{2}$/.test(item.date)) {
          // Format YYYY-MM as "Sep '25"
          const [year, month] = item.date.split("-");
          const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
          displayLabel = `${monthNames[parseInt(month) - 1]} '${year.slice(2)}`;
        } else if (timeframe === "30d" && /^\d{1,2}:\d{2}$/.test(item.label)) {
          // Format hour labels like "9:00", "12:00", "15:00"
          const hour = parseInt(item.label.split(':')[0]);
          displayLabel = `${hour}:00`;
        }
        
        return {
          label: displayLabel,
          fullDate: item.date || item.label || "",
          revenue: Number(item.revenue || 0),
          units: Number(item.unitsSold || item.units || item.purchases || 0),
          orders: Number(item.orders || 0),
          aov: Number(item.aov || (item.orders ? item.revenue / item.orders : 0))
        };
      });
    }
    // Fallback to old data structure if not from reporting API
    if (timeframe === "30d") {
      const list = rows(data.revenueByPeriod?.day30 || data.salesByDate?.slice(-30));
      return list.map((item) => ({
        label: item.date ? item.date.slice(5) : (item.period || item.label || ""),
        fullDate: item.date || item.period,
        revenue: Number(item.revenue || 0),
        units: Number(item.purchases || item.units || item.unitsSold || 0),
        orders: Number(item.orders || 0),
        aov: Number(item.aov || (item.orders ? item.revenue / item.orders : 0))
      }));
    }
    if (timeframe === "month") {
      const list = rows(data.revenueByPeriod?.month);
      return list.map((item) => ({
        label: item.period || item.label || "",
        fullDate: item.period || item.label || "",
        revenue: Number(item.revenue || 0),
        units: Number(item.purchases || item.unitsSold || 0),
        orders: Number(item.orders || 0),
        aov: Number(item.orders ? item.revenue / item.orders : 0)
      }));
    }
    if (timeframe === "week") {
      const list = rows(data.revenueByPeriod?.week);
      return list.map((item) => ({
        label: item.period || item.label || "",
        fullDate: item.period || item.label || "",
        revenue: Number(item.revenue || 0),
        units: Number(item.purchases || item.unitsSold || 0),
        orders: Number(item.orders || 0),
        aov: Number(item.orders ? item.revenue / item.orders : 0)
      }));
    }
    return [];
  }, [data, timeframe]);

  if (!series.length) return <Empty message="No recorded sales for this period." />;

  const metricConfig = {
    revenue: { 
      label: "Revenue (₹)", 
      format: (v) => formatINR(v), 
      shortFormat: (v) => {
        const val = Number(v);
        if (val === 0) return "₹0";
        if (val < 1000) return `₹${Math.round(val)}`;
        if (val < 100000) return `₹${(val / 1000).toFixed(val % 1000 === 0 ? 0 : 1)}k`;
        return `₹${(val / 100000).toFixed(val % 100000 === 0 ? 0 : 1)}L`;
      }, 
      color: "#0E4B44" 
    },
    units: { 
      label: "Units Sold", 
      format: (v) => `${number(v)} units`, 
      shortFormat: (v) => number(v), 
      color: "#D97706" 
    },
    orders: { 
      label: "Sales", 
      format: (v) => `${number(v)} sales`, 
      shortFormat: (v) => number(v), 
      color: "#2563EB" 
    },
    aov: { 
      label: "Avg Sale Value", 
      format: (v) => formatINR(v), 
      shortFormat: (v) => {
        const val = Number(v);
        if (val === 0) return "₹0";
        if (val < 1000) return `₹${Math.round(val)}`;
        if (val < 100000) return `₹${(val / 1000).toFixed(0)}k`;
        return `₹${(val / 100000).toFixed(1)}L`;
      }, 
      color: "#7C3AED" 
    }
  };
  const activeCfg = metricConfig[metric];

  const values = series.map((s) => s[metric]);
  const maxValue = Math.max(...values, 0);
  const minValue = Math.min(...values, 0);
  // Add 10% padding to the top for better visual spacing
  const chartMax = maxValue > 0 ? maxValue * 1.1 : 1;
  const totalValue = values.reduce((a, b) => a + b, 0);
  const avgValue = totalValue / Math.max(1, values.length);
  const peakIndex = values.indexOf(maxValue);

  const width = 940;
  const height = 280;
  const padLeft = 70;
  const padRight = 24;
  const padTop = 24;
  const padBottom = 48;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const points = series.map((s, idx) => {
    const x = padLeft + (series.length === 1 ? chartW / 2 : (idx * chartW) / (series.length - 1));
    const y = padTop + chartH - (s[metric] / chartMax) * chartH;
    return { x, y, data: s };
  });

  const splinePath = getSmoothSplinePath(points);
  const areaPath = points.length > 0
    ? `${splinePath} L ${points[points.length - 1].x} ${padTop + chartH} L ${points[0].x} ${padTop + chartH} Z`
    : "";

  const activePoint = hoverIndex !== null && points[hoverIndex] ? points[hoverIndex] : null;

  const handleMouseMove = (e) => {
    if (!svgRef.current || !points.length) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * width;
    let closestIdx = 0;
    let minDiff = Infinity;
    points.forEach((p, idx) => {
      const diff = Math.abs(p.x - mouseX);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = idx;
      }
    });
    setHoverIndex(closestIdx);
  };

  const getAxisTicks = () => {
    // For day view (hourly), show key hours if many points
    if (timeframe === "30d" && series.length > 12) {
      // Show every 2-3 hours for readability
      const step = Math.ceil(series.length / 8);
      const ticks = [];
      for (let i = 0; i < points.length; i += step) {
        ticks.push({ x: points[i].x, label: points[i].data.label });
      }
      if (ticks.length > 0 && ticks[ticks.length - 1].x !== points[points.length - 1].x) {
        ticks.push({ x: points[points.length - 1].x, label: points[points.length - 1].data.label });
      }
      return ticks;
    }
    // For week view (7 days), show all labels
    if (timeframe === "week" && series.length === 7) {
      return points.map((p) => ({ x: p.x, label: p.data.label }));
    }
    // For month view, show all months if <= 12
    if (timeframe === "month" && series.length <= 12) {
      return points.map((p) => ({ x: p.x, label: p.data.label }));
    }
    // For other views, show up to 8 evenly spaced labels
    if (series.length <= 8) {
      return points.map((p) => ({ x: p.x, label: p.data.label }));
    }
    const step = Math.max(1, Math.floor(series.length / 7));
    const ticks = [];
    for (let i = 0; i < points.length; i += step) {
      ticks.push({ x: points[i].x, label: points[i].data.label });
    }
    // Always include the last point
    if (ticks.length > 0 && ticks[ticks.length - 1].x !== points[points.length - 1].x) {
      ticks.push({ x: points[points.length - 1].x, label: points[points.length - 1].data.label });
    }
    return ticks;
  };
  const axisTicks = getAxisTicks();

  return (
    <div className="space-y-4">
      {/* Controls Bar: Metrics & Timeframes */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b pb-4" style={{ borderColor: "var(--border)" }}>
        {/* Metric Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {[
            { id: "revenue", label: "Revenue (₹)", icon: DollarSign },
            { id: "units", label: "Units Sold", icon: Boxes },
            { id: "orders", label: "Orders", icon: ShoppingCart },
            { id: "aov", label: "Avg Order", icon: TrendingUp }
          ].map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMetric(m.id)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-all"
              style={{
                background: metric === m.id ? "var(--primary)" : "var(--surface)",
                color: metric === m.id ? "white" : "var(--ink-soft)",
                boxShadow: metric === m.id ? "0 2px 8px rgba(14, 75, 68, 0.25)" : "none"
              }}
            >
              <m.icon size={13} /> {m.label}
            </button>
          ))}
        </div>

        {/* Timeframe Toggle Buttons */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold mr-1" style={{ color: "var(--ink-soft)" }}>Period:</span>
          <div className="flex rounded-lg overflow-hidden" style={{ border: "2px solid var(--border)" }}>
            {[
              { id: "30d", label: "Day" },
              { id: "week", label: "Week" },
              { id: "month", label: "Month" }
            ].map((tf, idx) => (
              <button
                key={tf.id}
                type="button"
                onClick={() => {
                  handleTimeframeChange(tf.id);
                  setHoverIndex(null);
                }}
                className="px-4 py-2 text-sm font-bold transition-all"
                style={{
                  background: timeframe === tf.id ? "var(--primary)" : "white",
                  color: timeframe === tf.id ? "white" : "var(--ink)",
                  borderRight: idx < 2 ? "1px solid var(--border)" : "none",
                  minWidth: "70px"
                }}
              >
                {tf.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI Stats Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 rounded-xl p-3" style={{ background: "var(--surface)" }}>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-soft)]">Total Volume</p>
          <p className="mt-0.5 text-sm font-bold font-mono-stat text-[var(--primary)]">
            {metric === "aov" ? formatINR(avgValue) : activeCfg.format(totalValue)}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-soft)]">Peak Point</p>
          <p className="mt-0.5 text-sm font-bold font-mono-stat text-amber-700">
            {activeCfg.format(maxValue)} <span className="text-[10px] font-normal text-[var(--ink-soft)]">({series[peakIndex]?.label})</span>
          </p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-soft)]">Average per Unit</p>
          <p className="mt-0.5 text-sm font-bold font-mono-stat text-[var(--ink)]">
            {activeCfg.format(avgValue)}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-soft)]">Observed Points</p>
          <p className="mt-0.5 text-sm font-bold font-mono-stat text-emerald-700">
            {series.length} data points
          </p>
        </div>
      </div>

      {/* Spacious Spline Curve SVG */}
      <div className="relative rounded-2xl p-3 sm:p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <svg
          ref={svgRef}
          className="h-auto w-full cursor-crosshair select-none"
          viewBox={`0 0 ${width} ${height}`}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIndex(null)}
          role="img"
          aria-label="Sales momentum chart"
        >
          <defs>
            <linearGradient id="gradChartFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.28" />
              <stop offset="60%" stopColor="var(--primary)" stopOpacity="0.08" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.0" />
            </linearGradient>
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="rgba(14, 75, 68, 0.35)" />
            </filter>
          </defs>

          {/* Y-axis Grid lines with better scaling */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = padTop + chartH * ratio;
            const val = chartMax * (1 - ratio);
            return (
              <g key={ratio}>
                <line
                  x1={padLeft}
                  x2={width - padRight}
                  y1={y}
                  y2={y}
                  stroke="var(--border)"
                  strokeDasharray={ratio > 0 && ratio < 1 ? "4 4" : ""}
                  strokeOpacity="0.8"
                />
                <text x={padLeft - 8} y={y + 4} textAnchor="end" fontSize="11" fill="var(--ink-soft)" fontFamily="monospace">
                  {activeCfg.shortFormat(val)}
                </text>
              </g>
            );
          })}

          <path d={areaPath} fill="url(#gradChartFill)" />
          <path
            d={splinePath}
            fill="none"
            stroke="var(--primary)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#glow)"
          />

          {series.length <= 31 &&
            points.map((pt, idx) => (
              <circle
                key={idx}
                cx={pt.x}
                cy={pt.y}
                r={hoverIndex === idx ? 6 : 3}
                fill={hoverIndex === idx ? "var(--primary)" : "var(--card)"}
                stroke="var(--primary)"
                strokeWidth={hoverIndex === idx ? 3 : 1.5}
                className="transition-all duration-150"
              />
            ))}

          {activePoint && (
            <g>
              <line
                x1={activePoint.x}
                x2={activePoint.x}
                y1={padTop}
                y2={padTop + chartH}
                stroke="var(--primary)"
                strokeWidth="1.5"
                strokeDasharray="3 3"
                opacity="0.75"
              />
              <circle cx={activePoint.x} cy={activePoint.y} r="8" fill="var(--primary)" fillOpacity="0.2" />
              <circle cx={activePoint.x} cy={activePoint.y} r="5" fill="var(--card)" stroke="var(--primary)" strokeWidth="3" />
            </g>
          )}

          {axisTicks.map((t, idx) => (
            <text key={idx} x={t.x} y={height - 14} textAnchor="middle" fontSize="10" fill="var(--ink-soft)" fontWeight="500">
              {t.label}
            </text>
          ))}
        </svg>

        {activePoint && (
          <div
            className="pointer-events-none absolute z-20 rounded-xl p-3 text-xs shadow-2xl backdrop-blur-md transition-transform"
            style={{
              background: "rgba(18, 30, 28, 0.95)",
              color: "white",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              left: `${Math.max(10, Math.min(80, (activePoint.x / width) * 100))}%`,
              top: `${Math.max(10, (activePoint.y / height) * 100 - 30)}%`,
              transform: "translate(-50%, -100%)"
            }}
          >
            <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-1.5 mb-1.5">
              <span className="font-bold text-white/90">{activePoint.data.fullDate}</span>
              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                {metric.toUpperCase()}
              </span>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between gap-4">
                <span className="text-white/60">Revenue:</span>
                <span className="font-bold text-emerald-400 font-mono-stat">{formatINR(activePoint.data.revenue)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-white/60">Units Sold:</span>
                <span className="font-bold text-amber-300 font-mono-stat">{number(activePoint.data.units)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-white/60">Orders:</span>
                <span className="font-bold text-white/90 font-mono-stat">{number(activePoint.data.orders)}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// 6. Interactive Demand Forecast Component
function InteractiveDemandForecast({ item, forecastDays, setForecastDays }) {
  const stock = Number(item?.stock) || 0;
  const dailyAverage = Number(item?.averageDailySales) || 0;
  const demand = Math.max(1, Math.round(dailyAverage * forecastDays));
  const shortage = Math.max(0, demand - stock);
  const recommendedRestock = shortage;
  const runoutDays = dailyAverage > 0 ? Math.floor(stock / dailyAverage) : 999;
  const isOutOfStock = stock <= 0;

  const trajectoryPoints = useMemo(() => {
    const steps = 10;
    const points = [];
    for (let i = 0; i <= steps; i++) {
      const day = Math.round((i / steps) * forecastDays);
      const remainingStock = Math.max(0, Math.round(stock - dailyAverage * day));
      const cumDemand = Math.round(dailyAverage * day);
      points.push({ day, remainingStock, cumDemand });
    }
    return points;
  }, [stock, dailyAverage, forecastDays]);

  if (!item) return <Empty message="No product selected for demand forecasting." />;

  const maxVal = Math.max(stock, demand, 1);
  const tWidth = 600;
  const tHeight = 160;
  const padL = 45;
  const padR = 20;
  const padT = 15;
  const padB = 25;
  const cW = tWidth - padL - padR;
  const cH = tHeight - padT - padB;

  const stockCoords = trajectoryPoints.map((p, idx) => ({
    x: padL + (idx * cW) / (trajectoryPoints.length - 1),
    y: padT + cH - (p.remainingStock / maxVal) * cH
  }));
  const demandCoords = trajectoryPoints.map((p, idx) => ({
    x: padL + (idx * cW) / (trajectoryPoints.length - 1),
    y: padT + cH - (p.cumDemand / maxVal) * cH
  }));

  const stockPath = getSmoothSplinePath(stockCoords);
  const demandPath = getSmoothSplinePath(demandCoords);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[var(--ink-soft)]">Forecast Horizon:</span>
          <div className="flex rounded-lg p-0.5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            {[7, 14, 30, 60, 90].map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setForecastDays(days)}
                className="rounded-md px-3 py-1.5 text-[11px] font-bold transition-all focus-ring"
                style={{
                  background: forecastDays === days ? "var(--primary)" : "transparent",
                  color: forecastDays === days ? "white" : "var(--ink-soft)"
                }}
              >
                {days} Days
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge tone={item.origin === "catalog" ? "primary" : "default"}>
            {item.origin === "catalog" ? "My Catalog Product" : "Historical Dataset"}
          </Badge>
          <Badge tone={isOutOfStock ? "danger" : shortage > 0 ? "warning" : "success"}>
            {isOutOfStock ? "Out of Stock" : shortage > 0 ? "Restock Needed" : "Healthy Stock"}
          </Badge>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Current Stock On Hand" value={stock} />
        <Metric label="Historical Units Sold" value={item.historicalSales || 0} />
        <Metric label="Daily Sales Velocity" value={dailyAverage.toFixed(2)} />
        <Metric label={`${forecastDays}-Day Projected Demand`} value={demand} tone={shortage > 0 ? "danger" : "success"} />
      </div>

      <div className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div>
            <span className="font-bold text-[var(--ink)]">Stock Depletion vs Cumulative Demand Trajectory</span>
            <p className="text-[11px] text-[var(--ink-soft)]">
              Simulated inventory depletion curve based on {dailyAverage.toFixed(2)} units/day historical velocity.
            </p>
          </div>
          <div className="flex items-center gap-4 text-[11px] font-semibold">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-600" /> Stock Level
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-600" /> Projected Demand
            </span>
          </div>
        </div>

        <svg className="h-auto w-full" viewBox={`0 0 ${tWidth} ${tHeight}`} role="img" aria-label="Stock trajectory graph">
          {[0, 0.5, 1].map((r) => (
            <line
              key={r}
              x1={padL}
              x2={tWidth - padR}
              y1={padT + cH * r}
              y2={padT + cH * r}
              stroke="var(--border)"
              strokeDasharray={r === 0.5 ? "3 3" : ""}
            />
          ))}

          <path d={stockPath} fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" />
          <path d={demandPath} fill="none" stroke="#D97706" strokeWidth="2.5" strokeDasharray="5 4" strokeLinecap="round" />

          {runoutDays <= forecastDays && (
            <g>
              <circle
                cx={padL + (Math.min(runoutDays, forecastDays) / forecastDays) * cW}
                cy={padT + cH}
                r="5"
                fill="#DC2626"
                stroke="white"
                strokeWidth="2"
              />
              <text
                x={padL + (Math.min(runoutDays, forecastDays) / forecastDays) * cW}
                y={padT + cH - 10}
                fontSize="10"
                fontWeight="bold"
                fill="#DC2626"
                textAnchor="middle"
              >
                Stockout Day {runoutDays}
              </text>
            </g>
          )}

          <text x={padL - 6} y={padT + 4} fontSize="9" fill="var(--ink-soft)" textAnchor="end">
            {maxVal}
          </text>
          <text x={padL - 6} y={padT + cH + 3} fontSize="9" fill="var(--ink-soft)" textAnchor="end">
            0
          </text>

          <text x={padL} y={tHeight - 6} fontSize="10" fill="var(--ink-soft)" textAnchor="start">
            Day 0 (Today)
          </text>
          <text x={padL + cW / 2} y={tHeight - 6} fontSize="10" fill="var(--ink-soft)" textAnchor="middle">
            Day {Math.round(forecastDays / 2)}
          </text>
          <text x={padL + cW} y={tHeight - 6} fontSize="10" fill="var(--ink-soft)" textAnchor="end">
            Day {forecastDays}
          </text>
        </svg>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-soft)]">Stock Runout Timeline</p>
          <p className="mt-1 text-lg font-bold text-[var(--ink)]">
            {isOutOfStock ? "Currently Out of Stock" : runoutDays > 365 ? "365+ Days of Supply" : `${runoutDays} Days Remaining`}
          </p>
          <p className="mt-1 text-xs text-[var(--ink-soft)]">
            {runoutDays <= forecastDays
              ? `⚠️ Inventory will deplete in ${runoutDays} days before period ends.`
              : "✅ Stock is sufficient for the chosen forecast window."}
          </p>
        </div>

        <div className="rounded-xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-soft)]">Recommended Reorder</p>
          <p className="mt-1 text-lg font-bold font-mono-stat" style={{ color: recommendedRestock > 0 ? "var(--danger)" : "var(--primary)" }}>
            {recommendedRestock > 0 ? `${number(recommendedRestock)} units` : "0 units (Covered)"}
          </p>
          <p className="mt-1 text-xs text-[var(--ink-soft)]">
            {recommendedRestock > 0 ? "Place order now to avoid supply disruption." : "No immediate reorder required."}
          </p>
        </div>

        <div className="rounded-xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-soft)]">Forecast Source Basis</p>
          <p className="mt-1 text-sm font-bold text-[var(--primary)] truncate" title={item.forecastBasisLabel}>
            {item.forecastBasisLabel || "Historical Dataset"}
          </p>
          <p className="mt-1 text-xs text-[var(--ink-soft)]">
            {item.category} · {number(item.observedDays || 365)} days of order history
          </p>
        </div>
      </div>
    </div>
  );
}

export default function VendorInsights() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(getSettings);

  // Reporting & Benchmarking States
  const [benchmarkData, setBenchmarkData] = useState(null);
  const [reportingScope, setReportingScope] = useState("vendor"); // "vendor" | "marketplace"
  const [reportingTimeframe, setReportingTimeframe] = useState("30d"); // "30d" | "90d" | "year" | "month" | "week"
  const [reportingData, setReportingData] = useState(null);
  const [exportingSales, setExportingSales] = useState(false);
  const [exportingProducts, setExportingProducts] = useState(false);

  // Customer Section States (3 Tiers Filter & Search)
  const [customerTierFilter, setCustomerTierFilter] = useState("all"); // "all", "high", "medium", "low"
  const [customerSearch, setCustomerSearch] = useState("");

  // Forecast Section States
  const [selectedProduct, setSelectedProduct] = useState("");
  const [forecastDays, setForecastDays] = useState(30);
  const [forecastScope, setForecastScope] = useState("all");
  const [forecastCategory, setForecastCategory] = useState("");
  const [forecastSearch, setForecastSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("all");

  // Basket View State
  const [basketView, setBasketView] = useState("products");
  const loadRequestRef = useRef(0);
  const reportingRequestRef = useRef(0);

  const loadData = async () => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setError("");
    try {
      const params = {
        ...settings,
        days: forecastDays,
        scope: forecastScope,
        category: forecastCategory,
        search: forecastSearch
      };
      // Render the live inventory first. Basket mining and forecasts can take
      // substantially longer on the historical dataset, so they must not hold
      // the whole Insights page behind a loading screen.
      const [inventory, customers, sales, historical, benchmarkRes] = await Promise.all([
        api.get("/analytics/inventory", { params }),
        api.get("/analytics/customers"),
        api.get("/analytics/sales"),
        api.get("/analytics/historical-summary"),
        api.get("/analytics/benchmark")
      ]);
      if (requestId !== loadRequestRef.current) return;

      setBenchmarkData(benchmarkRes.data || null);
      setData({
        inventory: { ...inventory.data, summary: inventory.data?.summary || {} },
        customers: {
          ...customers.data,
          summary: customers.data?.summary || {},
          allCustomers: rows(customers.data?.customers)
        },
        sales: sales.data || {},
        historical: historical.data || {},
        benchmark: benchmarkRes.data || {},
        reporting: {},
        patterns: { patterns: [], categoryPatterns: [] },
        rules: { rules: [], categoryRules: [] },
        recommendations: { recommendations: [], topSelling: [], categoryAffinity: [] },
        forecastInfo: {}, forecasts: [],
        categories: ["Accessories", "Audio", "Computers", "Electronics", "Wearables"], validation: []
      });
      setLoading(false);

      const deferred = await Promise.allSettled([
        api.get("/analytics/frequent-patterns", { params }), api.get("/analytics/association-rules", { params }),
        api.get("/analytics/recommendations", { params }), api.get("/analytics/forecast", { params }), api.get("/analytics/validation")
      ]);
      if (requestId !== loadRequestRef.current) return;
      const [patternsResult, rulesResult, recommendationsResult, forecastResult, validationResult] = deferred;
      const forecast = forecastResult.status === "fulfilled" ? forecastResult.value.data : null;
      const forecasts = rows(forecast?.forecasts);
      setData((current) => ({ ...current,
        patterns: patternsResult.status === "fulfilled" ? { ...patternsResult.value.data, patterns: rows(patternsResult.value.data?.patterns), categoryPatterns: rows(patternsResult.value.data?.categoryPatterns) } : current.patterns,
        rules: rulesResult.status === "fulfilled" ? { ...rulesResult.value.data, rules: rows(rulesResult.value.data?.rules), categoryRules: rows(rulesResult.value.data?.categoryRules) } : current.rules,
        recommendations: recommendationsResult.status === "fulfilled" ? { ...recommendationsResult.value.data, recommendations: rows(recommendationsResult.value.data?.recommendations), topSelling: rows(recommendationsResult.value.data?.topSelling), categoryAffinity: rows(recommendationsResult.value.data?.categoryAffinity) } : current.recommendations,
        forecastInfo: forecast || {}, forecasts, categories: forecast?.categories || current.categories,
        validation: validationResult.status === "fulfilled" ? rows(validationResult.value.data?.checks) : current.validation
      }));
      if (!selectedProduct && forecasts[0]) setSelectedProduct(String(forecasts[0].product_id));
    } catch (requestError) {
      if (requestId !== loadRequestRef.current) return;
      setError(requestError.response?.data?.error || "Unable to load insights.");
      setLoading(false);
    }
  };

  const loadReportingData = async () => {
    const requestId = ++reportingRequestRef.current;
    try {
      const [salesOverTime, categoryPerformance, topProducts, summary] = await Promise.all([
        api.get(`/analytics/reporting/sales-over-time?timeframe=${reportingTimeframe}&scope=${reportingScope}`),
        api.get(`/analytics/reporting/category-performance?scope=${reportingScope}`),
        api.get(`/analytics/reporting/top-products?limit=10&scope=${reportingScope}`),
        api.get(`/analytics/reporting/summary?scope=${reportingScope}`)
      ]);
      if (requestId !== reportingRequestRef.current) return;
      const reporting = { salesOverTime: salesOverTime.data || {}, categoryPerformance: categoryPerformance.data || {}, topProducts: topProducts.data || {}, summary: summary.data || {} };
      setReportingData(reporting);
      setData((current) => current ? { ...current, reporting } : current);
    } catch (requestError) {
      setError(requestError.response?.data?.error || "Unable to load reporting data.");
    }
  };

  // CSV Export Handlers
  const handleExportSales = async (scope = reportingScope) => {
    try {
      setExportingSales(true);
      const res = await api.get(`/analytics/export/sales?scope=${scope}`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "text/csv;charset=utf-8;" }));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `sales_report_${scope}_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export sales CSV failed:", err);
      alert("Unable to export sales CSV. Please try again.");
    } finally {
      setExportingSales(false);
    }
  };

  const handleExportProducts = async (scope = reportingScope) => {
    try {
      setExportingProducts(true);
      const res = await api.get(`/analytics/export/products?scope=${scope}`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "text/csv;charset=utf-8;" }));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `products_report_${scope}_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export products CSV failed:", err);
      alert("Unable to export products CSV. Please try again.");
    } finally {
      setExportingProducts(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [forecastScope, forecastCategory, forecastDays]);

  useEffect(() => {
    loadReportingData();
  }, [reportingScope, reportingTimeframe]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(settings));
  }, [settings]);

  const update = (name) => (event) => setSettings((current) => ({ ...current, [name]: event.target.value }));

  // Instant Customer Filtering by 3 Tiers & Search
  const filteredCustomers = useMemo(() => {
    const list = data?.customers?.allCustomers || [];
    return list.filter((c) => {
      if (customerTierFilter !== "all" && c.tierCode !== customerTierFilter) return false;
      if (customerSearch) {
        const q = customerSearch.toLowerCase();
        const match = (c.customer_name || "").toLowerCase().includes(q) || (c.email || "").toLowerCase().includes(q) || (c.customer_id || "").toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [data?.customers?.allCustomers, customerTierFilter, customerSearch]);

  // Instant Forecast Product Filtering
  const filteredForecasts = useMemo(() => {
    return (data?.forecasts || []).filter((item) => {
      if (forecastSearch) {
        const q = forecastSearch.toLowerCase();
        const match = item.product_name.toLowerCase().includes(q) || String(item.product_id).toLowerCase().includes(q);
        if (!match) return false;
      }
      if (riskFilter === "restock") return item.shortage > 0 || item.status !== "healthy";
      if (riskFilter === "healthy") return item.shortage === 0 && item.status === "healthy";
      return true;
    });
  }, [data?.forecasts, forecastSearch, riskFilter]);

  const selectedForecast = useMemo(() => {
    return (
      filteredForecasts.find((item) => String(item.product_id) === String(selectedProduct)) ||
      filteredForecasts[0] ||
      data?.forecasts[0]
    );
  }, [filteredForecasts, selectedProduct, data?.forecasts]);

  const customerTiers = data?.customers?.summary?.tiers || {};


  return (
    <main className="insights-page mx-auto w-full max-w-7xl space-y-6 pb-12">
      {/* Top Hero Banner */}
      <header className="insights-hero rounded-2xl p-5 sm:p-7">
        <div className="insights-hero-content flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-xl">
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-white/20 text-white">
                Historical Dataset Connected
              </span>
              <p className="text-[10px] font-bold uppercase tracking-[.2em]" style={{ color: "var(--accent)" }}>
                End-to-End Business Intelligence
              </p>
            </div>
            <h1 className="font-display text-2xl font-bold sm:text-3xl text-white">Insights That Move Inventory</h1>
            <p className="mt-2 text-sm leading-relaxed text-white/80">
              100% computed from 10,000 products, 5,000 orders, and ₹14.97 Cr in actual historical dataset transactions.
            </p>
          </div>
          <div className="insights-filter-card grid grid-cols-2 gap-2 rounded-xl p-3 md:grid-cols-3 xl:grid-cols-5">
            <label className="text-xs font-semibold text-white/90">
              Low stock
              <input
                type="number"
                value={settings.lowThreshold}
                onChange={update("lowThreshold")}
                className="mt-1 block w-full rounded-lg px-2 py-2 text-sm"
              />
            </label>
            <label className="text-xs font-semibold text-white/90">
              Medium
              <input
                type="number"
                value={settings.mediumThreshold}
                onChange={update("mediumThreshold")}
                className="mt-1 block w-full rounded-lg px-2 py-2 text-sm"
              />
            </label>
            <label className="text-xs font-semibold text-white/90">
              Support
              <input
                type="number"
                step=".0001"
                value={settings.minSupport}
                onChange={update("minSupport")}
                className="mt-1 block w-full rounded-lg px-2 py-2 text-sm"
              />
            </label>
            <label className="text-xs font-semibold text-white/90">
              Confidence
              <input
                type="number"
                step=".05"
                value={settings.minConfidence}
                onChange={update("minConfidence")}
                className="mt-1 block w-full rounded-lg px-2 py-2 text-sm"
              />
            </label>
            <button onClick={loadData} type="button" className="flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-bold shadow-sm">
              <SlidersHorizontal size={14} /> Apply
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="rounded-xl p-3 text-sm" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
          {error}
          <button className="ml-2 font-semibold underline" onClick={loadData} type="button">
            Retry
          </button>
        </div>
      )}

      {loading && !data && <Empty message="Loading dataset intelligence..." />}

      {data && (
        <>
          {/* Top High-Level Dataset KPIs */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard icon={ShoppingCart} label="Historical orders" value={number(data.historical.totalOrders)} accent="accent" />
            <StatCard icon={BarChart3} label="Historical revenue" value={formatINR(data.historical.totalRevenue)} accent="pending" />
            <StatCard icon={Boxes} label="Products sold" value={number(data.sales.summary.totalProductsSold)} />
            <StatCard icon={Users} label="Total customers" value={number(data.historical.totalCustomers)} accent="success" />
            <StatCard icon={TrendingUp} label="Average order value" value={formatINR(data.sales.summary.averageOrderValue)} />
          </div>

          {/* ========================================================================= */}
          {/* CSV EXPORT & REPORTING SCOPE TOOLBAR */}
          {/* ========================================================================= */}
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-bold text-[var(--ink-soft)] uppercase tracking-wider">
                Reporting Scope:
              </span>
              <div className="flex rounded-lg p-0.5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                {[
                  { id: "vendor", label: "🏪 My Vendor Sales" },
                  { id: "marketplace", label: "🌐 Marketplace (10k Products)" }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setReportingScope(tab.id)}
                    className="rounded-md px-3.5 py-1.5 text-xs font-bold transition-all"
                    style={{
                      background: reportingScope === tab.id ? "var(--primary)" : "transparent",
                      color: reportingScope === tab.id ? "white" : "var(--ink-soft)"
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleExportSales(reportingScope)}
                disabled={exportingSales}
                className="inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90 shadow-sm disabled:opacity-50"
                style={{ background: "var(--primary)" }}
                title="Download real Sales CSV export"
              >
                <Download size={14} className={exportingSales ? "animate-bounce" : ""} />
                {exportingSales ? "Exporting Sales..." : "Export Sales CSV"}
              </button>
              <button
                type="button"
                onClick={() => handleExportProducts(reportingScope)}
                disabled={exportingProducts}
                className="inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition-opacity hover:opacity-90 shadow-sm border disabled:opacity-50"
                style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--ink)" }}
                title="Download real Product Catalog CSV export"
              >
                <FileSpreadsheet size={14} className={exportingProducts ? "animate-bounce text-emerald-700" : "text-emerald-700"} />
                {exportingProducts ? "Exporting Products..." : "Export Products CSV"}
              </button>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* ADVANCED REPORTING: VENDOR BENCHMARKING (Vendor vs Marketplace Average) */}
          {/* ========================================================================= */}
          <Panel
            icon={Scale}
            eyebrow="Performance Benchmark"
            title="Vendor vs Marketplace Benchmark"
            description="Real-time performance benchmark comparing your vendor metrics (Revenue, Orders, Units Sold, Products Listed) against the overall marketplace average."
          >
            <VendorBenchmarkPanel benchmark={data.benchmark} />
          </Panel>

          {/* ========================================================================= */}
          {/* 1. INVENTORY HEALTH */}
          {/* ========================================================================= */}
          <Panel
            icon={PackageCheck}
            eyebrow="Inventory Intelligence"
            title="Inventory Health & Stock Status"
            description="Live overview of catalog stock levels, replenishment requirements, and supply risks."
            action={
              <Link
                to="/vendor/add-product"
                className="inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 shadow-sm"
                style={{ background: "var(--primary)" }}
              >
                <Plus size={14} /> Add product
              </Link>
            }
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric label="Total Products Listed" value={data.inventory.summary.totalProducts} />
              <Metric label="Healthy Stock" value={data.inventory.summary.healthyStock} tone="success" />
              <Metric label="Low Stock Warning" value={data.inventory.summary.lowStock} tone="warning" />
              <Metric label="Out of Stock" value={data.inventory.summary.outOfStock} tone="danger" />
            </div>
          </Panel>

          {/* ========================================================================= */}
          {/* 2. CUSTOMER INSIGHTS (3 Spending Categories: High, Medium, Low Tier) */}
          {/* ========================================================================= */}
          <Panel
            icon={Users}
            eyebrow="Customer Insights"
            title="Customer Segments (3 Spending Tiers)"
            description="5,000 historical customers categorized into 3 distinct spending tiers based on total purchase value."
          >
            {/* 3 Tier Summary Cards */}
            <div className="grid gap-4 md:grid-cols-3 mb-6">
              {/* High Value Tier */}
              <div className="rounded-2xl p-5 border transition-all" style={{ background: "var(--surface)", borderColor: "rgba(14, 75, 68, 0.2)" }}>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-800">
                    <Crown size={15} className="text-emerald-700" /> High Value (VIP)
                  </span>
                  <Badge tone="success">{customerTiers.high?.threshold}</Badge>
                </div>
                <p className="mt-3 font-mono-stat text-2xl font-bold text-[var(--primary)]">
                  {number(customerTiers.high?.count)} <span className="text-xs font-normal text-[var(--ink-soft)]">customers</span>
                </p>
                <div className="mt-3 space-y-1.5 text-xs border-t border-black/5 pt-3">
                  <div className="flex justify-between">
                    <span className="text-[var(--ink-soft)]">Total Revenue Share:</span>
                    <span className="font-bold text-emerald-800">{formatINR(customerTiers.high?.totalSpend)} ({customerTiers.high?.spendPct}%)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--ink-soft)]">Average Spend:</span>
                    <span className="font-mono-stat font-semibold">{formatINR(customerTiers.high?.avgSpend)}</span>
                  </div>
                </div>
              </div>

              {/* Medium Value Tier */}
              <div className="rounded-2xl p-5 border transition-all" style={{ background: "var(--surface)", borderColor: "rgba(217, 119, 6, 0.2)" }}>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-800">
                    <Award size={15} className="text-amber-600" /> Medium Value (Regular)
                  </span>
                  <Badge tone="gold">{customerTiers.medium?.threshold}</Badge>
                </div>
                <p className="mt-3 font-mono-stat text-2xl font-bold text-amber-800">
                  {number(customerTiers.medium?.count)} <span className="text-xs font-normal text-[var(--ink-soft)]">customers</span>
                </p>
                <div className="mt-3 space-y-1.5 text-xs border-t border-black/5 pt-3">
                  <div className="flex justify-between">
                    <span className="text-[var(--ink-soft)]">Total Revenue Share:</span>
                    <span className="font-bold text-amber-800">{formatINR(customerTiers.medium?.totalSpend)} ({customerTiers.medium?.spendPct}%)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--ink-soft)]">Average Spend:</span>
                    <span className="font-mono-stat font-semibold">{formatINR(customerTiers.medium?.avgSpend)}</span>
                  </div>
                </div>
              </div>

              {/* Low Value Tier */}
              <div className="rounded-2xl p-5 border transition-all" style={{ background: "var(--surface)", borderColor: "rgba(100, 116, 139, 0.2)" }}>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-700">
                    <Shield size={15} className="text-slate-600" /> Low Value (Starter)
                  </span>
                  <Badge tone="default">{customerTiers.low?.threshold}</Badge>
                </div>
                <p className="mt-3 font-mono-stat text-2xl font-bold text-slate-800">
                  {number(customerTiers.low?.count)} <span className="text-xs font-normal text-[var(--ink-soft)]">customers</span>
                </p>
                <div className="mt-3 space-y-1.5 text-xs border-t border-black/5 pt-3">
                  <div className="flex justify-between">
                    <span className="text-[var(--ink-soft)]">Total Revenue Share:</span>
                    <span className="font-bold text-slate-800">{formatINR(customerTiers.low?.totalSpend)} ({customerTiers.low?.spendPct}%)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--ink-soft)]">Average Spend:</span>
                    <span className="font-mono-stat font-semibold">{formatINR(customerTiers.low?.avgSpend)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Interactive Tier Filter & Customer Search */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-black/5 pb-3">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-[var(--ink-soft)] mr-1">Filter Tier:</span>
                {[
                  { id: "all", label: `All (${data.customers?.allCustomers?.length || 0})` },
                  { id: "high", label: `💎 High Value (${customerTiers.high?.count || 0})` },
                  { id: "medium", label: `🥇 Medium Value (${customerTiers.medium?.count || 0})` },
                  { id: "low", label: `🥈 Low Value (${customerTiers.low?.count || 0})` }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setCustomerTierFilter(tab.id)}
                    className="rounded-md px-2.5 py-1 text-[11px] font-bold transition-all"
                    style={{
                      background: customerTierFilter === tab.id ? "var(--primary)" : "var(--surface)",
                      color: customerTierFilter === tab.id ? "white" : "var(--ink-soft)"
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-2.5 text-[var(--ink-soft)]" />
                <input
                  type="text"
                  placeholder="Search customer name or email..."
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  className="rounded-lg pl-8 pr-3 py-1.5 text-xs w-64"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
                />
              </div>
            </div>

            {/* Customers Table */}
            <Table
              headers={["Customer ID", "Customer Name", "Email", "Orders", "Total Spent", "Avg Order Value", "Spending Category"]}
              data={filteredCustomers.slice(0, 10).map((c) => [
                <span className="font-mono-stat font-semibold" key={c.customer_id}>{c.customer_id}</span>,
                <span className="font-medium text-[var(--ink)]" key={`${c.customer_id}-name`}>{c.customer_name}</span>,
                <span className="text-[var(--ink-soft)]" key={`${c.customer_id}-email`}>{c.email}</span>,
                number(c.orderCount),
                <span className="font-mono-stat font-bold text-emerald-800" key={`${c.customer_id}-spend`}>{formatINR(c.totalSpending)}</span>,
                formatINR(c.averageOrderValue),
                <Badge
                  key={`${c.customer_id}-badge`}
                  tone={c.tierCode === "high" ? "success" : c.tierCode === "medium" ? "gold" : "default"}
                >
                  {c.tier}
                </Badge>
              ])}
              empty="No customers match the selected spending category or search filter."
            />
          </Panel>

          {/* ========================================================================= */}
          {/* 3. SALES PERFORMANCE (Day, Week, Month - Spacious Graph) */}
          {/* ========================================================================= */}
          <Panel
            icon={BarChart3}
            eyebrow={`Sales & Reporting · ${reportingScope === "vendor" ? "Vendor Live Sales" : "Marketplace Dataset"}`}
            title="Sales Performance Over Time"
            description={`Revenue and unit volume grouped by the selected period. Day shows hourly breakdown (aggregated across all sales), Week shows the 7-day breakdown (Monday–Sunday), and Month shows monthly performance chronologically.`}
          >
            <SpaciousSalesChart 
              data={reportingData?.salesOverTime || data.sales} 
              timeframe={reportingTimeframe}
              onTimeframeChange={setReportingTimeframe}
            />
          </Panel>

          {/* ========================================================================= */}
          {/* 4. SALES PERFORMANCE (Top Products by Sales / Units Sold) */}
          {/* ========================================================================= */}
          <Panel
            icon={Sparkles}
            eyebrow={`Product Intelligence · ${reportingScope === "vendor" ? "Your Top Products" : "Marketplace Bestsellers"}`}
            title="Top Products by Sales Volume & Revenue"
            description={`Bestselling products ranked by sales volume and revenue generation in ${reportingScope === "vendor" ? "your vendor catalog" : "the marketplace dataset"}.`}
          >
            <div className="space-y-4">
              {rows(reportingData?.topProducts?.products || data.sales?.topProducts).slice(0, 8).map((p, idx) => {
                const list = rows(reportingData?.topProducts?.products || data.sales?.topProducts);
                const maxUnits = Math.max(1, ...list.map((i) => Number(i.unitsSold || i.units_sold || 0)));
                const unitsSold = Number(p.unitsSold || p.units_sold || 0);
                const pct = (unitsSold / maxUnits) * 100;
                return (
                  <div
                    key={p.product_id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border border-black/5 hover:border-emerald-700/20 transition-all"
                    style={{ background: "var(--surface)" }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--card)] font-mono-stat text-xs font-bold text-[var(--primary)] border border-black/5">
                        #{idx + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm text-[var(--ink)] truncate">{p.product_name || p.name}</p>
                        <p className="text-xs text-[var(--ink-soft)]">
                          Category: <span className="font-medium text-emerald-800">{p.category}</span> · ID: {p.product_id}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-6 sm:w-1/2 justify-between">
                      <div className="w-1/2">
                        <div className="flex justify-between text-[11px] mb-1">
                          <span className="text-[var(--ink-soft)]">Volume</span>
                          <span className="font-bold text-[var(--primary)]">{number(unitsSold)} units</span>
                        </div>
                        <div className="h-2 rounded-full overflow-hidden bg-black/5">
                          <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${Math.max(5, pct)}%` }} />
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <p className="text-[10px] uppercase font-bold text-[var(--ink-soft)]">Total Revenue</p>
                        <p className="font-mono-stat font-bold text-sm text-emerald-800">{formatINR(p.revenue)}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          {/* ========================================================================= */}
          {/* 5. REVENUE BY CATEGORY */}
          {/* ========================================================================= */}
          <Panel
            icon={Layers}
            eyebrow={`Performance Benchmark · ${reportingScope === "vendor" ? "Vendor Category Breakdown" : "Marketplace Category Breakdown"}`}
            title="Revenue by Category"
            description={`Revenue distribution and product sales contribution across categories in ${reportingScope === "vendor" ? "your sales history" : "the marketplace dataset"}.`}
          >
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {rows(reportingData?.categoryPerformance?.categories || data.sales?.revenueByCategory).map((cat) => {
                const list = rows(reportingData?.categoryPerformance?.categories || data.sales?.revenueByCategory);
                const totalCatRev = list.reduce((s, c) => s + Number(c.revenue || 0), 0);
                const pct = cat.revenueSharePct ?? (totalCatRev ? Math.round((Number(cat.revenue || 0) / totalCatRev) * 100) : 0);
                return (
                  <div
                    key={cat.category}
                    className="p-4 rounded-2xl border border-black/5 flex flex-col justify-between"
                    style={{ background: "var(--surface)" }}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-bold text-base text-[var(--ink)]">{cat.category}</h3>
                        <Badge tone="primary">{pct}% of revenue</Badge>
                      </div>
                      <p className="font-mono-stat text-xl font-bold text-emerald-800">{formatINR(cat.revenue)}</p>
                    </div>

                    <div className="mt-4 pt-3 border-t border-black/5">
                      <div className="flex justify-between text-xs mb-1.5">
                        <span className="text-[var(--ink-soft)]">Units Sold:</span>
                        <span className="font-bold font-mono-stat">{number(cat.unitsSold || cat.units_sold || 0)}</span>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden bg-black/5">
                        <div className="h-full rounded-full bg-amber-600" style={{ width: `${Math.max(5, pct)}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          {/* ========================================================================= */}
          {/* 6. DEMAND PROJECTION & INTERACTIVE STOCKOUT ENGINE */}
          {/* ========================================================================= */}
          <Panel
            icon={TrendingUp}
            eyebrow="Demand Forecast"
            title="Demand Projection & Stockout Engine"
            description="Search across 10,000 catalog products to simulate inventory depletion trajectories."
          >
            <div className="mb-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex rounded-lg p-0.5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                    {[
                      { id: "all", label: "All Products" },
                      { id: "catalog", label: "My Catalog" },
                      { id: "dataset", label: "Dataset Catalog (10k)" }
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setForecastScope(tab.id)}
                        className="rounded-md px-3 py-1.5 text-[11px] font-semibold transition-colors"
                        style={{
                          background: forecastScope === tab.id ? "var(--primary)" : "transparent",
                          color: forecastScope === tab.id ? "white" : "var(--ink-soft)"
                        }}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <select
                    value={forecastCategory}
                    onChange={(e) => setForecastCategory(e.target.value)}
                    className="rounded-lg px-3 py-1.5 text-xs font-semibold"
                    style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
                  >
                    <option value="">All Categories</option>
                    {(data.categories || []).map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>

                  <div className="flex rounded-lg p-0.5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                    {[
                      { id: "all", label: "All Status" },
                      { id: "restock", label: "⚠️ Restock Needed" },
                      { id: "healthy", label: "✅ Healthy" }
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setRiskFilter(tab.id)}
                        className="rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition-colors"
                        style={{
                          background: riskFilter === tab.id ? "var(--primary)" : "transparent",
                          color: riskFilter === tab.id ? "white" : "var(--ink-soft)"
                        }}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-2.5 text-[var(--ink-soft)]" />
                    <input
                      type="text"
                      placeholder="Filter 10k products..."
                      value={forecastSearch}
                      onChange={(e) => setForecastSearch(e.target.value)}
                      className="rounded-lg pl-8 pr-3 py-1.5 text-xs"
                      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <label className="text-xs font-semibold shrink-0" style={{ color: "var(--ink-soft)" }}>
                  Select Product:
                </label>
                <select
                  value={selectedForecast?.product_id || ""}
                  onChange={(event) => setSelectedProduct(event.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm font-semibold truncate"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
                >
                  {filteredForecasts.length === 0 && <option value="">No products matching current filter</option>}
                  {filteredForecasts.map((item) => (
                    <option value={item.product_id} key={item.product_id}>
                      [{item.category}] {item.product_name} · Stock: {item.stock} {item.shortage > 0 ? `⚠️ (Deficit: ${item.shortage})` : "✅ (Healthy)"}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <InteractiveDemandForecast
              item={selectedForecast}
              forecastDays={forecastDays}
              setForecastDays={setForecastDays}
            />
          </Panel>

          {/* ========================================================================= */}
          {/* 7. RECOMMENDATIONS & MARKET BASKET INTELLIGENCE */}
          {/* ========================================================================= */}
          <div className="grid gap-5 xl:grid-cols-2">
            <Panel
              icon={Lightbulb}
              eyebrow="Intelligence"
              title="Cross-Sell & Upsell Recommendations"
              description="Rule-based product suggestions generated from actual co-purchases in transaction baskets."
            >
              <Table
                headers={["Starting Product", "Recommended Product", "Reason"]}
                data={data.recommendations.recommendations.slice(0, 7).map((item) => [
                  item.basedOnProduct,
                  <span className="font-semibold text-[var(--primary)]" key={item.recommendedProduct}>
                    {item.recommendedProduct}
                  </span>,
                  item.reason
                ])}
                empty="No recommendations meet the current thresholds."
              />
            </Panel>

            <Panel
              icon={GitFork}
              eyebrow="Intelligence"
              title="Frequently Bought Together (Basket Analysis)"
              description={`${number(data.patterns.transactionCount)} transactions analyzed for product and category affinity.`}
              action={
                <div className="flex rounded-lg p-0.5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                  <button
                    type="button"
                    onClick={() => setBasketView("products")}
                    className="rounded-md px-2.5 py-1 text-[11px] font-semibold"
                    style={{
                      background: basketView === "products" ? "var(--primary)" : "transparent",
                      color: basketView === "products" ? "white" : "var(--ink-soft)"
                    }}
                  >
                    Products
                  </button>
                  <button
                    type="button"
                    onClick={() => setBasketView("categories")}
                    className="rounded-md px-2.5 py-1 text-[11px] font-semibold"
                    style={{
                      background: basketView === "categories" ? "var(--primary)" : "transparent",
                      color: basketView === "categories" ? "white" : "var(--ink-soft)"
                    }}
                  >
                    Categories
                  </button>
                </div>
              }
            >
              {basketView === "products" ? (
                <Table
                  headers={["Product Pair", "Co-Purchases", "Support"]}
                  data={data.patterns.patterns.slice(0, 7).map((item) => [
                    item.itemset.join(" + "),
                    `${number(item.absoluteSupport)} orders`,
                    percent(item.relativeSupport)
                  ])}
                  empty="No product pairs meet the current support threshold."
                />
              ) : (
                <Table
                  headers={["Category Pair", "Co-Purchases", "Support"]}
                  data={data.patterns.categoryPatterns.slice(0, 7).map((item) => [
                    item.itemset,
                    `${number(item.absoluteSupport)} orders`,
                    percent(item.relativeSupport)
                  ])}
                  empty="No category patterns available."
                />
              )}
            </Panel>
          </div>

          {/* ========================================================================= */}
          {/* 8. ASSOCIATION RULES & DATA QUALITY AUDIT */}
          {/* ========================================================================= */}
          <div className="grid gap-5 xl:grid-cols-2">
            <Panel
              icon={GitFork}
              eyebrow="Intelligence"
              title="Purchase Relationship Rules"
              description="Directional rule confidence: When customer buys X, likelihood of buying Y."
            >
              <Table
                headers={["Rule (If X -> Then Y)", "Support", "Confidence"]}
                data={data.rules.rules.slice(0, 7).map((item) => [
                  `${item.antecedent} ➔ ${item.consequent}`,
                  percent(item.relativeSupport),
                  percent(item.confidence)
                ])}
                empty="No rules meet the selected thresholds. Try lowering the support or confidence filters."
              />
            </Panel>

            <Panel
              icon={CheckCircle2}
              eyebrow="Data Audit"
              title="Dataset Validation Status"
              description="Live audit of imported SQLite database tables vs raw Excel dataset workbooks."
            >
              <Table
                headers={["Dataset", "Imported", "Source", "Difference", "Status"]}
                data={data.validation.map((item) => [
                  item.label,
                  number(item.calculated),
                  number(item.expected),
                  number(item.difference),
                  <Badge key={item.metric} tone={item.status === "passed" ? "success" : "danger"}>
                    {item.status === "passed" ? "Validated" : "Difference detected"}
                  </Badge>
                ])}
                empty="Validation data is unavailable."
              />
            </Panel>
          </div>
        </>
      )}
    </main>
  );
}
