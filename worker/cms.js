const adminAddresses = new Set([
  "juanjoseortegaparraga6@gmail.com", "rovaeliab@gmail.com", "cityofgamerso@gmail.com",
]);
const isAdmin = (user) => Boolean(user && adminAddresses.has(user.email.trim().toLowerCase()));
const cmsId = /^[a-zA-Z0-9_-]{1,100}$/;
const mediaKey = /^[0-9a-f-]{36}\.(?:jpg|png|webp|gif)$/;
const imageTypes = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
class InputError extends Error {}
function requireValue(ok, message) { if (!ok) throw new InputError(message); }

function field(value, max, required = false) {
  requireValue(value == null || typeof value === "string", "Revisa los campos de texto.");
  const result = (value || "").trim();
  requireValue(result.length <= max && (!required || result.length > 0), "Completa los campos obligatorios y revisa la longitud del texto.");
  return result;
}
function urlField(value, required = false) {
  const val = field(value, 2048, required);
  if (!val || /^\/assets\/[\w./-]+$/.test(val) && !val.includes("..") || val.startsWith("/media/") && mediaKey.test(val.slice(7))) return val;
  let parsed;
  try { parsed = new URL(val); } catch {}
  requireValue(parsed && parsed.protocol === "https:" && !parsed.username && !parsed.password, "La imagen o el enlace debe usar una dirección HTTPS válida.");
  return parsed.href;
}
function listOf(value, max, convert) {
  requireValue(Array.isArray(value) && value.length <= max, "La lista tiene un formato o una longitud incorrectos.");
  return value.map(convert);
}
function priceValue(value) {
  requireValue(value === null || typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1e13, "Revisa los precios de tus variantes.");
  return value;
}
function cleanProduct(input, existing, id) {
  const p = { ...existing, id };
  p.title = field(input.title, 300, true);
  p.description = field(input.description, 16000, !existing || !!existing.description);
  p.image = urlField(input.image, !existing || !!existing.image);
  p.images = [...new Set(listOf(input.images || [], 40, (v) => urlField(v, true)))];
  p.tags = [...new Set(listOf(input.tags || [], 12, (v) => field(v, 42, true)))];
  p.genres = [...new Set(listOf(input.genres || [], 30, (v) => field(v, 100, true)))];
  for (const k of ["brand", "developer", "publisher", "editionDate", "requirements", "ageRating"]) p[k] = field(input[k], k === "requirements" ? 5000 : 260);
  for (const k of ["officialSite", "officialStore", "videoUrl", "url"]) p[k] = urlField(input[k]);
  p.details = { ...existing?.details };
  for (const k of ["language", "size", "ps5Mode"]) p.details[k] = field(input.details?.[k], 500);
  requireValue(["game", "bundle", "addon"].includes(input.type), "Selecciona un tipo de producto.");
  p.type = input.type;
  const previous = new Map((existing?.variants || []).map(v => [String(v.id), v]));
  const ids = new Set();
  p.variants = listOf(input.variants, 80, (v) => {
    const key = field(v.id, 100, true);
    requireValue(cmsId.test(key) && !ids.has(key), "Las variantes deben tener identificadores distintos.");
    ids.add(key);
    requireValue(["PS4","PS5"].includes(v.platform) && ["primaria","secundaria","completa","standard"].includes(v.account), "Revisa la consola o cuenta de la variante.");
    const old = previous.get(key);
    requireValue(v.price !== null || (old && old.price == null), "Indica el precio de cada variante nueva.");
    requireValue([true,false,null].includes(v.available), "Revisa la disponibilidad.");
    return { ...old, id: key, platform: v.platform, platformLabel: old?.platform === v.platform ? (old.platformLabel || v.platform) : v.platform,
      account: v.account, edition: field(v.edition, 220), image: urlField(v.image), price: priceValue(v.price),
      regularPrice: priceValue(v.regularPrice ?? null), available: v.available };
  });
  requireValue(p.variants.length > 0, "Agrega al menos una variante con consola y precio.");
  p.platforms = [...new Set(p.variants.map(v => v.platform))];
  return p;
}
function cleanSettings(key, input) {
  if (key === "contact") {
    const raw = field(input.whatsapp, 36, true);
    const digits = raw.replace(/[\s()+-]/g, "");
    requireValue(/^[1-9]\d{6,14}$/.test(digits), "Escribe el número internacional de WhatsApp con indicativo de país.");
    return { whatsapp: digits };
  }
  if (key === "banners") return listOf(input, 40, (b) => ({
    title: field(b.title, 120, true), alt: field(b.alt, 500), image: urlField(b.image, true), small: urlField(b.small),
  }));
  const out = {};
  for (const k of Object.keys(storeDefaults.appearance)) {
    const value = input[k];
    if (k === "backgroundImage") out[k] = urlField(value);
    else if (k === "backgroundColor") {
      requireValue(/^#[a-f\d]{6}$/i.test(value), "Elige un color de fondo válido.");
      out[k] = value;
    } else if (k === "showBanners" || k === "showHighlights") { requireValue(typeof value === "boolean", "Revisa la visibilidad de las secciones."); out[k] = value; }
    else out[k] = field(value, 400, k !== "footerText");
  }
  return out;
}

async function snapshot(db) {
  const { results } = await db.prepare("SELECT entry_key, version, value FROM cms_entries ORDER BY rowid").all();
  const items = new Map(products);
  const settings = { ...storeDefaults };
  const versions = {};
  const added = [];
  let revision = 0;
  for (const row of results) {
    versions[row.entry_key] = row.version;
    revision += row.version;
    const value = row.value === null ? null : JSON.parse(row.value);
    if (row.entry_key.startsWith("game:")) {
      const id = row.entry_key.slice(5);
      if (value === null) items.delete(id);
      else if (products.has(id)) items.set(id, value);
      else added.push(value);
    } else if (Object.hasOwn(storeDefaults, row.entry_key)) settings[row.entry_key] = value;
  }
  return { settings, versions, revision, products: [...added.reverse(), ...items.values()] };
}
async function currentEntry(db, key, fallback) {
  const row = await db.prepare("SELECT version, value FROM cms_entries WHERE entry_key = ?").bind(key).first();
  return row ? { version: row.version, value: row.value === null ? null : JSON.parse(row.value) } : { version: 0, value: fallback };
}
async function writeEntry(db, key, version, value) {
  const encoded = value === null ? null : JSON.stringify(value);
  const statement = version === 0
    ? db.prepare("INSERT INTO cms_entries (entry_key, version, value) VALUES (?, 1, ?) ON CONFLICT(entry_key) DO NOTHING RETURNING version").bind(key, encoded)
    : db.prepare("UPDATE cms_entries SET version = version + 1, value = ? WHERE entry_key = ? AND version = ? RETURNING version").bind(encoded, key, version);
  return await statement.first();
}
async function limitedBytes(request, max) {
  if (Number(request.headers.get("content-length") || 0) > max || !request.body) throw new InputError("El archivo o formulario supera el tamaño permitido o está vacío.");
  const reader = request.body.getReader();
  const parts = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) { await reader.cancel(); throw new InputError("El archivo o formulario supera el tamaño permitido."); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let pos = 0;
  for (const part of parts) { bytes.set(part, pos); pos += part.length; }
  return bytes;
}
function mediaExtension(bytes) {
  const str = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpg";
  if (str(0,8) === "\x89PNG\r\n\x1a\n") return "png";
  if (str(0,4) === "RIFF" && str(8,12) === "WEBP") return "webp";
  if (["GIF87a","GIF89a"].includes(str(0,6))) return "gif";
  throw new InputError("Selecciona una imagen PNG, JPEG, WebP o GIF.");
}
async function serveMedia(request, url, env) {
  const key = url.pathname.slice(7);
  if (!mediaKey.test(key)) return new Response(null, { status: 404 });
  if (!["GET","HEAD"].includes(request.method)) return new Response(null, { status: 405 });
  const object = await env.BUCKET.get(key);
  if (!object) return new Response(null, { status: 404 });
  return new Response(request.method === "HEAD" ? null : object.body, { headers: {
    "Content-Type": imageTypes[key.split(".").pop()], "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  } });
}
async function handleCms(request, url, env) {
  const user = signedInUser(request);
  if (!user) return json({ error: "Inicia sesión para administrar la tienda." }, 401);
  if (!isAdmin(user)) return json({ error: "Tu cuenta no tiene permisos de administración." }, 403);
  if (url.pathname === "/api/admin" && request.method === "GET") return json(await snapshot(env.DB));
  if (request.headers.get("Origin") !== url.origin) return json({ error: "Guarda los cambios desde esta tienda." }, 403);
  if (url.pathname === "/api/admin/media" && request.method === "POST") {
    const bytes = await limitedBytes(request, 4 * 1024 * 1024);
    const ext = mediaExtension(bytes);
    const key = crypto.randomUUID() + "." + ext;
    await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: imageTypes[ext] } });
    return json({ url: "/media/" + key }, 201);
  }
  const match = /^\/api\/admin\/(juegos\/([a-zA-Z0-9_-]{1,100})|apariencia|carrusel|contacto)$/.exec(url.pathname);
  if (!match) return json({ error: "Recurso desconocido." }, 404);
  const id = match[2];
  const key = id ? "game:" + id : {apariencia:"appearance",carrusel:"banners",contacto:"contact"}[match[1]];
  if (!(request.method === "PUT" || (id && request.method === "DELETE"))) return json({ error: "Método no disponible." }, 405);
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return json({ error: "Se esperaba JSON." }, 415);
  let payload;
  try { payload = JSON.parse(decoder.decode(await limitedBytes(request, 160 * 1024))); } catch { throw new InputError("Revisa el formulario o reduce su tamaño."); }
  requireValue(Number.isSafeInteger(payload?.version) && payload.version >= 0, "Actualiza el panel para guardar esta edición.");
  const current = await currentEntry(env.DB, key, id ? products.get(id) : storeDefaults[key]);
  if (current.version !== payload.version) return json({ error: "Otra persona guardó cambios. Recarga los datos antes de editar esta sección." }, 409);
  if (request.method === "DELETE" && !current.value) return json({ error: "Este juego ya no está en el catálogo." }, 404);
  if (id && !current.value && current.version > 0) return json({ error: "Este juego fue eliminado. Crea una ficha nueva." }, 409);
  const value = request.method === "DELETE" ? null : id ? cleanProduct(payload.value, current.value, id) : cleanSettings(key, payload.value);
  const saved = await writeEntry(env.DB, key, current.version, value);
  return saved ? json({ version: saved.version, key, value }) : json({ error: "El registro cambió en otra sesión. Recarga los datos." }, 409);
}

function markupText(value) {
  return String(value).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]);
}
async function initialBanners(html, db) {
  const { results } = await db.prepare("SELECT entry_key, value FROM cms_entries WHERE entry_key IN ('banners', 'appearance')").all();
  const overrides = Object.fromEntries(results.map(row => [row.entry_key, JSON.parse(row.value)]));
  const banners = overrides.banners || storeDefaults.banners;
  const appearance = overrides.appearance || storeDefaults.appearance;
  if (appearance.showBanners && banners.length) html = html.replace('<section hidden class="promotions"', '<section class="promotions"');
  if (overrides.banners) {
    const images = banners.map((b,i) => {
      const sourceSet = b.small ? ' srcset="' + markupText(b.small) + ' 1024w, ' + markupText(b.image) + ' 2048w" sizes="(max-width: 1344px) 100vw, 1344px"' : "";
      return '<img data-title="' + markupText(b.title) + '" src="' + markupText(b.image) + '"' + sourceSet + ' width="2048" height="682" draggable="false" alt="' + markupText(b.alt || b.title) + '"' + (i ? ' loading="lazy"' : ' fetchpriority="high"') + '>';
    }).join("");
    html = html.replace(/<!--promo-start-->[\s\S]*?<!--promo-end-->/, () => images);
  }
  return html;
}
