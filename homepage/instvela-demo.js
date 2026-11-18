import { PianoRoll, midiNoteName } from "@instvela/pianoroll.js";
import { loadDemoConfig, readRenderDefaults } from "@instvela/core/config.js";
import { prepareM01Input } from "@instvela/core/midi.js";
import { requestFromScore, normalizeMonophony } from "@instvela/core/features.js";
import { renderHall } from "@instvela/core/reverb.js";
import RendererWorker from "@instvela/worker.js?worker";
import violinMidi from "@instvela-songs/violin-demo-01-short.mid?url";
import { getInstvelaModelUrl } from "./instvela-models.js";

// Read the full demo's defaults without creating settings controls.
const numericFields = [
  "seed", "pitchExpression", "transpose", "stepsF0", "stepsAc", "cfgF0", "cfgAc",
  "windowSeconds", "knownPrefixSeconds", "vocoderChunkSeconds", "vocoderContextSeconds", "threads",
];
const renderFields = [
  { key: "pitchMap", type: "pitchmap" },
  { key: "barOriginBeats", configKey: "pre_roll_beats", label: "Pre-roll", type: "number" },
  { key: "tailSeconds", configKey: "tail", label: "Tail", type: "number" },
  { key: "useVelocity", type: "select", options: [["auto"], ["on"], ["off"]] },
  { key: "format", type: "select", options: [["mp3"], ["wav"]] },
  { key: "device", type: "select", options: [["auto"], ["wasm"]] },
  ...numericFields.map((key) => ({ key, label: key, type: "number" })),
];

