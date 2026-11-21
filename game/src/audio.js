// Sound for Solmar, synthesised live with WebAudio: no audio files, no
// network, everything a few oscillators and a noise buffer. The engine hums
// with speed, sirens wail when the law is near, and a slow bassline keeps
// the city moving underneath.
const MUSIC_NOTES = [55, 55, 65.41, 49, 55, 55, 73.42, 65.41];
const NOTE_LEN = 0.42;

/** A sound board; call ensure() from the first user gesture. */
export function createAudio() {
  let ctx = null;
  let master = null;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenHigh = false;
  let sirenTimer = 0;
  let musicTimer = null;
  let musicStep = 0;
  let muted = false;
  let noiseBuf = null;

  function makeNoise() {
    const len = ctx.sampleRate * 0.5;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function tone(freq, dur, type, vol, slideTo) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise(dur, vol, filterFreq) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  return {
    get muted() {
      return muted;
    },
    /** Build the context. Browsers require a gesture first; call on click/key. */
    ensure() {
      if (ctx) {
        if (ctx.state === 'suspended') ctx.resume();
        return;
      }
      const AC = window.AudioContext ?? window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      noiseBuf = makeNoise();
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 50;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();
      sirenOsc = ctx.createOscillator();
      sirenOsc.type = 'triangle';
      sirenOsc.frequency.value = 700;
      sirenGain = ctx.createGain();
      sirenGain.gain.value = 0;
      sirenOsc.connect(sirenGain);
      sirenGain.connect(master);
      sirenOsc.start();
    },
    setMuted(m) {
      muted = m;
      if (master) master.gain.value = m ? 0 : 0.5;
    },
    /** Engine pitch follows speed; silent on foot. */
    engine(speed, driving) {
      if (!ctx) return;
      const target = driving ? 0.05 + Math.min(0.12, Math.abs(speed) / 4200) : 0;
      engineGain.gain.setTargetAtTime(target, ctx.currentTime, 0.08);
      engineOsc.frequency.setTargetAtTime(50 + Math.abs(speed) * 0.35, ctx.currentTime, 0.08);
    },
    /** Two-tone siren while any cop is close; call every frame. */
    siren(near, dt) {
      if (!ctx) return;
      sirenGain.gain.setTargetAtTime(near && !muted ? 0.045 : 0, ctx.currentTime, 0.1);
      if (!near) return;
      sirenTimer -= dt;
      if (sirenTimer <= 0) {
        sirenHigh = !sirenHigh;
        sirenOsc.frequency.setValueAtTime(sirenHigh ? 880 : 660, ctx.currentTime);
        sirenTimer = 0.42;
      }
    },
    shot() {
      noise(0.14, 0.5, 2400);
      tone(180, 0.08, 'square', 0.2, 60);
    },
    punch() {
      noise(0.09, 0.35, 500);
    },
    pickup() {
      tone(660, 0.09, 'sine', 0.25);
      tone(990, 0.14, 'sine', 0.22);
    },
    crash() {
      noise(0.3, 0.5, 900);
      tone(90, 0.25, 'sine', 0.4, 40);
    },
    coin() {
      tone(880, 0.07, 'sine', 0.2);
      tone(1320, 0.1, 'sine', 0.18);
    },
    /** Little two-note chime when a mission step lands. */
    jingle() {
      tone(523, 0.12, 'triangle', 0.28);
      setTimeout(() => tone(784, 0.2, 'triangle', 0.28), 120);
    },
    /** Sad slide for getting busted or wasted. */
    fail() {
      tone(330, 0.5, 'sawtooth', 0.2, 110);
    },
    /** Start the bassline loop; it schedules itself. */
    musicStart() {
      if (!ctx || musicTimer) return;
      const stepFn = () => {
        if (!muted) tone(MUSIC_NOTES[musicStep % MUSIC_NOTES.length], NOTE_LEN * 0.9, 'triangle', 0.16);
        musicStep += 1;
        musicTimer = setTimeout(stepFn, NOTE_LEN * 1000);
      };
      stepFn();
    },
  };
}
