import { useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";

export default function ConfirmDialog({ open, title, message, confirmLabel = "Confirm", onConfirm, onCancel }) {
  useEffect(() => {
    if (!open) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="presentation"
      style={{ background: "rgba(13, 30, 26, 0.55)" }}
      onMouseDown={onCancel}
    >
      <section
        className="w-full max-w-md rounded-2xl p-6 shadow-2xl"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center" style={{ background: "var(--danger-soft)" }}>
            <AlertTriangle size={20} style={{ color: "var(--danger)" }} />
          </div>
          <button type="button" onClick={onCancel} className="p-1 rounded-md focus-ring" style={{ color: "var(--ink-soft)" }} aria-label="Close dialog">
            <X size={18} />
          </button>
        </div>
        <h2 id="confirm-dialog-title" className="font-display text-lg font-bold mt-4">{title}</h2>
        <p id="confirm-dialog-message" className="text-sm leading-6 mt-2" style={{ color: "var(--ink-soft)" }}>{message}</p>
        <div className="flex justify-end gap-3 mt-6">
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-sm font-semibold focus-ring" style={{ border: "1px solid var(--border)", color: "var(--ink-soft)" }}>Cancel</button>
          <button type="button" onClick={onConfirm} className="px-4 py-2 rounded-lg text-sm font-semibold text-white focus-ring" style={{ background: "var(--danger)" }}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}
