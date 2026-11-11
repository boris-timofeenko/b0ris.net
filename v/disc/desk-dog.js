// Tundra on the desk of the Projects menu, drawn on a canvas from pre-rendered layers (scene3d/src/projects_tundra.py
// renders them, projects_tundra_pack.py packs them and writes v/disc/tundra/frames.js). She turns her head after the
// mouse, or to the project chosen in the menu, and back to the visitor when nothing happens; she blinks now and then
// and wags now and then. Layers, bottom up: her body (base), her head (a cross-fade of the four nearest of the 13 x 3
// rendered head positions while it turns, one of them at rest), her tail, her shut eyes during a blink.
// With reduced motion, or without the script, the still picture in the page stays.
(function () {
  // phones held upright see the room through a camera of their own, so she has a set of layers for each
  var camera = matchMedia("(max-width: 700px), (max-aspect-ratio: 4/5)").matches ? "phone" : "room";
  var dog = document.querySelector("[data-dog]"), game = document.querySelector("[data-menu]"), T = (window.TUNDRA || {})[camera];
  if (!dog || !game || !T) return;
  if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var LOOK_DEPTH = 0.3;   // how far in front of her a target on the screen is, in stage widths: smaller turns her more
  var TURN_TIME = 0.09;   // seconds: how quickly her head closes on what she looks at
  var LINGER = 2600;      // ms she keeps looking at a choice, or at a still mouse, before she looks back at the visitor
  var WAG_FPS = 24;

  // the layer images sit in a <template> so that they only load when they will be used
  var holder = document.createElement("span");
  holder.hidden = true;
  holder.appendChild(dog.querySelector('template[data-layers="' + camera + '"]').content.cloneNode(true));
  dog.appendChild(holder);
  var layer = {};
  holder.querySelectorAll("img[data-layer]").forEach(function (im) {
    layer[im.getAttribute("data-layer")] = im;
    if (!im.complete) im.addEventListener("load", kick);
  });
  function loaded(name) { var im = layer[name]; return im && im.complete && im.naturalWidth > 0; }

  var still = dog.querySelector(".still");
  var canvas = document.createElement("canvas");
  canvas.width = T.w;
  canvas.height = T.h;
  canvas.setAttribute("aria-hidden", "true");
  dog.insertBefore(canvas, still.closest("picture") || still);
  var g = canvas.getContext("2d");

  var YAW0 = T.yaws[0], YAW_STEP = T.yaws[1] - T.yaws[0], YAWS = T.yaws.length;
  var PITCH0 = T.pitches[0], PITCH_STEP = T.pitches[1] - T.pitches[0];
  var tail = { x: T.wag[0], y: T.wag[1], w: T.wag[2], h: T.wag[3], frames: T.wag[4] };

  // her head as indices into the grid of rendered positions; at rest both are whole numbers
  function yawIndex(deg) { return Math.round(Math.max(0, Math.min(YAWS - 1, (deg - YAW0) / YAW_STEP))); }
  function pitchIndex(deg) { return Math.round(Math.max(0, Math.min(T.pitches.length - 1, (deg - PITCH0) / PITCH_STEP))); }
  var atVisitor = { y: yawIndex(T.visitor[0]), p: pitchIndex(T.visitor[1]) };
  var head = { y: atVisitor.y, p: atVisitor.p }, aim = { y: atVisitor.y, p: atVisitor.p };

  // where on the screen she should look: the angle from her eyes to the point, as if it stood LOOK_DEPTH in front of her
  function lookAt(x, y) {
    var r = canvas.getBoundingClientRect(), gw = dog.parentElement.getBoundingClientRect().width;  // the stage
    var dx = x - (r.left + T.eyes[0] / T.w * r.width), dy = y - (r.top + T.eyes[1] / T.h * r.height);
    var deg = 180 / Math.PI, depth = LOOK_DEPTH * gw;
    aim.y = yawIndex(T.visitor[0] + Math.atan2(dx, depth) * deg);
    aim.p = pitchIndex(T.visitor[1] + Math.atan2(-dy, depth * 1.6) * deg);
    kick();
  }
  function lookAtVisitor() { aim.y = atVisitor.y; aim.p = atVisitor.p; kick(); }
  function lookAtElement(el) {
    var r = (el.querySelector("img") || el).getBoundingClientRect();
    lookAt(r.left + r.width / 2, r.top + r.height / 2);
  }
  var lingerTimer = 0;
  function backToVisitorLater() { clearTimeout(lingerTimer); lingerTimer = setTimeout(lookAtVisitor, LINGER); }

  // blinks and wags
  var blinkUntil = 0, wagFrom = 0, wagUntil = 0;
  function blink() {
    blinkUntil = performance.now() + 120;
    kick();
    var next = Math.random() < 0.2 ? 260 : 2500 + Math.random() * 4500;  // now and then twice in a row
    setTimeout(blink, next);
  }
  function wag(cycles) {
    var now = performance.now();
    if (now < wagUntil) return;
    wagFrom = now;
    wagUntil = now + cycles * tail.frames * 1000 / WAG_FPS;
    kick();
  }
  function wagNowAndThen() {
    setTimeout(function () { wag(2 + Math.floor(Math.random() * 3)); wagNowAndThen(); }, 7000 + Math.random() * 11000);
  }

  function draw(now) {
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.clearRect(0, 0, T.w, T.h);
    g.drawImage(layer.base, 0, T.split);
    var y0 = Math.floor(head.y), p0 = Math.floor(head.p), ty = head.y - y0, tp = head.p - p0, first = true;
    [[y0, p0, (1 - ty) * (1 - tp)], [y0 + 1, p0, ty * (1 - tp)], [y0, p0 + 1, (1 - ty) * tp], [y0 + 1, p0 + 1, ty * tp]]
      .forEach(function (q) {
        if (q[2] < 0.004) return;
        // a sum of the frames, each by its weight, is the true cross-fade, edges and all
        g.globalCompositeOperation = first ? "source-over" : "lighter";
        g.globalAlpha = q[2];
        g.drawImage(layer["look-" + q[1]], q[0] * T.w, 0, T.w, T.split, 0, 0, T.w, T.split);
        first = false;
      });
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    var f = now < wagUntil ? Math.floor((now - wagFrom) * WAG_FPS / 1000) % tail.frames : 0;
    g.drawImage(layer.wag, f * tail.w, 0, tail.w, tail.h, tail.x, tail.y, tail.w, tail.h);
    if (now < blinkUntil && !ty && !tp && loaded("blink")) {
      var b = T.blink[y0 + YAWS * p0];
      if (b[1]) g.drawImage(layer.blink, b[0], 0, b[1], b[2], b[3], b[4], b[1], b[2]);
    }
  }

  var last = 0, running = false, shown = false;
  function frame(now) {
    if (!loaded("base") || !loaded("look-1") || !loaded("wag")) { running = false; return; }
    if (!loaded("look-0") || !loaded("look-2")) aim.p = head.p = 1;  // only the level row has come yet
    var dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    var k = 1 - Math.exp(-dt / TURN_TIME);
    head.y += (aim.y - head.y) * k;
    head.p += (aim.p - head.p) * k;
    if (Math.abs(aim.y - head.y) < 0.02) head.y = aim.y;
    if (Math.abs(aim.p - head.p) < 0.02) head.p = aim.p;
    draw(now);
    if (!shown) { shown = true; still.style.opacity = 0; }
    var busy = head.y !== aim.y || head.p !== aim.p || now < wagUntil || now < blinkUntil;
    if (busy) requestAnimationFrame(frame);
    else { running = false; last = 0; }
  }
  function kick() {
    if (running) return;
    running = true;
    requestAnimationFrame(frame);
  }

  // the mouse leads; a choice in the menu (arrows, keys, a tap) turns her to the chosen project for a while
  var mouseAt = 0;
  document.addEventListener("pointermove", function (e) {
    if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
    mouseAt = performance.now();
    lookAt(e.clientX, e.clientY);
    backToVisitorLater();
  }, { passive: true });
  document.documentElement.addEventListener("mouseleave", function () { clearTimeout(lingerTimer); lookAtVisitor(); });
  game.addEventListener("menu:select", function (e) {
    if (performance.now() - mouseAt < 1500) return;
    var el = game.querySelector('[data-level="' + e.detail.level + '"]');
    if (!el) return;
    lookAtElement(el);
    backToVisitorLater();
  });
  document.addEventListener("pointerdown", function (e) {
    if (e.pointerType !== "touch") return;
    lookAt(e.clientX, e.clientY);
    backToVisitorLater();
  }, { passive: true });
  dog.addEventListener("mouseenter", function () { wag(3); });
  dog.addEventListener("pointerdown", function () { wag(3); });
  window.addEventListener("resize", kick);

  kick();
  setTimeout(blink, 1500 + Math.random() * 2000);
  wagNowAndThen();
})();
