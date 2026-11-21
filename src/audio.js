/* Fully procedural ambience — no audio files. Wind bed, sea, birds, footsteps. */
export class Ambience {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = localStorage.getItem('libertalia.muted') !== '0'; // 默认静音
    this.lastStep = 0;
    this.birdTimer = 3;
  }

  mute(m) {
    this.muted = !!m;
    localStorage.setItem('libertalia.muted', this.muted ? '1' : '0');
    if (!this.master) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(this.muted ? 0 : 0.5, now + 0.12);
  }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.0;
    this.master.connect(ctx.destination);
    if (!this.muted) this.master.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 2.5);

    // --- wind bed
    const windSrc = this._noiseLoop(this._noiseBuffer(6, 'brown'));
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 420;
    windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.34;
    windSrc.connect(windFilter).connect(this.windGain).connect(this.master);

    // slow gusts
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 240;
    lfo.connect(lfoGain).connect(windFilter.frequency);
    lfo.start();

    // --- sea wash
    const seaSrc = this._noiseLoop(this._noiseBuffer(5, 'pink'));
    const seaFilter = ctx.createBiquadFilter();
    seaFilter.type = 'bandpass';
    seaFilter.frequency.value = 780;
    seaFilter.Q.value = 0.5;
    const seaGain = ctx.createGain();
    seaGain.gain.value = 0.10;
    seaSrc.connect(seaFilter).connect(seaGain).connect(this.master);

    this.ready = true;
  }

  _noiseBuffer(seconds, kind) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0, b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      if (kind === 'brown') {
        last = (last + 0.02 * white) / 1.02;
        d[i] = last * 3.2;
      } else {
        b0 = 0.99765 * b0 + white * 0.0990460;
        b1 = 0.96300 * b1 + white * 0.2965164;
        b2 = 0.57000 * b2 + white * 1.0526913;
        d[i] = (b0 + b1 + b2 + white * 0.1848) * 0.11;
      }
    }
    // fade edges so the loop is seamless
    const fade = 2000;
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[i] *= k;
      d[len - 1 - i] *= k;
    }
    return buf;
  }

  _noiseLoop(buf) {
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.start();
    return src;
  }

  chirp() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const base = 1800 + Math.random() * 2200;
    const notes = 2 + ((Math.random() * 3) | 0);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) pan.pan.value = Math.random() * 1.6 - 0.8;
    const out = ctx.createGain();
    out.gain.value = 0.055;
    if (pan) { out.connect(pan).connect(this.master); } else out.connect(this.master);
    for (let i = 0; i < notes; i++) {
      const st = t + i * 0.085;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(base * (1 + i * 0.06), st);
      osc.frequency.exponentialRampToValueAtTime(base * 1.5, st + 0.05);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(1, st + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.07);
      osc.connect(g).connect(out);
      osc.start(st);
      osc.stop(st + 0.09);
    }
  }

  step() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    if (t - this.lastStep < 0.18) return;
    this.lastStep = t;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.16, 'pink');
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 480 + Math.random() * 380;
    f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.18);
  }

  thud() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(58, t + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.34, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    osc.connect(g).connect(this.master);
    osc.start(t); osc.stop(t + 0.55);
  }

  chime() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    [880, 1320, 1760].forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = ctx.createGain();
      const st = t + i * 0.07;
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.09, st + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.9);
      osc.connect(g).connect(this.master);
      osc.start(st); osc.stop(st + 1.0);
    });
  }

  update(dt) {
    if (!this.ready) return;
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 2.5 + Math.random() * 6;
      this.chirp();
    }
  }
}
