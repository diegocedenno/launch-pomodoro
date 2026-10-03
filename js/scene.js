/* Escena: el cohete en su plataforma, el despegue y el descanso en órbita.
   Lo que depende del estado (torre, combustible, llama) se deriva del snapshot
   del temporizador en update(); el despegue y el aterrizaje son animaciones de
   una sola vez (Web Animations). Solo se animan `transform` y `opacity`.
   Con prefers-reduced-motion no hay vibración, ascenso ni bucle: los cambios
   de vista son un fundido. */
(function () {
  "use strict";

  var App = (window.LaunchPomodoro = window.LaunchPomodoro || {});

  var H = 320; // alto fijo del viewBox; el ancho sigue la forma del contenedor
  var SITE_Y = -80; // la plataforma está dibujada con el suelo en y = 360
  var GROUND = 264; // altura de la tobera: el cohete descansa sobre dos soportes
  var ASCENT = 420; // unidades que sube el cohete hasta salir del encuadre
  var ROCKET_HALF = 51; // del centro del cohete a su tobera, en unidades de la plataforma
  var IGNITION_MS = 3000; // la llama se enciende en los últimos segundos de T-10
  var TAU = Math.PI * 2;

  var EASE_IN = "cubic-bezier(0.55, 0, 1, 0.45)";
  var EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
  var EASE_IN_OUT = "cubic-bezier(0.65, 0, 0.35, 1)";

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function reduced() {
    return window.Pluton && window.Pluton.reducedMotion();
  }

  App.createScene = function (options) {
    var stage = options.stage;
    var svg = options.svg;
    var site = svg.querySelector("#site");
    var ground = svg.querySelector("#ground");
    var trail = svg.querySelector(".trail");
    var puffs = Array.prototype.slice.call(svg.querySelectorAll("#smoke circle"));
    var rocketPos = svg.querySelector("#rocket-pos");
    var fly = svg.querySelector("#rocket-fly");
    var shaker = svg.querySelector("#rocket-shake");
    var rocket = svg.querySelector("#rocket");

    var width = 368;
    var padX = 184;
    var orbit = { cx: 184, cy: 166, rx: 140, ry: 62.6 };
    var where = "pad"; // dónde está el cohete: pad | orbit
    var staging = false; // despegue o aterrizaje en curso
    var sequence = 0; // invalida los temporizadores de una animación ya superada
    var frame = 0;
    var anims = [];
    var timers = [];
    var shakeAnim = null;
    var rumbling = false;
    var lastFuel = -1;
    var lastLabel = "";

    /* ---------- utilidades ---------- */

    function animate(el, keyframes, timing) {
      if (!el.animate) return null;
      var anim = el.animate(keyframes, timing);
      anims.push(anim);
      return anim;
    }

    function later(ms, fn) {
      var token = sequence;
      timers.push(
        window.setTimeout(function () {
          if (token === sequence) fn();
        }, ms)
      );
    }

    function clearMotion() {
      sequence++;
      timers.forEach(function (id) {
        window.clearTimeout(id);
      });
      timers = [];
      anims.forEach(function (anim) {
        anim.cancel();
      });
      anims = [];
      stopShake();
    }

    function setFlame(level) {
      if (rocket.dataset.flame !== level) rocket.dataset.flame = level;
    }

    function setView(view) {
      svg.dataset.view = view;
    }

    function setLabel(text) {
      if (text === lastLabel) return;
      lastLabel = text;
      svg.setAttribute("aria-label", text);
    }

    // Movimiento reducido: el cambio de vista es un fundido de toda la escena.
    function crossfade(apply) {
      svg.classList.add("is-fading");
      later(210, function () {
        apply();
        svg.classList.remove("is-fading");
      });
    }

    /* ---------- geometría ---------- */

    function layout() {
      var rect = stage.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      width = clamp((H * rect.width) / rect.height, 260, 900);
      padX = width / 2;

      var rx = Math.min(width * 0.38, 178);
      orbit = { cx: width / 2, cy: 166, rx: rx, ry: rx * (76 / 170) };

      svg.setAttribute("viewBox", "0 0 " + width.toFixed(1) + " " + H);
      site.setAttribute("transform", "translate(" + padX.toFixed(1) + " " + SITE_Y + ")");
      ground.setAttribute("x", (-padX).toFixed(1));
      ground.setAttribute("width", width.toFixed(1));

      // Plutón: lejos y arriba a la derecha desde la plataforma; centrado y cerca en órbita.
      // En escenas estrechas se encoge para no pisar el reloj ni la trayectoria.
      var far = clamp((width / 368) * 0.42, 0.28, 0.42);
      svg.style.setProperty("--pluto-pad", "translate(" + (width - 22 - 170 * far).toFixed(1) + "px, 78px) scale(" + far.toFixed(3) + ")");
      svg.style.setProperty(
        "--pluto-orbit",
        "translate(" + orbit.cx.toFixed(1) + "px, " + orbit.cy + "px) scale(" + (rx / 170).toFixed(3) + ")"
      );

      if (where === "pad") placeOnPad();
      else if (!frame) placeOnOrbit(orbitProgress(), performance.now());
    }

    function placeOnPad() {
      rocketPos.setAttribute("transform", "translate(" + padX.toFixed(1) + " " + GROUND + ")");
    }

    function orbitProgress() {
      // Sin animación el cohete queda en un punto fijo y vistoso de la órbita.
      return reduced() ? 0.14 : options.snapshot().progress;
    }

    // Una vuelta completa por descanso: sale del punto más bajo y vuelve a él.
    function placeOnOrbit(progress, now) {
      var a = Math.PI / 2 - progress * TAU;
      var bob = reduced() ? 0 : Math.sin(now / 1300) * 2;
      var x = orbit.cx + orbit.rx * Math.cos(a);
      var y = orbit.cy + orbit.ry * Math.sin(a) + bob;
      // El rumbo sale de la tangente de la elipse (el ángulo decrece al avanzar).
      var heading = (Math.atan2(-orbit.ry * Math.cos(a), orbit.rx * Math.sin(a)) * 180) / Math.PI + 90;
      rocketPos.setAttribute(
        "transform",
        "translate(" + x.toFixed(2) + " " + y.toFixed(2) + ") rotate(" + heading.toFixed(1) + ") scale(0.5) translate(0 " + ROCKET_HALF + ")"
      );
    }

    /* ---------- bucle de órbita ---------- */

    function orbitFrame(now) {
      placeOnOrbit(options.snapshot().progress, now);
      frame = requestAnimationFrame(orbitFrame);
    }

    function startLoop() {
      if (frame || where !== "orbit" || staging || reduced() || document.hidden) return;
      frame = requestAnimationFrame(orbitFrame);
    }

    function stopLoop() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }

    /* ---------- vibración ---------- */

    function shake(amplitude, iterations) {
      stopShake();
      if (!shaker.animate) return;
      var a = amplitude;
      shakeAnim = shaker.animate(
        [
          { transform: "translate(0, 0)" },
          { transform: "translate(" + a + "px, " + -a * 0.4 + "px)" },
          { transform: "translate(" + -a + "px, " + a * 0.3 + "px)" },
          { transform: "translate(" + a * 0.5 + "px, 0)" },
          { transform: "translate(0, 0)" },
        ],
        { duration: 110, iterations: iterations, easing: EASE_IN_OUT }
      );
    }

    function stopShake() {
      if (shakeAnim) shakeAnim.cancel();
      shakeAnim = null;
      rumbling = false;
    }

    /* ---------- despegue ---------- */

    function smoke(strength) {
      puffs.forEach(function (puff, i) {
        var side = i % 2 ? 1 : -1;
        var reach = (26 + i * 11) * strength;
        animate(
          puff,
          [
            { transform: "translate(0, 0) scale(0.3)", opacity: 0.42 },
            {
              transform: "translate(" + side * reach + "px, " + (-4 - i * 2.5) * strength + "px) scale(" + (1.5 + i * 0.22) + ")",
              opacity: 0,
            },
          ],
          { duration: 1300 + i * 170, delay: i * 80, easing: EASE_OUT }
        );
      });
    }

    function liftoff(ms) {
      clearMotion();
      stopLoop();
      staging = true;
      setFlame("full");
      setLabel("El cohete despega");
      // Sin movimiento no hay ascenso: la llama queda encendida y el paso a la
      // órbita se hace con un fundido cuando empieza el descanso.
      if (reduced()) return;

      var hold = 350; // un instante retenido en la plataforma, vibrando
      var ascent = Math.max(900, ms * 0.6);
      var timing = { duration: ascent, delay: hold, easing: EASE_IN, fill: "forwards" };

      shake(1.1, Math.round((hold + ascent * 0.45) / 110));
      smoke(1);
      animate(
        fly,
        [
          { transform: "translateY(0px)", opacity: 1 },
          { transform: "translateY(" + -ASCENT * 0.72 + "px)", opacity: 1, offset: 0.72 },
          { transform: "translateY(" + -ASCENT + "px)", opacity: 0 },
        ],
        timing
      );
      // La estela se estira con la misma curva que el ascenso: más larga cuanto más rápido.
      animate(
        trail,
        [
          { transform: "scaleY(0)", opacity: 0 },
          { transform: "scaleY(1)", opacity: 0.55 },
        ],
        timing
      );
      later(hold + ascent, function () {
        setView("orbit"); // la cámara sigue al cohete: la plataforma cae y Plutón se acerca
      });
    }

    function enterOrbit() {
      clearMotion();
      staging = false;
      where = "orbit";
      setLabel("El cohete descansa en órbita alrededor de Plutón");

      function apply() {
        setView("orbit");
        setFlame("cruise");
        placeOnOrbit(orbitProgress(), performance.now());
      }

      if (reduced()) {
        crossfade(apply);
        return;
      }
      apply();
      // Entra siguiendo su propio rumbo, desde detrás.
      animate(
        fly,
        [
          { transform: "translateY(90px)", opacity: 0 },
          { transform: "translateY(0px)", opacity: 1 },
        ],
        { duration: 1200, easing: EASE_OUT }
      );
      startLoop();
    }

    /* ---------- aterrizaje ---------- */

    function settleOnPad() {
      where = "pad";
      setView("pad");
      placeOnPad();
    }

    function land(ms) {
      clearMotion();
      stopLoop();
      staging = true;
      setLabel("El cohete vuelve a la plataforma");

      if (reduced()) {
        crossfade(function () {
          settleOnPad();
          setFlame("off");
        });
        return;
      }

      var leave = 320;
      animate(fly, [{ opacity: 1 }, { opacity: 0 }], { duration: leave, easing: EASE_IN_OUT, fill: "forwards" });
      later(leave, function () {
        settleOnPad();
        setFlame("full");
        // Desciende frenando: rápido arriba, suave al tocar la plataforma.
        var descent = animate(
          fly,
          [
            { transform: "translateY(" + -ASCENT + "px)", opacity: 0 },
            { transform: "translateY(" + -ASCENT * 0.6 + "px)", opacity: 1, offset: 0.4 },
            { transform: "translateY(0px)", opacity: 1 },
          ],
          { duration: Math.max(800, ms - leave - 350), easing: EASE_OUT, fill: "backwards" }
        );
        if (descent) {
          descent.onfinish = function () {
            setFlame("off");
            smoke(0.5);
          };
        }
      });
    }

    function enterPad() {
      clearMotion();
      stopLoop();
      staging = false;
      if (reduced() && where !== "pad") crossfade(settleOnPad);
      else settleOnPad();
    }

    /* ---------- estado derivado ---------- */

    function update(snap) {
      var inStage = snap.mode === "liftoff" || snap.mode === "landing";
      var onPad = snap.phase === "focus";

      if (!inStage) {
        if (!onPad && where !== "orbit") enterOrbit();
        else if (onPad && (where !== "pad" || staging)) enterPad();
      }

      var finalCount = onPad && snap.countdown;
      var igniting = finalCount && snap.remainingMs <= IGNITION_MS;
      var venting = onPad && snap.mode === "timing" && snap.running && !finalCount;

      svg.classList.toggle("is-retracted", finalCount || inStage || !onPad);
      svg.classList.toggle("is-venting", venting);

      var fuel = !onPad || snap.mode === "liftoff" ? 1 : snap.mode === "idle" ? 0 : snap.progress;
      if (Math.abs(fuel - lastFuel) >= 0.002 || (fuel === 0) !== (lastFuel === 0)) {
        lastFuel = fuel;
        svg.style.setProperty("--fuel", fuel.toFixed(4));
      }

      if (inStage) return;

      if (onPad) {
        setFlame(igniting ? "ignite" : "off");
        // Vibración leve mientras los motores arrancan.
        var rumble = igniting && snap.running && !reduced();
        if (rumble && !rumbling) {
          shake(0.45, Infinity);
          rumbling = true;
        } else if (!rumble && rumbling) {
          stopShake();
        }
        setLabel(
          snap.mode === "idle"
            ? "Cohete en la plataforma de lanzamiento, en espera"
            : finalCount
              ? "Cuenta regresiva: la torre se retira del cohete"
              : "Cohete en la plataforma, cargando combustible"
        );
      } else {
        setFlame("cruise");
      }
    }

    /* ---------- eventos ---------- */

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stopLoop();
      else startLoop();
    });

    if (window.matchMedia) {
      var query = window.matchMedia("(prefers-reduced-motion: reduce)");
      var onMotionChange = function () {
        if (query.matches) {
          stopLoop();
          stopShake();
          if (where === "orbit") placeOnOrbit(orbitProgress(), performance.now());
        } else {
          startLoop();
        }
      };
      if (query.addEventListener) query.addEventListener("change", onMotionChange);
    }

    if (window.ResizeObserver) new ResizeObserver(layout).observe(stage);
    else window.addEventListener("resize", layout);
    layout();
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        svg.classList.add("is-ready");
      });
    });

    return { update: update, liftoff: liftoff, land: land };
  };
})();
