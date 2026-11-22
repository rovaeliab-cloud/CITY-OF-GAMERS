function mountPromotions(carousel) {

  const viewport = carousel.querySelector(".promo-viewport");
  const slides = Array.from(viewport.children);
  const controls = carousel.querySelector(".promo-controls");
  const dots = carousel.querySelector(".promo-dots");
  const caption = carousel.querySelector(".promo-caption");
  const rotation = carousel.querySelector("[data-rotation]");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const count = slides.length;
  let selected = 0;
  let rotating = !reducedMotion.matches;
  let hovered = false;
  let inView = false;
  let timer;
  let drag;
  let settleTimer;
  if (count < 2) return () => {};

  // The two end copies let a swipe continue in the same direction at either edge.
  function endCopy(slide) {
    const copy = slide.cloneNode(false);
    copy.alt = "";
    copy.setAttribute("aria-hidden", "true");
    copy.removeAttribute("data-title");
    copy.removeAttribute("fetchpriority");
    copy.loading = "lazy";
    return copy;
  }
  viewport.prepend(endCopy(slides[count - 1]));
  viewport.append(endCopy(slides[0]));
  const frames = Array.from(viewport.children);
  const lastFrame = frames.length - 1;
  let requestedFrame = 1;

  function scheduleRotation() {
    window.clearTimeout(timer);
    if (rotating && inView && !hovered && !document.hidden) {
      timer = window.setTimeout(() => showFrame(selected + 2), 7000);
    }
  }

  function setRotation(playing) {
    rotating = playing;
    const label = playing ? "Pausar el carrusel" : "Reproducir el carrusel";
    rotation.title = label;
    rotation.setAttribute("aria-label", label);
    rotation.querySelector("use").setAttribute("href", playing ? "#i-pause" : "#i-play");
    caption.setAttribute("aria-live", playing ? "off" : "polite");
    scheduleRotation();
  }

  const indicators = slides.map((slide, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "promo-dot";
    button.title = slide.dataset.title;
    button.setAttribute("aria-controls", viewport.id);
    button.setAttribute("aria-label", `Banner ${index + 1} de ${count}, ${slide.dataset.title}`);
    button.addEventListener("click", () => navigate(index + 1));
    dots.append(button);
    return button;
  });

  function selectFrame(frame) {
    selected = (frame - 1 + count) % count;
    for (const [index, slide] of slides.entries()) {
      slide.setAttribute("aria-hidden", String(index !== selected));
      indicators[index].setAttribute("aria-current", String(index === selected));
    }
    const title = slides[selected].dataset.title;
    if (caption.textContent !== title) caption.textContent = title;
  }

  function scrollToFrame(frame, behavior) {
    viewport.scrollTo({ left: frames[frame].offsetLeft, behavior });
  }

  function showFrame(frame) {
    // A second button press can arrive while a wraparound is still animating.
    if (requestedFrame === 0 || requestedFrame === lastFrame) {
      scrollToFrame(selected + 1, "instant");
    }
    requestedFrame = frame;
    selectFrame(frame);
    scrollToFrame(frame, reducedMotion.matches ? "instant" : "smooth");
    scheduleRotation();
  }

  function navigate(frame) {
    setRotation(false);
    showFrame(Math.max(0, Math.min(frame, lastFrame)));
  }

  function nearestFrame() {
    const width = slides[0].getBoundingClientRect().width;
    return Math.max(0, Math.min(Math.round(viewport.scrollLeft / width), lastFrame));
  }

  function settleScroll() {
    if (drag) return;
    const frame = nearestFrame();
    selectFrame(frame);
    requestedFrame = selected + 1;
    if (frame !== requestedFrame) scrollToFrame(requestedFrame, "instant");
    scheduleRotation();
  }

  if ("onscrollend" in viewport) {
    viewport.addEventListener("scrollend", settleScroll);
  } else {
    viewport.addEventListener("scroll", () => {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(settleScroll, 120);
    }, { passive: true });
  }

  carousel.querySelector("[data-previous]").addEventListener("click", () => navigate(selected));
  carousel.querySelector("[data-next]").addEventListener("click", () => navigate(selected + 2));
  rotation.addEventListener("click", () => {
    hovered = false;
    setRotation(!rotating);
  });
  carousel.addEventListener("keydown", (event) => {
    const targets = { ArrowLeft: selected, ArrowRight: selected + 2, Home: 1, End: count };
    if (!Object.hasOwn(targets, event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    navigate(targets[event.key]);
  });
  carousel.addEventListener("focusin", (event) => {
    if (event.target.matches(":focus-visible")) setRotation(false);
  });
  carousel.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "mouse") {
      hovered = true;
      scheduleRotation();
    }
  });
  carousel.addEventListener("pointerleave", () => {
    hovered = false;
    scheduleRotation();
  });
  viewport.addEventListener("wheel", (event) => {
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) setRotation(false);
  }, { passive: true });

  // Touchscreens and trackpads scroll natively. A mouse can drag the same track.
  viewport.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    setRotation(false);
    if (event.pointerType !== "mouse") return;
    drag = { x: event.clientX, left: viewport.scrollLeft, frame: nearestFrame() };
    viewport.classList.add("is-dragging");
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener("pointermove", (event) => {
    if (drag && event.pointerType === "mouse") viewport.scrollLeft = drag.left + drag.x - event.clientX;
  });
  function finishDrag(event) {
    if (!drag || event.pointerType !== "mouse") return;
    let frame = nearestFrame();
    const travel = drag.x - event.clientX;
    if (event.type === "pointerup" && frame === drag.frame && Math.abs(travel) > Math.min(50, viewport.clientWidth * .12)) {
      frame += Math.sign(travel);
    }
    drag = null;
    viewport.classList.remove("is-dragging");
    navigate(frame);
  }
  viewport.addEventListener("pointerup", finishDrag);
  viewport.addEventListener("lostpointercapture", finishDrag);

  document.addEventListener("visibilitychange", scheduleRotation);
  const onMotionChange = () => { if (reducedMotion.matches) setRotation(false); };
  reducedMotion.addEventListener("change", onMotionChange);
  const visibility = new IntersectionObserver(([entry]) => {
    inView = entry.intersectionRatio >= 0.4;
    scheduleRotation();
  }, { threshold: 0.4 });
  visibility.observe(viewport);

  let previousWidth = viewport.clientWidth;
  const size = new ResizeObserver(() => {
    if (viewport.clientWidth === previousWidth) return;
    previousWidth = viewport.clientWidth;
    requestedFrame = selected + 1;
    scrollToFrame(requestedFrame, "instant");
  });
  size.observe(viewport);

  selectFrame(1);
  scrollToFrame(1, "instant");
  setRotation(rotating);
  controls.hidden = false;
  return () => {
    visibility.disconnect();
    size.disconnect();
    clearTimeout(timer);
    clearTimeout(settleTimer);
    document.removeEventListener("visibilitychange", scheduleRotation);
    reducedMotion.removeEventListener("change", onMotionChange);
  };
}

