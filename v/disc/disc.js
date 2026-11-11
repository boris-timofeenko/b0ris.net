// The disc: Esc goes back to the autorun from any screen; on the autorun the arrows move between the buttons.
(function () {
  var back = document.querySelector("[data-back]");
  document.addEventListener("keydown", function (e) {
    if (e.altKey || e.metaKey || e.ctrlKey || /input|textarea|select/i.test(e.target.tagName)) return;
    if (e.key === "Escape" && back) location.href = back.href;
  });

  // The autorun's film. Normal: the clip library played by scene-player.js (never the same 24 s twice). PlayStation 2:
  // the old 24 s loop (?ps2 in the address, the P key or the switch), remembered per browser. With reduced motion the
  // poster stands still. On phones the film fills only the part of the art above the panel.
  var film = document.querySelector("[data-scene]");
  if (film) {
    var art = film.parentNode, sw = document.querySelector("[data-mode]"), panel = document.querySelector(".panel");
    var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    var stored = null, player = null;
    try { stored = localStorage.getItem("disc-film"); } catch (e) {}
    var mode = /[?&]ps2\b/.test(location.search) ? "ps2" : stored === "ps2" ? "ps2" : "normal";
    var play = function () { var p = film.play(); if (p && p.catch) p.catch(function () {}); };
    var show = function (m) {
      mode = m;
      art.classList.toggle("ps2", m === "ps2");
      if (sw) sw.setAttribute("aria-pressed", String(m === "ps2"));
      if (player) { player.stop(); player = null; }
      if (m === "ps2") {
        film.poster = film.dataset.ps2.replace(/\.mp4$/, ".jpg");
        film.loop = true;
        film.src = film.dataset.ps2;
        if (!still) play();
      } else {
        film.removeAttribute("poster");
        film.removeAttribute("src");
        if (!still && window.ScenePlayer) player = ScenePlayer.start(film, film.dataset.scene);
      }
    };
    var fit = function () {
      var phone = window.matchMedia && matchMedia("(max-width: 700px)").matches && panel;
      film.style.height = phone ? Math.round(panel.getBoundingClientRect().top - art.getBoundingClientRect().top) + "px" : "";
    };
    fit();
    window.addEventListener("resize", fit);
    show(mode);
    window.discScene = function () { return player; };
    var flip = function () {
      show(mode === "ps2" ? "normal" : "ps2");
      try { localStorage.setItem("disc-film", mode); } catch (e) {}
    };
    if (sw) sw.addEventListener("click", flip);
    document.addEventListener("keydown", function (e) {
      if ((e.key === "p" || e.key === "P") && !e.altKey && !e.metaKey && !e.ctrlKey) flip();
    });
  }

  var menu = document.querySelector("[data-autorun]");
  if (!menu) return;
  var btns = [].slice.call(menu.querySelectorAll(".btns a"));
  document.addEventListener("keydown", function (e) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    var i = btns.indexOf(document.activeElement);
    if (e.key === "ArrowDown") i = (i + 1) % btns.length;
    else i = i <= 0 ? btns.length - 1 : i - 1;
    btns[i].focus();
    e.preventDefault();
  });
})();
