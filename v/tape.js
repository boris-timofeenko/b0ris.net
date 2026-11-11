// Measures every frame of the tape clip in the browser and hands the numbers to whatever draws them:
// a luma waveform, a waveform coloured by the pixels that made it, a vectorscope, readouts,
// and listeners on the page (Tape.on). The same levels uvcdv-capture measures for its automatic correction.
(function () {
  var video = document.querySelector("video[data-tape]");
  if (!video) return;
  var still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var W = +(video.getAttribute("data-res") || 160), H = Math.round(W * 3 / 4), WH = +(video.getAttribute("data-levels") || 100), VS = 96;
  var probe = document.createElement("canvas");
  probe.width = W; probe.height = H;
  var pctx = probe.getContext("2d", { willReadFrequently: true });

  var wn = new Float32Array(W * WH), wr = new Float32Array(W * WH), wg = new Float32Array(W * WH), wb = new Float32Array(W * WH);
  var vn = new Float32Array(VS * VS), vr = new Float32Array(VS * VS), vg = new Float32Array(VS * VS), vb = new Float32Array(VS * VS);
  var cols = new Float32Array(W), hist = new Uint32Array(256);
  var listeners = [], frames = 0;
  window.Tape = { on: function (fn) { listeners.push(fn); }, video: video, still: still };

  var bars = [["R", 191, 0, 0], ["MG", 191, 0, 191], ["B", 0, 0, 191], ["CY", 0, 191, 191], ["G", 0, 191, 0], ["YL", 191, 191, 0]]
    .map(function (b) { return [b[0], cb(b[1], b[2], b[3]), cr(b[1], b[2], b[3])]; });
  function cb(r, g, b) { return -0.168736 * r - 0.331264 * g + 0.5 * b; }
  function cr(r, g, b) { return 0.5 * r - 0.418688 * g - 0.081312 * b; }

  var canvases = [].slice.call(document.querySelectorAll("canvas[data-scope]")).map(function (c) {
    var st = getComputedStyle(c);
    var v = function (name, dflt) { var s = st.getPropertyValue(name).trim(); return s || dflt; };
    return { el: c, ctx: c.getContext("2d"), kind: c.getAttribute("data-scope"),
      trace: v("--trace", "232,230,214"), grid: v("--grid", "rgba(228,227,218,0.16)"),
      label: v("--label", "rgba(140,143,132,1)"), font: v("--scope-font", "ui-monospace, Menlo, monospace"),
      tmp: document.createElement("canvas") };
  });
  var out = {};
  document.querySelectorAll("[data-r]").forEach(function (el) { out[el.getAttribute("data-r")] = el; });

  function analyse() {
    if (!video.videoWidth) return;
    pctx.drawImage(video, 0, 0, W, H);
    var d = pctx.getImageData(0, 0, W, H).data, i;
    for (i = 0; i < wn.length; i++) { wn[i] *= 0.45; wr[i] *= 0.45; wg[i] *= 0.45; wb[i] *= 0.45; }
    for (i = 0; i < vn.length; i++) { vn[i] *= 0.5; vr[i] *= 0.5; vg[i] *= 0.5; vb[i] *= 0.5; }
    hist.fill(0); cols.fill(0);
    var sum = 0, su = 0, sv = 0, sr = 0, sg = 0, sb = 0, n = W * H;
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var p = (y * W + x) * 4, r = d[p], g = d[p + 1], b = d[p + 2];
      var luma = 0.299 * r + 0.587 * g + 0.114 * b;
      hist[luma | 0]++; sum += luma; cols[x] += luma; sr += r; sg += g; sb += b;
      var c = (WH - 1 - Math.min(WH - 1, Math.round(luma / 255 * (WH - 1)))) * W + x;
      wn[c] += 1; wr[c] += r; wg[c] += g; wb[c] += b;
      var u = cb(r, g, b), v = cr(r, g, b);
      su += u; sv += v;
      var vx = Math.round(VS / 2 + u / 128 * (VS / 2) * 0.92), vy = Math.round(VS / 2 - v / 128 * (VS / 2) * 0.92);
      if (vx >= 0 && vx < VS && vy >= 0 && vy < VS) { var k = vy * VS + vx; vn[k] += 1; vr[k] += r; vg[k] += g; vb[k] += b; }
    }
    for (x = 0; x < W; x++) cols[x] /= H * 255;
    canvases.forEach(draw);
    var frame = { t: video.currentTime, mean: sum / n / 255, u: su / n, v: sv / n, rgb: [sr / n, sg / n, sb / n], cols: cols };
    listeners.forEach(function (fn) { fn(frame); });
    if (frames++ % 4 === 0) readouts(frame, n);
  }

  function image(c, w, h) {
    if (c.tmp.width !== w) { c.tmp.width = w; c.tmp.height = h; c.img = new ImageData(w, h); }
    return c.img;
  }
  function blit(c, x, y, w, h) {
    c.tmp.getContext("2d").putImageData(c.img, 0, 0);
    c.ctx.imageSmoothingEnabled = !c.el.hasAttribute("data-pixel");
    c.ctx.globalCompositeOperation = c.el.hasAttribute("data-multiply") ? "multiply" : "lighter";
    c.ctx.drawImage(c.tmp, x, y, w, h);
    c.ctx.globalCompositeOperation = "source-over";
  }

  // ordered dither to the 216 web-safe colours, as a 256-colour display of 1996 would show the tape
  var bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  function dither(c) {
    var w = c.el.width, h = c.el.height, ctx = c.ctx;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(video, 0, 0, w, h);
    var img = ctx.getImageData(0, 0, w, h), d = img.data;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var p = (y * w + x) * 4, t = (bayer[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5;
      for (var k = 0; k < 3; k++) {
        var v = Math.round(d[p + k] / 51 + t);
        d[p + k] = (v < 0 ? 0 : v > 5 ? 5 : v) * 51;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  // premultiply by opacity, then snap to the web-safe cube: on a black panel this is what "lighter" would give
  function websafe(px) {
    for (var i = 0; i < px.length; i += 4) {
      var a = px[i + 3] / 255;
      for (var k = 0; k < 3; k++) px[i + k] = Math.round(px[i + k] * a / 51) * 51;
      px[i + 3] = px[i] || px[i + 1] || px[i + 2] ? 255 : 0;
    }
  }

  function draw(c) {
    var w = c.el.width, h = c.el.height, ctx = c.ctx, px, i;
    if (c.kind === "dither") return dither(c);
    ctx.clearRect(0, 0, w, h);
    if (c.kind === "wave" || c.kind === "wave-colour") {
      var graticule = c.el.hasAttribute("data-graticule"), padL = graticule ? 26 : 0, padT = graticule ? 8 : 0;
      px = image(c, W, WH).data;
      var tr = c.trace.split(",").map(Number), coloured = c.kind === "wave-colour";
      for (i = 0; i < wn.length; i++) {
        var k = wn[i], a = Math.pow(Math.min(1, k / (7 * H / 120)), 0.6);
        if (coloured && k > 0.05) {
          var r = wr[i] / k, g = wg[i] / k, b = wb[i] / k, m = Math.max(r, g, b, 1), lift = 245 / m;
          px[i * 4] = Math.min(255, r * lift); px[i * 4 + 1] = Math.min(255, g * lift); px[i * 4 + 2] = Math.min(255, b * lift);
        } else { px[i * 4] = tr[0]; px[i * 4 + 1] = tr[1]; px[i * 4 + 2] = tr[2]; }
        px[i * 4 + 3] = Math.round(a * 255);
      }
      if (c.el.hasAttribute("data-websafe")) websafe(px);
      if (c.el.hasAttribute("data-pixel")) {
        ctx.fillStyle = c.grid;
        [0, 0.5, 1].forEach(function (f) { for (var xx = 0; xx < w; xx += 2) ctx.fillRect(xx, Math.min(h - 1, Math.round((1 - f) * (h - 1))), 1, 1); });
      } else if (graticule) {
        ctx.strokeStyle = c.grid; ctx.fillStyle = c.label; ctx.lineWidth = 1;
        ctx.font = Math.round(h / 15) + "px " + c.font;
        [0, 25, 50, 75, 100].forEach(function (lv) {
          var yy = Math.round(padT + (1 - lv / 100) * (h - 2 * padT)) + 0.5;
          ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w, yy); ctx.stroke();
          ctx.fillText(String(lv), 0, yy + 5);
        });
      }
      blit(c, padL, padT, w - padL, h - 2 * padT);
    } else {
      px = image(c, VS, VS).data;
      for (i = 0; i < vn.length; i++) {
        var q = vn[i];
        if (q < 0.05) { px[i * 4 + 3] = 0; continue; }
        var rr = vr[i] / q, gg = vg[i] / q, bb = vb[i] / q, mm = Math.max(rr, gg, bb, 1), l2 = 230 / mm;
        px[i * 4] = Math.min(255, rr * l2); px[i * 4 + 1] = Math.min(255, gg * l2); px[i * 4 + 2] = Math.min(255, bb * l2);
        px[i * 4 + 3] = Math.round(Math.min(1, Math.pow(q / (6 * W * H / 19200), 0.5)) * 255);
      }
      var s = w, cc = s / 2, inset = c.kind === "vector-dots" ? 1 : 6, rad = s / 2 - inset;
      ctx.strokeStyle = c.grid; ctx.lineWidth = c.kind === "vector-dots" ? Math.max(1, s / 24) : 1;
      ctx.beginPath(); ctx.arc(cc, cc, rad - ctx.lineWidth / 2, 0, Math.PI * 2); ctx.stroke();
      if (c.kind === "vector-dots") {
        // the skin-tone line every vectorscope has, at 123 degrees: it is also the slash that makes this circle a zero
        var ia = 123 * Math.PI / 180, ix = Math.cos(ia) * (rad - ctx.lineWidth), iy = -Math.sin(ia) * (rad - ctx.lineWidth);
        ctx.beginPath(); ctx.moveTo(cc - ix, cc - iy); ctx.lineTo(cc + ix, cc + iy); ctx.stroke();
      }
      if (c.el.hasAttribute("data-websafe")) websafe(px);
      if (c.kind === "vector" && c.el.hasAttribute("data-pixel")) {
        ctx.fillStyle = c.grid;
        for (var q2 = 3; q2 < s - 3; q2 += 2) { ctx.fillRect(Math.floor(cc), q2, 1, 1); ctx.fillRect(q2, Math.floor(cc), 1, 1); }
        bars.forEach(function (t) {
          var x = cc + t[1] / 128 * rad * 0.92, y = cc - t[2] / 128 * rad * 0.92;
          ctx.strokeRect(Math.round(x - 3) + 0.5, Math.round(y - 3) + 0.5, 6, 6);
        });
      } else if (c.kind === "vector") {
        ctx.beginPath(); ctx.moveTo(cc, 6); ctx.lineTo(cc, s - 6); ctx.moveTo(6, cc); ctx.lineTo(s - 6, cc); ctx.stroke();
        ctx.font = Math.round(s / 17) + "px " + c.font;
        bars.forEach(function (t) {
          var x = cc + t[1] / 128 * rad * 0.92, y = cc - t[2] / 128 * rad * 0.92;
          ctx.strokeRect(Math.round(x - 5) + 0.5, Math.round(y - 5) + 0.5, 10, 10);
          ctx.fillStyle = c.label;
          ctx.fillText(t[0], x + (x > cc ? 8 : -8 - t[0].length * s / 28), y + 4);
        });
      }
      ctx.save(); ctx.beginPath(); ctx.arc(cc, cc, rad, 0, Math.PI * 2); ctx.clip();
      var zoom = c.kind === "vector-dots" ? 1.6 : 1;            // the logo zero shows the middle of the scope, where a real picture sits
      blit(c, cc - rad * zoom, cc - rad * zoom, rad * 2 * zoom, rad * 2 * zoom);
      ctx.restore();
    }
  }

  function percentile(q, n) {
    var target = q * n, acc = 0;
    for (var i = 0; i < 256; i++) { acc += hist[i]; if (acc >= target) return i; }
    return 255;
  }
  function readouts(f, n) {
    var pct = function (x) { return Math.round(x / 255 * 100) + "%"; };
    if (out.black) out.black.textContent = pct(percentile(0.01, n));
    if (out.white) out.white.textContent = pct(percentile(0.99, n));
    if (out.mean) out.mean.textContent = Math.round(f.mean * 100) + "%";
    if (out.cast) {
      var mag = Math.sqrt(f.u * f.u + f.v * f.v), hue = Math.atan2(f.v, f.u) * 180 / Math.PI, best = "", gap = 999;
      bars.forEach(function (t) {
        var hh = Math.atan2(t[2], t[1]) * 180 / Math.PI, dd = Math.abs(((hue - hh + 540) % 360) - 180);
        if (dd < gap) { gap = dd; best = t[0]; }
      });
      out.cast.textContent = mag < 3 ? "none" : best + " " + mag.toFixed(0);
    }
    if (out.tc) {
      var fr = Math.floor(f.t * 25), two = function (x) { return (x < 10 ? "0" : "") + x; };
      out.tc.textContent = "0:00:" + two(Math.floor(fr / 25) % 60) + ":" + two(fr % 25);
    }
  }

  var visible = true;
  if ("IntersectionObserver" in window) {
    var watched = document.querySelector("[data-tape-watch]") || video;
    new IntersectionObserver(function (e) { visible = e[0].isIntersecting; }).observe(watched);
  }
  // animation frames rather than video frame callbacks: the video may be hidden behind a canvas that redraws it
  var lastT = -1;
  function loop() {
    if (visible && !video.paused && video.currentTime !== lastT) { lastT = video.currentTime; analyse(); }
    requestAnimationFrame(loop);
  }
  var toggle = document.querySelector("[data-toggle]");
  function setLabel() { if (toggle) toggle.textContent = video.paused ? "play" : "pause"; }
  if (toggle) toggle.addEventListener("click", function () { if (video.paused) video.play(); else video.pause(); setLabel(); });
  video.addEventListener("seeked", analyse);
  video.addEventListener("pause", setLabel);
  video.addEventListener("play", setLabel);
  function start() {
    if (still) { video.pause(); video.currentTime = 1.0; setLabel(); }
    else { var p = video.play(); if (p && p.catch) p.catch(function () { video.currentTime = 1.0; setLabel(); }); }
    loop();
  }
  if (video.readyState >= 2) start(); else video.addEventListener("loadeddata", start, { once: true });
})();
