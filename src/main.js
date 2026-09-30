/**
 * Pitch-Synchronous Spectrogram Studio
 * Pure JavaScript with ES Modules. No Frameworks.
 */

import './index.css';
import { generateSpectrograms } from './dsp/spectrogram.js';
import {
  recordTwoSecondsAudio,
  loadAudioFile,
  generateSyntheticAudio,
  AudioPlaybackController
} from './audio/recorder.js';
import { SpectrogramRenderer } from './render/spectrogram-renderer.js';
import { SliceRenderer } from './render/slice-renderer.js';

// Application State
const state = {
  audioBuffer: null,
  sampleRate: 48000,
  spectrograms: null,
  isRecording: false,
  isPlaying: false,
  selectedTime: 0.5,
  maxFreq: 8000,
  colormap: 'inferno',
  minDb: -80,
  maxDb: 0,
  showPitchTrack: true,
  pitchDetector: 'folded-hamming-fft', // 'folded-hamming-fft' | 'hamming-fft' | 'yin'
  folding: false,
  renderers: [],
  sliceRenderer: null,
  activePreset: 'vibrato',
  cursorInfo: {
    active: false,
    time: 0,
    freq: 0
  }
};

const playback = new AudioPlaybackController();
let isInitialized = false;

// DOM Container
const root = document.getElementById('app');

/**
 * Initialize application UI and event listeners
 */
function init() {
  if (isInitialized) return;
  isInitialized = true;

  renderLayout();
  bindEvents();

  // Allow DOM layout pass to compute accurate element bounding boxes
  requestAnimationFrame(() => {
    loadPreset('vibrato');
    setupResizeObserver();
  });
}

function setupResizeObserver() {
  const container = document.getElementById('spectrograms-section');
  if (container && window.ResizeObserver) {
    const observer = new ResizeObserver(() => {
      handleWindowResize();
    });
    observer.observe(container);
  }
  window.addEventListener('resize', handleWindowResize);
}

/**
 * Builds the pure HTML/CSS structural layout
 */
