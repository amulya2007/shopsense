"use strict";

// Product identity helpers shared by the RAG retriever and description generator.
// Names are intentionally the primary signal: the historical dataset contains
// category labels that are not always consistent with the product name.

const TYPE_PATTERNS = [
  ["wireless_earbuds", /\b(?:wireless\s+)?(?:earbuds?|earphones?|in[ -]?ear)\b/i],
  ["headphones", /\b(?:headphones?|headsets?)\b/i],
  ["microphone", /\b(?:microphones?|mics?)\b/i],
  ["speaker", /\b(?:speakers?|soundbars?)\b/i],
  ["keyboard", /\b(?:keyboards?)\b/i],
  ["mouse", /\b(?:mice|mouse)\b/i],
  ["mouse_pad", /\b(?:mouse\s*pad|desk\s*mat)\b/i],
  ["notebook", /\b(?:notebooks?)\b/i],
  ["laptop", /\b(?:laptops?)\b/i],
  ["desktop", /\b(?:desktops?|pcs?|computers?)\b/i],
  ["tablet", /\b(?:tablets?)\b/i],
  ["monitor", /\b(?:monitors?|displays?)\b/i],
  ["webcam", /\b(?:webcams?)\b/i],
  ["router", /\b(?:routers?|modems?)\b/i],
  ["charger", /\b(?:chargers?|charging\s+(?:adapter|brick|dock))\b/i],
  ["power_bank", /\b(?:power\s*banks?|portable\s+chargers?)\b/i],
  ["usb_hub", /\b(?:usb\s*hubs?|docks?)\b/i],
  ["cable", /\b(?:usb\s*)?(?:cables?|cords?)\b/i],
  ["smartwatch", /\b(?:smart\s*watches?|smartwatches?)\b/i],
  ["fitness_tracker", /\b(?:fitness\s*(?:bands?|trackers?)|activity\s*trackers?)\b/i],
  ["watch", /\b(?:watches?|watch)\b/i],
  ["phone_case", /\b(?:phone\s*cases?|mobile\s*covers?)\b/i],
  ["screen_protector", /\b(?:screen\s*protectors?|tempered\s*glass)\b/i],
  ["smartphone", /\b(?:smartphones?|mobile\s*phones?)\b/i],
  ["camera", /\b(?:cameras?|dslr)\b/i],
  ["television", /\b(?:televisions?|tvs?)\b/i],
  ["printer", /\b(?:printers?)\b/i],
  ["lipstick", /\b(?:lipsticks?|lip\s*sticks?)\b/i],
  ["lip_gloss", /\b(?:lip\s*gloss(?:es)?)\b/i],
  ["foundation", /\b(?:foundations?)\b/i],
  ["mascara", /\b(?:mascaras?)\b/i],
  ["perfume", /\b(?:perfumes?|fragrances?|colognes?)\b/i],
  ["shampoo", /\b(?:shampoos?)\b/i],
  ["running_shoes", /\b(?:running\s+shoes?|running\s+sneakers?)\b/i],
  ["shoes", /\b(?:shoes?|sneakers?|trainers?|boots?|sandals?)\b/i],
  ["t_shirt", /\b(?:t[ -]?shirts?|tees?)\b/i],
  ["backpack", /\b(?:backpacks?)\b/i],
  ["water_bottle", /\b(?:water\s*bottles?)\b/i],
  ["mug", /\b(?:mugs?|cups?)\b/i],
  ["umbrella", /\b(?:umbrellas?)\b/i],
  ["notebook", /\b(?:notebooks?)\b/i],
  ["yoga_mat", /\b(?:yoga\s*mats?)\b/i]
];

const TOKEN_STOPWORDS = new Set([
  "a", "an", "and", "at", "best", "buy", "by", "for", "from", "get", "in", "is", "item",
  "me", "my", "of", "on", "or", "product", "products", "show", "the", "to", "with", "under",
  "above", "available", "cheap", "cheapest", "expensive", "find", "looking", "need", "price", "shop",
  "shopsense", "want", "wireless", "smart", "basic", "classic", "ergonomic", "gaming", "lite", "max",
  "portable", "premium", "pro", "ultra", "new", "latest", "quality"
]);

