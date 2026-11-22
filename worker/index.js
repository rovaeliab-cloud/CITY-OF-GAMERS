const profileCookie = "__Host-city-gamers-profile";
const profileMaxAge = 180 * 24 * 60 * 60;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const privateHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
const accountLabels = new Map([
  ["primaria", "Cuenta primaria"],
  ["secundaria", "Cuenta secundaria"],
  ["completa", "Cuenta completa"],
]);
const catalog = JSON.parse(siteAssets["/catalogo.json"].body);
const products = new Map(catalog.products.map((product) => [String(product.id), product]));
const prices = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: catalog.currency,
  currencyDisplay: catalog.currency === "COP" ? "narrowSymbol" : "code",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function signedInUser(request) {
  const id = request.headers.get("oai-authenticated-user-id")?.trim();
  const email = request.headers.get("oai-authenticated-user-email")?.trim();
  return id && email ? { id, email } : null;
}

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { ...privateHeaders, ...headers } });
}

function redirect(url) {
  return new Response(null, {
    status: 302,
    headers: { ...privateHeaders, Location: url.href },
  });
}

function signIn(url) {
  const destination = new URL("/signin-with-chatgpt", url.origin);
  destination.searchParams.set("return_to", url.pathname + url.search);
  return redirect(destination);
}

function base64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value) {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0));
}

function profileKey(env) {
  if (typeof env.PROFILE_SIGNING_SECRET !== "string" || env.PROFILE_SIGNING_SECRET.length < 32) {
    throw new Error("PROFILE_SIGNING_SECRET no configurado");
  }
  return crypto.subtle.importKey(
    "raw", encoder.encode(env.PROFILE_SIGNING_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
  );
}

function nameForProfile(value) {
  if (typeof value !== "string") return "";
  const name = value.trim().normalize("NFC");
  if (!name || [...name].length > 80 || /[\p{C}\p{Zl}\p{Zp}]/u.test(name)) return "";
  return name;
}

async function profileName(request, user, key) {
  const prefix = `${profileCookie}=`;
  const cookie = request.headers.get("Cookie")?.split(";")
    .map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length);
  if (!cookie || cookie.length > 2048 || !/^[\w-]+\.[\w-]+$/.test(cookie)) return "";

  try {
    const [payload, signature] = cookie.split(".");
    const valid = await crypto.subtle.verify(
      "HMAC", key, decodeBase64Url(signature), encoder.encode(`${user.id}\n${payload}`),
    );
    if (!valid) return "";
    const profile = JSON.parse(decoder.decode(decodeBase64Url(payload)));
    if (!Number.isSafeInteger(profile.expires) || profile.expires <= Math.floor(Date.now() / 1000)) return "";
    return nameForProfile(profile.name);
  } catch {
    return "";
  }
}

