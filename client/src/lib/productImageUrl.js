const apiBaseUrl = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, "") || "";

// Demo photos and uploaded photos are served by the API. Keep relative image
// paths pointed at that API when the client is deployed on a separate origin.
export function productImageUrl(value) {
  const url = String(value || "").trim();
  if (!url || /^(?:https?:|data:|blob:)/i.test(url)) return url;
  return apiBaseUrl ? `${apiBaseUrl.replace(/\/api$/, "")}${url}` : url;
}
