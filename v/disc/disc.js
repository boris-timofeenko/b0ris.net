// The disc: Esc goes back to the autorun from any screen; on the autorun the arrows move between the buttons.
(function () {
  var back = document.querySelector("[data-back]");
  document.addEventListener("keydown", function (e) {
    if (e.altKey || e.metaKey || e.ctrlKey || /input|textarea|select/i.test(e.target.tagName)) return;
    if (e.key === "Escape" && back) location.href = back.href;
  });

  // The autorun's film: the clip library played by scene-player.js (never the same 24 s twice). With reduced motion
  // the poster stands still. On phones the film fills only the part of the art above the panel.
  var film = document.querySelector("[data-scene]");
  if (film) {
    var art = film.parentNode, panel = document.querySelector(".panel");
    var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    var player = null;
    var fit = function () {
      var phone = window.matchMedia && matchMedia("(max-width: 700px)").matches && panel;
      film.style.height = phone ? Math.round(panel.getBoundingClientRect().top - art.getBoundingClientRect().top) + "px" : "";
    };
    fit();
    window.addEventListener("resize", fit);
    if (!still && window.ScenePlayer) player = ScenePlayer.start(film, film.dataset.scene);
    window.discScene = function () { return player; };
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
