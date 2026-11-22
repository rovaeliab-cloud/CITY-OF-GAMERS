"use strict";

const select = (selector, root = document) => root.querySelector(selector);
const selectAll = (selector, root = document) => [...root.querySelectorAll(selector)];
const byId = (id) => document.getElementById(id);

const catalog = byId("catalogo");
const grid = byId("game-grid");
const search = byId("search-input");
const genre = byId("genre-select");
const sort = byId("sort-select");
const count = byId("catalog-count");
const more = byId("load-more");
const cartCount = byId("cart-count");
const empty = byId("empty-state");
const dialogs = {
  product: byId("game-dialog"),
  cart: byId("cart-dialog"),
  order: byId("order-dialog"),
};
const pageSize = 24;
const storageKey = "city-of-gamers-cart-v1";
const accountNames = {
  primaria: "Cuenta primaria",
  secundaria: "Cuenta secundaria",
  completa: "Cuenta completa",
  standard: "Sin tipo de cuenta indicado",
};
const productTypes = { game: "Juego digital", bundle: "Pack digital", addon: "Complemento digital" };
const collator = new Intl.Collator("es", { numeric: true, sensitivity: "base" });
const filters = { platform: "all", genre: "all", search: "", sort: "featured", offers: false, limit: pageSize };
let products = [];
let productMap = new Map();
let sourceUrl = "";
let currency = "";
let money = null;
let cart = readCart();
let selectedProduct = "";
let selectedVariant = "";