function renderLayout() {
  root.innerHTML = `
    <!-- Top Bar Contract: Brand, Links, Action -->
    <header class="flex items-center justify-between px-6 py-3.5 bg-slate-900/80 backdrop-blur border-b border-slate-800 shrink-0 sticky top-0 z-30">
      <div class="flex items-center gap-3">
        <div class="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)]"></div>
        <a href="#" class="text-base font-semibold tracking-tight text-white select-none">
          Pitch-Synchronous Spectrogram Studio
        </a>
      </div>

      <nav class="hidden md:flex items-center gap-6 text-xs font-medium text-slate-400">
        <a href="#spectrograms-section" class="hover:text-cyan-400 transition-colors">Spectrograms</a>
        <a href="#slice-section" class="hover:text-cyan-400 transition-colors">Slice Inspector</a>
        <a href="#dsp-theory" class="hover:text-cyan-400 transition-colors">DSP Theory & Scaling</a>
      </nav>

      <div class="flex items-center gap-2">
        <input type="file" id="input-audio-file" accept="audio/*" class="hidden">
        <button id="btn-upload" class="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 active:scale-95 border border-slate-700 transition-all rounded-md shadow-sm whitespace-nowrap cursor-pointer">
          <svg class="w-3.5 h-3.5 text-cyan-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
          </svg>
          <span>Upload Audio File</span>
        </button>

        <button id="btn-record" class="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 active:scale-95 transition-all rounded-md shadow-sm whitespace-nowrap cursor-pointer">
          <svg class="w-3.5 h-3.5 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" />
          </svg>
          <span id="btn-record-text">Record Audio (2s)</span>
        </button>
      </div>
    </header>

    <!-- Recording Overlay Modal -->
    <div id="recording-modal" class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 hidden flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-slate-700/80 rounded-xl p-6 max-w-md w-full shadow-2xl flex flex-col items-center text-center">
        <div class="w-14 h-14 rounded-full bg-rose-500/20 text-rose-500 flex items-center justify-center mb-4 ring-8 ring-rose-500/10 animate-pulse">
          <svg class="w-7 h-7" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 10v2a7 7 0 01-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
        </div>
        <h3 class="text-lg font-semibold text-white mb-1">Recording 2 Seconds</h3>
        <p class="text-xs text-slate-400 mb-4">Please hum, sing a steady pitch, or speak into your microphone.</p>
        
        <!-- Progress Bar -->
        <div class="w-full bg-slate-800 rounded-full h-2 mb-3 overflow-hidden border border-slate-700">
          <div id="rec-progress-bar" class="bg-rose-500 h-2 w-0 transition-all duration-75"></div>
        </div>

        <!-- Level Meter -->
        <div class="w-full flex items-center justify-between text-[11px] font-mono text-slate-400 mb-1">
          <span>Mic Input Level</span>
          <span id="rec-time-left" class="tabular-nums text-rose-400 font-semibold">2.0s</span>
        </div>
        <div class="w-full bg-slate-800/80 rounded h-1.5 overflow-hidden mb-4">
          <div id="rec-level-meter" class="bg-emerald-400 h-1.5 w-0 transition-all duration-75"></div>
        </div>

        <button id="btn-rec-cancel" class="text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded border border-slate-700 hover:bg-slate-800 transition-colors cursor-pointer">
          Cancel Recording
        </button>
      </div>
    </div>

    <!-- Microphone / Audio Error Modal (Persistent until explicitly dismissed) -->
    <div id="mic-error-modal" class="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-50 hidden flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-rose-800/80 rounded-xl p-6 max-w-lg w-full shadow-2xl flex flex-col items-center text-center ring-1 ring-rose-500/30">
        <div class="w-14 h-14 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mb-4 ring-8 ring-rose-500/10">
          <svg class="w-7 h-7" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
        </div>
        <h3 class="text-base font-semibold text-white mb-2">Microphone Access Error</h3>
        <div id="mic-error-message" class="text-xs text-rose-300 bg-rose-950/50 border border-rose-900/70 rounded p-3 mb-4 text-left w-full font-mono break-words leading-relaxed">
          Error details will appear here.
        </div>
        <div class="text-[11px] text-slate-400 text-left w-full space-y-1.5 mb-5 bg-slate-950/60 p-3 rounded border border-slate-800">
          <div class="font-semibold text-slate-200">How to resolve:</div>
          <div>1. <span class="text-slate-300 font-medium">Browser Permissions:</span> Click the lock / microphone icon in your browser address bar next to the URL, and switch Microphone to <strong class="text-emerald-400">Allow</strong>.</div>
          <div>2. <span class="text-slate-300 font-medium">Iframe Restrictions:</span> Browsers frequently block microphone hardware inside embedded iframes for security. You can click <strong class="text-cyan-400">Upload Audio File</strong> to test any real recording or voice clip from your device.</div>
          <div>3. <span class="text-slate-300 font-medium">Built-In Presets:</span> You can also test the 4 spectrogram algorithms using the high-fidelity sound presets below (Vibrato, Vocal, Chirp, Chord).</div>
        </div>
        <div class="flex flex-wrap items-center justify-center gap-3 w-full">
          <button id="btn-error-upload" class="px-3.5 py-2 text-xs font-semibold text-white bg-cyan-600 hover:bg-cyan-500 rounded-md cursor-pointer transition-all">
            Upload Audio File
          </button>
          <button id="btn-error-preset" class="px-3.5 py-2 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-md cursor-pointer transition-all">
            Load Vibrato Sample
          </button>
          <button id="btn-error-dismiss" class="px-3.5 py-2 text-xs font-medium text-slate-400 hover:text-white border border-slate-700 hover:bg-slate-800 rounded-md cursor-pointer transition-all">
            Dismiss
          </button>
        </div>
      </div>
    </div>

    <!-- Main Workspace Container -->
    <main class="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 flex flex-col gap-6">

      <!-- Workbench Controls Bar -->
      <section class="bg-slate-900 border border-slate-800 rounded-lg p-3 sm:p-4 flex flex-wrap items-center justify-between gap-4">
        
        <!-- Left: Audio Playback & Sample Presets -->
        <div class="flex flex-wrap items-center gap-3">
          <button id="btn-play-pause" class="inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-700 rounded transition-colors cursor-pointer">
            <svg id="play-icon" class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            <span id="play-btn-text">Play Audio</span>
          </button>

          <div class="h-4 w-px bg-slate-800 hidden sm:block"></div>

          <!-- Reference Presets -->
          <div class="flex items-center gap-1">
            <span class="text-xs text-slate-400 mr-1 hidden sm:inline">Presets:</span>
            <button data-preset="vibrato" class="preset-btn px-2.5 py-1 text-xs font-medium rounded transition-colors border border-slate-700 bg-cyan-950/60 text-cyan-300 border-cyan-800 cursor-pointer">
              Flute 440Hz Vibrato
            </button>
            <button data-preset="vocal" class="preset-btn px-2.5 py-1 text-xs font-medium rounded transition-colors border border-slate-800 bg-slate-800/60 text-slate-400 hover:text-slate-200 cursor-pointer">
              Vocal Formant
            </button>
            <button data-preset="chord" class="preset-btn px-2.5 py-1 text-xs font-medium rounded transition-colors border border-slate-800 bg-slate-800/60 text-slate-400 hover:text-slate-200 cursor-pointer">
              Harmonic Chord
            </button>
            <button data-preset="chirp" class="preset-btn px-2.5 py-1 text-xs font-medium rounded transition-colors border border-slate-800 bg-slate-800/60 text-slate-400 hover:text-slate-200 cursor-pointer">
              Chirp Sweep
            </button>
          </div>
        </div>

        <!-- Right: Spectrogram Visualization Parameters -->
        <div class="flex flex-wrap items-center gap-4 text-xs">
          <!-- Pitch Detection Engine Selector -->
          <div class="flex items-center gap-1.5">
            <label for="select-pitch-detector" class="text-slate-400">Pitch Engine:</label>
            <select id="select-pitch-detector" class="bg-slate-950 border border-slate-700 text-cyan-300 font-medium rounded px-2 py-1 text-xs focus:outline-none focus:border-cyan-500 cursor-pointer">
              <option value="folded-hamming-fft" selected>Harmonic-Folded Hamming-FFT (Peak-Picked)</option>
              <option value="hamming-fft">Hamming-FFT + HPS + Phase Match</option>
              <option value="yin">Time-Domain YIN</option>
            </select>
          </div>

          <!-- Max Frequency Band -->
          <div class="flex items-center gap-1.5">
            <label for="select-freq" class="text-slate-400">Freq Span:</label>
            <select id="select-freq" class="bg-slate-950 border border-slate-700 text-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-cyan-500 cursor-pointer">
              <option value="2000">0 - 2,000 Hz</option>
              <option value="4000">0 - 4,000 Hz</option>
              <option value="8000" selected>0 - 8,000 Hz (Optimal)</option>
              <option value="16000">0 - 16,000 Hz</option>
              <option value="24000">0 - Nyquist (24 kHz)</option>
            </select>
          </div>

          <!-- Colormap -->
          <div class="flex items-center gap-1.5">
            <label for="select-colormap" class="text-slate-400">Palette:</label>
            <select id="select-colormap" class="bg-slate-950 border border-slate-700 text-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-cyan-500 cursor-pointer">
              <option value="inferno" selected>Inferno</option>
              <option value="viridis">Viridis</option>
              <option value="turbo">Turbo</option>
            </select>
          </div>

          <!-- Dynamic Range dB Slider -->
          <div class="flex items-center gap-2">
            <span class="text-slate-400">Range:</span>
            <input id="slider-mindb" type="range" min="-120" max="-40" value="-80" step="5" class="w-20 accent-cyan-500 cursor-pointer">
            <span id="label-mindb" class="font-mono text-slate-300 w-12 text-right tabular-nums">-80 dB</span>
          </div>

          <!-- Pitch Track Overlay Toggle -->
          <label class="flex items-center gap-1.5 text-slate-300 cursor-pointer select-none">
            <input type="checkbox" id="toggle-pitch-track" checked class="rounded accent-cyan-500 cursor-pointer">
            <span>F0 Track Overlay</span>
          </label>

          <!-- Harmonic Folding View Toggle Button -->
          <button id="btn-toggle-folding" class="inline-flex items-center gap-2 px-2.5 py-1 text-xs font-medium rounded transition-all border border-slate-700 bg-slate-800 text-slate-300 hover:text-white cursor-pointer select-none">
            <span id="folding-indicator" class="w-2 h-2 rounded-full bg-slate-500 transition-colors"></span>
            <span>Harmonic Folding</span>
          </button>
        </div>
      </section>

      <!-- Three Spectrograms Display -->
      <section id="spectrograms-section" class="flex flex-col gap-4">
        
        <!-- 1) Rectangular 4096 FFT -->
        <div class="bg-slate-900 border border-slate-800 rounded-lg p-3 sm:p-4 overflow-hidden shadow-sm">
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.6)]"></span>
              <h2 class="text-sm font-semibold text-slate-200">1. Rectangular 4096 FFT (No Windowing)</h2>
            </div>
            <span class="text-xs font-mono text-slate-400">N = 4096 · Spectral Leakage Sidelobes</span>
          </div>
          <div class="relative w-full h-80 sm:h-96 md:h-[380px] bg-slate-950 rounded border border-slate-800/80">
            <canvas id="canvas-rect" class="w-full h-full block cursor-crosshair"></canvas>
          </div>
        </div>

        <!-- 2) Hamming Windowed 4096 FFT -->
        <div class="bg-slate-900 border border-slate-800 rounded-lg p-3 sm:p-4 overflow-hidden shadow-sm">
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.6)]"></span>
              <h2 class="text-sm font-semibold text-slate-200">2. Hamming Windowed 4096 FFT</h2>
            </div>
            <span class="text-xs font-mono text-slate-400">N = 4096 · Tapered Boundary · Mainlobe Broadening</span>
          </div>
          <div class="relative w-full h-80 sm:h-96 md:h-[380px] bg-slate-950 rounded border border-slate-800/80">
            <canvas id="canvas-hamming" class="w-full h-full block cursor-crosshair"></canvas>
          </div>
        </div>

        <!-- 3) Pitch-Dependent Adaptive Window (Time-Stretched) -->
        <div class="bg-slate-900 border border-cyan-800/80 rounded-lg p-3 sm:p-4 overflow-hidden shadow-sm relative ring-1 ring-cyan-500/30">
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)] animate-pulse"></span>
              <h2 class="text-sm font-semibold text-cyan-200">3. Pitch-Dependent Adaptive Window (Time-Stretched)</h2>
            </div>
            <span class="text-xs font-mono text-cyan-400/90 font-medium">Variable M ≤ 4096 · Integer Multiples of Wavelengths · Zero Leakage</span>
          </div>
          <div class="relative w-full h-80 sm:h-96 md:h-[380px] bg-slate-950 rounded border border-cyan-900/60">
            <canvas id="canvas-pitch" class="w-full h-full block cursor-crosshair"></canvas>
          </div>
        </div>

        <!-- 4) Pitch-Dependent Adaptive Window + Hamming Taper -->
        <div class="bg-slate-900 border border-emerald-800/80 rounded-lg p-3 sm:p-4 overflow-hidden shadow-sm relative ring-1 ring-emerald-500/30">
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse"></span>
              <h2 class="text-sm font-semibold text-emerald-200">4. Pitch-Dependent Adaptive Window + Hamming Taper</h2>
            </div>
            <span class="text-xs font-mono text-emerald-400/90 font-medium">Variable M ≤ 4096 · Integer Cycles + Hamming Window Taper · Maximum Sidelobe Suppression</span>
          </div>
          <div class="relative w-full h-80 sm:h-96 md:h-[380px] bg-slate-950 rounded border border-emerald-900/60">
            <canvas id="canvas-pitch-hamming" class="w-full h-full block cursor-crosshair"></canvas>
          </div>
        </div>

      </section>

      <!-- Live Telemetry Readout Bar -->
      <section class="bg-slate-900 border border-slate-800 rounded-lg px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
        <div class="flex items-center gap-4 text-slate-300">
          <div>Time: <span id="telemetry-time" class="text-cyan-400 font-semibold tabular-nums">0.500s</span></div>
          <div>Freq: <span id="telemetry-freq" class="text-cyan-400 font-semibold tabular-nums">440.0Hz</span></div>
          <div>F0 Pitch: <span id="telemetry-f0" class="text-emerald-400 font-semibold tabular-nums">440.0Hz</span></div>
        </div>

        <div class="flex items-center gap-4 text-slate-400">
          <div>Period P: <span id="telemetry-period" class="text-slate-200 tabular-nums">109.1 smp</span></div>
          <div>Cycles k: <span id="telemetry-k" class="text-slate-200 tabular-nums">37</span></div>
          <div>Stretched M: <span id="telemetry-m" class="text-cyan-300 tabular-nums">4036.7 smp</span></div>
          <div>Step Hop: <span id="telemetry-hop" class="text-slate-200 tabular-nums">505 smp</span></div>
        </div>
      </section>

      <!-- Comparative 1D Slice Spectrum Inspector -->
      <section id="slice-section" class="bg-slate-900 border border-slate-800 rounded-lg p-4 sm:p-5 shadow-sm">
        <div class="flex flex-wrap items-center justify-between mb-3 gap-2">
          <div>
            <h2 class="text-sm font-semibold text-slate-200">Frequency Spectrum Cross-Section (Slice Inspector)</h2>
            <p class="text-xs text-slate-400">Click anywhere on the spectrograms to inspect the 1D spectrum at that exact instant.</p>
          </div>
          <div class="flex items-center gap-2 text-xs font-mono">
            <span class="text-slate-400">Inspecting:</span>
            <input id="slider-slice-time" type="range" min="0" max="2" step="0.005" value="0.5" class="w-32 accent-cyan-500 cursor-pointer">
            <span id="label-slice-time" class="text-cyan-400 font-semibold tabular-nums">0.500s</span>
          </div>
        </div>

        <div class="relative w-full h-72 sm:h-80 md:h-[340px] bg-slate-950 rounded border border-slate-800/80">
          <canvas id="canvas-slice" class="w-full h-full block"></canvas>
        </div>
      </section>

      <!-- DSP Theory & Mathematical Scaling Reference -->
      <section id="dsp-theory" class="bg-slate-900/60 border border-slate-800 rounded-lg p-5 text-xs text-slate-300 space-y-4">
        <h3 class="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-cyan-400"></span>
          DSP Deep Dive: Why Hamming Usually Wins & How FFT Pitch Detection Helps
        </h3>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-1">
          <div class="bg-slate-950/60 p-3.5 rounded border border-slate-800/70">
            <div class="font-semibold text-rose-400 mb-1">1. Rectangular 4096 FFT</div>
            <p class="text-slate-400 leading-relaxed">
              Arbitrary 4096-sample slice without integer cycle alignment creates severe phase discontinuity at $x[0]$ vs $x[4095]$, causing heavy $-20\text{ dB/dec}$ sidelobe leakage across all bins.
            </p>
          </div>

          <div class="bg-slate-950/60 p-3.5 rounded border border-slate-800/70">
            <div class="font-semibold text-amber-400 mb-1">2. Hamming 4096 FFT</div>
            <p class="text-slate-400 leading-relaxed">
              Smooth cosine taper forces boundaries to near-zero, unconditionally suppressing leakage sidelobes by $>40\text{ dB}$. Broadens main lobe from 1 bin to ~4 bins.
            </p>
          </div>

          <div class="bg-slate-950/60 p-3.5 rounded border border-cyan-900/40">
            <div class="font-semibold text-cyan-300 mb-1">3. Pitch-Stretched (Rectangular)</div>
            <p class="text-slate-400 leading-relaxed">
              Stretches $M = k \cdot P \le 4096$ integer cycles into 4096 samples without windowing. Yields single-bin peaks, but leaks if $P$ has sub-sample drift over $k$ cycles.
            </p>
          </div>

          <div class="bg-slate-950/60 p-3.5 rounded border border-emerald-900/40">
            <div class="font-semibold text-emerald-300 mb-1">4. Pitch-Stretched + Hamming</div>
            <p class="text-slate-400 leading-relaxed">
              Best of both worlds: aligns harmonic bins using integer cycle stretching ($M = k \cdot P$), while Hamming tapering quenches residual phase drift and leakage floors.
            </p>
          </div>
        </div>

        <div class="bg-slate-950/40 p-4 rounded border border-cyan-900/30 space-y-2 text-[11px] text-slate-400">
          <div class="font-semibold text-cyan-300 text-xs">Pitch Detection Engine Options:</div>
          <ul class="list-disc list-inside space-y-1 text-slate-300">
            <li><span class="text-emerald-300 font-medium">Harmonic-Folded Hamming-FFT:</span> Folds harmonics ($2b, 3b, 4b, \dots$) down into candidate fundamental buckets on the Hamming spectrum. Suppresses noise/formants, peak-picks $F_0$ with parabolic interpolation, and phase-aligns the boundary zero-crossing.</li>
            <li><span class="text-cyan-300 font-medium">Hamming-FFT + HPS:</span> Harmonic Product Spectrum downsampling across 5 harmonics with boundary zero-crossing phase alignment.</li>
            <li><span class="text-slate-300 font-medium">Time-Domain YIN:</span> Normalized difference function over 2048-sample sub-window with parabolic interpolation.</li>
          </ul>
        </div>

        <div class="pt-1 text-[11px] text-slate-400 border-t border-slate-800/80">
          <span class="text-slate-300 font-medium">Coordinate Scaling:</span> In the pitch-stretched window, $M$ samples are stretched to 4096 FFT points. Therefore, FFT bin $b$ corresponds to physical frequency $f = b \cdot (f_s / M)$. To render frequency $f$, the bin index is scaled by $b = f \cdot (M / f_s)$. In the time domain, the window advances by $M \cdot \text{hopRatio}$ ($< 4096$ samples), maintaining rigorous physical time ($x$) and frequency ($y$) synchronization across all three spectrograms.
        </div>
      </section>

    </main>

    <!-- Footer -->
    <footer class="border-t border-slate-800/80 py-4 px-6 text-center text-xs text-slate-400 bg-slate-950">
      Pitch-Synchronous Spectrogram Studio · Pure JavaScript DSP Engine · 4096-Point Radix-2 FFT
    </footer>
  `;
}