function normalise(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function meaningfulTokens(value) {
  return normalise(value).split(/\s+/).filter((token) =>
    token.length > 1 && !TOKEN_STOPWORDS.has(token) && !/^x\d+$/.test(token)
  );
}

function extractProductIdentity(name, category = "") {
  const normalizedName = normalise(name);
  const normalizedCategory = normalise(category);
  const match = TYPE_PATTERNS.find(([, pattern]) => pattern.test(normalizedName));
  return {
    type: match ? match[0] : "",
    name: normalizedName,
    category: normalizedCategory,
    tokens: meaningfulTokens(normalizedName)
  };
}

function nameOverlap(left, right) {
  const leftTokens = new Set(meaningfulTokens(left));
  const rightTokens = new Set(meaningfulTokens(right));
  if (!leftTokens.size || !rightTokens.size) return 0;

  let shared = 0;
  leftTokens.forEach((token) => { if (rightTokens.has(token)) shared += 1; });
  // Favour a query whose meaningful product words are all present in a name,
  // while retaining a bounded score for broad product searches.
  return shared / Math.min(leftTokens.size, rightTokens.size);
}

function isSameProductKind(leftName, rightName, leftCategory = "", rightCategory = "") {
  const left = extractProductIdentity(leftName, leftCategory);
  const right = extractProductIdentity(rightName, rightCategory);
  if (left.type && right.type) return left.type === right.type;
  if (left.type || right.type) return false;
  return nameOverlap(leftName, rightName) >= 0.6;
}

function isGenericCatalogDescription(description) {
  const text = normalise(description);
  if (!text) return true;
  return (
    /^shopsense catalog product in \w+(?: \w+)?$/.test(text) ||
    /^shopsense marketplace catalog product(?: in \w+(?: \w+)?)?$/.test(text) ||
    /^(?:a|an) (?:product|item) designed for everyday use$/.test(text) ||
    /^(?:a|an) (?:electronics|audio|computing|wearable|home|fashion|food) product designed for everyday(?: [a-z]+)? use$/.test(text)
  );
}

function isRelevantRetrievedProduct(productName, category = "", doc = {}) {
  if (!doc || !doc.name) return false;
  const query = extractProductIdentity(productName, category);
  const candidate = extractProductIdentity(doc.name, doc.category);

  // A recognised product type is a hard relevance boundary. This prevents an
  // accessory sharing a department (for example, a mouse beside a keyboard)
  // from influencing the generated description.
  if (query.type) return candidate.type === query.type;
  if (candidate.type) return nameOverlap(productName, doc.name) >= 0.6;

  const overlap = nameOverlap(productName, doc.name);
  if (overlap >= 0.6) return true;
  return Boolean(category && doc.category && normalise(category) === normalise(doc.category) && overlap >= 0.35);
}

function generateLocalDescription(name, category = "", extraHints = "") {
  const productName = String(name || "").trim() || "This product";
  const identity = extractProductIdentity(productName, category);
  const descriptions = {
    wireless_earbuds: ["pair of wireless earbuds", "calls, listening, and other personal audio"],
    headphones: ["pair of headphones", "calls, listening, and other personal audio"],
    microphone: ["microphone", "voice recording, calls, and audio input"],
    speaker: ["speaker", "playing music and other audio"],
    keyboard: ["keyboard", "typing and computer input"],
    mouse: ["computer mouse", "cursor navigation and computer input"],
    mouse_pad: ["mouse pad", "providing a dedicated mouse surface"],
    laptop: ["laptop computer", "portable computing tasks"],
    desktop: ["desktop computer", "a stationary computing workspace"],
    tablet: ["tablet", "digital tasks and media use"],
    monitor: ["monitor", "displaying visual output from compatible devices"],
    webcam: ["webcam", "video calls and video capture"],
    router: ["router", "managing internet connectivity for compatible devices"],
    charger: ["charger", "powering compatible electronic devices"],
    power_bank: ["portable power bank", "recharging compatible devices away from a power outlet"],
    usb_hub: ["USB hub", "adding ports for compatible devices"],
    cable: ["cable", "connecting compatible electronic devices"],
    smartwatch: ["smartwatch", "wearable timekeeping and digital tasks"],
    fitness_tracker: ["fitness tracker", "monitoring everyday activity"],
    watch: ["watch", "timekeeping and everyday wear"],
    phone_case: ["phone case", "protecting a compatible mobile device"],
    screen_protector: ["screen protector", "helping protect a compatible device display"],
    smartphone: ["smartphone", "communication and mobile digital tasks"],
    camera: ["camera", "capturing photos and video"],
    television: ["television", "viewing broadcast, streaming, and video content"],
    printer: ["printer", "producing physical copies of documents and images"],
    lipstick: ["lip color product", "adding color to the lips"],
    lip_gloss: ["lip gloss", "adding shine and color to the lips"],
    foundation: ["foundation makeup product", "creating a base for makeup application"],
    mascara: ["mascara", "enhancing the appearance of eyelashes"],
    perfume: ["personal fragrance", "everyday fragrance use"],
    shampoo: ["shampoo", "cleansing hair"],
    running_shoes: ["pair of running shoes", "running and other athletic activity"],
    shoes: ["pair of shoes", "everyday footwear use"],
    t_shirt: ["casual T-shirt", "everyday wear"],
    backpack: ["backpack", "carrying personal essentials"],
    water_bottle: ["water bottle", "storing and carrying drinking water"],
    mug: ["mug", "holding hot or cold beverages"],
    umbrella: ["umbrella", "protection from rain or sun"],
    notebook: ["notebook", "writing notes and keeping paper records"],
    yoga_mat: ["yoga mat", "yoga practice and floor exercises"]
  };

  const [productType, typicalUse] = descriptions[identity.type] || ["product", "its intended everyday purpose"];
  const safeHints = String(extraHints || "").trim().replace(/\s+/g, " ");
  const hintLine = safeHints
    ? `Vendor notes: ${safeHints}`
    : "Review the listing details to confirm the specifications and compatibility you need.";

  // Line breaks give the product form a readable three-line draft while the
  // catalogue still renders the same content naturally as a paragraph.
  return [
    `${productName} is a ${productType} designed for ${typicalUse}.`,
    `It is a suitable choice when you need a product for this purpose in the ${String(category || "general").trim() || "general"} category.`,
    hintLine
  ].join("\n");
}

module.exports = {
  extractProductIdentity,
  isGenericCatalogDescription,
  isSameProductKind,
  isRelevantRetrievedProduct,
  nameOverlap,
  generateLocalDescription
};