function normalize(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function safeUrl(value) {
  if (!value || typeof value !== "string") return "";
  try {
    const parsed = new URL(value, window.location.href);
    return parsed.protocol === "https:" || (parsed.protocol === "http:" && parsed.origin === window.location.origin) ? parsed.href : "";
  } catch {
    return "";
  }
}

function icon(name) {
  return `<svg class="ui-icon" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;
}

function formatPrice(value) {
  return value == null || !money ? "Precio por confirmar" : money.format(value);
}

function parsePrice(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const timeZone = /^\d{4}-\d{2}-\d{2}$/.test(value) ? "UTC" : "America/Bogota";
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeZone }).format(date);
}

function imageMarkup(image, title, eager = false) {
  const url = safeUrl(image);
  if (!url) return `<span class="image-placeholder" aria-hidden="true">${icon("gamepad")}</span>`;
  return `<img src="${escapeHtml(url)}" alt="${escapeHtml(title)}" loading="${eager ? "eager" : "lazy"}" decoding="async">`;
}

function normalizeProducts(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => row?.id != null && row.title).map((row) => {
    const platforms = Array.isArray(row.platforms) ? row.platforms.filter((platform) => ["PS4", "PS5"].includes(platform)) : [];
    const variants = (Array.isArray(row.variants) ? row.variants : []).filter(Boolean).map((variant, index) => ({
      ...variant,
      id: String(variant.id ?? index),
      platform: platforms.includes(variant.platform) || ["PS4", "PS5"].includes(variant.platform) ? variant.platform : null,
      account: Object.hasOwn(accountNames, variant.account) ? variant.account : "standard",
      price: parsePrice(variant.price),
      regularPrice: parsePrice(variant.regularPrice),
      available: typeof variant.available === "boolean" ? variant.available : null,
    }));
    for (const variant of variants) {
      if (variant.platform && !platforms.includes(variant.platform)) platforms.push(variant.platform);
    }
    return {
      ...row,
      id: String(row.id),
      title: String(row.title),
      image: row.image || row.officialCover,
      platforms: [...new Set(platforms)].sort().reverse(),
      genres: Array.isArray(row.genres) ? row.genres.filter((entry) => typeof entry === "string" && entry.trim()) : [],
      variants,
    };
  });
}

function hasPromo(product) {
  return (product.tags || []).some(tag => ["oferta","descuento"].includes(normalize(tag)));
}

function isOffer(variant) {
  return variant.price != null && variant.regularPrice != null && variant.regularPrice > variant.price && variant.available !== false;
}

function variantsForPlatform(product, platform) {
  if (platform === "all") return product.variants;
  return product.variants.filter((variant) => variant.platform === platform || (!variant.platform && product.platforms.includes(platform)));
}

function getCardPrice(product) {
  const prices = variantsForPlatform(product, filters.platform).filter((variant) => variant.price != null);
  const active = prices.filter((variant) => variant.available !== false);
  let pool = active.length ? active : prices;
  if (filters.offers && !hasPromo(product)) pool = pool.filter(isOffer);
  const best = [...pool].sort((a, b) => a.price - b.price)[0];
  return { best, from: pool.some((variant) => variant.price !== best?.price) };
}

function getVisibleProducts() {
  const terms = normalize(filters.search).trim().split(/\s+/).filter(Boolean);
  const results = products.filter((product) => {
    if (filters.platform !== "all" && !product.platforms.includes(filters.platform)) return false;
    if (filters.genre !== "all" && !product.genres.includes(filters.genre)) return false;
    if (filters.offers && !hasPromo(product) && !variantsForPlatform(product, filters.platform).some(isOffer)) return false;
    const searchable = normalize([product.title, product.brand, ...product.platforms, ...product.genres].filter(Boolean).join(" "));
    return terms.every((term) => searchable.includes(term));
  });

  if (filters.sort === "az" || filters.sort === "za") {
    const direction = filters.sort === "az" ? 1 : -1;
    return results.sort((a, b) => direction * collator.compare(a.title, b.title));
  }
  if (filters.sort === "low" || filters.sort === "high") {
    const direction = filters.sort === "low" ? 1 : -1;
    const prices = new Map(results.map((product) => [product.id, getCardPrice(product).best?.price ?? null]));
    return results.sort((a, b) => {
      const left = prices.get(a.id);
      const right = prices.get(b.id);
      if (left == null || right == null) return Number(left == null) - Number(right == null);
      return direction * (left - right) || collator.compare(a.title, b.title);
    });
  }
  return results;
}

function gameCard(product, index) {
  const { best, from } = getCardPrice(product);
  const variants = variantsForPlatform(product, filters.platform);
  const sale = variants.some(isOffer);
  const soldOut = variants.length > 0 && variants.every((variant) => variant.available === false);
  const automaticBadge = sale && !(product.tags || []).some(tag => normalize(tag) === "oferta") ? '<span class="game-tag game-tag--sale">Oferta</span>'
    : soldOut ? '<span class="game-tag">Agotado</span>' : "";
  const badge = automaticBadge + (product.tags || []).map(tag => `<span class="game-tag game-tag--sale">${escapeHtml(tag)}</span>`).join("");
  const platforms = product.platforms.map((platform) => `<span class="game-tag game-tag--platform">${platform}</span>`).join("");
  const label = best ? (from ? "Desde" : "Precio de referencia") : "En catálogo";
  const listPrice = best && isOffer(best) ? `<s class="game-card-price-old">${escapeHtml(formatPrice(best.regularPrice))}</s>` : "";
  return `<button class="game-card" type="button" data-open-product="${escapeHtml(product.id)}" style="--card-index:${Math.min(index, 11)}">
    <span class="game-card-art">${imageMarkup(product.image, "", index < 4)}
      ${badge ? `<span class="game-card-badges">${badge}</span>` : ""}
    </span>
    <span class="game-card-body">
      <span class="game-card-platforms">${platforms}</span>
      <span class="game-card-title">${escapeHtml(product.title)}</span>
      <span class="game-card-bottom">
        <span class="game-card-price">
          <span class="game-card-price-label">${label}</span>
          <span class="game-card-price-current">${escapeHtml(formatPrice(best?.price))}</span>
          ${listPrice}
        </span>
        <span class="game-card-action">${icon("plus")}</span>
      </span>
    </span>
  </button>`;
}

function syncFilters() {
  selectAll("[data-platform]").forEach((button) => {
    const active = button.dataset.platform === filters.platform;
    if (button.tagName === "BUTTON") button.setAttribute("aria-pressed", active);
    if (button.tagName === "A") button.removeAttribute("aria-pressed");
    button.classList.toggle("is-active", active);
  });
  selectAll("[data-show-offers]").forEach((button) => {
    if (button.tagName === "BUTTON") button.setAttribute("aria-pressed", filters.offers);
    if (button.tagName === "A") button.removeAttribute("aria-pressed");
    button.classList.toggle("is-active", filters.offers);
  });
  if (genre) genre.value = filters.genre;
  if (sort) sort.value = filters.sort;
  if (search && search.value !== filters.search) search.value = filters.search;
}

function renderCatalog(append = false) {
  const visible = getVisibleProducts();
  const shown = visible.slice(0, filters.limit);
  const previous = append ? grid.children.length : 0;
  const cards = shown.slice(previous).map((product, index) => gameCard(product, index)).join("");
  if (append) {
    grid.insertAdjacentHTML("beforeend", cards);
    grid.children[previous]?.focus({ preventScroll: true });
  } else {
    grid.innerHTML = cards;
  }
  count.textContent = visible.length === 1
    ? "1 resultado"
    : visible.length > shown.length ? `Mostrando ${shown.length} de ${visible.length} resultados` : `${visible.length} resultados`;
  grid.hidden = !shown.length;
  if (empty) empty.hidden = Boolean(shown.length);
  more.hidden = visible.length <= shown.length;
  const moreControls = byId("more-controls");
  if (moreControls) moreControls.hidden = more.hidden;
  if (!more.hidden) {
    const remaining = Math.min(pageSize, visible.length - shown.length);
    more.innerHTML = `${icon("plus")} ${remaining === 1 ? "Ver 1 juego más" : `Ver ${remaining} juegos más`}`;
  }
  syncFilters();
}

function updateFilters(patch) {
  Object.assign(filters, patch, { limit: pageSize });
  renderCatalog();
}

function scrollToCatalog() {
  catalog?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
}

function dialogMarkup(title, label, body, dialogClass = "") {
  return `<div class="dialog-shell ${dialogClass}">
    <header class="dialog-header">
      <div><p class="dialog-eyebrow">${escapeHtml(label)}</p><h2 class="dialog-section-title">${escapeHtml(title)}</h2></div>
      <button type="button" class="icon-button dialog-close" data-close-dialog aria-label="Cerrar">${icon("close")}</button>
    </header>${body}
  </div>`;
}

function presentDialog(dialog, markup) {
  const container = select("[data-dialog-content]", dialog) || dialog;
  container.innerHTML = markup;
  const title = select("h2", container);
  title.id = `${dialog.id}-title`;
  dialog.setAttribute("aria-labelledby", title.id);
  if (!dialog.open) dialog.showModal();
}

function dismissDialog(dialog) {
  if (dialog.open) dialog.close();
}

function productPlatformLabel(product, variant) {
  if (variant.platformLabel) return variant.platformLabel;
  if (variant.platform) return variant.platform;
  return product.platforms.join(" y ") || "Consola por confirmar";
}

function purchaseHref(product, variant) {
  if (!variant || variant.price == null || variant.available === false) return "";
  const selection = new URLSearchParams({ juego: product.id, variante: variant.id });
  return `./comprar?${selection}`;
}

function priceMarkup(variant) {
  if (!variant) return escapeHtml(formatPrice(null));
  const regular = isOffer(variant) ? ` <s>${escapeHtml(formatPrice(variant.regularPrice))}</s>` : "";
  return `<strong>${escapeHtml(formatPrice(variant.price))}</strong>${regular}`;
}

function optionButton(type, value, title, active, disabled = false) {
  return `<button class="product-option" type="button" data-product-option="${type}" data-value="${escapeHtml(value)}" aria-pressed="${active}" ${disabled ? "disabled" : ""}>${escapeHtml(title)}</button>`;
}

function optionGroup(label, buttons) {
  return `<fieldset class="product-option-group"><legend>${label}</legend><div class="product-option-grid">${buttons.join("")}</div></fieldset>`;
}

function pickVariant(variants) {
  return variants.find((variant) => variant.available !== false && variant.price != null)
    || variants.find((variant) => variant.available !== false)
    || variants[0];
}

function productOptions(product, variant) {
  if (!variant) return "";
  const platformChoices = [...new Set(product.variants.map((entry) => entry.platform || "shared"))];
  const platformOptions = platformChoices.map((platform) => optionButton(
    "platform",
    platform,
    platform === "shared" ? product.platforms.join(" y ") || "Por confirmar" : platform,
    platform === (variant.platform || "shared"),
  ));
  const samePlatform = product.variants.filter((entry) => entry.platform === variant.platform);
  const accounts = [...new Set(samePlatform.map((entry) => entry.account))];
  const indicatedAccounts = product.variants.some((entry) => ["primaria", "secundaria"].includes(entry.account));
  const choices = indicatedAccounts ? [...new Set(["primaria", "secundaria", ...accounts])] : accounts;
  const accountOptions = choices.map((account) => optionButton(
    "account", account, accountNames[account], account === variant.account, !accounts.includes(account),
  ));
  const sameAccount = samePlatform.filter((entry) => entry.account === variant.account);
  const editionOptions = sameAccount.map((entry, index) => optionButton(
    "edition",
    entry.id,
    entry.edition || (sameAccount.length === 1 ? "Estándar" : [entry.platformLabel || `Opción ${index + 1}`, entry.price == null ? "" : formatPrice(entry.price)].filter(Boolean).join(" · ")),
    entry.id === variant.id,
  ));
  return optionGroup("Consola", platformOptions)
    + optionGroup("Tipo de cuenta", accountOptions)
    + (sameAccount.length > 1 || variant.edition ? optionGroup("Edición", editionOptions) : "");
}

function lookupProduct(key) {
  return productMap.get(String(key)) || products.find((product) => product.slug === key || normalize(product.title) === normalize(key));
}

function specifications(product) {
  const details = product.details || {};
  const release = product.editionDate || product.releaseDate || product.release;
  const facts = [
    ["Desarrollador", product.developer],
    ["Editor", product.publisher],
    [product.editionDate ? "Lanzamiento de la edición" : "Lanzamiento", release && formatDate(release)],
    ["Idioma", details.language],
    ["Tamaño", details.size],
    ["Modo PS5", details.ps5Mode],
    ["Requisitos", product.requirements],
    ["Clasificación por edad", product.ageRating],
  ].filter(([, value]) => value);
  if (!facts.length) return "";
  return `<dl class="product-specs">${facts.map(([name, value]) => `<div><dt>${name}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>`;
}

function showProduct(key, preferredPlatform = filters.platform, updateLocation = true, preferredVariant = null) {
  const product = lookupProduct(key);
  if (!product) return;
  selectedProduct = product.id;
  const resumed = product.variants.find((variant) => variant.id === preferredVariant);
  selectedVariant = resumed?.id || pickVariant(variantsForPlatform(product, preferredPlatform))?.id || pickVariant(product.variants)?.id || "";
  renderProduct();
  if (updateLocation) history.replaceState(history.state, "", `#juego=${encodeURIComponent(product.slug || product.id)}`);
}

function renderProduct(focusedOption) {
  const product = lookupProduct(selectedProduct);
  if (!product) return;
  const variant = product.variants.find((entry) => entry.id === selectedVariant);
  const source = safeUrl(product.url) || sourceUrl;
  const official = safeUrl(product.officialSite) || safeUrl(product.officialStore);
  const metadata = [product.publisher ? "" : product.brand, ...product.genres, ...(product.tags || [])].filter(Boolean);
  const purchaseUrl = purchaseHref(product, variant);
  const purchaseLabel = `${icon("check")} Confirmar compra por web.whatsapp`;
  const purchaseAction = purchaseUrl
    ? `<a class="dialog-action" href="${escapeHtml(purchaseUrl)}" target="_blank" rel="noopener noreferrer">${purchaseLabel}</a>`
    : `<button class="dialog-action" type="button" disabled>${purchaseLabel}</button>`;
  const status = variant?.available === false ? "Variante agotada en el catálogo de referencia."
    : variant?.available === null ? "Disponibilidad por confirmar." : "";
  const description = typeof product.description === "string" && product.description.trim()
    ? `<p class="product-description">${escapeHtml(product.description)}</p>` : "";
  presentDialog(dialogs.product, dialogMarkup(product.title, productTypes[product.type] || "Juego digital", `
    <div class="product-layout">
      <div><div class="product-art">${imageMarkup(variant?.image || product.image, `Portada de ${product.title}`, true)}</div>
        <div class="product-gallery">${[...new Set([product.image, ...(product.images || [])])].filter(url => safeUrl(url) && url !== (variant?.image || product.image)).map(url => `<a target="_blank" rel="noopener noreferrer" href="${escapeHtml(safeUrl(url))}">${imageMarkup(url, product.title)}</a>`).join("")}</div></div>
      <div class="product-information">
        ${metadata.length ? `<p class="product-meta">${metadata.map(escapeHtml).join(" · ")}</p>` : ""}
        ${description}
        ${specifications(product)}
        <div class="product-options">${productOptions(product, variant)}</div>
        <div class="product-price"><span>Precio de referencia</span>${priceMarkup(variant)}</div>
        ${status ? `<p class="product-variant-status">${status}</p>` : ""}
        <div class="dialog-actions">
          ${purchaseAction}
        </div>
        <div class="product-links">
          ${source ? `<a class="product-source" href="${escapeHtml(source)}" target="_blank" rel="noopener noreferrer">Ficha y precio de referencia</a>` : ""}
          ${official ? `<a class="product-source" href="${escapeHtml(official)}" target="_blank" rel="noopener noreferrer">Información oficial del juego</a>` : ""}
        </div>
      </div>
    </div>`, "product-dialog-shell"));
  if (focusedOption) {
    selectAll("[data-product-option]", dialogs.product).find((button) => (
      button.dataset.productOption === focusedOption.type && button.dataset.value === focusedOption.value
    ))?.focus({ preventScroll: true });
  }
}

function chooseOption(button) {
  const product = lookupProduct(selectedProduct);
  if (!product) return;
  const current = product.variants.find((variant) => variant.id === selectedVariant);
  if (!current) return;
  const type = button.dataset.productOption;
  const value = button.dataset.value;
  let option;
  if (type === "platform") {
    const variants = product.variants.filter((entry) => (entry.platform || "shared") === value);
    option = pickVariant(variants.filter((entry) => entry.account === current.account)) || pickVariant(variants);
  } else if (type === "account") {
    option = pickVariant(product.variants.filter((entry) => entry.platform === current.platform && entry.account === value));
  } else if (type === "edition") {
    option = product.variants.find((entry) => entry.id === value);
  }
  if (!option || option.id === selectedVariant) return;
  selectedVariant = option.id;
  renderProduct({ type, value });
}

function readCart() {
  try {
    const entries = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
    return Array.isArray(entries) ? entries.filter((entry) => (
      typeof entry?.productId === "string" && typeof entry.variantId === "string"
      && Number.isSafeInteger(entry.quantity) && entry.quantity > 0
    )).map((entry) => ({ ...entry, quantity: Math.min(entry.quantity, 99) })) : [];
  } catch {
    return [];
  }
}

function saveCart() {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(cart));
  } catch {
    // The item remains in the cart in this tab if browser storage is unavailable.
  }
  updateCartCount();
}

function updateCartCount() {
  const quantity = cart.reduce((total, entry) => total + entry.quantity, 0);
  if (cartCount) cartCount.textContent = String(quantity);
  selectAll("[data-open-cart]").forEach((button) => {
    button.setAttribute("aria-label", quantity ? `Abrir carrito, ${quantity} ${quantity === 1 ? "artículo" : "artículos"}` : "Abrir carrito, vacío");
  });
}

function cartDetails() {
  return cart.flatMap((entry) => {
    const product = productMap.get(entry.productId);
    const variant = product?.variants.find((option) => option.id === entry.variantId);
    return product && variant ? [{ ...entry, product, variant }] : [];
  });
}

function cartItem(entry, index) {
  const { product, variant, quantity } = entry;
  const details = [productPlatformLabel(product, variant), accountNames[variant.account], variant.edition].filter(Boolean);
  const invalid = variant.price == null || variant.available === false;
  return `<li class="cart-item">
    <span class="cart-item-image">${imageMarkup(variant.image || product.image, "")}</span>
    <div class="cart-item-info">
      <strong>${escapeHtml(product.title)}</strong>
      <small>${details.map(escapeHtml).join(" · ")}</small>
      <span>${escapeHtml(formatPrice(variant.price == null ? null : variant.price * quantity))}</span>
      ${invalid ? '<small class="product-variant-status">Este artículo requiere confirmación.</small>' : ""}
    </div>
    <div class="cart-item-actions">
      <div class="cart-quantity" aria-label="Cantidad">
        <button type="button" class="icon-button" data-cart-change="-1" data-index="${index}" aria-label="Restar una unidad de ${escapeHtml(product.title)}" ${quantity === 1 ? "disabled" : ""}>${icon("minus")}</button>
        <span>${quantity}</span>
        <button type="button" class="icon-button" data-cart-change="1" data-index="${index}" aria-label="Agregar una unidad de ${escapeHtml(product.title)}" ${quantity >= 99 ? "disabled" : ""}>${icon("plus")}</button>
      </div>
      <button type="button" class="icon-button" data-cart-change="remove" data-index="${index}" aria-label="Quitar ${escapeHtml(product.title)} del carrito">${icon("trash")}</button>
    </div>
  </li>`;
}

function cartTotal(entries) {
  return entries.reduce((total, { variant, quantity }) => total + (variant.price ?? 0) * quantity, 0);
}

function renderCart(focusOptions) {
  const items = cartDetails();
  const markup = items.length ? `
    <ul class="cart-items">${items.map(cartItem).join("")}</ul>
    <div class="cart-totals"><span>Total de referencia</span><strong>${escapeHtml(formatPrice(cartTotal(items)))}</strong></div>
    <p class="dialog-note">Los importes y la disponibilidad están sujetos a confirmación. Puedes guardar tu selección como resumen de pedido.</p>
    <div class="dialog-actions"><button class="dialog-action" type="button" data-review-order
      ${items.some(({ variant }) => variant.price == null || variant.available === false) ? "disabled" : ""}>Revisar pedido</button></div>`
    : `<div class="cart-empty">${icon("cart")}<p>Tu carrito está vacío.</p><button class="dialog-action" type="button" data-return-catalog>Explorar catálogo</button></div>`;
  presentDialog(dialogs.cart, dialogMarkup("Tu carrito", "CITY OF GAMERS", markup, "cart-dialog-shell"));
  if (focusOptions) {
    const buttons = selectAll("[data-cart-change]:not(:disabled)", dialogs.cart);
    (buttons.find((button) => Number(button.dataset.index) === focusOptions.index && button.dataset.cartChange === focusOptions.action)
      || buttons.find((button) => Number(button.dataset.index) === focusOptions.index)
      || select("[data-close-dialog]", dialogs.cart))?.focus({ preventScroll: true });
  }
}

function changeCart(button) {
  const index = Number(button.dataset.index);
  const action = button.dataset.cartChange;
  const entry = cartDetails()[index];
  if (!entry) return;
  cart = cart.flatMap((item) => {
    if (item.productId !== entry.productId || item.variantId !== entry.variantId) return [item];
    if (action === "remove") return [];
    return [{ ...item, quantity: Math.min(99, Math.max(1, item.quantity + Number(action))) }];
  });
  saveCart();
  renderCart({ index, action });
}

function reviewOrder() {
  const items = cartDetails();
  if (!items.length || items.some(({ variant }) => variant.price == null || variant.available === false)) return;
  dismissDialog(dialogs.cart);
  presentDialog(dialogs.order, dialogMarkup("Resumen del pedido", "CITY OF GAMERS", `
    <ul class="order-summary">
      ${items.map(({ product, variant, quantity }) => {
        const variation = [productPlatformLabel(product, variant), accountNames[variant.account], variant.edition].filter(Boolean);
        const numberOfUnits = `${quantity} ${quantity === 1 ? "unidad" : "unidades"}`;
        return `<li><div><strong>${escapeHtml(product.title)}</strong>
          <small>${[...variation, numberOfUnits].map(escapeHtml).join(" · ")}</small></div>
          <span>${escapeHtml(formatPrice(variant.price * quantity))}</span></li>`;
      }).join("")}
    </ul>
    <div class="cart-totals"><span>Total de referencia</span><strong>${escapeHtml(formatPrice(cartTotal(items)))}</strong></div>
    <p class="dialog-note">El resumen se guarda en tu dispositivo. La tienda aún no puede procesar pagos ni confirmar pedidos.</p>
    <div class="dialog-actions"><button class="dialog-action" type="button" data-download-order>${icon("download")} Descargar pedido</button>
      <button class="dialog-secondary" type="button" data-back-to-cart>Volver al carrito</button></div>
  `, "cart-dialog-shell"));
}

function downloadOrder() {
  const items = cartDetails();
  if (!items.length) return;
  const date = new Intl.DateTimeFormat("es-CO", { dateStyle: "long", timeZone: "America/Bogota" }).format(new Date());
  const lines = items.map(({ product, variant, quantity }) => {
    const details = [productPlatformLabel(product, variant), accountNames[variant.account], variant.edition].filter(Boolean).join(" · ");
    return `- ${product.title} — ${details} — ${quantity} × ${formatPrice(variant.price)}`;
  });
  const content = ["CITY OF GAMERS", `Resumen del pedido · ${date}`, "", ...lines, "", `Total de referencia · ${formatPrice(cartTotal(items))}`,
    currency ? `Moneda · ${currency}` : "", "", "Importes y disponibilidad sujetos a confirmación. Resumen pendiente de confirmación y de pago."].join("\n");
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "pedido-city-of-gamers.txt";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function syncProductLocation() {
  const selection = new URLSearchParams(window.location.hash.slice(1));
  const product = selection.get("juego");
  if (!product) {
    dismissDialog(dialogs.product);
    return;
  }
  showProduct(product, filters.platform, false, selection.get("variante"));
}

function onPageClick(event) {
  const target = event.target.closest("button, a, [data-open-product]");
  if (!target || target.disabled) return;
  if (target.hasAttribute("data-platform")) {
    event.preventDefault();
    updateFilters({ platform: target.dataset.platform });
    if (!catalog?.contains(target)) scrollToCatalog();
  } else if (target.hasAttribute("data-show-offers")) {
    event.preventDefault();
    updateFilters({ offers: catalog?.contains(target) ? !filters.offers : true });
    if (!catalog?.contains(target)) scrollToCatalog();
  } else if (target.hasAttribute("data-reset-filters")) {
    event.preventDefault();
    updateFilters({ platform: "all", offers: false, genre: "all", search: "", sort: "featured" });
  } else if (target.hasAttribute("data-open-search")) {
    event.preventDefault();
    scrollToCatalog();
    search?.focus({ preventScroll: true });
  } else if (target.hasAttribute("data-open-product")) {
    event.preventDefault();
    showProduct(target.dataset.openProduct);
  } else if (target.hasAttribute("data-open-cart")) {
    event.preventDefault();
    renderCart();
  } else if (target.hasAttribute("data-close-dialog")) {
    dismissDialog(target.closest("dialog"));
  } else if (target.hasAttribute("data-product-option")) {
    chooseOption(target);
  } else if (target.hasAttribute("data-cart-change")) {
    changeCart(target);
  } else if (target.hasAttribute("data-return-catalog")) {
    dismissDialog(dialogs.cart);
    scrollToCatalog();
  } else if (target.hasAttribute("data-review-order")) {
    reviewOrder();
  } else if (target.hasAttribute("data-back-to-cart")) {
    dismissDialog(dialogs.order);
    renderCart();
  } else if (target.hasAttribute("data-download-order")) {
    downloadOrder();
  }
}

function addListeners() {
  document.addEventListener("click", onPageClick);
  search?.addEventListener("input", () => updateFilters({ search: search.value }));
  search?.closest("form")?.addEventListener("submit", (event) => event.preventDefault());
  genre?.addEventListener("change", () => updateFilters({ genre: genre.value }));
  sort?.addEventListener("change", () => updateFilters({ sort: sort.value }));
  more?.addEventListener("click", () => {
    filters.limit += pageSize;
    renderCatalog(true);
  });
  for (const dialog of Object.values(dialogs)) {
    dialog?.addEventListener("click", (event) => {
      if (event.target === dialog) dismissDialog(dialog);
    });
    dialog?.addEventListener("close", () => {
      if (!dialog.open) (select("[data-dialog-content]", dialog) || dialog).replaceChildren();
    });
  }
  dialogs.product?.addEventListener("close", () => {
    if (!dialogs.product.open && window.location.hash.startsWith("#juego=")) {
      history.replaceState(history.state, "", "#catalogo");
    }
  });
  window.addEventListener("hashchange", syncProductLocation);
  document.addEventListener("error", (event) => {
    if (event.target.tagName === "IMG") event.target.classList.add("image-unavailable");
  }, true);
}

function configureCatalog(catalogData) {
  applyStorefront(catalogData.settings);
  sourceUrl = safeUrl(catalogData.sourceUrl);
  currency = /^[A-Z]{3}$/.test(catalogData.currency) ? catalogData.currency : "";
  if (currency) {
    money = new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency,
      currencyDisplay: currency === "COP" ? "narrowSymbol" : "code",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }
  document.documentElement.dataset.currency = currency;
  products = normalizeProducts(catalogData.products);
  productMap = new Map(products.map((product) => [product.id, product]));
  cart = cart.filter(({ productId, variantId }) => (
    productMap.get(productId)?.variants.some((variant) => variant.id === variantId)
  ));
  saveCart();

  const genres = [...new Set(products.flatMap((product) => product.genres))].sort(collator.compare);
  if (genre) genre.replaceChildren(new Option("Todos los géneros", "all"));
  if (filters.genre !== "all" && !genres.includes(filters.genre)) filters.genre = "all";
  genre?.append(...genres.map((name) => new Option(name, name)));
  const total = byId("catalog-total");
  if (total) total.textContent = new Intl.NumberFormat("es-CO").format(products.length);
  const source = byId("catalog-source");
  if (source && sourceUrl) source.href = sourceUrl;
  const currencyLabel = byId("catalog-currency");
  if (currencyLabel && currency) currencyLabel.textContent = currency;
  const checked = byId("catalog-checked");
  if (checked && catalogData.checkedAt) {
    checked.textContent = formatDate(catalogData.checkedAt);
    if (checked.tagName === "TIME") checked.dateTime = catalogData.checkedAt;
  }
}

async function start() {
  if (!grid || !count || !more || !dialogs.product || !dialogs.cart || !dialogs.order) return;
  addListeners();
  updateCartCount();
  try {
    const response = await fetch("./catalogo.json");
    if (!response.ok) throw new Error(`Catálogo HTTP ${response.status}`);
    const data = await response.json();
    configureCatalog(data);
    watchStorefront(data.revision);
    renderCatalog();
    syncProductLocation();
  } catch (error) {
    console.error(error);
    count.textContent = "El catálogo no se pudo cargar.";
    grid.hidden = true;
    more.hidden = true;
    const moreControls = byId("more-controls");
    if (moreControls) moreControls.hidden = true;
    if (empty) {
      const message = select("[data-empty-message]", empty);
      if (message) message.textContent = "El catálogo no está disponible en este momento. Vuelve a cargar la página para intentarlo de nuevo.";
      selectAll("[data-reset-filters]", empty).forEach((button) => { button.hidden = true; });
      empty.hidden = false;
    }
  }
}

start();
