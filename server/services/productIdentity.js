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
    wireless_earbuds: "Wireless earbuds for personal listening to music, calls, podcasts, and other audio content.",
    headphones: "Headphones for personal listening to music, calls, podcasts, and other audio content.",
    microphone: "A microphone for capturing audio during calls, recording, or other voice input.",
    speaker: "An audio product for playing music and other sound content.",
    keyboard: "A keyboard input device for typing and data entry.",
    mouse: "A computer mouse for cursor navigation and input control.",
    mouse_pad: "A desk accessory that provides a surface for using a computer mouse.",
    laptop: "A laptop computer for portable computing tasks.",
    desktop: "A computer for computing tasks in a stationary workspace.",
    tablet: "A tablet computing device for digital tasks and media use.",
    monitor: "A display monitor for visual output from compatible devices.",
    webcam: "A webcam for video calls and video capture.",
    router: "A network router for managing and distributing internet connectivity.",
    charger: "A charging device for powering compatible electronic devices.",
    power_bank: "A portable power bank for recharging compatible electronic devices.",
    usb_hub: "A USB hub for expanding available ports for connected devices.",
    cable: "A cable for connecting compatible electronic devices.",
    smartwatch: "A smartwatch designed as a wearable device for time display and digital features.",
    fitness_tracker: "A fitness tracker designed as a wearable device for activity monitoring.",
    watch: "A watch designed for timekeeping and personal wear.",
    phone_case: "A phone case for protecting a compatible mobile device.",
    screen_protector: "A screen protector for helping shield a compatible device display.",
    smartphone: "A smartphone for communication and mobile digital tasks.",
    camera: "A camera for capturing photographs and video recordings.",
    television: "A television for viewing broadcast, streaming, and video content.",
    printer: "A printer for producing physical copies of digital documents and images.",
    lipstick: "A cosmetic lip product designed to add color and enhance the appearance of the lips.",
    lip_gloss: "A cosmetic lip product designed to add shine and color to the lips.",
    foundation: "A facial cosmetic base product for makeup application.",
    mascara: "A cosmetic product designed to enhance the appearance of eyelashes.",
    perfume: "A scented product for personal fragrance use.",
    shampoo: "A hair-care product for washing and cleansing hair.",
    running_shoes: "A pair of athletic shoes designed for running and athletic activities.",
    shoes: "A pair of shoes designed for everyday footwear use.",
    t_shirt: "A shirt designed for casual and everyday wear.",
    backpack: "A backpack designed for carrying personal items during daily activities.",
    water_bottle: "A water bottle designed for storing and carrying drinking water.",
    mug: "A mug designed for holding and drinking hot or cold beverages.",
    umbrella: "An umbrella designed for protection from rain or sun.",
    notebook: "A notebook designed for writing notes and keeping paper records.",
    yoga_mat: "A yoga mat designed for yoga practice and floor exercises."
  };

  const base = descriptions[identity.type] || `A ${String(category || "general").trim().toLowerCase()} product: ${productName}.`;
  const safeHints = String(extraHints || "").trim().replace(/\s+/g, " ");
  return safeHints ? `${productName} is ${base.charAt(0).toLowerCase()}${base.slice(1)} Vendor notes: ${safeHints}` : `${productName} is ${base.charAt(0).toLowerCase()}${base.slice(1)}`;
}

module.exports = {
  extractProductIdentity,
  isGenericCatalogDescription,
  isSameProductKind,
  isRelevantRetrievedProduct,
  nameOverlap,
  generateLocalDescription
};
