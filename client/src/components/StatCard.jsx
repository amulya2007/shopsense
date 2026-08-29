import { TrendingUp, TrendingDown } from "lucide-react";

export default function StatCard({ icon: Icon, label, value, accent = "primary", trend, trendLabel }) {
  const colorMap = {
    primary: "var(--primary)",
    accent: "var(--accent)",
    success: "var(--success)",
    danger: "var(--danger)",
    pending: "var(--pending)",
  };
  const color = colorMap[accent] || colorMap.primary;

  // Determine if trend is positive, negative, or neutral
  const getTrendColor = () => {
    if (!trend) return null;
    const numericTrend = parseFloat(trend);
    if (numericTrend > 0) return "var(--success)";
    if (numericTrend < 0) return "var(--danger)";
    return "var(--ink-soft)";
  };

  const getTrendIcon = () => {
    if (!trend) return null;
    const numericTrend = parseFloat(trend);
    if (numericTrend > 0) return TrendingUp;
    if (numericTrend < 0) return TrendingDown;
    return null;
  };

  const TrendIcon = getTrendIcon();
  const trendColor = getTrendColor();

  return (
    <div
      className="flex flex-col rounded-xl p-4 sm:p-5 transition-all hover:shadow-md"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      <div className="flex items-start justify-between mb-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
          style={{ background: `${color}1a`, color }}
        >
          <Icon size={20} />
        </div>
        {trend && TrendIcon && (
          <div 
            className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-md"
            style={{ background: `${trendColor}15`, color: trendColor }}
          >
            <TrendIcon size={12} />
            <span>{Math.abs(parseFloat(trend))}%</span>
          </div>
        )}
      </div>
      
      <div className="flex-1">
        <div className="font-mono-stat text-2xl font-bold leading-tight mb-1" title={String(value)}>
          {value}
        </div>
        <div className="text-xs font-medium mb-1" style={{ color: "var(--ink-soft)" }}>
          {label}
        </div>
        {trendLabel && (
          <div className="text-[10px]" style={{ color: "var(--ink-soft)" }}>
            {trendLabel}
          </div>
        )}
      </div>
    </div>
  );
}
