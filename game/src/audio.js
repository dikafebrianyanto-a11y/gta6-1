// Solmar's soundtrack, synthesised live with WebAudio: no audio files, no
// network, just oscillators, a noise buffer and a slow bassline. The car
// engine hums with speed, a motorcycle buzzes higher and rougher, sirens
// wail when the law is near, roadblocks get their own sharper alarm, and
// pickups, coins and mission beats land as short chimes.
//
// Everything is lazy: nothing exists until ensure() runs from a user
// gesture, because browsers will not let audio start before one.
const BASSLINE = [55, 55, 65.41, 49, 55, 55, 73.42, 65.41];
const BASS_STEP_SECONDS = 0.42;

// How loud each layer sits under the master gain.
const LEVEL = {
  master: 0.5,
  engine: 0.17,
  bike: 0.12,
  siren: 0.045,
  roadblock: 0.06,
};

/** A sound board; call ensure() from the first user gesture. */
export function createAudio() {
  // One state bag instead of a dozen loose variables: every voice the
  // board owns, the music sequencer's place in the bassline, and the
  // mute flag live here.
  const s = {
    ctx: null,
    master: null,
    noiseBuf: null,
    muted: false,
    car: { osc: null, gain: null },
    bike: { osc: null, gain: null, sub: null, subGain: null },
    siren: { osc: null, gain: null, high: false, timer: 0 },
    roadblock: { osc: null, gain: null, high: false, timer: 0 },
    music: { timer: null, step: 0 },
  };

  /** Half a second of white noise, reused by every percussive sound. */
  function buildNoiseBuffer() {
    const len = s.ctx.sampleRate * 0.5;
    const buf = s.ctx.createBuffer(1, len, s.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** A looping oscillator plus its gain, already wired into the master. */
  function loopVoice(type, freq, level) {
    const osc = s.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = s.ctx.createGain();
    gain.gain.value = level;
    osc.connect(gain);
    gain.connect(s.master);
    osc.start();
    return { osc, gain };
  }

  /** One short pitched note that slides and fades out. */
  function blip(freq, dur, type, vol, slideTo) {
    if (!s.ctx || s.muted) return;
    const t0 = s.ctx.currentTime;
    const osc = s.ctx.createOscillator();
    const gain = s.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain);
    gain.connect(s.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** One burst of filtered noise — gunshots, punches, crashes. */
  function thud(dur, vol, filterFreq) {
    if (!s.ctx || s.muted) return;
    const t0 = s.ctx.currentTime;
    const src = s.ctx.createBufferSource();
    src.buffer = s.noiseBuf;
    const filter = s.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = s.ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(s.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  /** Two notes in sequence, the second delayed by `gapMs`. */
  function twoNotes(first, second, gapMs) {
    blip(first.freq, first.dur, first.type, first.vol, first.slideTo);
    setTimeout(() => blip(second.freq, second.dur, second.type, second.vol, second.slideTo), gapMs);
  }

  /** Flip a two-tone alarm between its high and low note on a timer. */
  function alternateAlarm(voice, dt, highFreq, lowFreq, period) {
    voice.timer -= dt;
    if (voice.timer > 0) return;
    voice.high = !voice.high;
    voice.osc.frequency.setValueAtTime(voice.high ? highFreq : lowFreq, s.ctx.currentTime);
    voice.timer = period;
  }

  return {
    get muted() {
      return s.muted;
    },
    /** Build the context. Browsers require a gesture first; call on click/key. */
    ensure() {
      if (s.ctx) {
        if (s.ctx.state === 'suspended') s.ctx.resume();
        return;
      }
      const AC = window.AudioContext ?? window.webkitAudioContext;
      if (!AC) return;
      s.ctx = new AC();
      s.master = s.ctx.createGain();
      s.master.gain.value = LEVEL.master;
      s.master.connect(s.ctx.destination);
      s.noiseBuf = buildNoiseBuffer();
      // The car engine: a low sawtooth that follows speed.
      s.car = loopVoice('sawtooth', 50, 0);
      // The police siren: a triangle that alternates two notes.
      s.siren = { ...loopVoice('triangle', 700, 0), high: false, timer: 0 };
      // The motorcycle: a buzzy square wave an octave-ish above the car,
      // plus a quiet sub sawtooth for the thump underneath.
      const bikeMain = loopVoice('square', 110, 0);
      const bikeSub = loopVoice('sawtooth', 55, 0);
      s.bike = { ...bikeMain, sub: bikeSub.osc, subGain: bikeSub.gain };
      // The roadblock alarm gets its own voice so it never fights the
      // police siren: a sharper square wave that alternates faster.
      s.roadblock = { ...loopVoice('square', 950, 0), high: false, timer: 0 };
    },
    setMuted(m) {
      s.muted = m;
      if (s.master) s.master.gain.value = m ? 0 : LEVEL.master;
    },
    /** Engine pitch follows speed; silent on foot. */
    engine(speed, driving) {
      if (!s.ctx) return;
      const loudness = driving ? 0.05 + Math.min(LEVEL.engine - 0.05, Math.abs(speed) / 4200) : 0;
      s.car.gain.gain.setTargetAtTime(loudness, s.ctx.currentTime, 0.08);
      s.car.osc.frequency.setTargetAtTime(50 + Math.abs(speed) * 0.35, s.ctx.currentTime, 0.08);
    },
    /** Motorcycle engine: a higher, rougher buzz that revs with speed.
     * Call every frame while Dex rides a bike; silent otherwise. */
    motorcycleEngine(speed, riding) {
      if (!s.ctx) return;
      const abs = Math.abs(speed);
      const loudness = riding ? 0.04 + Math.min(LEVEL.bike - 0.04, abs / 5200) : 0;
      s.bike.gain.gain.setTargetAtTime(loudness, s.ctx.currentTime, 0.06);
      // The buzz climbs faster than a car engine and wobbles a little,
      // the way a small bike engine does at full throttle.
      const wobble = riding ? Math.sin(s.ctx.currentTime * 31) * 6 : 0;
      s.bike.osc.frequency.setTargetAtTime(110 + abs * 0.55 + wobble, s.ctx.currentTime, 0.06);
      if (s.bike.sub) {
        s.bike.sub.frequency.setTargetAtTime(55 + abs * 0.22, s.ctx.currentTime, 0.06);
        s.bike.subGain.gain.setTargetAtTime(loudness * 0.6, s.ctx.currentTime, 0.06);
      }
    },
    /** Two-tone siren while any cop is close; call every frame. */
    siren(near, dt) {
      if (!s.ctx) return;
      s.siren.gain.gain.setTargetAtTime(near && !s.muted ? LEVEL.siren : 0, s.ctx.currentTime, 0.1);
      if (!near) return;
      alternateAlarm(s.siren, dt, 880, 660, 0.42);
    },
    /** Sharp roadblock alarm: faster and higher than the police siren, so
     * a barricade ahead sounds different from a chase behind. Call every
     * frame with whether a roadblock is near. */
    roadblockSiren(active, dt) {
      if (!s.ctx) return;
      s.roadblock.gain.gain.setTargetAtTime(active && !s.muted ? LEVEL.roadblock : 0, s.ctx.currentTime, 0.08);
      if (!active) return;
      alternateAlarm(s.roadblock, dt, 1180, 880, 0.24);
    },
    shot() {
      thud(0.14, 0.5, 2400);
      blip(180, 0.08, 'square', 0.2, 60);
    },
    punch() {
      thud(0.09, 0.35, 500);
    },
    pickup() {
      twoNotes(
        { freq: 660, dur: 0.09, type: 'sine', vol: 0.25 },
        { freq: 990, dur: 0.14, type: 'sine', vol: 0.22 },
        0,
      );
    },
    /** Bright three-note chime when a courier package is collected. */
    courierChime() {
      blip(784, 0.09, 'sine', 0.26);
      setTimeout(() => blip(988, 0.09, 'sine', 0.26), 90);
      setTimeout(() => blip(1319, 0.16, 'sine', 0.24), 180);
    },
    /** Short rising blip for the difficulty-select menu. */
    difficultyBlip() {
      blip(440, 0.07, 'triangle', 0.22, 660);
    },
    crash() {
      thud(0.3, 0.5, 900);
      blip(90, 0.25, 'sine', 0.4, 40);
    },
    coin() {
      twoNotes(
        { freq: 880, dur: 0.07, type: 'sine', vol: 0.2 },
        { freq: 1320, dur: 0.1, type: 'sine', vol: 0.18 },
        0,
      );
    },
    /** Little two-note chime when a mission step lands. */
    jingle() {
      twoNotes(
        { freq: 523, dur: 0.12, type: 'triangle', vol: 0.28 },
        { freq: 784, dur: 0.2, type: 'triangle', vol: 0.28 },
        120,
      );
    },
    /** Sad slide for getting busted or wasted. */
    fail() {
      blip(330, 0.5, 'sawtooth', 0.2, 110);
    },
    /** Start the bassline loop; it schedules itself. */
    musicStart() {
      if (!s.ctx || s.music.timer) return;
      const playStep = () => {
        if (!s.muted) {
          blip(BASSLINE[s.music.step % BASSLINE.length], BASS_STEP_SECONDS * 0.9, 'triangle', 0.16);
        }
        s.music.step += 1;
        s.music.timer = setTimeout(playStep, BASS_STEP_SECONDS * 1000);
      };
      playStep();
    },
  };
}
