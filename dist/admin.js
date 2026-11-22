(() => {
  "use strict";
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const view = $("#cms-view"), editor = $("#cms-editor"), gameForm = $("#game-form");
  const notice = $("#cms-status"), gameNotice = $("#game-status");
  const escape = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const money = new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:0});
  const topics = {catalogo:"Catálogo",carrusel:"Carrusel de inicio",apariencia:"Apariencia",contacto:"Contacto"};
  const settingsKeys = {carrusel:"banners",apariencia:"appearance",contacto:"contact"};
  const channel = "BroadcastChannel" in window ? new BroadcastChannel("cog-cms") : null;
  let data, game, active = "catalogo", search = "", page = 0, dirty = false, editorDirty = false, busy = false, uploads = 0;
  let editVersion = 0;
  function message(el, text = "", error = false) { el.textContent = text; el.classList.toggle("error",error); }
  function button(action, label, cls = "") { return '<button type="button" data-action="'+action+'" class="'+cls+'">'+escape(label)+'</button>'; }
  function field(name, label, value = "", options = {}) {
    const {type="text",required=false,wide=false,choices,max,rows,placeholder} = options;
    const attr = ' name="'+name+'"'+(required?' required':'')+(max?' maxlength="'+max+'"':'')+(placeholder?' placeholder="'+escape(placeholder)+'"':'');
    let input;
    if (choices) input = '<select'+attr+'>'+choices.map(([k,v])=>'<option value="'+escape(k)+'"'+(k===value?' selected':'')+'>'+escape(v)+'</option>').join("")+'</select>';
    else if (rows) input = '<textarea'+attr+' rows="'+rows+'">'+escape(value)+'</textarea>';
    else if (type==="checkbox") return '<label class="check"><input type="checkbox" name="'+name+'"'+(value?' checked':'')+'>'+escape(label)+'</label>';
    else input = '<input type="'+type+'"'+attr+' value="'+escape(value)+'"'+(type==="number"?' min="0" step="0.01"':'')+'>';
    return '<label'+(wide?' class="wide"':'')+'>'+escape(label)+input+'</label>';
  }
  function uploader(target, label, append = false) {
    return '<label>'+escape(label)+'<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-upload="'+target+'"'+(append?' data-append multiple':'')+'></label>';
  }
  function heading(title, action = "") { return '<header class="cms-title"><h1>'+escape(title)+'</h1>'+action+'</header>'; }
  function card(title, content) { return '<section class="cms-card"><h3>'+escape(title)+'</h3><div class="cms-grid">'+content+'</div></section>'; }
  function read(root, name) { const el = root.querySelector('[name="'+name+'"]'); return el.type==="checkbox" ? el.checked : el.value.trim(); }
  function split(value, separator = ",") { return value.split(separator).map(v=>v.trim()).filter(Boolean); }

  async function api(path, opts = {}) {
    const response = await fetch(path,{cache:"no-store",credentials:"same-origin",...opts});
    let result;
    try { result = await response.json(); } catch { throw Error("La sesión no está disponible. Vuelve a abrir el panel desde la tienda."); }
    if (!response.ok) throw Error(result.error || "No se pudo completar la operación.");
    return result;
  }
  function saved() { channel?.postMessage("guardado"); message(notice,"Cambios guardados en la tienda."); }
  function discard() { return !dirty || window.confirm("Hay cambios sin guardar. ¿Quieres descartarlos?"); }
  async function load() {
    try { data = await api("/api/admin"); dirty = false; message(notice); draw(); }
    catch(e){ message(notice,e.message,true); view.innerHTML=button("reload","Volver a cargar"); }
  }
  function draw() {
    for (const tab of $$("#cms-nav button")) {
      if (tab.dataset.tab === active) tab.setAttribute("aria-current","page");
      else tab.removeAttribute("aria-current");
    }
    if (active === "catalogo") {
      view.innerHTML = heading("Catálogo",button("add-game","Agregar videojuego","cms-primary"))
        + '<div class="cms-toolbar">'+field("search","Buscar videojuego",search,{type:"search",placeholder:"Nombre del juego"})+'<span id="catalog-count-admin" class="cms-count"></span></div><div id="catalog-list"></div>';
      drawList();
      return;
    }
    const settings = data.settings;
    let body;
    if (active === "contacto") {
      body = card("WhatsApp de la tienda",field("whatsapp","Número con indicativo de país",settings.contact.whatsapp,{required:true,type:"tel",placeholder:"+57 300 000 0000"}))
        + '<p class="cms-muted">Este número recibe las consultas de contacto y las confirmaciones de compra.</p>';
    } else if (active === "apariencia") {
      const a=settings.appearance;
      body = card("Fondo de la web",field("backgroundColor","Color de fondo",a.backgroundColor,{type:"color"})
        + field("backgroundImage","URL de la imagen de fondo",a.backgroundImage)+uploader("backgroundImage","Subir imagen de fondo"))
        + card("Textos de la tienda",appearanceFields.map(([k,l])=>field(k,l,a[k],{required:k!=="footerText",max:400,wide:k==="footerText"})).join(""))
        + card("Secciones visibles",field("showBanners","Mostrar carrusel",a.showBanners,{type:"checkbox"})
        + field("showHighlights","Mostrar accesos de consola y tipo de cuenta",a.showHighlights,{type:"checkbox"}));
    } else {
      body = '<div id="banners">'+settings.banners.map(bannerRow).join("")+'</div>'+button("add-banner","Agregar banner");
    }
    view.innerHTML = heading(topics[active])+'<form id="settings-form">'+body+'<div class="cms-actions"><button type="submit" class="cms-primary">Guardar cambios</button>'+button("reload","Recargar datos")+'</div></form>';
    if (active==="carrusel") bannerPositions();
  }
  const appearanceFields = [["storeName","Nombre de la tienda"],["heroTitle","Título accesible del carrusel"],["catalogKicker","Texto sobre el catálogo"],["catalogTitle","Título del catálogo"],["ps5Title","Título del acceso PS5"],["ps5Text","Texto del acceso PS5"],["ps4Title","Título del acceso PS4"],["ps4Text","Texto del acceso PS4"],["accountTitle","Título de cuentas"],["accountText","Texto de cuentas"],["footerText","Texto del pie de página"]];
  function drawList() {
    const normalize = value => value.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    const rows = data.products.filter(p=>normalize(p.title).includes(normalize(search)));
    const pages=Math.max(1,Math.ceil(rows.length/15)); page=Math.min(page,pages-1);
    $("#catalog-count-admin").textContent = rows.length+" de "+data.products.length+" juegos";
    $("#catalog-list").innerHTML = '<div class="cms-table">'+(rows.slice(page*15,page*15+15).map(p=>{
      const values = p.variants.map(v=>v.price).filter(Number.isFinite);
      const img=p.image || p.officialCover;
      return '<div class="cms-row"><span class="cms-game-name">'+(img?'<img src="'+escape(img)+'" loading="lazy" alt="">':'')+'<span><strong>'+escape(p.title)+'</strong><small>'+escape((p.tags || []).join(" · "))+'</small></span></span><span class="cms-platform">'+escape(p.platforms.join(" / "))+'</span><span class="cms-price">'+(values.length?escape(money.format(Math.min(...values))):"Por confirmar")+'</span><button type="button" data-edit="'+escape(p.id)+'">Editar</button></div>';
    }).join("") || '<p class="cms-empty">No hay juegos con ese nombre.</p>')+'</div><div class="cms-pager"><button type="button" data-action="prev"'+(page===0?' disabled':'')+'>Anterior</button><span>'+String(page+1)+' / '+pages+'</span><button type="button" data-action="next"'+(page===pages-1?' disabled':'')+'>Siguiente</button></div>';
  }
  function bannerRow(b={}) {
    return '<div class="cms-banner" data-row data-small="'+escape(b.small||"")+'" data-initial="'+escape(b.image||"")+'"><img '+(b.image?'src="'+escape(b.image)+'"':'hidden')+' alt="Vista previa del banner"><div class="cms-grid">'+field("title","Título",b.title,{required:true,max:120})+field("alt","Descripción accesible",b.alt,{max:500})+field("image","URL de la imagen",b.image,{required:true,wide:true})+uploader("image","Subir imagen")+'</div><div class="cms-actions">'+button("up","Subir posición")+button("down","Bajar posición")+button("remove-banner","Quitar banner","danger")+'</div></div>';
  }
  function bannerPositions() {
    const rows=$$(".cms-banner");
    rows.forEach((row,i)=>{ $('[data-action=up]',row).disabled=i===0; $('[data-action=down]',row).disabled=i===rows.length-1; });
  }
  function variantRow(v={}) {
    const choices = (arr)=>arr.map(s=>[s,s]);
    return '<div class="cms-variant" data-row data-id="'+escape(v.id || crypto.randomUUID())+'"><div class="cms-grid">'
      +field("platform","Consola",v.platform || "PS5",{choices:choices(["PS5","PS4"])})
      +field("account","Cuenta",v.account || "primaria",{choices:[["primaria","Primaria"],["secundaria","Secundaria"],["completa","Completa"],["standard","Estándar"]]})
      +field("edition","Edición",v.edition)+field("price","Precio (COP)",v.price,{type:"number",required:!Object.hasOwn(v,"price") || v.price!==null})
      +field("regularPrice","Precio anterior (COP)",v.regularPrice,{type:"number"})
      +field("available","Disponibilidad",v.available===false?"no":v.available===null?"pendiente":"si",{choices:[["si","Disponible"],["no","Agotado"],["pendiente","Por confirmar"]]})
      +field("image","Imagen de esta variante",v.image,{wide:true})+uploader("image","Subir imagen de variante")
      +'</div><div class="cms-actions">'+button("remove-variant","Quitar variante","danger")+'</div></div>';
  }
  const extraFields=[["brand","Marca"],["developer","Desarrollador"],["publisher","Editor"],["editionDate","Fecha de lanzamiento"],["ageRating","Clasificación por edad"],["language","Idioma"],["size","Tamaño de instalación"],["ps5Mode","Modo PS5"],["officialSite","Web oficial"],["officialStore","Tienda oficial"],["videoUrl","Video"],["url","Fuente del producto"]];
  function openGame(p) {
    game = p || {id:crypto.randomUUID(),type:"game",variants:[],details:{},images:[],genres:[],tags:[]};
    editVersion = data.versions["game:"+game.id] || 0;
    editorDirty = false; message(gameNotice);
    $("#cms-editor-title").textContent=p?"Editar videojuego":"Agregar videojuego";
    $("#game-fields").innerHTML=card("Ficha del videojuego",field("title","Título",game.title,{required:true,wide:true,max:300})
      +field("description","Descripción",game.description,{required:!p || !!game.description,rows:3,wide:true,max:16000})
      +field("type","Tipo de producto",game.type,{choices:[["game","Juego digital"],["bundle","Pack"],["addon","Complemento"]]})
      +field("genres","Géneros separados por comas",(game.genres||[]).join(", "))
      +field("tags","Etiquetas separadas por comas",(game.tags||[]).join(", "),{wide:true,placeholder:"Descuento, Oferta, Nuevo"})
      +field("requirements","Requisitos",game.requirements,{rows:2,wide:true}))
      +card("Imágenes",field("image","URL de la portada",game.image,{required:!p || !!game.image})+uploader("image","Subir portada")
      +field("images","Galería · una URL por línea",(game.images||[]).join("\n"),{rows:2,wide:true})+uploader("images","Añadir imágenes a la galería",true))
      +'<section class="cms-card"><h3>Precios y variantes</h3><div id="variants">'+(p?game.variants:[{}]).map(variantRow).join("")+'</div>'+button("add-variant","Agregar variante")+'</section>'
      +'<details class="cms-card"><summary>Especificaciones y enlaces</summary><div class="cms-grid">'+extraFields.map(([k,l])=>field(k,l,game[k] || game.details?.[k])).join("")+'</div></details>'
      +(p?'<div class="cms-actions">'+button("delete-game","Eliminar videojuego","danger")+button("reload-game","Recargar ficha")+'</div>':"");
    editor.showModal();
  }
  function gameValue() {
    const value={...game, details:{...game.details}};
    for(const k of ["title","description","image","type","requirements"]) value[k]=read(gameForm,k);
    for(const k of ["genres","tags"]) value[k]=split(read(gameForm,k));
    value.images=split(read(gameForm,"images"),"\n");
    for(const [k] of extraFields) { if(["language","size","ps5Mode"].includes(k)) value.details[k]=read(gameForm,k); else value[k]=read(gameForm,k); }
    value.variants=$$(".cms-variant",gameForm).map(row=>{
      const entry={id:row.dataset.id};for(const k of ["platform","account","edition","image"]) entry[k]=read(row,k);
      const old=game.variants.find(v=>String(v.id)===entry.id);
      if(old?.image && old.image===game.image && entry.image===old.image && value.image!==game.image) entry.image=value.image;
      for(const k of ["price","regularPrice"]){ const raw=read(row,k); entry[k]=raw===""?null:Number(raw); }
      entry.available={si:true,no:false,pendiente:null}[read(row,"available")];return entry;
    });
    return value;
  }
  function settingsValue() {
    const form=$("#settings-form");
    if(active==="contacto") return {whatsapp:read(form,"whatsapp")};
    if(active==="apariencia") return Object.fromEntries(Object.keys(data.settings.appearance).map(k=>[k,read(form,k)]));
    return $$(".cms-banner",form).map(row=>{const image=read(row,"image");return {title:read(row,"title"),alt:read(row,"alt"),image,small:image===row.dataset.initial?row.dataset.small:""};});
  }
  async function persist(path, version, value, method="PUT") {
    return api("/api/admin/"+path,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify({version,value})});
  }
  function closeGame() { if(!busy && !uploads && (!editorDirty || confirm("¿Descartar los cambios de esta ficha?"))) {editorDirty=false;editor.close();} }
  async function perform(target, action) {
    if(busy || uploads) return;
    if(action==="reload") {if(discard()) await load();return;}
    if(action==="reload-game") {if(!editorDirty || confirm("¿Descartar esta edición y cargar la ficha guardada?")){const fresh=await api("/api/admin");data=fresh;editorDirty=false;editor.close();draw();const p=data.products.find(p=>p.id===game.id);if(p) openGame(p);}return;}
    if(action==="prev" || action==="next"){page+=action==="prev"?-1:1;drawList();return;}
    if(action==="add-game"){openGame();return;}
    if(action==="add-variant"){$("#variants").insertAdjacentHTML("beforeend",variantRow());editorDirty=true;return;}
    if(action==="remove-variant"){if($$(".cms-variant").length<2)throw Error("Conserva al menos una variante.");target.closest("[data-row]").remove();editorDirty=true;return;}
    if(action==="delete-game"){
      if(!confirm('¿Eliminar «'+game.title+'» del catálogo?')) return;
      busy=true;
      try{await persist("juegos/"+encodeURIComponent(game.id),editVersion,null,"DELETE");data.products=data.products.filter(p=>p.id!==game.id);editorDirty=false;editor.close();draw();saved();}finally{busy=false;}return;
    }
    if(action==="add-banner"){$("#banners").insertAdjacentHTML("beforeend",bannerRow());}
    else {const row=target.closest(".cms-banner");if(!row)return;
      if(action==="remove-banner")row.remove(); else if(action==="up" && row.previousElementSibling)row.parentNode.insertBefore(row,row.previousElementSibling);
      else if(action==="down" && row.nextElementSibling)row.parentNode.insertBefore(row.nextElementSibling,row);}
    dirty=true;bannerPositions();
  }

  document.addEventListener("click",async ev=>{
    const target=ev.target.closest("button");if(!target)return;
    try{
      if(target.hasAttribute("data-close"))return closeGame();
      if(busy || uploads)return;
      if(target.dataset.tab && data){if(active===target.dataset.tab || !discard())return;active=target.dataset.tab;dirty=false;message(notice);draw();}
      else if(target.dataset.edit)openGame(data.products.find(p=>p.id===target.dataset.edit));
      else if(target.dataset.action)await perform(target,target.dataset.action);
    }catch(e){message(editor.open?gameNotice:notice,e.message,true);}
  });
  document.addEventListener("input", ev=>{
    if(ev.target.name==="search"){search=ev.target.value;page=0;drawList();return;}
    if(gameForm.contains(ev.target)) editorDirty=true;
    if(ev.target.closest("#settings-form"))dirty=true;
    if(ev.target.name==="image" && ev.target.closest(".cms-banner")){
      const img=$("img",ev.target.closest(".cms-banner"));
      if(/^(https:\/\/|\/(?:media|assets)\/)/.test(ev.target.value)){img.src=ev.target.value;img.hidden=false;}else img.hidden=true;
    }
  });
  document.addEventListener("change",async ev=>{
    const input=ev.target;if(!input.dataset.upload || !input.files.length)return;
    const where=input.closest("[data-row]") || input.form;
    const output=where.querySelector('[name="'+input.dataset.upload+'"]');
    const status=editor.open?gameNotice:notice;uploads++; message(status,"Subiendo imagen…");
    try {
      for(const file of input.files){if(file.size>4*1024*1024)throw Error("Cada imagen puede pesar hasta 4 MB.");
        const result=await api("/api/admin/media",{method:"POST",headers:{"Content-Type":file.type || "application/octet-stream"},body:file});
        output.value=input.hasAttribute("data-append")?[output.value.trim(),result.url].filter(Boolean).join("\n"):result.url;
        output.dispatchEvent(new Event("input",{bubbles:true}));}
      message(status,"Imagen cargada. Guarda los cambios para mostrarla en la tienda.");
    }catch(e){message(status,e.message,true);}finally{uploads--;input.value="";}
  });
  document.addEventListener("submit",async ev=>{
    ev.preventDefault();if(busy || uploads)return;
    const isGame=ev.target===gameForm;
    const status=isGame?gameNotice:notice;
    busy=true;const submit=ev.submitter;if(submit)submit.disabled=true;
    try{
      message(status,"Guardando…");
      if(isGame){
        const fresh=await persist("juegos/"+encodeURIComponent(game.id),editVersion,gameValue());
        const at=data.products.findIndex(p=>p.id===game.id);if(at<0)data.products.unshift(fresh.value);else data.products[at]=fresh.value;
        data.versions[fresh.key]=fresh.version;editorDirty=false;editor.close();
      }else{
        const k=settingsKeys[active];const fresh=await persist(active,data.versions[k] || 0,settingsValue());
        data.settings[k]=fresh.value;data.versions[k]=fresh.version;dirty=false;
      }
      draw();saved();
    }catch(e){message(status,e.message,true);}finally{busy=false;if(submit)submit.disabled=false;}
  });
  editor.addEventListener("cancel",ev=>{ev.preventDefault();closeGame();});
  window.addEventListener("beforeunload", ev=>{if(dirty || editorDirty || uploads){ev.preventDefault();ev.returnValue="";}});
  load();
})();
