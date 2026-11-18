const sections = [...document.querySelectorAll(".page-section")];
const sectionLinks = [...document.querySelectorAll(".section-nav a")];
const topbar = document.querySelector(".topbar");
let scheduled = false;

function updateSection() {
  const marker = window.innerHeight * .42;
  const current = sections.findLast((section) => section.getBoundingClientRect().top <= marker) || sections[0];
  for (const link of sectionLinks) {
    if (link.hash === `#${current.id}`) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  }
  topbar.classList.toggle("is-scrolled", window.scrollY > 20);
  scheduled = false;
}
window.addEventListener("scroll", () => {
  if (!scheduled) { scheduled = true; requestAnimationFrame(updateSection); }
}, { passive: true });
window.addEventListener("resize", updateSection);
updateSection();
document.getElementById("year").textContent = new Date().getFullYear();

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
if (!reducedMotion.matches && "IntersectionObserver" in window) {
  const reveal = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-revealed");
      reveal.unobserve(entry.target);
    }
  }, { threshold: .06 });
  for (const element of document.querySelectorAll("[data-reveal]")) {
    if (element.getBoundingClientRect().top <= innerHeight) continue;
    element.classList.add("will-reveal");
    reveal.observe(element);
  }
}

// Freeze the actual README GIF in a canvas, retaining the current frame.
const animation = document.getElementById("studio-animation");
const still = document.getElementById("studio-still");
const animationToggle = document.querySelector(".animation-toggle");
let paused = false;
function setAnimationPaused(value) {
  if (!animation.complete || !animation.naturalWidth) return;
  if (value) {
    still.width = animation.naturalWidth;
    still.height = animation.naturalHeight;
    still.getContext("2d").drawImage(animation, 0, 0);
  }
  paused = value;
  animation.hidden = paused;
  still.hidden = !paused;
  animationToggle.setAttribute("aria-pressed", String(paused));
  animationToggle.setAttribute("aria-label", `${paused ? "Play" : "Pause"} studio demo animation`);
  animationToggle.querySelector("span").textContent = paused ? "Play demo" : "Pause demo";
  animationToggle.querySelector("use").setAttribute("href", paused ? "#play" : "#pause");
}
animationToggle.addEventListener("click", () => setAnimationPaused(!paused));
animation.addEventListener("load", () => { if (reducedMotion.matches) setAnimationPaused(true); });
if (animation.complete && reducedMotion.matches) setAnimationPaused(true);
reducedMotion.addEventListener("change", () => setAnimationPaused(reducedMotion.matches));

// Load the editor near its section; model weights wait for the Render button.
const demoRoot = document.getElementById("violin-demo");
let demoLoading = false;
async function loadDemo() {
  if (demoLoading) return;
  demoLoading = true;
  try {
    const { mountViolinDemo } = await import("../instvela/homepage-demo.js");
    await mountViolinDemo(demoRoot);
  } catch (error) {
    demoLoading = false;
    demoRoot.dataset.state = "error";
    demoRoot.querySelector("#demo-status").textContent = "The violin demo could not load. Try again, or open InstVELA above.";
    const button = demoRoot.querySelector("#render-violin");
    button.disabled = false;
    button.querySelector("span").textContent = "Try again";
    button.addEventListener("click", loadDemo, { once: true });
    console.error("Could not load the homepage violin demo:", error);
  }
}
if ("IntersectionObserver" in window) {
  const demoObserver = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    demoObserver.disconnect();
    void loadDemo();
  }, { rootMargin: "500px 0px" });
  demoObserver.observe(demoRoot);
} else {
  void loadDemo();
}
