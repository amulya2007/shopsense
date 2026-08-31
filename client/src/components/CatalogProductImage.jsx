import { useEffect, useState } from "react";
import { Package } from "lucide-react";
import { productImageUrl } from "../lib/productImageUrl";

export default function CatalogProductImage({ src, alt, className }) {
  const [failed, setFailed] = useState(false);
  const imageUrl = productImageUrl(src);

  useEffect(() => setFailed(false), [imageUrl]);

  if (!imageUrl || failed) {
    return (
      <div className={`${className} flex items-center justify-center`} style={{ background: "var(--surface)" }}>
        <Package size={36} style={{ color: "var(--border)" }} aria-hidden="true" />
      </div>
    );
  }

  return (
    <img
      src={imageUrl}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
