/**
 * All sound is synthesised with the Web Audio API — no asset files. Every cue
 * is positional: volume falls off with distance and pans left/right relative
 * to where the player is facing the world.
 */

export type SoundName =
  | "pistol"
  | "small_rifle"
  | "shotgun"
  | "assault_rifle"
  | "sniper"
  | "bazooka"
  | "explosion"
  | "reload"
  | "footstep"
  | "pickup"
  | "letter"
  | "hurt"
  | "die"
  | "respawn"
  | "zone"
  | "plane";

/** How far a sound carries, in world units. */
export const EARSHOT: Record<SoundName, number> = {
  pistol: 900,
  small_rifle: 950,
  shotgun: 1000,
  assault_rifle: 1100,
  sniper: 1500,
  bazooka: 1600,
  explosion: 1600,
  reload: 260,
  footstep: 330,
  pickup: 260,
  letter: 400,
  hurt: 400,
  die: 600,
  respawn: 400,
  zone: 2000,
  plane: 2200,
};

interface GunTone {
  /** Peak gain. */
  gain: number;
  /** Seconds until silence. */
  decay: number;
  /** Band-pass centre, in Hz. */
  tone: number;
  /** Low sine thump layered underneath. */
  body: number;
}

const GUN_TONES: Record<string, GunTone> = {
  pistol: { gain: 0.5, decay: 0.14, tone: 1500, body: 150 },
  small_rifle: { gain: 0.36, decay: 0.09, tone: 1900, body: 180 },
  shotgun: { gain: 0.7, decay: 0.28, tone: 900, body: 90 },
  assault_rifle: { gain: 0.52, decay: 0.16, tone: 1300, body: 120 },
  sniper: { gain: 0.85, decay: 0.42, tone: 700, body: 70 },
  bazooka: { gain: 0.8, decay: 0.5, tone: 420, body: 55 },
};

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = false;

  /** Must be called from a user gesture; browsers refuse audio before one. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    try {
      this.ctx = new Ctor();
    } catch {
      return;
    }

    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    this.master.connect(this.ctx.destination);

    // One second of white noise, reused by every percussive sound.
    const rate = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, rate, rate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.55, this.ctx.currentTime, 0.02);
    }
  }

  get isMuted() {
    return this.muted;
  }

  private route(volume: number, pan: number): GainNode | null {
    if (!this.ctx || !this.master) return null;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    if (typeof this.ctx.createStereoPanner === "function") {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      gain.connect(panner);
      panner.connect(this.master);
    } else {
      gain.connect(this.master);
    }
    return gain;
  }

  private burst(
    out: GainNode,
    opts: { decay: number; tone: number; q?: number; sweepTo?: number },
  ) {
    if (!this.ctx || !this.noise) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = opts.tone;
    filter.Q.value = opts.q ?? 1.1;
    if (opts.sweepTo) {
      filter.frequency.setValueAtTime(opts.tone, now);
      filter.frequency.exponentialRampToValueAtTime(opts.sweepTo, now + opts.decay);
    }
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(1, now);
    env.gain.exponentialRampToValueAtTime(0.0001, now + opts.decay);
    src.connect(filter);
    filter.connect(env);
    env.connect(out);
    src.start(now);
    src.stop(now + opts.decay + 0.05);
  }

  private tone(
    out: GainNode,
    opts: { freq: number; to?: number; decay: number; type?: OscillatorType; delay?: number },
  ) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime + (opts.delay ?? 0);
    const osc = this.ctx.createOscillator();
    osc.type = opts.type ?? "sine";
    osc.frequency.setValueAtTime(opts.freq, now);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, now + opts.decay);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(1, now + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, now + opts.decay);
    osc.connect(env);
    env.connect(out);
    osc.start(now);
    osc.stop(now + opts.decay + 0.05);
  }

  /**
   * `volume` 0..1 (already distance-attenuated by the caller) and `pan` -1..1.
   */
  play(name: SoundName, volume = 1, pan = 0) {
    if (!this.ctx || this.muted || volume <= 0.01) return;
    if (this.ctx.state === "suspended") return;

    const gun = GUN_TONES[name];
    if (gun) {
      const out = this.route(volume * gun.gain, pan);
      if (!out) return;
      this.burst(out, { decay: gun.decay, tone: gun.tone, q: 0.9 });
      this.tone(out, { freq: gun.body, to: gun.body * 0.5, decay: gun.decay * 0.8 });
      return;
    }

    switch (name) {
      case "explosion": {
        const out = this.route(volume * 0.9, pan);
        if (!out) return;
        this.burst(out, { decay: 0.75, tone: 900, sweepTo: 90, q: 0.6 });
        this.tone(out, { freq: 90, to: 32, decay: 0.7, type: "triangle" });
        break;
      }
      case "reload": {
        const out = this.route(volume * 0.4, pan);
        if (!out) return;
        this.burst(out, { decay: 0.05, tone: 2600, q: 3 });
        this.burst(out, { decay: 0.06, tone: 1700, q: 3 });
        break;
      }
      case "footstep": {
        const out = this.route(volume * 0.28, pan);
        if (!out) return;
        this.burst(out, { decay: 0.07, tone: 380, q: 1.6 });
        break;
      }
      case "pickup": {
        const out = this.route(volume * 0.34, pan);
        if (!out) return;
        this.tone(out, { freq: 700, to: 1250, decay: 0.11, type: "triangle" });
        break;
      }
      case "letter": {
        // A soft two-note chime, deliberately the nicest sound in the game.
        const out = this.route(volume * 0.42, pan);
        if (!out) return;
        this.tone(out, { freq: 784, decay: 0.5 });
        this.tone(out, { freq: 1175, decay: 0.6, delay: 0.11 });
        break;
      }
      case "hurt": {
        const out = this.route(volume * 0.5, pan);
        if (!out) return;
        this.tone(out, { freq: 200, to: 90, decay: 0.22, type: "sawtooth" });
        break;
      }
      case "die": {
        const out = this.route(volume * 0.6, pan);
        if (!out) return;
        this.tone(out, { freq: 420, to: 70, decay: 0.85, type: "triangle" });
        break;
      }
      case "respawn": {
        const out = this.route(volume * 0.4, pan);
        if (!out) return;
        this.tone(out, { freq: 520, decay: 0.16 });
        this.tone(out, { freq: 660, decay: 0.16, delay: 0.1 });
        this.tone(out, { freq: 880, decay: 0.3, delay: 0.2 });
        break;
      }
      case "zone": {
        const out = this.route(volume * 0.45, pan);
        if (!out) return;
        this.tone(out, { freq: 300, to: 190, decay: 0.7, type: "sine" });
        break;
      }
      case "plane": {
        const out = this.route(volume * 0.3, pan);
        if (!out) return;
        this.burst(out, { decay: 1.4, tone: 220, q: 0.5 });
        break;
      }
    }
  }
}
