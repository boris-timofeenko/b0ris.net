// Tundra drawn in Paint, but in 3D, on the Contacts page. tools/proto/paint_tundra.py redrew the renders of her
// sitting with her head turned (13 turns x 3 tilts) as Paint drawings; here they are shown one at a time on a canvas,
// never blended, so her head turns the way a flipbook does: a frame, then the next. She looks at the mouse, at the
// contact under it, now and then at a contact by herself (phones have no mouse), and back at the visitor when nothing
// happens; she blinks, and wags when a contact is pointed at or when she is clicked.
// The element: <div data-pdog> with the still (.still) and a <template data-sheets="desk|phone"> per size holding the
// sheets as <img data-sheet="body|shut|tail|shadow">, so they load only when used; without the script the still stays.
(function () {
  var box = document.querySelector("[data-pdog]"), ALL = window.PAINT_TUNDRA;
  if (!box || !ALL) return;
  var size = matchMedia("(max-width: 700px)").matches ? "phone" : "desk";
  var T = ALL[size], tpl = box.querySelector('template[data-sheets="' + size + '"]');
  if (!T || !tpl) return;

  var STEP = 45;          // ms per frame while her head turns
  var LINGER = 2600;      // ms she keeps looking at a still mouse before she looks back at the visitor
  var WAG_FPS = 20;

  var pics = {}, waiting = 0;
  [].forEach.call(tpl.content.querySelectorAll("img[data-sheet]"), function (src) {
    var im = new Image();
    waiting++;
    im.onload = function () { if (--waiting === 0) start(); };
    im.src = src.getAttribute("src");
    pics[src.getAttribute("data-sheet")] = im;
  });

  var canvas = document.createElement("canvas");
  canvas.width = T.w;
  canvas.height = T.h;
  canvas.setAttribute("aria-hidden", "true");
  var g = canvas.getContext("2d");
  g.imageSmoothingEnabled = false;

  function index(v, list) { return Math.max(0, Math.min(list.length - 1, Math.round((v - list[0]) / (list[1] - list[0])))); }
  var home = { i: index(T.visitor[0], T.yaws), j: index(T.visitor[1], T.pitches) };
  var head = { i: home.i, j: home.j }, aim = { i: home.i, j: home.j };

  // the angle from her eyes to a point on the screen, as if the screen stood in front of her about as far as she
  // is tall; yaw to her left is to the visitor's right
  function lookAt(x, y) {
    var r = canvas.getBoundingClientRect(), k = r.width / T.w, depth = 1.5 * r.height;
    var dx = x - (r.left + T.eyes[0] * k), dy = y - (r.top + T.eyes[1] * k), deg = 180 / Math.PI;
    aim.i = index(T.visitor[0] + Math.atan2(dx, depth) * deg, T.yaws);
    aim.j = index(T.visitor[1] + Math.atan2(-dy, depth * 1.4) * deg, T.pitches);
    kick();
  }
  function lookAtEl(el) { var r = el.getBoundingClientRect(); lookAt(r.left + r.width / 2, r.top + r.height / 2); }
  function lookHome() { aim.i = home.i; aim.j = home.j; kick(); }
  var linger = 0;
  function homeLater(ms) { clearTimeout(linger); linger = setTimeout(lookHome, ms || LINGER); }

  var blinkUntil = 0, wagFrom = 0, wagUntil = 0;
  function blink() {
    blinkUntil = performance.now() + 130;
    kick();
    setTimeout(blink, Math.random() < 0.2 ? 280 : 2500 + Math.random() * 4500);
  }
  function wag(cycles) {
    var now = performance.now();
    if (now < wagUntil) return;
    wagFrom = now;
    wagUntil = now + cycles * T.tailFrames * 1000 / WAG_FPS;
    kick();
  }

  function draw(now) {
    g.clearRect(0, 0, T.w, T.h);
    g.drawImage(pics.shadow, 0, 0);
    var sheet = now < blinkUntil ? pics.shut : pics.body;
    g.drawImage(sheet, head.i * T.w, head.j * T.h, T.w, T.h, 0, 0, T.w, T.h);
    var f = now < wagUntil ? Math.floor((now - wagFrom) * WAG_FPS / 1000) % T.tailFrames : 0;
    var t = T.tail, tw = t[2] - t[0], th = t[3] - t[1];
    g.drawImage(pics.tail, f * tw, 0, tw, th, t[0], t[1], tw, th);
  }

  var running = false, lastStep = 0;
  function frame(now) {
    if (now - lastStep >= STEP) {  // one frame of the turn at a time, sideways first, as a head turns
      lastStep = now;
      if (head.i !== aim.i) head.i += head.i < aim.i ? 1 : -1;
      else if (head.j !== aim.j) head.j += head.j < aim.j ? 1 : -1;
    }
    draw(now);
    if (head.i !== aim.i || head.j !== aim.j || now < blinkUntil || now < wagUntil) requestAnimationFrame(frame);
    else running = false;
  }
  function kick() { if (!running && !waiting) { running = true; requestAnimationFrame(frame); } }

  function start() {
    var still = box.querySelector(".still");
    still = still && (still.closest("picture") || still);
    box.insertBefore(canvas, still);
    if (still) still.hidden = true;
    draw(performance.now());
    setTimeout(blink, 1500 + Math.random() * 2000);

    var mouse = false;
    document.addEventListener("mousemove", function (e) { mouse = true; lookAt(e.clientX, e.clientY); homeLater(); });
    document.documentElement.addEventListener("mouseleave", function () { homeLater(400); });
    var marks = [].slice.call(document.querySelectorAll("[data-look]"));
    marks.forEach(function (el) {
      var link = el.closest("li") || el;
      var point = function () { lookAtEl(el); wag(2); homeLater(); };
      link.addEventListener("mouseenter", point);
      link.addEventListener("focusin", point);
      link.addEventListener("touchstart", point, { passive: true });
    });
    box.addEventListener("click", function () { lookHome(); wag(4); });
    // by herself: a look at one of the contacts now and then, when the mouse is not leading her
    (function glance() {
      setTimeout(function () {
        if (!mouse && marks.length && !document.hidden) { lookAtEl(marks[Math.floor(Math.random() * marks.length)]); homeLater(1600); }
        if (!document.hidden && Math.random() < 0.3) wag(2);
        glance();
      }, 4000 + Math.random() * 5000);
    })();
  }
})();