export async function mountViolinDemo(root) {
  const base = new URL(import.meta.env.BASE_URL, location.href);
  const config = await loadDemoConfig(new URL("config.json", base));
  const model = config.models.find((entry) => entry.model === "m01-violin-onnx-v1");
  if (!model) throw new Error("The violin model is missing from the demo configuration.");
  const settings = readRenderDefaults(model, renderFields);
  const response = await fetch(violinMidi);
  if (!response.ok) throw new Error(`The violin phrase returned HTTP ${response.status}.`);
  const midi = prepareM01Input(new Uint8Array(await response.arrayBuffer()), {
    keyswitches: model.keyswitches, range: model.range, pitchMap: settings.pitchMap,
  });
  const useVelocity = settings.useVelocity === "auto" ? null : settings.useVelocity === "on";
  const score = requestFromScore(midi.score, model.keyswitches, settings.barOriginBeats, useVelocity, model.instrument);
  const { notes, edits } = normalizeMonophony(score.notes, score.tempo_bpm, config.midi.min_cropped_note_seconds);
  let request = { ...score, notes };
  const find = (selector) => root.querySelector(selector);
  const button = find("#render-violin");
  const buttonLabel = button.querySelector("span");
  const status = find("#demo-status");
  const progress = find("#demo-progress");
  const output = find("#demo-output");
  const player = find("#demo-audio");
  const canvas = find("#demo-canvas");
  const roll = new PianoRoll(find("#demo-roll"), find("#demo-spacer"), canvas, config.piano_roll.zoom);
  let worker = null, ready = false, busy = false, rendered = false;
  let job = 0, activeJob = null, audioUrl = null, playFrame = null, selectedNote = 0;

  find("#demo-metadata").textContent = `${notes.length} notes · ${request.tempo_bpm} BPM · ${request.time_signature.join("/")}`;

  function clearAudio() {
    cancelAnimationFrame(playFrame);
    player.pause();
    player.removeAttribute("src");
    player.load();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = null;
    output.hidden = true;
    roll.setPlayhead(0);
  }

  function setState(state, message) {
    root.dataset.state = state;
    status.textContent = message;
    busy = state === "loading" || state === "rendering";
    button.disabled = busy || rendered;
    buttonLabel.textContent = state === "loading" ? "Loading violin…" : state === "rendering" ? "Rendering…" : state === "error" ? "Try again" : "Render violin";
    progress.hidden = !busy;
    if (roll.data) roll.data.onPitchChange = busy ? null : movePitch;
  }

  function movePitch(index, pitch) {
    pitch = Math.max(model.range[0], Math.min(model.range[1], pitch));
    selectedNote = index;
    const moved = request.notes.map((note, i) => i === index ? { ...note, pitch } : note);
    if (request.notes[index].pitch !== pitch) {
      request = { ...request, notes: moved };
      rendered = false;
      clearAudio();
      setState("ready", `Note moved to ${midiNoteName(pitch)}. Render to hear your change.`);
    }
    return moved;
  }

  roll.set({ notes, edits, tempo: score.tempo_bpm, timeSignature: score.time_signature,
    barOrigin: score.bar_origin_beats, tail: settings.tailSeconds + config.audio.reverb.tail_seconds,
    onPitchChange: movePitch,
  });
  setState("ready", "Make a change, or hear the original phrase.");

  // Pointer and touch editing come from the original piano roll. Keyboard editing
  // changes the same pitch field, preserving timing, velocity, and articulation.
  canvas.addEventListener("keydown", (event) => {
    if (busy || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "ArrowLeft") selectedNote = Math.max(0, selectedNote - 1);
    else if (event.key === "ArrowRight") selectedNote = Math.min(request.notes.length - 1, selectedNote + 1);
    else {
      roll.data.notes = movePitch(selectedNote, request.notes[selectedNote].pitch + (event.key === "ArrowUp" ? 1 : -1));
      roll.draw();
    }
    const note = request.notes[selectedNote];
    roll.scroller.scrollLeft = Math.max(0, note.start * 60 / request.tempo_bpm * roll.pxPerSec - roll.scroller.clientWidth / 2);
    roll.scroller.scrollTop = Math.max(0, (roll.hi - note.pitch) * roll.rowH - roll.scroller.clientHeight / 2);
    status.textContent = `Note ${selectedNote + 1} of ${request.notes.length}: ${midiNoteName(note.pitch)}. Up or down changes its pitch.`;
  });

  function fail(message) {
    worker?.terminate();
    worker = null;
    ready = false;
    activeJob = null;
    rendered = false;
    setState("error", `Could not render this take. ${message}`);
  }

  function generate() {
    activeJob = ++job;
    progress.value = .15;
    setState("rendering", "Shaping the performance…");
    worker.postMessage({ type: "generate", id: activeJob, request, settings, midi: config.midi, audio: config.audio });
  }

  async function applyReverb(message) {
    try {
      const stereo = await renderHall(message.wave, message.sampleRate,
        new URL(config.audio.reverb.impulse_response, base), config.audio.reverb);
      message.port.postMessage(stereo, [stereo.left.buffer, stereo.right.buffer]);
    } catch (error) {
      message.port.postMessage({ error: error.message });
    } finally {
      message.port.close();
    }
  }

  const stages = ["features", "F0 generator", "acoustic generator", "vocoder", "encode"];
  const weights = [.01, .36, .36, .23, .04];
  const messages = ["Reading your notes…", "Shaping the performance…", "Giving the notes a voice…", "Rendering the strings…", "Finishing your audio…"];
  function onMessage(event) {
    if (event.currentTarget !== worker) { event.data.port?.close(); return; }
    const message = event.data;
    if (message.type === "ready") {
      if (message.constants?.instrument && message.constants.instrument !== model.instrument) return fail("The violin model did not match.");
      ready = true;
      generate();
    } else if (message.type === "progress") {
      const fraction = message.total ? message.done / message.total : 0;
      if (!ready) progress.value = fraction * .15;
      else {
        const index = stages.indexOf(message.stage);
        if (index >= 0) {
          progress.value = .15 + .85 * (weights.slice(0, index).reduce((a, b) => a + b, 0) + weights[index] * fraction);
          status.textContent = messages[index];
        }
      }
    } else if (message.type === "reverb") void applyReverb(message);
    else if (message.type === "error") fail(message.message);
    else if (message.type === "result" && message.id === activeJob) {
      activeJob = null;
      rendered = true;
      audioUrl = URL.createObjectURL(new Blob([message.audio], { type: message.mime }));
      player.src = audioUrl;
      output.hidden = false;
      find("#demo-audio-info").textContent = `${message.info.audio_seconds.toFixed(1)} seconds · Stereo · Rendered on your device`;
      setState("done", "Your take is ready. Press play to hear it.");
    }
  }

  button.addEventListener("click", () => {
    if (busy || rendered) return;
    clearAudio();
    progress.value = 0;
    if (ready && worker) return generate();
    setState("loading", "Loading the violin model. The first render takes a moment.");
    try {
      worker = new RendererWorker({ name: "instvela-homepage" });
      worker.onmessage = onMessage;
      worker.onerror = (event) => { if (event.currentTarget === worker) fail(event.message || "Please try again."); };
      worker.postMessage({ type: "init", modelsUrl: getInstvelaModelUrl(model.model),
        ortUrl: new URL("ort/ort.all.min.mjs", base).href,
        threads: self.crossOriginIsolated ? (settings.threads || Math.min(config.runtime.max_auto_threads, navigator.hardwareConcurrency || 1)) : 1,
        preferWebgpu: settings.device !== "wasm",
      });
    } catch (error) { fail(error.message); }
  });

  player.addEventListener("play", () => {
    cancelAnimationFrame(playFrame);
    const tick = () => { roll.setPlayhead(player.currentTime, true); playFrame = requestAnimationFrame(tick); };
    tick();
  });
  for (const type of ["pause", "ended", "seeked"]) player.addEventListener(type, () => {
    if (type !== "seeked") cancelAnimationFrame(playFrame);
    roll.setPlayhead(player.currentTime, type === "seeked");
  });
  window.addEventListener("pagehide", () => {
    worker?.terminate();
    worker = null;
    ready = false;
    rendered = false;
    clearAudio();
    setState("ready", "Make a change, or hear the original phrase.");
  });
}
