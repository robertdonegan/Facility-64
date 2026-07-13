/* Shared music-track system.
   Loaded by the browser (window.MUSIC) AND required by server.js, same pattern as level.js.

   A track is plain data:
     { name, bpm, steps, channels:[
         { role:'lead',  notes:[midi|null, ...] },   // monophonic synth line
         { role:'bass',  notes:[midi|null, ...] },
         { role:'kick',  hits:[0|1, ...] },           // drum hit grid
         { role:'snare', hits:[0|1, ...] },
         { role:'hat',   hits:[0|1, ...] },
       ] }
   validateTrack(data) sanitizes untrusted JSON. createSequencer(track, ctx, dest) schedules
   playback on a real Web Audio context — pure functions, given a ctx, so this module has no
   direct dependency on `window` and stays require()-able from server.js for validation only. */
(function (root) {

  const ROLES = ['lead', 'bass', 'kick', 'snare', 'hat'];
  const LIMITS = { stepsAllowed: [8, 16, 32], bpmMin: 60, bpmMax: 220, nameLen: 16, noteMin: 24, noteMax: 96 };

  /* Default soundtrack: a 96bpm D-minor thriller crawl — heartbeat kick pairs,
     a sparse lead leaning on semitone and tritone tension, bass ostinato.
     The original FACILITY THEME still ships as music/FACILITYTHEME.json. */
  const DEFAULT_TRACK = {
    name: 'SHADOW PROTOCOL', bpm: 96, steps: 32,
    channels: [
      { role: 'lead', notes: [
        74, null, null, null, null, null, null, 75, null, null, 74, null, null, null, null, null,
        69, null, null, 68, null, null, 69, null, 77, null, 76, null, null, null, 74, null] },
      { role: 'bass', notes: [
        38, null, null, null, null, null, 38, null, 36, null, null, null, null, null, 34, null,
        38, null, null, null, null, null, 38, null, 41, null, null, null, 33, null, 36, null] },
      { role: 'kick', hits: [
        1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0,
        1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0] },
      { role: 'snare', hits: [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1] },
      { role: 'hat', hits: [
        0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1,
        0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0] },
    ],
  };

  /* Validate untrusted track data. Returns { ok, error?, clean? }. */
  function validateTrack(data) {
    const fail = (error) => ({ ok: false, error });
    if (!data || typeof data !== 'object') return fail('track must be an object');
    const bpm = +data.bpm;
    if (!isFinite(bpm) || bpm < LIMITS.bpmMin || bpm > LIMITS.bpmMax) {
      return fail(`bpm must be ${LIMITS.bpmMin}-${LIMITS.bpmMax}`);
    }
    const steps = +data.steps;
    if (!LIMITS.stepsAllowed.includes(steps)) return fail('steps must be 8, 16, or 32');
    const name = String(data.name || 'UNTITLED').toUpperCase().replace(/[^A-Z0-9 _-]/g, '').slice(0, LIMITS.nameLen) || 'UNTITLED';

    if (!Array.isArray(data.channels)) return fail('channels must be an array');
    const channels = [];
    for (const role of ROLES) {
      const src = data.channels.find(c => c && c.role === role);
      if (!src) return fail('missing channel: ' + role);
      if (role === 'kick' || role === 'snare' || role === 'hat') {
        if (!Array.isArray(src.hits) || src.hits.length !== steps) return fail(`${role} hits must be an array of length ${steps}`);
        channels.push({ role, hits: src.hits.map(h => h ? 1 : 0) });
      } else {
        if (!Array.isArray(src.notes) || src.notes.length !== steps) return fail(`${role} notes must be an array of length ${steps}`);
        const notes = src.notes.map(n => {
          if (n === null || n === undefined) return null;
          const v = Math.round(+n);
          if (!isFinite(v) || v < LIMITS.noteMin || v > LIMITS.noteMax) return null;
          return v;
        });
        channels.push({ role, notes });
      }
    }
    return { ok: true, clean: { name, bpm, steps, channels } };
  }

  /* ---- synthesis (pure given a Web Audio context; no `window` reference) ---- */
  function midiToFreq(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

  function playSynthNote(ctx, dest, t, midi, wave, dur) {
    const o = ctx.createOscillator(); o.type = wave;
    o.frequency.setValueAtTime(midiToFreq(midi), t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(wave === 'triangle' ? 0.5 : 0.28, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function playNoiseHit(ctx, dest, t, tone) {
    const dur = tone === 'low' ? 0.22 : tone === 'mid' ? 0.16 : 0.06;
    const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, tone === 'low' ? 1.6 : 2.4);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = tone === 'low' ? 'lowpass' : tone === 'mid' ? 'bandpass' : 'highpass';
    filt.frequency.value = tone === 'low' ? 150 : tone === 'mid' ? 900 : 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(tone === 'low' ? 0.55 : tone === 'mid' ? 0.35 : 0.16, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(g).connect(dest);
    src.start(t);
  }

  /* Lookahead step scheduler — the standard pattern for tight Web Audio timing.
     Returns { start(), stop(), get running(), get step() }. */
  function createSequencer(track, ctx, dest) {
    const stepDur = 60 / track.bpm / 4; // one step = a 16th note
    let running = false, step = 0, nextTime = 0, timer = null;

    function scheduleStep(t, idx) {
      for (const ch of track.channels) {
        if (ch.hits) {
          if (ch.hits[idx]) playNoiseHit(ctx, dest, t, ch.role === 'kick' ? 'low' : ch.role === 'snare' ? 'mid' : 'high');
        } else {
          const note = ch.notes[idx];
          if (note != null) playSynthNote(ctx, dest, t, note, ch.role === 'bass' ? 'triangle' : 'square', stepDur * 0.9);
        }
      }
    }
    function tick() {
      while (nextTime < ctx.currentTime + 0.12) {
        scheduleStep(nextTime, step);
        step = (step + 1) % track.steps;
        nextTime += stepDur;
      }
    }
    return {
      start() {
        if (running) return;
        running = true; step = 0; nextTime = ctx.currentTime + 0.05;
        tick();
        timer = setInterval(tick, 25);
      },
      stop() { running = false; if (timer) clearInterval(timer); timer = null; },
      get running() { return running; },
      get step() { return step; },
    };
  }

  const MUSIC = { ROLES, LIMITS, DEFAULT_TRACK, validateTrack, createSequencer, playSynthNote, playNoiseHit };
  if (typeof module !== 'undefined' && module.exports) module.exports = MUSIC;
  else root.MUSIC = MUSIC;
})(typeof self !== 'undefined' ? self : this);
