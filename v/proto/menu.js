// The main menu: the CRT shows one project at a time, like a level preview. Arrows, hover on a medallion,
// the keyboard (left, right, Enter) or a swipe change the channel; between channels the screen shows a moment of snow.
(function () {
  var game = document.querySelector("[data-menu]");
  if (!game) return;
  var up = game.getAttribute("data-up"), proj = game.getAttribute("data-proj");
  var still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var levels = [
    { key: "tape", name: "uvcdv-capture", href: proj + "/uvcdv-capture/", counters: [["tape", "1.12.1"], ["star", "12 stars"]],
      about: "Captures MiniDV tapes over USB on a Mac that has no FireWire." },
    { key: "bolt", name: "Bolt", href: proj + "/bolt/", counters: [["photo", "48 photos"], ["watch", "3.9 ms"]], glow: "110,150,210",
      about: "Photo viewer for macOS. Open one photo, go through the whole folder, one key per decision." },
    { key: "neslop", name: "ne-slop-text", href: proj + "/ne-slop-text/", counters: [["page", "6 pages"], ["check", "26 features"]], glow: "200,200,190",
      about: "Claude Code skill that moves a text away from what models write by default." },
    { key: "parking", name: "GdeParkovka", href: proj + "/gdeparkovka/", counters: [["parking", "367 points"], ["calendar", "July 2026"]], glow: "170,190,160",
      about: "Map of free parking in Russia. Drivers add the points." },
    { key: "genealogy", name: "Genealogy", href: proj + "/genealogy/", counters: [["person", "215 people"], ["scroll", "123 sources"]], glow: "210,205,190",
      about: "Knowledge base of my mother\u2019s family line, in plain files and git." }
  ];
  var tv = game.querySelector(".tv"), cap = game.querySelector("[data-cap]"), counters = game.querySelector("[data-counters]");
  var screens = {};
  tv.querySelectorAll("[data-ch]").forEach(function (el) { screens[el.getAttribute("data-ch")] = el; });
  var snow = tv.querySelector(".snow"), sctx = snow.getContext("2d");
  var current = -1, flipTimer = null;

  function noise(ms) {
    if (still) return;
    var end = performance.now() + ms;
    snow.style.visibility = "visible";
    (function frame() {
      var img = sctx.createImageData(snow.width, snow.height), d = img.data;
      for (var i = 0; i < d.length; i += 4) { var v = Math.random() * 255 | 0; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
      sctx.putImageData(img, 0, 0);
      if (performance.now() < end) requestAnimationFrame(frame); else snow.style.visibility = "hidden";
    })();
  }

  function set(i) {
    i = (i + levels.length) % levels.length;
    if (i === current) return;
    current = i;
    var L = levels[i];
    noise(220);
    Object.keys(screens).forEach(function (k) { screens[k].hidden = k !== L.key; });
    cap.src = up + "v/proto/cap-" + L.key + ".gif";
    cap.alt = screens[L.key].getAttribute("aria-label") || L.key;
    if (counters) counters.innerHTML = L.counters.map(function (c) {
      return '<span><img src="' + up + 'v/proto/icon-' + c[0] + '.gif" width="32" height="32" alt="">' + c[1] + "</span>";
    }).join("");
    tv.href = L.href;
    // the fullscreen menu also says what the project is, in the scene and, on phones, under it
    document.querySelectorAll("[data-about]").forEach(function (el) { el.textContent = L.about; });
    document.querySelectorAll("[data-name]").forEach(function (el) { el.textContent = L.name; });
    document.querySelectorAll("[data-open]").forEach(function (el) { el.href = L.href; });
    if (L.glow) game.style.setProperty("--glow", L.glow);
    clearInterval(flipTimer);
    if (L.key === "bolt" && !still) {
      var imgs = screens.bolt.querySelectorAll("img"), n = 0;
      flipTimer = setInterval(function () { imgs.forEach(function (im, k) { im.hidden = k !== n; }); n = (n + 1) % imgs.length; }, 450);
    }
    game.querySelectorAll("[data-level]").forEach(function (el) { el.classList.toggle("on", +el.getAttribute("data-level") === i); });
    game.dispatchEvent(new CustomEvent("menu:select", { detail: { level: i } }));  // the dog on the desk looks at it
  }

  game.querySelector("[data-prev]").addEventListener("click", function () { set(current - 1); });
  game.querySelector("[data-next]").addEventListener("click", function () { set(current + 1); });
  game.querySelectorAll("[data-level]").forEach(function (el) {
    var i = +el.getAttribute("data-level");
    el.addEventListener("mouseenter", function () { set(i); });
    el.addEventListener("focus", function () { set(i); });
  });
  // while the tape is on, the light follows the mean colour of each frame
  if (window.Tape) Tape.on(function (f) {
    if (current !== 0) return;
    game.style.setProperty("--glow", f.rgb.map(function (v) { return Math.round(Math.min(255, v * 1.25)); }).join(","));
  });
  // on a phone a swipe across the room changes the channel too: to the left for the next, as a strip of cards would go
  var swipe = null;
  game.addEventListener("touchstart", function (e) {
    swipe = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  }, { passive: true });
  game.addEventListener("touchend", function (e) {
    if (!swipe) return;
    var dx = e.changedTouches[0].clientX - swipe.x, dy = e.changedTouches[0].clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > 1.5 * Math.abs(dy)) set(current + (dx < 0 ? 1 : -1));
  }, { passive: true });
  var dog = game.querySelector("[data-dog]");
  if (dog) dog.addEventListener("mouseenter", function () { set(0); if (window.Tape) Tape.video.currentTime = 5.8; });

  var inView = true;
  if ("IntersectionObserver" in window) new IntersectionObserver(function (e) { inView = e[0].intersectionRatio > 0.4; }, { threshold: [0, 0.4, 1] }).observe(game);
  document.addEventListener("keydown", function (e) {
    if (!inView || e.altKey || e.metaKey || e.ctrlKey || /input|textarea|select/i.test(e.target.tagName)) return;
    if (e.key === "ArrowLeft") { set(current - 1); e.preventDefault(); }
    else if (e.key === "ArrowRight") { set(current + 1); e.preventDefault(); }
    else if (e.key === "Enter" && e.target === document.body) { location.href = levels[current].href; }
  });

  var hints = document.querySelector("[data-hints]");
  if (hints) hints.addEventListener("click", function () {
    var on = game.classList.toggle("hints");
    hints.setAttribute("aria-pressed", String(on));
  });
  set(0);
})();