/**
 * Binds UI buttons, sliders, mouse interactions, and audio events
 */
function bindEvents() {
  const btnRecord = document.getElementById('btn-record');
  const btnPlayPause = document.getElementById('btn-play-pause');
  const selectFreq = document.getElementById('select-freq');
  const selectColormap = document.getElementById('select-colormap');
  const sliderMinDb = document.getElementById('slider-mindb');
  const labelMinDb = document.getElementById('label-mindb');
  const togglePitchTrack = document.getElementById('toggle-pitch-track');
  const sliderSliceTime = document.getElementById('slider-slice-time');
  const labelSliceTime = document.getElementById('label-slice-time');

  // Preset Buttons
  const presetBtns = document.querySelectorAll('.preset-btn');
  presetBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = btn.getAttribute('data-preset');
      loadPreset(preset);
      presetBtns.forEach((b) => {
        b.classList.remove('bg-cyan-950/60', 'text-cyan-300', 'border-cyan-800');
        b.classList.add('bg-slate-800/60', 'text-slate-400', 'border-slate-800');
      });
      btn.classList.remove('bg-slate-800/60', 'text-slate-400', 'border-slate-800');
      btn.classList.add('bg-cyan-950/60', 'text-cyan-300', 'border-cyan-800');
    });
  });

  // Record Button
  btnRecord.addEventListener('click', handleRecordClick);

  // Upload Audio File
  const inputAudioFile = document.getElementById('input-audio-file');
  const btnUpload = document.getElementById('btn-upload');
  if (btnUpload && inputAudioFile) {
    btnUpload.addEventListener('click', () => inputAudioFile.click());
    inputAudioFile.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const { audioBuffer, sampleRate, name } = await loadAudioFile(file);
        playback.stop();
        processAudio(audioBuffer, sampleRate, name || 'Uploaded Audio');
      } catch (err) {
        console.error('File decode error:', err);
        const errorModal = document.getElementById('mic-error-modal');
        const errorMsgEl = document.getElementById('mic-error-message');
        if (errorMsgEl) errorMsgEl.textContent = `Could not decode audio file: ${err.message}`;
        if (errorModal) errorModal.classList.remove('hidden');
      }
    });
  }

  // Cancel Recording Button
  const btnRecCancel = document.getElementById('btn-rec-cancel');
  if (btnRecCancel) {
    btnRecCancel.addEventListener('click', () => {
      const modal = document.getElementById('recording-modal');
      modal.classList.add('hidden');
      state.isRecording = false;
    });
  }

  // Microphone Error Modal Action Buttons
  const errorModal = document.getElementById('mic-error-modal');
  const btnErrorUpload = document.getElementById('btn-error-upload');
  const btnErrorPreset = document.getElementById('btn-error-preset');
  const btnErrorDismiss = document.getElementById('btn-error-dismiss');

  if (btnErrorUpload) {
    btnErrorUpload.addEventListener('click', () => {
      if (errorModal) errorModal.classList.add('hidden');
      if (inputAudioFile) inputAudioFile.click();
    });
  }
  if (btnErrorPreset) {
    btnErrorPreset.addEventListener('click', () => {
      if (errorModal) errorModal.classList.add('hidden');
      loadPreset('vibrato');
    });
  }
  if (btnErrorDismiss) {
    btnErrorDismiss.addEventListener('click', () => {
      if (errorModal) errorModal.classList.add('hidden');
    });
  }

  // Play / Pause Button
  btnPlayPause.addEventListener('click', () => {
    if (playback.isPlaying) {
      playback.pause();
    } else {
      playback.play();
    }
  });

  playback.onStateChange = (isPlaying) => {
    state.isPlaying = isPlaying;
    const playBtnText = document.getElementById('play-btn-text');
    const playIcon = document.getElementById('play-icon');
    if (isPlaying) {
      playBtnText.textContent = 'Pause';
      playIcon.innerHTML = `<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>`;
    } else {
      playBtnText.textContent = 'Play Audio';
      playIcon.innerHTML = `<path d="M8 5v14l11-7z" />`;
    }
  };

  playback.onPlayheadUpdate = (time) => {
    state.renderers.forEach((r) => r.setPlayhead(time));
    if (time >= 0) {
      updateTelemetryAt(time, state.cursorInfo.freq || 440);
    }
  };

  // Frequency range selector
  selectFreq.addEventListener('change', (e) => {
    const val = parseInt(e.target.value, 10);
    state.maxFreq = val;
    state.renderers.forEach((r) => r.setMaxFreq(val));
    if (state.sliceRenderer) {
      state.sliceRenderer.setMaxFreq(val);
    }
  });

  // Colormap selector
  selectColormap.addEventListener('change', (e) => {
    state.colormap = e.target.value;
    state.renderers.forEach((r) => r.setColormap(state.colormap));
  });

  // Dynamic range slider
  sliderMinDb.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    state.minDb = val;
    labelMinDb.textContent = `${val} dB`;
    state.renderers.forEach((r) => r.setDbRange(val, state.maxDb));
    if (state.sliceRenderer) {
      state.sliceRenderer.setDbRange(val, state.maxDb);
    }
  });

  // Pitch Detection Engine selector
  const selectPitchDetector = document.getElementById('select-pitch-detector');
  if (selectPitchDetector) {
    selectPitchDetector.addEventListener('change', (e) => {
      state.pitchDetector = e.target.value;
      if (state.audioBuffer) {
        processAudio(state.audioBuffer, state.sampleRate, state.activePreset);
      }
    });
  }

  // Pitch Track Toggle
  togglePitchTrack.addEventListener('change', (e) => {
    state.showPitchTrack = e.target.checked;
    state.renderers.forEach((r) => r.setShowPitchTrack(state.showPitchTrack));
  });

  // Harmonic Folding Toggle
  const btnToggleFolding = document.getElementById('btn-toggle-folding');
  const foldingIndicator = document.getElementById('folding-indicator');

  btnToggleFolding.addEventListener('click', () => {
    state.folding = !state.folding;
    if (state.folding) {
      btnToggleFolding.classList.remove('bg-slate-800', 'border-slate-700', 'text-slate-300');
      btnToggleFolding.classList.add('bg-cyan-950/90', 'border-cyan-500', 'text-cyan-300', 'shadow-[0_0_12px_rgba(6,182,212,0.4)]');
      foldingIndicator.classList.remove('bg-slate-500');
      foldingIndicator.classList.add('bg-cyan-400', 'shadow-[0_0_6px_rgba(6,182,212,0.9)]');
    } else {
      btnToggleFolding.classList.add('bg-slate-800', 'border-slate-700', 'text-slate-300');
      btnToggleFolding.classList.remove('bg-cyan-950/90', 'border-cyan-500', 'text-cyan-300', 'shadow-[0_0_12px_rgba(6,182,212,0.4)]');
      foldingIndicator.classList.add('bg-slate-500');
      foldingIndicator.classList.remove('bg-cyan-400', 'shadow-[0_0_6px_rgba(6,182,212,0.9)]');
    }

    state.renderers.forEach((r) => r.setFolding(state.folding));
    if (state.sliceRenderer) {
      state.sliceRenderer.setFolding(state.folding);
    }
  });

  // Slice time slider
  sliderSliceTime.addEventListener('input', (e) => {
    const t = parseFloat(e.target.value);
    state.selectedTime = t;
    labelSliceTime.textContent = `${t.toFixed(3)}s`;
    if (state.sliceRenderer) {
      state.sliceRenderer.setTime(t);
    }
    updateTelemetryAt(t, state.cursorInfo.freq || 440);
  });

  // Synchronized Canvas Mouse Hover & Click Events
  setupCanvasInteractions();
}

