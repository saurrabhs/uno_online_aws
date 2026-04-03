'use strict';

/**
 * UNO Sound Engine — Web Audio API, zero external files
 * All sounds synthesized programmatically
 */

const SoundEngine = (() => {
  let ctx = null;
  let enabled = true;
  let masterGain = null;

  function init() {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.6;
      masterGain.connect(ctx.destination);
    } catch (e) {
      console.warn('Web Audio not supported');
    }
  }

  function resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  // ── Core helpers ────────────────────────────────────────────────────────────

  function osc(type, freq, startTime, duration, gainVal = 0.3, detune = 0) {
    if (!ctx || !enabled) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    g.gain.setValueAtTime(gainVal, startTime);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    o.connect(g);
    g.connect(masterGain);
    o.start(startTime);
    o.stop(startTime + duration + 0.01);
  }

  function noise(startTime, duration, gainVal = 0.15, filterFreq = 2000) {
    if (!ctx || !enabled) return;
    const bufSize = ctx.sampleRate * duration;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq;
    filter.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainVal, startTime);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    src.connect(filter);
    filter.connect(g);
    g.connect(masterGain);
    src.start(startTime);
    src.stop(startTime + duration + 0.01);
  }

  // ── Sound definitions ────────────────────────────────────────────────────────

  function playCardFlip() {
    init(); resume();
    const t = ctx.currentTime;
    noise(t, 0.06, 0.12, 3000);
    noise(t + 0.02, 0.04, 0.08, 5000);
    osc('sine', 800, t, 0.05, 0.08);
  }

  function playCardDraw() {
    init(); resume();
    const t = ctx.currentTime;
    noise(t, 0.08, 0.1, 2500);
    osc('sine', 600, t, 0.06, 0.06);
    osc('sine', 500, t + 0.03, 0.05, 0.04);
  }

  function playCardPlay() {
    init(); resume();
    const t = ctx.currentTime;
    // Satisfying thud + swish
    noise(t, 0.05, 0.18, 1500);
    osc('sine', 300, t, 0.08, 0.15);
    osc('sine', 450, t + 0.02, 0.06, 0.1);
    noise(t + 0.03, 0.07, 0.1, 4000);
  }

  function playInvalidCard() {
    init(); resume();
    const t = ctx.currentTime;
    osc('sawtooth', 200, t, 0.1, 0.15);
    osc('sawtooth', 180, t + 0.05, 0.1, 0.12);
    osc('sawtooth', 160, t + 0.1, 0.1, 0.1);
  }

  function playSkip() {
    init(); resume();
    const t = ctx.currentTime;
    osc('square', 600, t, 0.08, 0.12);
    osc('square', 400, t + 0.1, 0.1, 0.1);
    noise(t, 0.05, 0.06, 3000);
  }

  function playReverse() {
    init(); resume();
    const t = ctx.currentTime;
    // Whoosh up then down
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(300, t);
    o.frequency.linearRampToValueAtTime(800, t + 0.15);
    o.frequency.linearRampToValueAtTime(300, t + 0.3);
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g); g.connect(masterGain);
    o.start(t); o.stop(t + 0.36);
    noise(t + 0.05, 0.2, 0.06, 2000);
  }

  function playDrawTwo() {
    init(); resume();
    const t = ctx.currentTime;
    noise(t, 0.06, 0.12, 2000);
    noise(t + 0.08, 0.06, 0.12, 2000);
    osc('sine', 400, t, 0.06, 0.1);
    osc('sine', 350, t + 0.08, 0.06, 0.1);
  }

  function playWild() {
    init(); resume();
    const t = ctx.currentTime;
    // Rainbow arpeggio
    const notes = [523, 659, 784, 1047];
    notes.forEach((freq, i) => {
      osc('sine', freq, t + i * 0.07, 0.12, 0.12);
    });
    noise(t, 0.1, 0.05, 3000);
  }

  function playWildDrawFour() {
    init(); resume();
    const t = ctx.currentTime;
    // Dramatic ascending + 4 card sounds
    const notes = [262, 330, 392, 523];
    notes.forEach((freq, i) => {
      osc('sawtooth', freq, t + i * 0.06, 0.15, 0.1);
      noise(t + i * 0.06, 0.05, 0.08, 2000);
    });
    osc('sine', 1047, t + 0.3, 0.2, 0.15);
  }

  function playUnoCall() {
    init(); resume();
    const t = ctx.currentTime;
    // "UNO!" — punchy announcement
    osc('square', 880, t, 0.08, 0.2);
    osc('square', 1100, t + 0.06, 0.1, 0.25);
    osc('sine', 1320, t + 0.14, 0.15, 0.2);
    noise(t, 0.05, 0.1, 4000);
  }

  function playUnoPenalty() {
    init(); resume();
    const t = ctx.currentTime;
    // Descending "caught!" sound
    osc('sawtooth', 400, t, 0.1, 0.15);
    osc('sawtooth', 300, t + 0.08, 0.1, 0.12);
    osc('sawtooth', 200, t + 0.16, 0.12, 0.1);
    noise(t, 0.08, 0.1, 1500);
  }

  function playTurnStart() {
    init(); resume();
    const t = ctx.currentTime;
    // Soft "your turn" ping
    osc('sine', 660, t, 0.1, 0.12);
    osc('sine', 880, t + 0.08, 0.08, 0.1);
  }

  function playTimerWarning() {
    init(); resume();
    const t = ctx.currentTime;
    osc('sine', 440, t, 0.06, 0.08);
  }

  function playTimerUrgent() {
    init(); resume();
    const t = ctx.currentTime;
    osc('square', 660, t, 0.05, 0.12);
  }

  function playWin() {
    init(); resume();
    const t = ctx.currentTime;
    // Victory fanfare
    const melody = [523, 659, 784, 1047, 784, 1047, 1319];
    melody.forEach((freq, i) => {
      osc('sine', freq, t + i * 0.1, 0.18, 0.18);
      if (i % 2 === 0) osc('triangle', freq * 0.5, t + i * 0.1, 0.18, 0.08);
    });
    // Chord at end
    [1047, 1319, 1568].forEach(f => osc('sine', f, t + 0.75, 0.4, 0.12));
  }

  function playLose() {
    init(); resume();
    const t = ctx.currentTime;
    // Sad descending
    const notes = [523, 440, 392, 330, 262];
    notes.forEach((freq, i) => {
      osc('sine', freq, t + i * 0.12, 0.2, 0.12);
    });
  }

  function playGameStart() {
    init(); resume();
    const t = ctx.currentTime;
    // Exciting game start
    const notes = [392, 523, 659, 784, 1047];
    notes.forEach((freq, i) => {
      osc('square', freq, t + i * 0.08, 0.12, 0.1);
      osc('sine', freq, t + i * 0.08, 0.12, 0.08);
    });
    noise(t + 0.35, 0.15, 0.08, 3000);
  }

  function playPlayerJoin() {
    init(); resume();
    const t = ctx.currentTime;
    osc('sine', 523, t, 0.08, 0.1);
    osc('sine', 659, t + 0.07, 0.08, 0.1);
  }

  function playChat() {
    init(); resume();
    const t = ctx.currentTime;
    osc('sine', 880, t, 0.04, 0.06);
    osc('sine', 1100, t + 0.03, 0.04, 0.05);
  }

  function playChallenge() {
    init(); resume();
    const t = ctx.currentTime;
    // Tense challenge sound
    osc('sawtooth', 220, t, 0.15, 0.15);
    osc('sawtooth', 277, t + 0.05, 0.12, 0.12);
    osc('sawtooth', 330, t + 0.1, 0.1, 0.1);
    noise(t, 0.12, 0.08, 1000);
  }

  // ── Volume control ───────────────────────────────────────────────────────────

  function setVolume(vol) {
    if (masterGain) masterGain.gain.value = Math.max(0, Math.min(1, vol));
  }

  function toggle() {
    enabled = !enabled;
    return enabled;
  }

  function isEnabled() { return enabled; }

  return {
    playCardFlip, playCardDraw, playCardPlay, playInvalidCard,
    playSkip, playReverse, playDrawTwo, playWild, playWildDrawFour,
    playUnoCall, playUnoPenalty, playTurnStart, playTimerWarning,
    playTimerUrgent, playWin, playLose, playGameStart, playPlayerJoin,
    playChat, playChallenge,
    setVolume, toggle, isEnabled, init, resume
  };
})();

window.SoundEngine = SoundEngine;