async function setProfileCookie(user, name, key) {
  const expires = Math.floor(Date.now() / 1000) + profileMaxAge;
  const payload = base64Url(encoder.encode(JSON.stringify({ name, expires })));
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${user.id}\n${payload}`));
  return `${profileCookie}=${payload}.${base64Url(new Uint8Array(signature))}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${profileMaxAge}`;
}

async function readProfileInput(request) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const bytes = new Uint8Array(4096);
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.byteLength > bytes.length) {
        await reader.cancel();
        return "";
      }
      bytes.set(value, length);
      length += value.byteLength;
    }
    const input = JSON.parse(decoder.decode(bytes.subarray(0, length)));
    return nameForProfile(input?.name);
  } catch {
    return "";
  } finally {
    reader.releaseLock();
  }
}

async function handleProfile(request, url, env) {
  const user = signedInUser(request);
  if (!user) return json({ error: "Inicia sesión para acceder al perfil." }, 401);

  if (request.method === "GET") {
    const name = await profileName(request, user, await profileKey(env));
    return json({ name, email: user.email, role: isAdmin(user) ? "admin" : "cliente" });
  }
  if (request.method !== "PUT") {
    return json({ error: "Método no disponible." }, 405, { Allow: "GET, PUT" });
  }
  if (request.headers.get("Origin") !== url.origin) {
    return json({ error: "La solicitud debe iniciarse desde la tienda." }, 403);
  }
  const type = request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
  if (type !== "application/json") {
    return json({ error: "El formato de la solicitud debe ser JSON." }, 415);
  }
  const name = await readProfileInput(request);
  if (!name) return json({ error: "Escribe un nombre de entre 1 y 80 caracteres." }, 400);

  const cookie = await setProfileCookie(user, name, await profileKey(env));
  return json({ name, email: user.email }, 200, { "Set-Cookie": cookie });
}

function whatsappPurchase(product, variant, name, whatsapp) {
  const platform = variant.platformLabel || variant.platform || product.platforms?.join(" y ") || "Consola por confirmar";
  const account = accountLabels.get(variant.account) || "Sin tipo de cuenta indicado";
  const price = `${prices.format(variant.price)}${catalog.currency === "COP" ? " COP" : ""}`;
  const message = [
    "Hola, CITY OF GAMERS. Quiero confirmar esta compra.",
    `Nombre · ${name}`,
    `Juego · ${product.title}`,
    `Consola · ${platform}`,
    `Tipo de cuenta · ${account}`,
    variant.edition && `Edición · ${variant.edition}`,
    `Precio de referencia · ${price}`,
  ].filter(Boolean).join("\n");
  const destination = new URL("https://wa.me/" + whatsapp);
  destination.searchParams.set("text", message);
  return redirect(destination);
}

async function handlePurchase(request, url, env) {
  if (request.method !== "GET") {
    return json({ error: "Método no disponible." }, 405, { Allow: "GET" });
  }
  const user = signedInUser(request);
  if (!user) return signIn(url);

  const id = url.searchParams.get("juego") || "";
  const { value: product } = await currentEntry(env.DB, "game:" + id, products.get(id));
  const variantId = url.searchParams.get("variante");
  const variant = product?.variants?.filter(Boolean).find((entry, index) => String(entry.id ?? index) === variantId);
  if (!product || !variant) return json({ error: "No encontramos la opción seleccionada." }, 404);
  if (variant.available === false || !Number.isFinite(variant.price) || variant.price < 0) {
    return json({ error: "La opción seleccionada no está disponible para confirmar." }, 409);
  }

  const name = await profileName(request, user, await profileKey(env));
  if (!name) {
    const profile = new URL("/", url.origin);
    profile.searchParams.set("perfil", "1");
    profile.searchParams.set("juego", String(product.id));
    profile.searchParams.set("variante", variantId);
    return redirect(profile);
  }
  const { value: contact } = await currentEntry(env.DB, "contact", storeDefaults.contact);
  return whatsappPurchase(product, variant, name, contact.whatsapp);
}

async function serveAsset(request, url, env) {
  const path = url.pathname === "/" ? "/index.html" : url.pathname === "/admin" || url.pathname === "/admin/" ? "/admin.html" : url.pathname;
  if (!Object.hasOwn(siteAssets, path)) return new Response("No se encontró la página.", { status: 404 });
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "Método no disponible." }, 405, { Allow: "GET, HEAD" });
  }
  if (path === "/index.html" && !signedInUser(request)) return signIn(url);
  if (path === "/catalogo.json" && !signedInUser(request)) {
    return json({ error: "Inicia sesión para consultar el catálogo." }, 401);
  }

  const user = signedInUser(request);
  if (path.startsWith("/admin.")) {
    if (!user) return signIn(url);
    if (!isAdmin(user)) return new Response("Tu cuenta no tiene acceso al panel.", { status: 403, headers: privateHeaders });
  }
  if (path === "/catalogo.json") {
    if (request.method === "HEAD") return new Response(null, { headers: privateHeaders });
    const data = await snapshot(env.DB);
    return json({ ...catalog, products: data.products, settings: data.settings, revision: data.revision });
  }
  const { contentType, body, base64 } = siteAssets[path];
  let content = request.method === "HEAD" ? null
    : base64 ? Uint8Array.from(atob(body), (char) => char.charCodeAt(0)) : body;
  const headers = { ...privateHeaders, "Content-Type": contentType };
  if (path === "/index.html" || path === "/admin.html") headers["Referrer-Policy"] = "same-origin";
  if (path === "/index.html" && content) content = content.replace("<!--admin-action-->", isAdmin(user) ? '<a class="icon-button admin-link" href="/admin">ADMIN</a>' : "");
  if (path === "/index.html" && content) content = await initialBanners(content, env.DB);
  return new Response(content, { headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/admin" || url.pathname.startsWith("/api/admin/")) return await handleCms(request, url, env);
      if (url.pathname.startsWith("/media/")) return await serveMedia(request, url, env);
      if (url.pathname === "/api/revision" && request.method === "GET") {
        if (!signedInUser(request)) return json({ error: "Inicia sesión." }, 401);
        return json(await env.DB.prepare("SELECT COALESCE(SUM(version), 0) AS revision FROM cms_entries").first());
      }
      if (url.pathname === "/api/perfil") return await handleProfile(request, url, env);
      if (url.pathname === "/comprar") return await handlePurchase(request, url, env);
      return await serveAsset(request, url, env);
    } catch (error) {
      if (error instanceof InputError) return json({ error: error.message }, 400);
      return json({ error: "El servicio no está disponible en este momento." }, 503);
    }
  },
};
