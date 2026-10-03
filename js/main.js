/* Control de misión: une temporizador, escena y sonido; pinta el reloj, las
   etiquetas y las estadísticas, y guarda ajustes y días en localStorage. */
(function () {
  "use strict";

  var App = window.LaunchPomodoro;
  var stats = App.stats;
  var STORE_KEY = "launch-pomodoro:v1";
  var BASE_TITLE = document.title;
  var TICK_MS = 200;

  var els = {
    statusPhase: document.getElementById("status-phase"),
    statusTime: document.getElementById("status-time"),
    clock: document.getElementById("clock"),
    mission: document.querySelector("#mission b"),
    time: document.getElementById("time"),
    timeSign: document.getElementById("time-sign"),
    timeDigits: document.getElementById("time-digits"),
    hud: document.getElementById("hud"),
    next: document.querySelector("#next b"),
    control: document.querySelector(".control"),
    toggle: document.getElementById("toggle"),
    toggleLabel: document.getElementById("toggle-label"),
    reset: document.getElementById("reset"),
    skip: document.getElementById("skip"),
    focuses: document.getElementById("stat-focuses"),
    minutes: document.getElementById("stat-minutes"),
    missions: document.getElementById("missions"),
    config: document.querySelector(".config"),
    configNote: document.getElementById("config-note"),
    sound: document.getElementById("sound"),
    soundState: document.getElementById("sound-state"),
    announce: document.getElementById("announce"),
  };

  var inputs = {
    focus: document.getElementById("cfg-focus"),
    short: document.getElementById("cfg-short"),
    long: document.getElementById("cfg-long"),
  };

  function reduced() {
    return window.Pluton.reducedMotion();
  }

  /* ---------- persistencia ---------- */

  function load() {
    var data = null;
    try {
      data = JSON.parse(window.localStorage.getItem(STORE_KEY) || "null");
    } catch (err) {
      data = null;
    }
    if (!data || typeof data !== "object") data = {};
    return {
      config: App.cleanConfig(data.config),
      sound: data.sound === true,
      days: stats.cleanDays(data.days),
    };
  }

  function save() {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (err) {
      /* almacenamiento no disponible: el temporizador sigue funcionando */
    }
  }

  var store = load();
  var shownDay = stats.dayKey();

  function today() {
    return stats.cleanDay(store.days[stats.dayKey()]);
  }

  function saveDay(day) {
    store.days[stats.dayKey()] = day;
    store.days = stats.cleanDays(store.days);
    save();
  }

  /* ---------- piezas ---------- */

  var sound = App.createSound();
  sound.setEnabled(store.sound);

  var timer = App.createTimer({
    config: store.config,
    cycle: today().cycle >= App.MISSIONS ? 0 : today().cycle,
    // Sin animación no hay nada que esperar: el cambio de fase es un fundido breve.
    liftoffMs: function () {
      return reduced() ? 1200 : 4200;
    },
    landingMs: function () {
      return reduced() ? 900 : 3200;
    },
    onEvent: onEvent,
  });

  var scene = App.createScene({
    stage: document.getElementById("stage"),
    svg: document.getElementById("scene"),
    snapshot: timer.snapshot,
  });

  /* ---------- vista ---------- */

  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }

  function setAttr(el, name, value) {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  var PHASE_NAMES = { focus: "enfoque", break: "descanso", longBreak: "descanso largo" };

  // Estado visible: una clave para los estilos y un nombre para las etiquetas.
  function describe(snap) {
    var name = PHASE_NAMES[snap.phase];
    if (snap.mode === "idle") return { key: "idle", name: "en espera" };
    if (snap.mode === "liftoff") return { key: "liftoff", name: "despegue" };
    if (snap.mode === "landing") return { key: "landing", name: "aterrizaje" };
    if (!snap.running) return { key: "paused", name: name + " en pausa" };
    if (snap.countdown) return { key: "countdown", name: snap.phase === "focus" ? "cuenta regresiva" : "reentrada" };
    return { key: snap.phase === "focus" ? "focus" : "break", name: name };
  }

  function clockParts(snap) {
    if (snap.mode === "liftoff" && snap.stageElapsedMs >= 1000) {
      var s = Math.floor(snap.stageElapsedMs / 1000);
      return { sign: "T+", digits: "00:" + (s < 10 ? "0" : "") + s };
    }
    return { sign: "T−", digits: App.formatClock(snap.remainingMs) };
  }

  function spoken(ms) {
    var seconds = Math.max(0, Math.ceil(ms / 1000));
    return "Faltan " + Math.floor(seconds / 60) + " min " + (seconds % 60) + " s";
  }

  function render() {
    var snap = timer.snapshot();
    var state = describe(snap);
    var clock = clockParts(snap);
    var staged = snap.mode === "liftoff" || snap.mode === "landing";
    var onPad = snap.phase === "focus";

    setText(els.timeSign, clock.sign);
    setText(els.timeDigits, clock.digits);
    setAttr(els.time, "aria-label", staged ? state.name : spoken(snap.remainingMs));
    setAttr(els.clock, "data-state", state.key);
    setAttr(els.control, "data-state", state.key);

    setText(els.statusPhase, state.name);
    setText(els.statusTime, clock.sign + clock.digits);
    setText(els.mission, snap.mission + " de " + snap.missions);

    var percent = Math.round((snap.mode === "idle" ? 0 : staged ? 1 : snap.progress) * 100) + " %";
    setText(els.hud.firstChild, onPad ? "combustible: " : "órbita: ");
    setText(els.hud.lastChild, percent);
    setText(els.next, PHASE_NAMES[snap.next.phase] + " · " + snap.next.minutes + " min");

    var title = snap.mode === "idle" ? BASE_TITLE : (staged ? "" : clock.digits + " · ") + state.name + " — launch-pomodoro";
    if (document.title !== title) document.title = title;

    // Controles
    setText(
      els.toggleLabel,
      snap.mode === "idle"
        ? "Iniciar"
        : snap.mode === "liftoff"
          ? "Despegando"
          : snap.mode === "landing"
            ? "Aterrizando"
            : snap.running
              ? "Pausar"
              : "Reanudar"
    );
    setAttr(els.toggle, "data-icon", staged ? "none" : snap.running ? "pause" : "play");
    setAttr(els.toggle, "aria-disabled", String(staged));
    setAttr(els.reset, "aria-disabled", String(staged || snap.mode === "idle"));
    setAttr(els.skip, "aria-disabled", String(staged || snap.countdown));

    renderMissions(snap);
    scene.update(snap);
    ticker.set(snap.running || staged);
  }

  function renderMissions(snap) {
    var marks = els.missions.children;
    for (var i = 0; i < marks.length; i++) {
      var state = i < snap.cycle ? "done" : i === snap.cycle && snap.phase === "focus" ? "current" : "todo";
      setAttr(marks[i], "data-state", state);
    }
    setAttr(els.missions, "aria-label", snap.cycle + " de " + snap.missions + " misiones completadas");
  }

  function renderStats() {
    var day = today();
    shownDay = stats.dayKey();
    setText(els.focuses, String(day.focuses));
    setText(els.minutes, String(Math.round(day.focusMs / 60000)));
  }

  function announce(text) {
    els.announce.textContent = text;
  }

  function pulse() {
    if (!els.time.animate || reduced()) return;
    els.time.animate([{ transform: "scale(1.07)" }, { transform: "scale(1)" }], {
      duration: 420,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
    });
  }

  /* ---------- eventos del temporizador ---------- */

  function onEvent(type, snap, detail) {
    if (type === "countdown" && snap.running) {
      announce("Diez segundos");
    } else if (type === "second") {
      sound.second(detail.n);
      pulse();
    } else if (type === "liftoff") {
      sound.liftoff(snap.stageTotalMs / 1000 + 1.5);
      scene.liftoff(snap.stageTotalMs);
    } else if (type === "break") {
      var day = stats.addFocus(today(), detail.workedMs);
      day.cycle = snap.cycle;
      saveDay(day);
      renderStats();
      els.configNote.hidden = true;
      announce("Enfoque completado. Enfoques de hoy: " + day.focuses + ".");
    } else if (type === "landing") {
      sound.landing();
      scene.land(snap.stageTotalMs);
    } else if (type === "ready") {
      var current = today();
      current.cycle = snap.cycle;
      saveDay(current);
      els.configNote.hidden = true;
      announce("De vuelta en la plataforma. Lista la misión " + snap.mission + " de " + snap.missions + ".");
    } else if (type === "reset") {
      els.configNote.hidden = true;
    }
    render();
  }

  /* ---------- reloj ---------- */

  // El tic sale de un Web Worker: en una pestaña en segundo plano los timers de la
  // página se ralentizan (hasta uno por minuto) y los del worker no. El tiempo no
  // depende del tic —se calcula contra la hora de fin—, pero así el título y los
  // pitidos de T-10 siguen llegando a tiempo. Si no hay worker, setInterval.
  function createTicker(fn, ms) {
    var worker = null;
    var interval = 0;
    var active = false;

    function fallback() {
      window.clearInterval(interval);
      interval = active ? window.setInterval(fn, ms) : 0;
    }

    try {
      var code = "var id=0;onmessage=function(e){clearInterval(id);if(e.data)id=setInterval(function(){postMessage(0)},e.data)}";
      worker = new Worker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })));
      worker.onmessage = fn;
      worker.onerror = function (event) {
        event.preventDefault();
        worker = null;
        fallback();
      };
    } catch (err) {
      worker = null;
    }

    return {
      set: function (on) {
        if (on === active) return;
        active = on;
        if (worker) worker.postMessage(on ? ms : 0);
        else fallback();
      },
    };
  }

  function step() {
    timer.tick();
    if (stats.dayKey() !== shownDay) renderStats(); // pasó la medianoche
    render();
  }

  var ticker = createTicker(step, TICK_MS);

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) step();
  });

  /* ---------- controles ---------- */

  function act(action) {
    sound.unlock(); // estamos dentro de un gesto: el audio puede arrancar aquí
    timer[action]();
  }

  function bindAction(button, action) {
    button.addEventListener("click", function (event) {
      // Clic de ratón o dedo (detail > 0): se suelta el foco para que la barra
      // espaciadora siga siendo iniciar/pausar y no repita este botón.
      if (event.detail > 0) button.blur();
      if (button.getAttribute("aria-disabled") === "true") return;
      act(action);
    });
  }

  bindAction(els.toggle, "toggle");
  bindAction(els.reset, "reset");
  bindAction(els.skip, "skip");

  document.addEventListener("keydown", function (event) {
    if (event.key !== " " && event.code !== "Space") return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    var target = event.target;
    if (target instanceof Element) {
      if (target.closest("input, textarea, select")) return;
      // Si alguien navega con Tab, el espacio activa el control enfocado.
      if (target.closest("button, a") && target.matches(":focus-visible")) return;
    }

    event.preventDefault(); // que la página no se desplace
    if (!event.repeat) act("toggle");
  });

  /* ---------- ajustes ---------- */

  var PHASE_KEYS = { focus: "focus", break: "short", longBreak: "long" };

  function writeInputs(config) {
    for (var key in inputs) inputs[key].value = String(config[key]);
  }

  function applyConfig() {
    var before = timer.config();
    var raw = {};
    // Un campo vacío vuelve a su valor anterior en vez de saltar al mínimo.
    for (var key in inputs) raw[key] = inputs[key].value.trim() === "" ? before[key] : inputs[key].value;

    var config = App.cleanConfig(raw);
    writeInputs(config);

    var snap = timer.snapshot();
    var currentKey = PHASE_KEYS[snap.phase];
    var deferred = snap.mode !== "idle" && config[currentKey] !== before[currentKey];

    timer.setConfig(config);
    store.config = config;
    save();

    if (deferred) {
      els.configNote.hidden = false;
      announce("La fase en curso no cambia: la nueva duración se aplica la próxima vez.");
    }
  }

  els.config.addEventListener("change", function (event) {
    if (event.target instanceof HTMLInputElement) applyConfig();
  });

  els.config.addEventListener("click", function (event) {
    var button = event.target instanceof Element ? event.target.closest(".step") : null;
    if (!button) return;
    if (event.detail > 0) button.blur();
    var input = document.getElementById(button.dataset.for);
    var current = Math.round(Number(input.value)) || timer.config()[input.dataset.key];
    input.value = String(current + Number(button.dataset.step));
    applyConfig();
  });

  /* ---------- sonido ---------- */

  function renderSound() {
    var on = sound.enabled();
    els.sound.setAttribute("aria-checked", String(on));
    els.soundState.textContent = on ? "on" : "off";
  }

  if (sound.supported) {
    els.sound.addEventListener("click", function (event) {
      if (event.detail > 0) els.sound.blur();
      sound.setEnabled(!sound.enabled());
      store.sound = sound.enabled();
      save();
      renderSound();
      if (sound.enabled()) {
        sound.unlock();
        sound.confirm();
      }
    });
  } else {
    els.sound.setAttribute("aria-disabled", "true");
  }

  /* ---------- arranque ---------- */

  writeInputs(timer.config());
  renderSound();
  renderStats();
  render();
})();
