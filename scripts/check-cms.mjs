import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = new URL("../", import.meta.url);
const load = path => readFile(new URL(path, root));
const { default: worker } = await import(new URL("dist/server/index.js", root));
const sqlite = new DatabaseSync(":memory:");
sqlite.exec((await load("drizzle/0000_contenido_tienda.sql")).toString());
const objects = new Map();
const env = {
  PROFILE_SIGNING_SECRET: randomBytes(32).toString("hex"),
  DB: { prepare(sql) {
    const stmt = sqlite.prepare(sql);
    const bind = (...params) => ({
      bind, first: async () => stmt.get(...params), all: async () => ({results:stmt.all(...params)}),
    });
    return bind();
  } },
  BUCKET: { put: async (key, bytes) => objects.set(key, bytes), get: async key => objects.has(key) ? {body:objects.get(key)} : null },
};
const origin = "https://cms.local.test";
const admin = ["juanjoseortegaparraga6@gmail.com","rovaeliab@gmail.com","cityofgamerso@gmail.com"];
const customer = "lector@example.test";
function request(path, email, method = "GET", payload, more = {}) {
  const headers = { Origin:origin, ...more };
  if(email) { headers["oai-authenticated-user-id"]="user-"+email; headers["oai-authenticated-user-email"]=email; }
  let body;
  if(payload instanceof Uint8Array) body=payload;
  else if(payload!==undefined) { headers["Content-Type"]="application/json"; body=JSON.stringify(payload); }
  return worker.fetch(new Request(origin+path,{method,headers,body}),env);
}
async function update(path, version, value, method="PUT", user=admin[0]) {
  const response=await request("/api/admin/"+path,user,method,{version,value});
  const result=await response.json();
  assert.ok(response.ok, JSON.stringify(result));
  return result;
}
for(const email of admin) {
  assert.equal((await request("/admin",email)).status,200);
  assert.match(await (await request("/",email)).text(),/>ADMIN<\/a>/);
}
assert.doesNotMatch(await (await request("/",customer)).text(),/>ADMIN<\/a>/);
assert.equal((await request("/admin.html",customer)).status,403);
assert.equal((await request("/api/admin")).status,401);
assert.equal((await request("/api/admin",customer)).status,403);
for (const path of ["contacto","apariencia","carrusel","juegos/test","media"]) {
  assert.equal((await request("/api/admin/"+path,customer,path==="media"?"POST":"PUT",{})).status,403);
}
const before=await (await request("/api/admin",admin[0])).json();
assert.equal(before.products.length,447); assert.equal(before.settings.banners.length,6);
const product={...before.products[0],id:"comprobacion",title:"Prueba de catálogo",description:"Prueba local",requirements:"Conexión a internet",tags:["Nuevo"],variants:[{...before.products[0].variants[0],price:12345}]};
const add=await update("juegos/comprobacion",0,product);
let catalog=await (await request("/catalogo.json",customer)).json();
assert.equal(catalog.products[0].title,product.title);
const change=await update("juegos/comprobacion",add.version,{...add.value,tags:["Oferta"],variants:[{...add.value.variants[0],price:9000}]});
assert.equal(change.value.variants[0].price,9000);
const stale=await request("/api/admin/juegos/comprobacion",admin[1],"PUT",{version:add.version,value:product});
assert.equal(stale.status,409);
assert.equal((await request("/api/admin/contacto",admin[0],"PUT",{version:0,value:{whatsapp:"1"}},{Origin:"https://otro.example"})).status,403);
const image=await load("dist/assets/banners/descuentos-1024.webp");
const media=await (await request("/api/admin/media",admin[2],"POST",image,{"Content-Type":"image/webp"})).json();
const downloaded=await request(media.url,customer);assert.equal(downloaded.headers.get("Content-Type"),"image/webp");
assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),image);
const banners=[{title:"Nuevo banner",alt:"Prueba",image:media.url},...before.settings.banners.slice(1).reverse()];
await update("carrusel",0,banners);
await update("apariencia",0,{...before.settings.appearance,backgroundColor:"#121234",backgroundImage:media.url,catalogTitle:"Juegos destacados",showHighlights:false});
await update("contacto",0,{whatsapp:"+57 300 000 0000"});
catalog=await (await request("/catalogo.json",customer)).json();
assert.equal(catalog.settings.contact.whatsapp,"573000000000");assert.equal(catalog.settings.banners[0].image,media.url);assert.equal(catalog.settings.appearance.catalogTitle,"Juegos destacados");
assert.equal(catalog.products[0].requirements,"Conexión a internet");assert.equal(catalog.products[0].tags[0],"Oferta");
const profile=await request("/api/perfil",customer,"PUT",{name:"Cliente de prueba"});
const cookie=profile.headers.get("Set-Cookie").split(";")[0];
const buy=await request("/comprar?juego=comprobacion&variante="+change.value.variants[0].id,customer,"GET",undefined,{Cookie:cookie});
const destination=new URL(buy.headers.get("location"));assert.equal(destination.pathname,"/573000000000");assert.match(destination.searchParams.get("text"),/9[.,]000/);
await update("juegos/comprobacion",change.version,null,"DELETE");
assert.equal((await request("/comprar?juego=comprobacion&variante=1",customer)).status,404);
const base=before.products[1];const baseChange=await update("juegos/"+base.id,0,{...base,title:"Edición de una ficha original"});
assert.equal(baseChange.value.variants.length,base.variants.length);
await update("juegos/"+base.id,baseChange.version,null,"DELETE");
assert.equal((await (await request("/catalogo.json",customer)).json()).products.length,446);
const revision=await (await request("/api/revision",customer)).json();assert.ok(revision.revision>=8);
sqlite.close();
console.log("CMS verificado con SQLite local: tres cuentas ADMIN, cliente, catálogo, precios, etiquetas, archivos, carrusel, apariencia, WhatsApp, conflictos entre ediciones y eliminación.");
