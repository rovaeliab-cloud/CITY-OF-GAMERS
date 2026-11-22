function applyStorefront(settings) {
  if (!settings) return;
  const a = settings.appearance;
  updatePromotions(settings);
  document.body.style.backgroundColor = a.backgroundColor;
  document.body.style.backgroundImage = a.backgroundImage ? "url(" + JSON.stringify(a.backgroundImage) + ")" : (a.backgroundColor === "#100d17" ? "" : "none");
  document.body.style.backgroundSize = a.backgroundImage ? "cover" : "";
  document.body.style.backgroundAttachment = a.backgroundImage ? "fixed" : "";
  document.querySelectorAll(".brand").forEach(brand => {
    const label = brand.lastElementChild;
    if (label.textContent !== a.storeName) label.textContent = a.storeName;
    brand.setAttribute("aria-label", a.storeName + ", inicio");
  });
  document.title = a.storeName + " | Videojuegos digitales PS5 y PS4";
  document.querySelector("#catalog-title").textContent = a.catalogTitle;
  const kicker = document.querySelector(".catalog-heading .eyebrow");
  kicker.replaceChildren(document.createElement("span"), document.createTextNode(a.catalogKicker));
  const details = document.querySelector(".store-details");
  details.hidden = !a.showHighlights;
  for (const [i,k] of ["ps5","ps4","account"].entries()) {
    details.children[i].querySelector("strong").textContent = a[k + "Title"];
    details.children[i].querySelector("small").textContent = a[k + "Text"];
  }
  const footer = document.querySelector("#footer-info");
  let customFooter = document.getElementById("cms-footer");
  if (!customFooter) { customFooter = document.createElement("p"); customFooter.id = "cms-footer"; footer.after(customFooter); }
  customFooter.textContent = a.footerText;
  customFooter.hidden = !a.footerText;
  footer.hidden = !!a.footerText;
  const contact = document.querySelector("#contact-whatsapp");
  contact.href = "https://wa.me/" + settings.contact.whatsapp;
  contact.hidden = false;
}

function watchStorefront(initialRevision) {
  let revision = initialRevision;
  let checking = false;
  async function refresh() {
    if (document.hidden || checking) return;
    checking = true;
    try {
      const head = await fetch("/api/revision", {cache:"no-store"});
      if (!head.ok || (await head.json()).revision === revision) return;
      const source = await fetch("/catalogo.json", {cache:"no-store"});
      if (!source.ok) return;
      const data = await source.json();
      configureCatalog(data);
      renderCatalog();
      if (dialogs.product.open) {
        const current = lookupProduct(selectedProduct);
        if (current) showProduct(current.id, filters.platform, false, selectedVariant);
        else dismissDialog(dialogs.product);
      }
      if (dialogs.cart.open) renderCart();
      if (dialogs.order.open) reviewOrder();
      revision = data.revision;
    } catch { /* Retry with the next visible refresh. */ }
    finally { checking = false; }
  }
  window.setInterval(refresh, 6000);
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refresh);
  if ("BroadcastChannel" in window) {
    const updates = new BroadcastChannel("cog-cms");
    updates.onmessage = refresh;
  }
}
