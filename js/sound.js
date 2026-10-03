/* Sonido con Web Audio, sin archivos: pitidos de la cuenta regresiva y un
   rugido de despegue hecho con ruido filtrado y envolvente.
   El AudioContext solo se crea dentro de un gesto del usuario (unlock), de modo
   que el navegador nunca lo bloquea ni avisa de autoplay. */
(function () {
  "use strict";

  var App = (window.LaunchPomodoro = window.LaunchPomodoro || {});
  var VOLUME = 0.55;

  function noop() {}

  App.createSound = function () {
    var AudioCtor = window.AudioContext || window.webkitAudioContext;
    var ctx = null;
    var master = null;
    var noise = null;
    var enabled = false;

    function unlock() {
      if (!enabled || !AudioCtor) return;
      try {
        if (!ctx) {
          ctx = new AudioCtor();
          master = ctx.createGain();
          master.gain.value = VOLUME;
          master.connect(ctx.destination);
        }
        if (ctx.state === "suspended") ctx.resume().catch(noop);
      } catch (err) {
        ctx = null;
      }
    }

    // Programa un sonido si el contexto ya corre. Con `wait`, espera a que arranque
    // (solo para la confirmación del interruptor, que llega en el mismo gesto).
    function play(build, wait) {
      if (!enabled || !ctx) return;
      if (ctx.state === "running") {
        build(ctx.currentTime + 0.02);
      } else if (ctx.state === "suspended") {
        var pending = ctx.resume();
        if (wait) {
          pending.then(function () {
            if (enabled) build(ctx.currentTime + 0.02);
          }, noop);
        } else {
          pending.catch(noop);
        }
      }
    }

    function tone(at, freq, duration, volume, type) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(freq, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(volume, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
      osc.connect(gain);
      gain.connect(master);
      osc.start(at);
      osc.stop(at + duration + 0.05);
    }

    // Ruido marrón: blanco integrado, con más cuerpo en graves que el blanco.
    function noiseBuffer() {
      if (noise) return noise;
      var length = ctx.sampleRate * 2;
      noise = ctx.createBuffer(1, length, ctx.sampleRate);
      var data = noise.getChannelData(0);
      var last = 0;
      for (var i = 0; i < length; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        data[i] = last * 3.5;
      }
      return noise;
    }

    function roar(at, duration) {
      var source = ctx.createBufferSource();
      source.buffer = noiseBuffer();
      source.loop = true;

      // El filtro se abre con la ignición y se cierra a medida que el cohete se aleja.
      var filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.Q.value = 0.8;
      filter.frequency.setValueAtTime(140, at);
      filter.frequency.exponentialRampToValueAtTime(900, at + duration * 0.22);
      filter.frequency.exponentialRampToValueAtTime(160, at + duration);

      var gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.9, at + 0.35);
      gain.gain.setValueAtTime(0.9, at + duration * 0.35);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);

      source.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      source.start(at);
      source.stop(at + duration + 0.1);

      // Un grave que baja de tono le da peso al rugido.
      var rumble = ctx.createOscillator();
      var rumbleGain = ctx.createGain();
      rumble.type = "sine";
      rumble.frequency.setValueAtTime(58, at);
      rumble.frequency.exponentialRampToValueAtTime(34, at + duration);
      rumbleGain.gain.setValueAtTime(0.0001, at);
      rumbleGain.gain.exponentialRampToValueAtTime(0.35, at + 0.4);
      rumbleGain.gain.exponentialRampToValueAtTime(0.0001, at + duration * 0.9);
      rumble.connect(rumbleGain);
      rumbleGain.connect(master);
      rumble.start(at);
      rumble.stop(at + duration);
    }

    return {
      supported: Boolean(AudioCtor),
      unlock: unlock,
      enabled: function () {
        return enabled;
      },
      setEnabled: function (on) {
        enabled = Boolean(on) && Boolean(AudioCtor);
        if (ctx && master) master.gain.setTargetAtTime(enabled ? VOLUME : 0, ctx.currentTime, 0.03);
      },
      // Confirmación al encender el interruptor.
      confirm: function () {
        play(function (at) {
          tone(at, 660, 0.09, 0.22);
          tone(at + 0.1, 990, 0.14, 0.22);
        }, true);
      },
      // Un pitido por segundo en T-10; los tres últimos suben de tono.
      second: function (n) {
        play(function (at) {
          tone(at, n <= 3 ? 1175 : 880, 0.1, 0.25);
        });
      },
      liftoff: function (seconds) {
        play(function (at) {
          tone(at, 1568, 0.4, 0.22);
          roar(at, Math.max(2, seconds));
        });
      },
      landing: function () {
        play(function (at) {
          tone(at, 784, 0.18, 0.2);
          tone(at + 0.2, 1047, 0.36, 0.2);
        });
      },
    };
  };
})();
