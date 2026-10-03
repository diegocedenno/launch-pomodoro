/* Lógica del pomodoro, sin DOM: máquina de estados, reloj por marcas de tiempo
   y estadísticas por fecha. Recibe el reloj como función, así que se puede
   probar con uno falso.

   Estados (mode):
     idle     en espera en la plataforma; siempre es la fase de enfoque
     timing   una fase corriendo o en pausa; sus últimos 10 s son la secuencia T-10
     liftoff  despegue tras un enfoque; al terminar, el enfoque cuenta
     landing  regreso a la plataforma tras un descanso                          */
(function () {
  "use strict";

  var App = (window.LaunchPomodoro = window.LaunchPomodoro || {});

  var COUNTDOWN_MS = 10000;
  var MISSIONS = 4; // enfoques por ciclo; tras el cuarto toca descanso largo
  var DEFAULTS = { focus: 25, short: 5, long: 15 }; // minutos
  var LIMITS = { focus: [1, 90], short: [1, 30], long: [1, 60] };
  var STAGE_MS = { liftoff: 4200, landing: 3200 };
  var KEEP_DAYS = 30;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }

  /* ---------- configuración ---------- */

  function cleanConfig(raw) {
    var out = {};
    for (var key in DEFAULTS) {
      var value = raw ? raw[key] : undefined;
      var usable = typeof value === "number" || (typeof value === "string" && value.trim() !== "");
      var n = usable ? Math.round(Number(value)) : NaN;
      out[key] = isFinite(n) ? clamp(n, LIMITS[key][0], LIMITS[key][1]) : DEFAULTS[key];
    }
    return out;
  }

  /* ---------- formato ---------- */

  // Segundos hacia arriba: una fase de 25 min muestra 25:00 durante su primer segundo.
  function formatClock(ms) {
    var seconds = Math.max(0, Math.ceil(ms / 1000));
    return pad(Math.floor(seconds / 60)) + ":" + pad(seconds % 60);
  }

  /* ---------- estadísticas por fecha ---------- */

  function dayKey(date) {
    var d = date || new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function count(value) {
    var n = Number(value);
    return isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  function cleanDay(raw) {
    var day = raw && typeof raw === "object" ? raw : {};
    return {
      focuses: count(day.focuses),
      focusMs: count(day.focusMs),
      cycle: clamp(count(day.cycle), 0, MISSIONS),
    };
  }

  // Valida lo leído de localStorage y conserva solo los días más recientes.
  function cleanDays(raw) {
    var out = {};
    if (!raw || typeof raw !== "object") return out;
    Object.keys(raw)
      .filter(function (key) {
        return /^\d{4}-\d{2}-\d{2}$/.test(key);
      })
      .sort()
      .slice(-KEEP_DAYS)
      .forEach(function (key) {
        out[key] = cleanDay(raw[key]);
      });
    return out;
  }

  function addFocus(day, workedMs) {
    var base = cleanDay(day);
    return {
      focuses: base.focuses + 1,
      focusMs: base.focusMs + count(workedMs),
      cycle: base.cycle,
    };
  }

  /* ---------- temporizador ---------- */

  App.createTimer = function (options) {
    var opts = options || {};
    var now = opts.now || Date.now;
    var listener = opts.onEvent || function () {};

    var config = cleanConfig(opts.config);
    var cycle = clamp(count(opts.cycle), 0, MISSIONS - 1); // enfoques completados del ciclo
    var phase = "focus"; // focus | break | longBreak
    var mode = "idle";
    var running = false;
    var total = durationOf("focus");
    var remaining = total; // válido mientras no corre
    var endAt = 0; // válido mientras corre: la hora de fin manda, no los ticks
    var skipped = 0; // ms saltados con "saltar": no cuentan como enfoque
    var stageStart = 0;
    var stageTotal = 0;
    var inCountdown = false;
    var lastSecond = null;

    function durationOf(which) {
      var key = which === "focus" ? "focus" : which === "break" ? "short" : "long";
      return config[key] * 60000;
    }

    function stageDuration(kind) {
      var custom = opts[kind + "Ms"];
      var value = typeof custom === "function" ? custom() : custom;
      return value > 0 ? value : STAGE_MS[kind];
    }

    function left() {
      return running ? Math.max(0, endAt - now()) : remaining;
    }

    function staged() {
      return mode === "liftoff" || mode === "landing";
    }

    function nextPhase() {
      if (phase !== "focus") return "focus";
      return cycle + 1 >= MISSIONS ? "longBreak" : "break";
    }

    function snapshot() {
      var rest = staged() ? 0 : left();
      var snap = {
        phase: phase,
        mode: mode,
        running: running,
        cycle: cycle,
        missions: MISSIONS,
        // La misión incluye su descanso: durante el descanso sigue siendo la que acaba de volar.
        mission: clamp(phase === "focus" ? cycle + 1 : cycle, 1, MISSIONS),
        totalMs: total,
        remainingMs: rest,
        progress: total ? clamp(1 - rest / total, 0, 1) : 0,
        countdown: mode === "timing" && rest <= COUNTDOWN_MS,
        stageElapsedMs: 0,
        stageTotalMs: 0,
        next: { phase: nextPhase(), minutes: durationOf(nextPhase()) / 60000 },
      };
      if (staged()) {
        snap.stageTotalMs = stageTotal;
        snap.stageElapsedMs = clamp(now() - stageStart, 0, stageTotal);
      }
      return snap;
    }

    function emit(type, detail) {
      listener(type, snapshot(), detail || {});
    }

    // Entrada en T-10 y un evento por cada segundo entero que queda (10 … 1).
    function watchCountdown() {
      var rest = left();
      if (mode !== "timing" || rest > COUNTDOWN_MS) return;
      if (!inCountdown) {
        inCountdown = true;
        emit("countdown");
      }
      var n = Math.ceil(rest / 1000);
      if (running && n !== lastSecond && n >= 1) {
        lastSecond = n;
        emit("second", { n: n });
      }
    }

    function run() {
      mode = "timing";
      running = true;
      endAt = now() + remaining;
    }

    function start() {
      if (staged() || running) return false;
      var type = mode === "idle" ? "start" : "resume";
      run();
      emit(type);
      watchCountdown();
      return true;
    }

    function pause() {
      if (!running || mode !== "timing") return false;
      remaining = left();
      running = false;
      emit("pause");
      return true;
    }

    function toggle() {
      return running ? pause() : start();
    }

    function reset() {
      if (staged()) return false;
      running = false;
      total = durationOf(phase);
      remaining = total;
      skipped = 0;
      inCountdown = false;
      lastSecond = null;
      mode = phase === "focus" ? "idle" : "timing";
      emit("reset");
      return true;
    }

    // Saltar no corta en seco: deja la fase a 10 s del final para que se vea la secuencia.
    function skip() {
      if (staged()) return false;
      var rest = left();
      if (rest <= COUNTDOWN_MS) return false;
      skipped += rest - COUNTDOWN_MS;
      remaining = COUNTDOWN_MS;
      run();
      emit("skip");
      watchCountdown();
      return true;
    }

    function beginStage(kind) {
      running = false;
      remaining = 0;
      inCountdown = false;
      lastSecond = null;
      mode = kind;
      stageTotal = stageDuration(kind);
      stageStart = now();
      emit(kind);
    }

    function finishStage() {
      if (mode === "liftoff") {
        // El enfoque cuenta aquí, al completarse su despegue.
        var worked = Math.max(0, total - skipped);
        cycle += 1;
        phase = cycle >= MISSIONS ? "longBreak" : "break";
        total = durationOf(phase);
        remaining = total;
        skipped = 0;
        run();
        emit("break", { workedMs: worked });
      } else {
        if (cycle >= MISSIONS) cycle = 0;
        phase = "focus";
        total = durationOf(phase);
        remaining = total;
        skipped = 0;
        mode = "idle";
        emit("ready");
      }
    }

    function tick() {
      if (staged()) {
        if (now() - stageStart >= stageTotal) finishStage();
        return;
      }
      if (!running) return;
      if (endAt - now() <= 0) {
        beginStage(phase === "focus" ? "liftoff" : "landing");
        return;
      }
      watchCountdown();
    }

    // Una duración nueva entra de inmediato solo si la fase aún no ha empezado.
    function setConfig(raw) {
      config = cleanConfig(raw);
      var applied = mode === "idle";
      if (applied) {
        total = durationOf("focus");
        remaining = total;
      }
      emit("config", { applied: applied });
      return applied;
    }

    return {
      start: start,
      pause: pause,
      toggle: toggle,
      reset: reset,
      skip: skip,
      tick: tick,
      snapshot: snapshot,
      setConfig: setConfig,
      config: function () {
        return { focus: config.focus, short: config.short, long: config.long };
      },
    };
  };

  App.COUNTDOWN_MS = COUNTDOWN_MS;
  App.MISSIONS = MISSIONS;
  App.LIMITS = LIMITS;
  App.cleanConfig = cleanConfig;
  App.formatClock = formatClock;
  App.stats = { dayKey: dayKey, cleanDay: cleanDay, cleanDays: cleanDays, addFocus: addFocus };
})();
