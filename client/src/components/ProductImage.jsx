import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";

export default function ProductImage({ src, alt }) {
  const [failed, setFailed] = useState(false);
  const imageUrl = src?.trim();

  useEffect(() => setFailed(false), [imageUrl]);

  if (!imageUrl || failed) {
    return (
      <div
        className="w-11 h-11 shrink-0 rounded-lg flex items-center justify-center"
        style={{ background: "var(--surface)", color: "var(--ink-soft)" }}
        title={imageUrl ? "Image could not be loaded" : "No product image"}
      >
        <ImageOff size={17} aria-hidden="true" />
      </div>
    );
  }

  return (
    <img
      src={imageUrl}
      alt={alt}
      loading="lazy"
      decoding="async"
      className="w-11 h-11 shrink-0 rounded-lg object-cover"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
      onError={() => setFailed(true)}
    />
  );
}
