// Sound, synthesised: every effect is an oscillator or filtered noise burst
// shaped by an envelope, so the game ships no audio files. Distance and
// direction are faked with gain and stereo pan relative to the listener,
// which is the player's head.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let volume = 0.8;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return false;
    }
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    const len = ctx.sampleRate * 1;
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    return true;
  }

  function panFor(x, z, listener) {
    if (!listener) return 0;
    const dx = x - listener.position.x;
    const dz = z - listener.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.5) return 0;
    // Pan by the angle between the listener's facing and the source.
    const fx = -Math.sin(listener.yaw);
    const fz = -Math.cos(listener.yaw);
    const rx = -fz;
    const rz = fx;
    return Math.max(-1, Math.min(1, (dx * rx + dz * rz) / dist));
  }

  function gainFor(dist, base) {
    return base * Math.max(0, 1 - dist / 55);
  }

  function noise({ duration, filterFreq, filterType = 'lowpass', gain, pan = 0, when = 0, q = 0.8 }) {
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    src.connect(filter).connect(g).connect(panner).connect(master);
    src.start(t);
    src.stop(t + duration + 0.05);
  }

  function tone({ freq, freqEnd, duration, gain, type = 'sine', pan = 0, when = 0 }) {
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    osc.connect(g).connect(panner).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  return {
    unlock() {
      ensure();
    },
    setVolume(v) {
      volume = v;
      if (master) master.gain.value = v;
    },
    shot(x, z, listener, weaponId) {
      if (!ensure()) return;
      const dist = listener ? Math.hypot(x - listener.position.x, z - listener.position.z) : 0;
      const pan = panFor(x, z, listener);
      const heavy = weaponId === 'dmr7' || weaponId === 'm870';
      noise({ duration: heavy ? 0.22 : 0.13, filterFreq: heavy ? 900 : 1600, gain: gainFor(dist, heavy ? 0.55 : 0.4), pan });
      tone({ freq: heavy ? 120 : 170, freqEnd: 50, duration: 0.12, gain: gainFor(dist, 0.3), type: 'triangle', pan });
    },
    dryFire() {
      if (!ensure()) return;
      tone({ freq: 1400, duration: 0.04, gain: 0.12, type: 'square' });
    },
    reload() {
      if (!ensure()) return;
      tone({ freq: 700, duration: 0.05, gain: 0.15, type: 'square', when: 0 });
      tone({ freq: 500, duration: 0.05, gain: 0.15, type: 'square', when: 0.35 });
      tone({ freq: 900, duration: 0.06, gain: 0.18, type: 'square', when: 0.7 });
    },
    hit(headshot) {
      if (!ensure()) return;
      tone({ freq: headshot ? 1800 : 1200, duration: 0.06, gain: 0.22, type: 'sine' });
    },
    kill() {
      if (!ensure()) return;
      tone({ freq: 880, duration: 0.09, gain: 0.2, type: 'sine' });
      tone({ freq: 1320, duration: 0.12, gain: 0.2, type: 'sine', when: 0.07 });
    },
    hurt() {
      if (!ensure()) return;
      tone({ freq: 220, freqEnd: 110, duration: 0.15, gain: 0.3, type: 'sawtooth' });
    },
    explosion(x, z, listener) {
      if (!ensure()) return;
      const dist = listener ? Math.hypot(x - listener.position.x, z - listener.position.z) : 0;
      const pan = panFor(x, z, listener);
      const g = gainFor(dist, 0.9);
      noise({ duration: 0.9, filterFreq: 400, gain: g, pan });
      tone({ freq: 90, freqEnd: 30, duration: 0.8, gain: g * 0.8, type: 'sine', pan });
      noise({ duration: 0.3, filterFreq: 2400, gain: g * 0.4, pan });
    },
    flashPop(x, z, listener) {
      if (!ensure()) return;
      const dist = listener ? Math.hypot(x - listener.position.x, z - listener.position.z) : 0;
      noise({ duration: 0.4, filterFreq: 3200, filterType: 'highpass', gain: gainFor(dist, 0.5), pan: panFor(x, z, listener) });
      tone({ freq: 2800, duration: 0.5, gain: gainFor(dist, 0.12), type: 'sine' });
    },
    beep(urgent) {
      if (!ensure()) return;
      tone({ freq: urgent ? 1500 : 1050, duration: 0.09, gain: 0.2, type: 'square' });
    },
    plantDone() {
      if (!ensure()) return;
      tone({ freq: 660, duration: 0.1, gain: 0.2, type: 'square' });
      tone({ freq: 990, duration: 0.14, gain: 0.2, type: 'square', when: 0.1 });
    },
    defuseDone() {
      if (!ensure()) return;
      tone({ freq: 990, duration: 0.1, gain: 0.2, type: 'sine' });
      tone({ freq: 1320, duration: 0.16, gain: 0.2, type: 'sine', when: 0.1 });
    },
    roundWin() {
      if (!ensure()) return;
      tone({ freq: 523, duration: 0.14, gain: 0.22, type: 'triangle' });
      tone({ freq: 659, duration: 0.14, gain: 0.22, type: 'triangle', when: 0.13 });
      tone({ freq: 784, duration: 0.24, gain: 0.24, type: 'triangle', when: 0.26 });
    },
    roundLose() {
      if (!ensure()) return;
      tone({ freq: 392, duration: 0.16, gain: 0.2, type: 'triangle' });
      tone({ freq: 330, duration: 0.16, gain: 0.2, type: 'triangle', when: 0.15 });
      tone({ freq: 262, duration: 0.3, gain: 0.2, type: 'triangle', when: 0.3 });
    },
    buy() {
      if (!ensure()) return;
      tone({ freq: 1200, duration: 0.06, gain: 0.15, type: 'sine' });
      tone({ freq: 1600, duration: 0.08, gain: 0.15, type: 'sine', when: 0.05 });
    },
    denied() {
      if (!ensure()) return;
      tone({ freq: 240, duration: 0.12, gain: 0.18, type: 'square' });
    },
    click() {
      if (!ensure()) return;
      tone({ freq: 900, duration: 0.04, gain: 0.1, type: 'sine' });
    },
    footstep(x, z, listener) {
      if (!ensure()) return;
      const dist = listener ? Math.hypot(x - listener.position.x, z - listener.position.z) : 0;
      if (dist > 14) return;
      noise({ duration: 0.06, filterFreq: 500, gain: gainFor(dist, 0.1), pan: panFor(x, z, listener) });
    },
  };
}