/**
 * Configures synchronized mouse and touch crosshairs across all three spectrograms
 */
function setupCanvasInteractions() {
  const canvasIds = ['canvas-rect', 'canvas-hamming', 'canvas-pitch', 'canvas-pitch-hamming'];

  canvasIds.forEach((id) => {
    const canvas = document.getElementById(id);
    if (!canvas) return;

    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Update all spectrogram renderers with same cursor
      state.renderers.forEach((r) => r.setCursor(true, x, y));

      if (state.renderers[0]) {
        const time = state.renderers[0].cursor.time;
        const freq = state.renderers[0].cursor.freq;
        state.cursorInfo = { active: true, time, freq };
        updateTelemetryAt(time, freq);
      }
    });

    canvas.addEventListener('mouseleave', () => {
      state.renderers.forEach((r) => r.setCursor(false, 0, 0));
      state.cursorInfo.active = false;
    });

    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      if (state.renderers[0]) {
        const normX = Math.max(0, Math.min(1, (x - state.renderers[0].margin.left) / state.renderers[0].plotWidth));
        const clickTime = normX * (state.spectrograms?.duration || 2.0);
        state.selectedTime = clickTime;

        // Update Slice Inspector
        if (state.sliceRenderer) {
          state.sliceRenderer.setTime(clickTime);
        }

        const sliderSliceTime = document.getElementById('slider-slice-time');
        const labelSliceTime = document.getElementById('label-slice-time');
        if (sliderSliceTime) sliderSliceTime.value = clickTime;
        if (labelSliceTime) labelSliceTime.textContent = `${clickTime.toFixed(3)}s`;

        // Seek audio playback
        playback.seek(clickTime);
      }
    });
  });
}

