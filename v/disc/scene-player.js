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

  function get(url) {
    return fetch(url, { priority: "low" }).then(function (r) {
      if (!r.ok) throw new Error(url + " " + r.status);
      return r.arrayBuffer();
    });
  }

  // which clip next: idle and episode by turns, episodes from a shuffled bag
  function Chooser(manifest) {
    var bag = [], last = null, lastKind = "episode", n = 0;
    return function (have) {
      var clips = manifest.clips.filter(function (c) { return have[c.id]; });
      if (manifest.order === "sequence") {  // the stand-in: the old loop in pieces, in order
        var c = manifest.clips[n++ % manifest.clips.length];
        return have[c.id] ? c.id : null;
      }
      var idles = clips.filter(function (c) { return c.kind === "idle"; });
      var eps = clips.filter(function (c) { return c.kind === "episode"; });
      var pick;
      if (lastKind === "episode" || !eps.length) {
        pick = idles.length ? idles[Math.floor(Math.random() * idles.length)].id : null;
        lastKind = "idle";
      }
      if (!pick) {
        bag = bag.filter(function (id) { return have[id]; });
        if (!bag.length) bag = eps.map(function (c) { return c.id; }).sort(function () { return Math.random() - 0.5; });
        if (bag.length > 1 && bag[0] === last) bag.push(bag.shift());
        pick = last = bag.shift();
        lastKind = "episode";
      }
      return pick;
    };
  }

  function start(video, base, opts) {
    opts = opts || {};
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
    var play = function () { var p = video.play(); if (p && p.catch) p.catch(arm); };

    fetch(base + "clips.json").then(function (r) { return r.json(); }).then(function (m) {
      if (stopped) return;
      manifest = m;
      next = Chooser(m);
      video.poster = base + m.layouts[lay].poster;
      if (MS) mse(); else twoVideos();
    }).catch(function () {});

    function url(file) { return base + file[cod].url; }

    function loadAll() {  // idles first, then the episodes in random order, one at a time
      var order = manifest.clips.slice().sort(function (a, b) {
        var rank = { idle: 0, episode: 1, enter: 2, exit: 2 };
        return rank[a.kind] - rank[b.kind] || Math.random() - 0.5;
      });
      (function one(i) {
        if (stopped || i >= order.length) return;
        var c = order[i];
        if (c.kind === "exit" || c.kind === "enter") return one(i + 1);  // only when asked for
        get(url(c.files[lay])).then(function (buf) { have[c.id] = buf; }, function () {}).then(function () { one(i + 1); });
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
      var buf = have[id] || (!manifest.clips.some(function (c) { return have[c.id] && c.kind === "idle"; }) && have["__starter"]);
      if (!buf) return;
      if (onEnd.length) onEnd.shift();
      try { sb.appendBuffer(buf); } catch (e) { /* full: the next pump removes the old part first */ }
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

    var vis = function () { if (document.hidden) video.pause(); else if (!stopped) play(); };
    document.addEventListener("visibilitychange", vis);

    return {
      stop: function () {
        stopped = true;
        document.removeEventListener("visibilitychange", vis);
        timers.forEach(function (t) { typeof t === "function" ? t() : clearInterval(t); });
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
      info: function () { return { layout: lay, codec: cod, loaded: Object.keys(have), mse: !!MS }; }
    };
  }

  window.ScenePlayer = { start: start };
})();
