// The homepage scene as a chain of short clips (scene3d/SPEC_CLIPS.md). Every clip starts and ends in the same pose,
// so any clip can follow any other; the page plays an idle clip, an episode, an idle clip, another episode..., picked
// at random from what has arrived so far, never the same episode twice running, and it never reads as a loop.
//
// Loading: the poster is there at once; then a small soft copy of the first idle clip (10-30 KB) starts playing; the
// rest come one by one in the background, quietly. Whatever has arrived is what plays, so on a slow line the page
// just cycles a smaller set. Clips are appended into one MediaSource buffer (ManagedMediaSource on iPhones), back to
// back, which is what makes the joins seamless; without MediaSource two <video> elements take turns instead.
//
//   var scene = ScenePlayer.start(videoElement, "/v/disc/scene/");   ...   scene.stop();
(function () {
  var MS = window.ManagedMediaSource || window.MediaSource;
  var TYPES = { av1: 'video/mp4; codecs="av01.0.08M.08"', avc: 'video/mp4; codecs="avc1.640028"' };

  function codec() {
    if (MS && MS.isTypeSupported(TYPES.av1)) return "av1";
    if (MS && MS.isTypeSupported(TYPES.avc)) return "avc";
    var v = document.createElement("video");
    return v.canPlayType(TYPES.av1) === "probably" ? "av1" : "avc";
  }

  function layout() {
    return window.matchMedia && matchMedia("(max-width: 700px)").matches ? "mobile" : "desktop";
  }

  var CACHE = {};  // every file once per page: a restart (see start) costs nothing
  function get(url) {
    if (CACHE[url]) return Promise.resolve(CACHE[url]);
    return fetch(url, { priority: "low" }).then(function (r) {
      if (!r.ok) throw new Error(url + " " + r.status);
      return r.arrayBuffer();
    }).then(function (buf) { CACHE[url] = buf; return buf; });
  }

  // which clip next: idle and episode by turns, episodes from a shuffled bag
  function Chooser(manifest) {
    // the page opens on the starter (a light copy of the pause) and goes straight on to manifest.first (Tundra
    // running to him to be stroked); until that has arrived, the pause plays again
    var st = manifest.starter || {}, bag = [], last = null, lastKind = st.kind || "idle", n = 0, first = manifest.first;
    return function (have) {
      var clips = manifest.clips.filter(function (c) { return have[c.id]; });
      if (manifest.order === "sequence") {  // the stand-in: the old loop in pieces, in order
        var c = manifest.clips[n++ % manifest.clips.length];
        return have[c.id] ? c.id : null;
      }
      var idles = clips.filter(function (c) { return c.kind === "idle"; });
      var eps = clips.filter(function (c) { return c.kind === "episode"; });
      if (first) {
        if (!have[first]) return idles.length ? idles[0].id : null;  // null: the starter again
        last = first;
        first = null;
        lastKind = "episode";
        return last;
      }
      var pick;
      if (lastKind === "episode" || !eps.length) {
        pick = idles.length ? idles[Math.floor(Math.random() * idles.length)].id : null;
        lastKind = "idle";
      }
      if (!pick) {
        bag = bag.filter(function (id) { return have[id]; });
        if (!bag.length) bag = eps.map(function (c) { return c.id; }).sort(function () { return Math.random() - 0.5; });
        if (bag.length > 1 && bag[0] === last) bag.push(bag.shift());
        pick = bag.shift();
        if (pick) last = pick;  // nothing yet: keep the last one, so it is not the next episode
        lastKind = "episode";
      }
      return pick;
    };
  }

  // Our clips are fragmented MP4s (scene3d/src/encode_clips.py): read the codec setup and every sample, in decode
  // order, so WebCodecs can be fed without a <video> element.
  function parseMp4(buf) {
    var d = new DataView(buf), u8 = new Uint8Array(buf), out = { samples: [] }, trex = {}, scale = 24000;
    var hex = function (n) { return (n < 16 ? "0" : "") + n.toString(16); };
    function boxes(s, e, f) {
      for (var o = s; o + 8 <= e;) {
        var size = d.getUint32(o), h = 8, type = String.fromCharCode(u8[o + 4], u8[o + 5], u8[o + 6], u8[o + 7]);
        if (size === 1) { size = d.getUint32(o + 8) * 4294967296 + d.getUint32(o + 12); h = 16; } else if (size === 0) size = e - o;
        f(type, o + h, o + size, o);
        o += size;
      }
    }
    boxes(0, buf.byteLength, function (t, s, e, at) {
      if (t === "moov") boxes(s, e, function inside(t, s, e) {
        if (/^(trak|mdia|minf|stbl|mvex)$/.test(t)) boxes(s, e, inside);
        else if (t === "mdhd") scale = d.getUint32(s + (u8[s] === 1 ? 20 : 12));
        else if (t === "trex") trex = { dur: d.getUint32(s + 12), size: d.getUint32(s + 16), flags: d.getUint32(s + 20) };
        else if (t === "stsd") boxes(s + 8, e, function (t, s, e) {  // the one sample entry, avc1 or av01
          boxes(s + 78, e, function (t, s, e) {
            var c = u8.slice(s, e);
            if (t === "avcC") { out.codec = "avc1." + hex(c[1]) + hex(c[2]) + hex(c[3]); out.description = c; }
            if (t === "av1C") {
              out.codec = "av01." + (c[1] >> 5) + "." + ("0" + (c[1] & 31)).slice(-2) + (c[2] & 128 ? "H" : "M") + "." +
                (c[2] & 64 ? (c[2] & 32 ? "12" : "10") : "08");
              out.description = c;
            }
          });
        });
      });
      if (t !== "moof") return;
      var tf = {}, base = 0;
      boxes(s, e, function (t, s, e) {
        if (t === "traf") boxes(s, e, function (t, s) {
          var flags = d.getUint32(s) & 0xffffff, o = s + 8;
          if (t === "tfhd") {
            if (flags & 1) o += 8;
            if (flags & 2) o += 4;
            if (flags & 8) { tf.dur = d.getUint32(o); o += 4; }
            if (flags & 16) { tf.size = d.getUint32(o); o += 4; }
            if (flags & 32) tf.flags = d.getUint32(o);
          } else if (t === "tfdt") {
            base = u8[s] === 1 ? d.getUint32(s + 4) * 4294967296 + d.getUint32(s + 8) : d.getUint32(s + 4);
          } else if (t === "trun") {
            var n = d.getUint32(s + 4), pos = at, first, dts = base;
            if (flags & 1) { pos += d.getInt32(o); o += 4; }
            if (flags & 4) { first = d.getUint32(o); o += 4; }
            for (var i = 0; i < n; i++) {
              var dur = tf.dur || trex.dur, size = tf.size || trex.size, cto = 0;
              var fl = i === 0 && first !== undefined ? first : tf.flags !== undefined ? tf.flags : trex.flags;
              if (flags & 0x100) { dur = d.getUint32(o); o += 4; }
              if (flags & 0x200) { size = d.getUint32(o); o += 4; }
              if (flags & 0x400) { fl = d.getUint32(o); o += 4; }
              if (flags & 0x800) { cto = u8[s] === 1 ? d.getInt32(o) : d.getUint32(o); o += 4; }
              out.samples.push({ data: u8.subarray(pos, pos + size), key: fl === undefined ? i === 0 : !(fl & 0x10000),
                                 ts: Math.round((dts + cto) * 1e6 / scale), dur: Math.round(dur * 1e6 / scale) });
              pos += size;
              dts += dur;
            }
          }
        });
      });
    });
    return out;
  }

  // iOS takes the decoder (canvas) or the buffered film (<video>) away from a page while Safari is in the background,
  // and the film stands still when it comes back. So while the page is on screen, a film that has played and then
  // shows no new frame for two seconds starts over from the files it already has (they are cached: no download).
  function start(video, base, opts) {
    var inner = run(video, base, opts), live = true, last = 0, still = 0;
    var probe = setInterval(function () {
      if (!live || document.hidden) { still = 0; return; }
      var now = inner.progress();
      if (now > 0 && now === last) still++; else still = 0;
      last = now;
      if (still >= 2) {
        still = 0;
        last = 0;
        inner.stop();
        inner = run(video, base, opts);
      }
    }, 1000);
    return {
      stop: function () { live = false; clearInterval(probe); inner.stop(); },
      then: function (id, cb) { return inner.then(id, cb); },
      info: function () { return inner.info(); }
    };
  }

  function run(video, base, opts) {
    opts = opts || {};
    var drawn = 0, seq = [];
    var lay = layout(), cod = codec(), stopped = false, timers = [];
    var have = {}, manifest = null, next = null, sb = null, ms = null, onEnd = [];
    video.removeAttribute("src");
    video.loop = false;
    video.muted = true;
    // iPhones in Low Power Mode (and some browsers) refuse to start even a muted film on their own: then the poster
    // stays as a picture, without a play button over it, and the film starts at the visitor's first touch or key
    var armed = false;
    var arm = function () {
      if (armed) return;
      armed = true;
      var go = function () {
        ["touchend", "click", "keydown"].forEach(function (t) { document.removeEventListener(t, go, true); });
        armed = false;
        if (!stopped) video.play().catch(function () {});
      };
      ["touchend", "click", "keydown"].forEach(function (t) { document.addEventListener(t, go, true); });
    };
    var play = function () { var p = video.play(); if (p && p.catch) p.catch(refused); };
    // the browser will not start a <video> on its own (iPhones in Low Power Mode): then the page decodes the clips
    // itself with WebCodecs and draws them on a canvas, which no autoplay rule stops; without WebCodecs, the first touch
    var refused = function () {
      if (window.VideoDecoder && window.EncodedVideoChunk && !cv) canvasMode().catch(function () { cv = null; arm(); });
      else arm();
    };
    var cv = null, gen = 0;

    fetch(base + "clips.json").then(function (r) { return r.json(); }).then(function (m) {
      if (stopped) return;
      manifest = m;
      next = Chooser(m);
      video.poster = base + m.layouts[lay].poster;
      if (MS) mse(); else twoVideos();
    }).catch(function () {});

    function url(file) { return base + file[cod].url; }

    function loadAll() {  // idles first, then the episodes in random order, one at a time
      var order = manifest.clips.slice().sort(function (a, b) {  // the first episode, then idles, then the rest
        var rank = function (c) { return c.id === manifest.first ? -1 : { idle: 0, episode: 1, enter: 2, exit: 2 }[c.kind]; };
        return rank(a) - rank(b) || Math.random() - 0.5;
      });
      (function one(i) {
        if (stopped || i >= order.length) return;
        var c = order[i], g = gen;
        if (c.kind === "exit" || c.kind === "enter") return one(i + 1);  // only when asked for
        get(url(c.files[lay])).then(function (buf) { if (g === gen) have[c.id] = buf; }, function () {}).then(function () {
          if (g === gen) one(i + 1);
        });
      })(0);
    }

    function mse() {
      ms = new MS();
      if (window.ManagedMediaSource && MS === window.ManagedMediaSource) video.disableRemotePlayback = true;
      video.src = URL.createObjectURL(ms);
      ms.addEventListener("sourceopen", function () {
        sb = ms.addSourceBuffer(TYPES[cod]);
        sb.mode = "sequence";  // each appended clip goes right after the last, whatever its own timestamps
        sb.addEventListener("updateend", pump);
        var s = manifest.starter;
        get(url(s.files[lay])).then(function (buf) {
          if (stopped) return;
          have["__starter"] = buf;
          pump();
          play();
          loadAll();
        });
        timers.push(setInterval(pump, 1000));
      });
    }

    function ahead() {
      var b = video.buffered;
      return b.length ? b.end(b.length - 1) - video.currentTime : 0;
    }

    function pump() {
      if (stopped || !sb || sb.updating || ms.readyState !== "open") return;
      var b = video.buffered;
      if (b.length && video.currentTime - b.start(0) > 40) {  // let go of what has been seen
        try { sb.remove(0, video.currentTime - 20); } catch (e) {}
        return;
      }
      if (ahead() > 5) return;
      var id = onEnd.length ? onEnd[0] : next(have);
      if (!have[id] && ahead() > 1) return;  // what comes next is still on its way: wait for it, repeat only if the film runs dry
      var buf = have[id] || (!manifest.clips.some(function (c) { return have[c.id] && c.kind === "idle"; }) && have["__starter"]);
      if (!buf) return;
      if (onEnd.length) onEnd.shift();
      try { sb.appendBuffer(buf); seq.push(have[id] ? id : "starter"); } catch (e) { /* full: the next pump removes the old part first */ }
    }

    function twoVideos() {  // no MediaSource: two players take turns, the next one loaded and waiting at frame 0
      var other = video.cloneNode(false);
      other.removeAttribute("data-scene");
      other.style.cssText = "position:absolute;inset:0;visibility:hidden";
      video.parentNode.appendChild(other);
      var cur = video, idle = manifest.starter;
      var src = function (id) {
        var c = manifest.clips.filter(function (x) { return x.id === id; })[0];
        return url((c || idle).files[lay]);
      };
      cur.src = url(idle.files[lay]);
      play();
      var queue = function () { other.src = src(next(manifest.clips.reduce(function (h, c) { h[c.id] = 1; return h; }, {}))); other.load(); };
      queue();
      var swap = function () {
        if (stopped) return;
        var p = other.play();
        (p && p.then ? p : Promise.resolve()).then(function () {
          other.style.visibility = "visible";
          cur.style.visibility = "hidden";
          var t = cur; cur = other; other = t;
          queue();
        }, function () {});
      };
      video.addEventListener("ended", swap);
      other.addEventListener("ended", swap);
      timers.push(function () { other.remove(); });
    }

    async function canvasMode() {
      var names = { av1: "av01.0.08M.08", avc: "avc1.640028" }, use = null;
      cv = {};
      for (var c of [cod, cod === "av1" ? "avc" : "av1"]) {
        var ok = await VideoDecoder.isConfigSupported({ codec: names[c], codedWidth: lay === "mobile" ? 700 : 1280, codedHeight: 1000 })
          .catch(function () { return {}; });
        if (ok.supported) { use = c; break; }
      }
      if (!use || stopped) throw new Error("no decoder");
      if (sb) { sb = null; try { if (ms.readyState === "open") ms.endOfStream(); } catch (e) {} }  // the <video> rests
      if (use !== cod) {  // the clips must come again, in a codec this decoder reads
        cod = use; gen++; have = {};
        get(url(manifest.starter.files[lay])).then(function (buf) { have["__starter"] = buf; loadAll(); });
      }
      var canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
      canvas.setAttribute("aria-hidden", "true");
      canvas.style.cssText = "position:absolute;pointer-events:none";
      video.parentNode.insertBefore(canvas, video.nextSibling);
      // the canvas holds the frame at its own size and CSS crops it exactly as it crops the <video> (object-fit: cover):
      // Safari reads drawImage's source rectangle for a VideoFrame its own way, so no cropping by hand
      canvas.style.objectFit = "cover";
      canvas.style.objectPosition = getComputedStyle(video).objectPosition || "50% 50%";
      var fit = function () {
        if (getComputedStyle(video.parentNode).position === "static") video.parentNode.style.position = "relative";
        canvas.style.left = video.offsetLeft + "px"; canvas.style.top = video.offsetTop + "px";
        canvas.style.width = video.offsetWidth + "px"; canvas.style.height = video.offsetHeight + "px";
      };
      fit();
      window.addEventListener("resize", fit);
      var frames = [], clip = null, feeding = false, due = 0, raf = 0, shown = false;
      var decoder = new VideoDecoder({ output: function (f) { if (stopped) f.close(); else frames.push(f); }, error: function () { clip = null; } });
      var feed = async function () {  // keep about a third of a second decoded ahead, one clip after another
        if (feeding || stopped) return;
        feeding = true;
        try {
          while (!stopped && frames.length < 8) {
            if (!clip || clip.i >= clip.samples.length) {
              if (clip) await decoder.flush();
              var id = next(have);
              var buf = have[id] || (!manifest.clips.some(function (c) { return have[c.id] && c.kind === "idle"; }) && have["__starter"]);
              if (!buf) { clip = null; break; }
              seq.push(have[id] ? id : "starter");
              clip = parseMp4(buf);
              clip.i = 0;
              decoder.configure({ codec: clip.codec, description: clip.description });
            }
            while (decoder.decodeQueueSize > 3) await new Promise(function (r) { setTimeout(r, 4); });
            var smp = clip.samples[clip.i++];
            decoder.decode(new EncodedVideoChunk({ type: smp.key ? "key" : "delta", timestamp: smp.ts, duration: smp.dur, data: smp.data }));
          }
        } catch (e) { clip = null; } finally { feeding = false; }
      };
      var draw = function (f) {  // the whole frame, 1:1 (the starter is smaller: the canvas follows it)
        if (canvas.width !== f.displayWidth || canvas.height !== f.displayHeight) {
          canvas.width = f.displayWidth;
          canvas.height = f.displayHeight;
        }
        ctx.drawImage(f, 0, 0, canvas.width, canvas.height);
      };
      var tick = function (now) {  // 24 frames a second; if decoding falls behind, the film waits rather than skips
        if (stopped) return;
        raf = requestAnimationFrame(tick);
        if (frames.length < 8) feed();
        if (document.hidden || !frames.length) { due = now; return; }
        if (now < due) return;
        var f = frames.shift();
        draw(f);
        f.close();
        drawn++;
        due = (now - due > 250 ? now : due) + 1000 / 24;
        if (!shown) { shown = true; video.style.visibility = "hidden"; }
      };
      raf = requestAnimationFrame(tick);
      cv = { stop: function () {
        cancelAnimationFrame(raf);
        frames.forEach(function (f) { f.close(); });
        try { decoder.close(); } catch (e) {}
        window.removeEventListener("resize", fit);
        canvas.remove();
        video.style.visibility = "";
      }, info: "canvas " + use };
    }

    var vis = function () { if (document.hidden) video.pause(); else if (!stopped && !cv) play(); };
    document.addEventListener("visibilitychange", vis);

    return {
      stop: function () {
        stopped = true;
        document.removeEventListener("visibilitychange", vis);
        timers.forEach(function (t) { typeof t === "function" ? t() : clearInterval(t); });
        if (cv && cv.stop) cv.stop();
        video.pause();
        if (ms && ms.readyState === "open") try { ms.endOfStream(); } catch (e) {}
        video.removeAttribute("src");
        video.load();
      },
      // play a clip (e.g. "leap_out") right after the one on screen ends; cb when it has played
      then: function (id, cb) {
        var c = manifest && manifest.clips.filter(function (x) { return x.id === id; })[0];
        if (!c || !sb) return cb && cb();
        get(url(c.files[lay])).then(function (buf) { have[id] = buf; onEnd.push(id); if (cb) setTimeout(cb, (ahead() + c.frames / 24) * 1000); });
      },
      info: function () { return { layout: lay, codec: cod, loaded: Object.keys(have), mse: !!MS, canvas: cv && cv.info, seq: seq }; },
      progress: function () { return cv && cv.info ? drawn : video.currentTime; }
    };
  }

  window.ScenePlayer = { start: start };
})();