/**
 * Handles Microphone 2-second audio capture workflow
 */
async function handleRecordClick() {
  if (state.isRecording) return;

  const modal = document.getElementById('recording-modal');
  const progressBar = document.getElementById('rec-progress-bar');
  const levelMeter = document.getElementById('rec-level-meter');
  const timeLeftLabel = document.getElementById('rec-time-left');

  state.isRecording = true;
  modal.classList.remove('hidden');
  playback.stop();

  try {
    const { audioBuffer, sampleRate } = await recordTwoSecondsAudio((progress, rms) => {
      progressBar.style.width = `${Math.round(progress * 100)}%`;
      levelMeter.style.width = `${Math.min(100, Math.round(rms * 400))}%`;
      const remaining = Math.max(0, 2.0 - progress * 2.0);
      timeLeftLabel.textContent = `${remaining.toFixed(1)}s`;
    });

    modal.classList.add('hidden');
    state.isRecording = false;

    // Load recorded audio into state and run DSP analysis
    processAudio(audioBuffer, sampleRate, 'Live Mic Recording');
  } catch (err) {
    modal.classList.add('hidden');
    state.isRecording = false;
    console.error('Microphone recording error:', err);

    // Show persistent in-app error modal (no transient flash or window.alert)
    const errorModal = document.getElementById('mic-error-modal');
    const errorMsgEl = document.getElementById('mic-error-message');
    if (errorMsgEl) {
      errorMsgEl.textContent = err.message || String(err);
    }
    if (errorModal) {
      errorModal.classList.remove('hidden');
    }
  }
}

