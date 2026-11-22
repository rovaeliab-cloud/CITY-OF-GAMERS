(() => {
  "use strict";

  const trigger = document.getElementById("profile-trigger");
  const triggerLabel = document.getElementById("profile-trigger-label");
  const dialog = document.getElementById("profile-dialog");
  const close = document.getElementById("profile-close");
  const form = document.getElementById("profile-form");
  const input = document.getElementById("profile-name");
  const email = document.getElementById("profile-email");
  const status = document.getElementById("profile-status");
  const submit = document.getElementById("profile-save");
  const retry = document.getElementById("profile-retry");
  const endpoint = "/api/perfil";

  let loaded = false;
  let busy = false;
  let savedName = "";

  function setStatus(message = "", error = false) {
    status.textContent = message;
    status.classList.toggle("is-error", error);
  }

  function updateControls() {
    input.disabled = !loaded || busy;
    submit.disabled = !loaded || busy;
    retry.disabled = busy;
    form.setAttribute("aria-busy", String(busy));
  }

  function showProfile() {
    if (dialog.open) return;
    input.setCustomValidity("");
    if (loaded) {
      input.value = savedName;
      setStatus();
    }
    dialog.showModal();
  }

  function renderProfile(profile) {
    savedName = typeof profile.name === "string" ? profile.name.trim() : "";
    input.value = savedName;
    if (Object.hasOwn(profile, "email") || !loaded) {
      email.textContent = typeof profile.email === "string" && profile.email ? profile.email : "No disponible";
    }
    triggerLabel.textContent = savedName || "Mi perfil";
    trigger.setAttribute("aria-label", savedName ? `Mi perfil, ${savedName}` : "Mi perfil");
  }

  async function requestProfile(options = {}) {
    const response = await fetch(endpoint, { credentials: "same-origin", cache: "no-store", ...options });
    if (!response.ok) throw new Error(String(response.status));
    const profile = await response.json();
    if (!profile || !Object.hasOwn(profile, "name")) throw new Error("Perfil inválido");
    return profile;
  }

  function completeReturn() {
    const url = new URL(location.href);
    const pendingKeys = ["perfil", "juego", "variante"];
    if (!pendingKeys.some((key) => url.searchParams.has(key))) return;
    const game = url.searchParams.get("juego");
    const variant = url.searchParams.get("variante");
    for (const key of pendingKeys) url.searchParams.delete(key);
    if (game) {
      const hash = new URLSearchParams({ juego: game });
      if (variant) hash.set("variante", variant);
      url.hash = hash.toString();
    }
    if (url.href === location.href) return;

    const oldURL = location.href;
    const changedHash = url.hash !== location.hash;
    history.replaceState(history.state, "", url);
    if (changedHash) window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL, newURL: url.href }));
  }

  async function loadProfile() {
    if (busy) return;
    busy = true;
    retry.hidden = true;
    email.textContent = "Cargando…";
    setStatus();
    updateControls();
    const params = new URLSearchParams(location.search);

    try {
      renderProfile(await requestProfile());
      loaded = true;
    } catch {
      email.textContent = "No disponible";
      setStatus("No pudimos cargar tu perfil. Inténtalo de nuevo.", true);
      retry.hidden = false;
    } finally {
      busy = false;
      updateControls();
    }

    if (loaded && savedName && params.has("juego")) {
      if (dialog.open) dialog.close();
      completeReturn();
    } else if (params.get("perfil") === "1") {
      showProfile();
      if (!input.disabled) input.focus();
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    if (!loaded || busy) return;
    const name = input.value.trim();
    if (!name || name.length > 80) {
      input.setCustomValidity("Escribe un nombre de 1 a 80 caracteres.");
      input.reportValidity();
      return;
    }

    busy = true;
    setStatus("Guardando tu nombre…");
    updateControls();

    try {
      const profile = await requestProfile({
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (typeof profile.name !== "string" || !profile.name.trim()) throw new Error("Nombre inválido");
      renderProfile(profile);
      dialog.close();
      completeReturn();
    } catch {
      setStatus("No pudimos guardar tu nombre. Inténtalo de nuevo.", true);
    } finally {
      busy = false;
      updateControls();
    }
  }

  trigger.addEventListener("click", showProfile);
  close.addEventListener("click", () => dialog.close());
  retry.addEventListener("click", loadProfile);
  form.addEventListener("submit", saveProfile);
  input.addEventListener("input", () => input.setCustomValidity(""));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  loadProfile();
})();