const originalPromotions = document.querySelector(".promotions").cloneNode(true);
let releasePromotions = document.querySelector(".promotions").hidden ? () => {} : mountPromotions(document.querySelector(".promotions"));
let lastBanners;
function updatePromotions(settings) {
  const banners = settings.banners;
  const signature = JSON.stringify([banners,settings.appearance.showBanners,settings.appearance.heroTitle]);
  if (lastBanners === signature) return;
  lastBanners = signature;
  releasePromotions();
  const carousel = originalPromotions.cloneNode(true);
  const viewport = carousel.querySelector(".promo-viewport");
  viewport.replaceChildren();
  carousel.hidden = !settings.appearance.showBanners || !banners.length;
  carousel.querySelector("h1").textContent = settings.appearance.heroTitle;
  banners.forEach((b, i) => {
    const image = document.createElement("img");
    image.src = b.image;
    if (b.small) {
      image.srcset = b.small + " 1024w, " + b.image + " 2048w";
      image.sizes = "(max-width: 1344px) 100vw, 1344px";
    }
    image.width = 2048;
    image.height = 682;
    image.alt = b.alt || b.title;
    image.dataset.title = b.title;
    image.draggable = false;
    if (i === 0) image.fetchPriority = "high";
    else image.loading = "lazy";
    viewport.append(image);
  });
  document.querySelector(".promotions").replaceWith(carousel);
  releasePromotions = carousel.hidden ? () => {} : mountPromotions(carousel);
}