/**
 * Loads a synthetic reference audio preset
 */
function loadPreset(presetName) {
  state.activePreset = presetName;
  playback.stop();
  const { audioBuffer, sampleRate } = generateSyntheticAudio(presetName, 48000);
  processAudio(audioBuffer, sampleRate, presetName);
}

/**
 * Runs DSP pipeline and updates all spectrogram canvases
 */
function processAudio(audioBuffer, sampleRate, title = '') {
  state.audioBuffer = audioBuffer;
  state.sampleRate = sampleRate;

  // Initialize playback controller
  playback.loadAudio(audioBuffer, sampleRate);

  // Generate the three spectrograms
  const specs = generateSpectrograms(audioBuffer, sampleRate, {
    hopSize: 512,
    pitchDetector: state.pitchDetector
  });
  state.spectrograms = specs;

  // Initialize Canvas Renderers
  const canvasRect = document.getElementById('canvas-rect');
  const canvasHamming = document.getElementById('canvas-hamming');
  const canvasPitch = document.getElementById('canvas-pitch');
  const canvasPitchHamming = document.getElementById('canvas-pitch-hamming');
  const canvasSlice = document.getElementById('canvas-slice');

  const options = {
    colormap: state.colormap,
    maxFreq: state.maxFreq,
    minDb: state.minDb,
    maxDb: state.maxDb,
    showPitchTrack: state.showPitchTrack,
    folding: state.folding
  };

  const rendererRect = new SpectrogramRenderer(canvasRect, specs.rect, options);
  const rendererHamming = new SpectrogramRenderer(canvasHamming, specs.hamming, options);
  const rendererPitch = new SpectrogramRenderer(canvasPitch, specs.pitchDependent, options);
  const rendererPitchHamming = new SpectrogramRenderer(canvasPitchHamming, specs.pitchHamming, options);

  state.renderers = [rendererRect, rendererHamming, rendererPitch, rendererPitchHamming];

  // Render all 4 spectrograms
  state.renderers.forEach((r) => r.render());

  // Initialize Slice Spectrum Inspector
  state.sliceRenderer = new SliceRenderer(canvasSlice, specs);
  state.sliceRenderer.setMaxFreq(state.maxFreq);
  state.sliceRenderer.setDbRange(state.minDb, state.maxDb);
  state.sliceRenderer.setFolding(state.folding);
  state.sliceRenderer.setTime(state.selectedTime);

  // Update initial telemetry
  updateTelemetryAt(state.selectedTime, 440);
}

