import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Bell, BellRing, PackageX, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";

const ALERT_REFRESH_MS = 60_000;
const THRESHOLD_STORAGE_KEY = "shopsense_inventory_thresholds";

function savedThresholds() {
  try {
    const saved = JSON.parse(localStorage.getItem(THRESHOLD_STORAGE_KEY) || "{}");
    return { lowThreshold: Number(saved.lowThreshold) || 5, mediumThreshold: Number(saved.mediumThreshold) || 20 };
  } catch {
    return { lowThreshold: 5, mediumThreshold: 20 };
  }
}

export default function InventoryNotifications() {
  const [alerts, setAlerts] = useState([]);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState(false);
  const [thresholds, setThresholds] = useState(savedThresholds);
  const signatureRef = useRef("");
  const navigate = useNavigate();

  useEffect(() => {
    const syncThresholdsFromInsights = (event) => {
      const updateButton = event.target.closest?.(".insights-filter-card button");
      if (!updateButton) return;
      const inputs = updateButton.closest(".insights-filter-card")?.querySelectorAll("input");
      const next = { lowThreshold: Number(inputs?.[0]?.value) || 0, mediumThreshold: Number(inputs?.[1]?.value) || 0 };
      localStorage.setItem(THRESHOLD_STORAGE_KEY, JSON.stringify(next));
      setThresholds(next);
    };
    document.addEventListener("click", syncThresholdsFromInsights);
    return () => document.removeEventListener("click", syncThresholdsFromInsights);
  }, []);

  useEffect(() => {
    let active = true;
    const loadAlerts = async () => {
      try {
        const { data } = await api.get("/vendor/inventory/alerts", { params: thresholds });
        if (!active) return;
        const nextAlerts = Array.isArray(data.alerts) ? data.alerts : [];
        const nextSignature = nextAlerts.map((alert) => `${alert.productId}:${alert.stock}:${alert.status}`).join("|");
        if (nextSignature && nextSignature !== signatureRef.current) setToast(true);
        signatureRef.current = nextSignature;
        setAlerts(nextAlerts);
      } catch {
        if (active) setAlerts([]);
      }
    };

    loadAlerts();
    const interval = window.setInterval(loadAlerts, ALERT_REFRESH_MS);
    window.addEventListener("inventory-updated", loadAlerts);
    const updateThresholds = () => setThresholds(savedThresholds());
    window.addEventListener("inventory-thresholds-updated", updateThresholds);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("inventory-updated", loadAlerts);
      window.removeEventListener("inventory-thresholds-updated", updateThresholds);
    };
  }, [thresholds]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(false), 3000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const openInsights = () => {
    setOpen(false);
    setToast(false);
    navigate("/vendor/insights");
  };

  const openRestock = (alert) => {
    setOpen(false);
    setToast(false);
    navigate(`/vendor/edit-product/${alert.productId}`);
  };

  const outOfStock = alerts.filter((alert) => alert.status === "out_of_stock").length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { setOpen((value) => !value); setToast(false); }}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg focus-ring"
        style={{ color: alerts.length ? "var(--danger)" : "var(--ink-soft)", background: alerts.length ? "var(--danger-soft)" : "var(--surface)" }}
        aria-label={`${alerts.length} inventory alerts`}
        aria-expanded={open}
      >
        {alerts.length ? <BellRing size={18} /> : <Bell size={18} />}
        {alerts.length > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white" style={{ background: "var(--danger)" }}>{alerts.length > 9 ? "9+" : alerts.length}</span>}
      </button>

      {toast && <div className="absolute right-0 top-12 z-30 w-72 rounded-xl p-3 shadow-lg" style={{ background: "var(--card)", border: "1px solid var(--border)" }} role="status">
        <div className="flex gap-2">
          <AlertTriangle className="shrink-0" size={18} style={{ color: "var(--danger)" }} />
          <button type="button" className="min-w-0 flex-1 text-left focus-ring" onClick={() => alerts[0] && openRestock(alerts[0])}>
            <p className="text-sm font-semibold">Inventory needs attention</p>
            <p className="mt-0.5 text-xs" style={{ color: "var(--ink-soft)" }}>Click to update the required stock.</p>
          </button>
          <button type="button" className="p-0.5 focus-ring" onClick={() => setToast(false)} aria-label="Dismiss notification"><X size={15} /></button>
        </div>
      </div>}

      {open && <div className="absolute right-0 top-12 z-30 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl shadow-xl" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <p className="text-sm font-bold">Inventory Alerts</p>
            <p className="text-[11px]" style={{ color: "var(--ink-soft)" }}>
              {outOfStock > 0 && `${outOfStock} out of stock`}
              {outOfStock > 0 && alerts.length - outOfStock > 0 && " • "}
              {alerts.length - outOfStock > 0 && `${alerts.length - outOfStock} low stock`}
              {alerts.length === 0 && "Stock levels are healthy"}
            </p>
          </div>
          <button type="button" className="text-xs font-semibold focus-ring" style={{ color: "var(--primary)" }} onClick={openInsights}>View insights</button>
        </div>
        {alerts.length ? <div className="max-h-80 overflow-y-auto">
          {alerts.map((alert) => <button type="button" className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-black/[0.02] focus-ring" style={{ borderBottom: "1px solid var(--border)" }} key={alert.productId} onClick={() => openRestock(alert)}>
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: alert.status === "out_of_stock" ? "var(--danger-soft)" : "var(--accent-soft)", color: alert.status === "out_of_stock" ? "var(--danger)" : "#7a5719" }}><PackageX size={16} /></div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{alert.productName}</p>
              <p className="mt-0.5 text-xs" style={{ color: "var(--ink-soft)" }}>
                {alert.status === "out_of_stock" ? (
                  <span className="font-semibold" style={{ color: "var(--danger)" }}>Out of stock — restock now</span>
                ) : (
                  <span className="font-semibold" style={{ color: "#7a5719" }}>Low stock: {alert.stock} remaining</span>
                )}
              </p>
            </div>
          </button>)}
        </div> : <div className="px-4 py-7 text-center"><Bell size={20} className="mx-auto mb-2" style={{ color: "var(--success)" }} /><p className="text-sm font-medium">No inventory alerts</p><p className="mt-1 text-xs" style={{ color: "var(--ink-soft)" }}>All current products are above the low-stock threshold.</p></div>}
      </div>}
    </div>
  );
}
