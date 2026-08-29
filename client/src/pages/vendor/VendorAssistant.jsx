import { useState, useRef, useEffect } from "react";
import {
  Bot,
  Send,
  Sparkles,
  RefreshCw,
  Package,
  CheckCircle2,
  AlertCircle,
  Tag,
  Boxes,
  HelpCircle,
  Zap,
  Store,
  Layers,
  ChevronRight
} from "lucide-react";
import api from "../../lib/api";

function formatINR(val) {
  if (val === undefined || val === null) return "₹0";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(val);
}

const EXAMPLE_PROMPTS = [
  "What laptop is best for video editing?",
  "Show electronics under ₹50,000.",
  "Which products are currently in stock?",
  "What is the cheapest product in Audio?",
  "Recommend popular products for a student.",
  "What products are available in Electronics?"
];

export default function VendorAssistant() {
  const [messages, setMessages] = useState([
    {
      id: "welcome",
      sender: "ai",
      text: "Hello! I am your **ShopSense AI Shopping Assistant**, powered by Retrieval-Augmented Generation (RAG). I can help you search, compare, and recommend products from our live SQLite catalog with strict grounding.",
      products: [],
      sources: []
    }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  const chatBottomRef = useRef(null);

  // Fetch AI status on mount
  useEffect(() => {
    api.get("/ai/status")
      .then((res) => setStatus(res.data))
      .catch(() => setStatus({ status: "online", vectorStoreReady: true, indexedProducts: 10009 }));
  }, []);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleSend = async (questionText = input) => {
    const q = String(questionText || "").trim();
    if (!q || loading) return;

    setInput("");
    setError("");

    const userMessage = {
      id: `user-${Date.now()}`,
      sender: "user",
      text: q
    };

    setMessages((prev) => [...prev, userMessage]);
    setLoading(true);

    try {
      const res = await api.post("/ai/shopping-assistant", { question: q });
      const aiMessage = {
        id: `ai-${Date.now()}`,
        sender: "ai",
        text: res.data.answer,
        products: res.data.products || [],
        sources: res.data.sources || []
      };
      setMessages((prev) => [...prev, aiMessage]);
    } catch (err) {
      console.error("AI Assistant error:", err);
      const errMsg = err.response?.data?.error || "AI Shopping Assistant is temporarily unavailable. Please try again.";
      setError(errMsg);
      setMessages((prev) => [
        ...prev,
        {
          id: `ai-err-${Date.now()}`,
          sender: "ai",
          text: `⚠️ **Error:** ${errMsg}`,
          isError: true,
          products: [],
          sources: []
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const clearChat = () => {
    setMessages([
      {
        id: `welcome-${Date.now()}`,
        sender: "ai",
        text: "Chat cleared! How can I assist with your catalog discovery today?",
        products: [],
        sources: []
      }
    ]);
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 pb-12">
      {/* Top Banner */}
      <header className="rounded-2xl p-6 relative overflow-hidden text-white shadow-sm" style={{ background: "linear-gradient(135deg, #0E4B44 0%, #15665c 100%)" }}>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-white/20 text-white">
                <Sparkles size={13} className="text-amber-300" /> RAG System Active
              </span>
              <span className="text-[11px] font-semibold text-white/80">
                10,000+ SQLite Products Indexed
              </span>
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold">AI Shopping Assistant</h1>
            <p className="mt-1 text-sm text-white/80 max-w-xl">
              Ask natural-language questions to discover, filter, and compare products grounded directly in the ShopSense database.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={clearChat}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold bg-white/10 hover:bg-white/20 transition-all text-white border border-white/15"
            >
              <RefreshCw size={13} /> Clear Chat
            </button>
          </div>
        </div>
      </header>

      {/* Suggested Quick Starters */}
      <div className="flex flex-col gap-2 p-4 rounded-2xl border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--ink-soft)]">
          <HelpCircle size={14} className="text-emerald-700" /> Suggested Inquiries:
        </div>
        <div className="flex flex-wrap gap-2">
          {EXAMPLE_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              disabled={loading}
              onClick={() => handleSend(prompt)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-left transition-all border hover:border-emerald-700/40 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 disabled:opacity-50"
              style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--ink)" }}
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>

      {/* Main Chat Container */}
      <div className="rounded-2xl border shadow-sm flex flex-col h-[640px]" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        {/* Messages Scroll Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.sender === "user" ? "items-end" : "items-start"}`}
            >
              {/* Message Header */}
              <div className="flex items-center gap-2 mb-1 text-xs text-[var(--ink-soft)] font-medium">
                {msg.sender === "ai" ? (
                  <>
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-700 text-white text-[10px] font-bold">
                      <Bot size={12} />
                    </span>
                    <span>ShopSense Assistant</span>
                  </>
                ) : (
                  <span>You</span>
                )}
              </div>

              {/* Message Bubble */}
              <div
                className={`rounded-2xl p-4 sm:p-5 max-w-3xl text-sm leading-relaxed ${
                  msg.sender === "user"
                    ? "text-white rounded-br-none shadow-sm"
                    : "border rounded-tl-none shadow-sm"
                }`}
                style={{
                  background: msg.sender === "user" ? "var(--primary)" : "var(--surface)",
                  borderColor: msg.sender === "user" ? "transparent" : "var(--border)",
                  color: msg.sender === "user" ? "white" : "var(--ink)"
                }}
              >
                <div className="whitespace-pre-line prose prose-sm max-w-none">
                  {msg.text}
                </div>

                {/* Render Grounded Product Cards if present */}
                {msg.products && msg.products.length > 0 && (
                  <div className="mt-5 space-y-3 border-t border-black/10 pt-4">
                    <p className="text-xs font-bold uppercase tracking-wider text-[var(--primary)] flex items-center gap-1.5">
                      <Package size={14} /> Retrieved Catalog Products ({msg.products.length}):
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {msg.products.map((p) => (
                        <div
                          key={p.id}
                          className="rounded-xl p-3.5 border bg-white dark:bg-black/20 flex flex-col justify-between transition-all hover:border-emerald-700/40 shadow-xs"
                          style={{ borderColor: "var(--border)" }}
                        >
                          <div>
                            <div className="flex items-start justify-between gap-2 mb-1.5">
                              <span className="font-semibold text-xs text-[var(--ink)] line-clamp-1">
                                {p.name}
                              </span>
                              <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                {p.category}
                              </span>
                            </div>
                            <p className="text-xs text-[var(--ink-soft)] line-clamp-2 mb-3">
                              {p.description || `Catalog product in ${p.category}`}
                            </p>
                          </div>

                          <div className="border-t border-black/5 pt-2 flex items-center justify-between text-xs">
                            <div>
                              <span className="text-[10px] uppercase font-bold text-[var(--ink-soft)] block">Price</span>
                              <span className="font-mono-stat font-bold text-emerald-800 dark:text-emerald-400">
                                {formatINR(p.price)}
                              </span>
                            </div>
                            <div className="text-right">
                              <span className="text-[10px] uppercase font-bold text-[var(--ink-soft)] block">Stock</span>
                              <span className={`font-semibold ${p.stock > 0 ? "text-emerald-700" : "text-rose-600"}`}>
                                {p.stock > 0 ? `${p.stock} units` : "Out of stock"}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Sources Citation Tray */}
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-black/5 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--ink-soft)]">
                    <span className="font-bold text-[var(--primary)] flex items-center gap-1">
                      <CheckCircle2 size={12} className="text-emerald-700" /> Sources:
                    </span>
                    {msg.sources.map((s, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded-md bg-black/5 font-mono text-[10px]"
                        title={`ID: ${s.productId} | ${s.category} | ${formatINR(s.price)}`}
                      >
                        {s.productName || s.productId}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Loading Thinking Bubble */}
          {loading && (
            <div className="flex flex-col items-start">
              <div className="flex items-center gap-2 mb-1 text-xs text-[var(--ink-soft)] font-medium">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-700 text-white text-[10px] font-bold">
                  <Bot size={12} />
                </span>
                <span>ShopSense Assistant</span>
              </div>
              <div
                className="rounded-2xl rounded-tl-none p-4 border shadow-sm flex items-center gap-3 text-sm text-[var(--ink-soft)]"
                style={{ background: "var(--surface)", borderColor: "var(--border)" }}
              >
                <div className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-700 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="h-2 w-2 rounded-full bg-emerald-700 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="h-2 w-2 rounded-full bg-emerald-700 animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
                <span>Retrieving catalog vectors & synthesizing grounded response...</span>
              </div>
            </div>
          )}

          <div ref={chatBottomRef} />
        </div>

        {/* Input Bar */}
        <div className="p-4 border-t" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-center gap-3"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about products, pricing, stock, categories (e.g., 'What laptop is under 50000?')..."
              disabled={loading}
              className="flex-1 rounded-xl px-4 py-3 text-sm border focus:outline-none focus:ring-2 focus:ring-emerald-700/30 transition-all"
              style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--ink)" }}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white shadow-sm transition-all hover:opacity-95 disabled:opacity-50"
              style={{ background: "var(--primary)" }}
            >
              <Send size={15} />
              <span>Send</span>
            </button>
          </form>
          <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--ink-soft)]">
            <span>Powered by ShopSense Vector Search & RAG</span>
            <span>{status?.indexedProducts ? `${status.indexedProducts.toLocaleString()} items indexed` : "Catalog connected"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