/**
 * Handles window resize for DPI and canvas bounds
 */
function handleWindowResize() {
  state.renderers.forEach((r) => {
    r.setupDPI();
    r.render();
  });
  if (state.sliceRenderer) {
    state.sliceRenderer.setupDPI();
    state.sliceRenderer.render();
  }
}

/**
 * Updates the technical telemetry bar with exact metrics at cursor/slice
 */
function updateTelemetryAt(time, freq) {
  const tEl = document.getElementById('telemetry-time');
  const fEl = document.getElementById('telemetry-freq');
  const f0El = document.getElementById('telemetry-f0');
  const periodEl = document.getElementById('telemetry-period');
  const kEl = document.getElementById('telemetry-k');
  const mEl = document.getElementById('telemetry-m');
  const hopEl = document.getElementById('telemetry-hop');

  if (!tEl || !state.spectrograms) return;

  tEl.textContent = `${time.toFixed(3)}s`;
  fEl.textContent = `${freq.toFixed(1)}Hz`;

  // Find slice in pitch-dependent spectrogram
  const pitchRenderer = state.renderers[2];
  if (pitchRenderer) {
    const slice = pitchRenderer.findSliceAtTime(time);
    if (slice && slice.hasPitch) {
      f0El.textContent = `${slice.pitchFreq.toFixed(2)}Hz`;
      periodEl.textContent = `${slice.pitchPeriod.toFixed(2)} smp`;
      kEl.textContent = `${slice.k}`;
      mEl.textContent = `${slice.M.toFixed(1)} smp`;
      const hop = Math.max(1, Math.floor(slice.M * (512 / 4096)));
      hopEl.textContent = `${hop} smp`;
    } else {
      f0El.textContent = `Unvoiced`;
      periodEl.textContent = `4096 smp`;
      kEl.textContent = `0`;
      mEl.textContent = `4096 smp`;
      hopEl.textContent = `512 smp`;
    }
  }
}

// Start application
document.addEventListener('DOMContentLoaded', init);
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  init();
}
