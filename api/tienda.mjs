import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import store from "../dist/server/index.js";
import { cloudStorage } from "../lib/cloud-storage.mjs";

const noStore = { "Cache-Control":"private, no-store", "Referrer-Policy":"same-origin", "X-Content-Type-Options":"nosniff" };
const now = () => Math.floor(Date.now()/1000);
const hmac = (secret,text) => createHmac("sha256",secret).update(text).digest("base64url");
function signed(secret,purpose,data) {
  const body=Buffer.from(JSON.stringify(data)).toString("base64url");
  return body+"."+hmac(secret,purpose+"\n"+body);
}
function verified(secret,purpose,value) {
  if (!value || value.length>5000) return null;
  const [body,sig,extra]=value.split(".");
  if (!sig || extra!==undefined) return null;
  const expected=Buffer.from(hmac(secret,purpose+"\n"+body));
  const actual=Buffer.from(sig);
  if(actual.length!==expected.length || !timingSafeEqual(actual,expected))return null;
  try {const obj=JSON.parse(Buffer.from(body,"base64url"));return Number.isSafeInteger(obj.exp)&&obj.exp>now()?obj:null;}catch{return null;}
}
function nameFor(url, name) { return (url.protocol==="https:"?"__Host-":"local-")+"cog-"+name; }
function cookie(url,name,value,seconds) {return nameFor(url,name)+"="+value+"; Path=/; HttpOnly; SameSite=Lax; Max-Age="+seconds+(url.protocol==="https:"?"; Secure":"");}
function readCookie(request,url,name) {const prefix=nameFor(url,name)+"=";return (request.headers.get("cookie") || "").split(";").map(v=>v.trim()).find(v=>v.startsWith(prefix))?.slice(prefix.length);}
function redirect(url,...cookies) {const hdr=new Headers({...noStore,Location:url.href});for(const c of cookies)hdr.append("Set-Cookie",c);return new Response(null,{status:303,headers:hdr});}
function page(title,body,status=200) {
  const html='<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+' | CITY OF GAMERS</title><style>body{font:16px/1.5 system-ui;background:#100d17;color:#f7f2fe;min-height:96vh;display:grid;place-items:center;margin:0}main{max-width:27rem;margin:1rem;padding:2rem;border:1px solid #49355e;border-radius:1rem;background:#201728}b{color:#c6a2ff}a,button{font:inherit;font-weight:650;color:#261530;background:#d0afff;border:0;border-radius:.5rem;padding:.65rem .9rem;display:inline-block;text-decoration:none;cursor:pointer}</style><main><b>CITY OF GAMERS</b><h1>'+title+'</h1>'+body+'</main></html>';
  return new Response(html,{status,headers:{...noStore,"Content-Type":"text/html; charset=utf-8"}});
}
function routeUrl(request){
  const url=new URL(request.url);
  const route=url.searchParams.get("__recurso");
  if(route!==null){url.pathname="/"+route.replace(/^\/+/,"");url.searchParams.delete("__recurso");}
  else if(url.pathname==="/api/tienda")url.pathname="/";
  return url;
}
function returnPath(path) {
  if(!path || !path.startsWith("/") || path.startsWith("//") || /[\\\r\n]/.test(path))return "/";
  return path;
}
function callbackUrl(origin){return new URL("/auth/callback",origin).href;}
function loginStart(url, env) {
  const state=randomBytes(24).toString("base64url"),verifier=randomBytes(48).toString("base64url");
  const go=new URL("https://accounts.google.com/o/oauth2/v2/auth");
  const params={client_id:env.GOOGLE_CLIENT_ID,redirect_uri:callbackUrl(env.APP_ORIGIN),response_type:"code",scope:"openid email",prompt:"select_account",state,code_challenge_method:"S256",code_challenge:createHash("sha256").update(verifier).digest("base64url")};
  go.search=new URLSearchParams(params);
  const flow=signed(env.SESSION_SECRET,"oauth",{state,verifier,path:returnPath(url.searchParams.get("volver")),exp:now()+600});
  return redirect(go,cookie(url,"flujo",flow,600));
}
async function finishLogin(request,url,env,transport){
  const fail=()=>page("Vuelve a iniciar sesión",'<p>No se pudo verificar la cuenta de Google.</p><a href="/acceso">Intentar de nuevo</a>',401);
  const flow=verified(env.SESSION_SECRET,"oauth",readCookie(request,url,"flujo"));
  const code=url.searchParams.get("code");
  if(!flow || !code || flow.state!==url.searchParams.get("state"))return fail();
  const token=await transport("https://oauth2.googleapis.com/token",{method:"POST",body:new URLSearchParams({code,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:callbackUrl(env.APP_ORIGIN),grant_type:"authorization_code",code_verifier:flow.verifier})});
  if(!token.ok)return fail();
  const {access_token}=await token.json();if(!access_token)return fail();
  const info=await transport("https://openidconnect.googleapis.com/v1/userinfo",{headers:{Authorization:"Bearer "+access_token}});
  if(!info.ok)return fail();
  const user=await info.json();
  if(user.email_verified!==true || typeof user.email!=="string" || typeof user.sub!=="string" || !user.sub)return fail();
  const session=signed(env.SESSION_SECRET,"login",{id:user.sub,email:user.email.trim().toLowerCase(),exp:now()+86400});
  return redirect(new URL(returnPath(flow.path),env.APP_ORIGIN),cookie(url,"sesion",session,86400),cookie(url,"flujo","",0));
}

export async function handleStore(request,env=process.env,storage=null,transport=fetch) {
  const url=routeUrl(request);
  if(!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.APP_ORIGIN || (env.SESSION_SECRET || "").length<32) return page("Configuración de acceso","<p>Completa las variables de Google y de sesión indicadas en README.md.</p>",503);
  const canonical=new URL(env.APP_ORIGIN).origin;
  if(url.origin!==canonical)return redirect(new URL(url.pathname+url.search,canonical));
  if(url.pathname==="/auth/callback" && request.method==="GET")return finishLogin(request,url,env,transport);
  if(url.pathname==="/acceso" && request.method==="GET")return loginStart(url,env);
  if(url.pathname==="/salir"){
    if(request.method==="GET")return page("Cerrar sesión",'<form method="post"><button>Cerrar sesión</button></form>');
    if(request.method!=="POST" || request.headers.get("origin")!==canonical)return new Response(null,{status:403});
    return redirect(new URL("/",canonical),cookie(url,"sesion","",0));
  }
  const session=verified(env.SESSION_SECRET,"login",readCookie(request,url,"sesion"));
  if(!session){
    if(url.pathname.startsWith("/api/"))return Response.json({error:"Inicia sesión."},{status:401,headers:noStore});
    const to=new URL("/acceso",url);to.searchParams.set("volver",url.pathname+url.search);return redirect(to);
  }
  const headers=new Headers();
  for(const key of ["origin","cookie","content-type","content-length"])if(request.headers.has(key))headers.set(key,request.headers.get(key));
  headers.set("oai-authenticated-user-id","google:"+session.id);headers.set("oai-authenticated-user-email",session.email);
  const init={method:request.method,headers};
  if(request.body && !["GET","HEAD"].includes(request.method)){init.body=request.body;init.duplex="half";}
  const bindings = storage || cloudStorage(env,transport);
  const response=await store.fetch(new Request(url,init),{...bindings,PROFILE_SIGNING_SECRET:hmac(env.SESSION_SECRET,"perfil")});
  if(request.method==="GET" && (url.pathname==="/" || url.pathname==="/index.html") && response.headers.get("content-type")?.startsWith("text/html")){
    return new Response((await response.text()).replace('href="/signout-with-chatgpt?return_to=%2F"','href="/salir"'),{status:response.status,headers:response.headers});
  }
  return response;
}
export default { fetch(request){ return handleStore(request); } };
