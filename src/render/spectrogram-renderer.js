/**
 * Spectrogram Canvas Renderer
 * Handles high-DPI rendering, time & frequency scaling, colormapping,
 * axes labels, grid lines, synchronized crosshairs, playhead, and pitch tracking.
 */

import { COLORMAPS } from './colormap.js';

export class SpectrogramRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} spectrogramData Spectrogram slice data object
   * @param {object} options
   */
  constructor(canvas, spectrogramData, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: false });
    this.data = spectrogramData;
    this.type = spectrogramData.type; // 'rectangular' | 'hamming' | 'pitch-dependent'
    this.title = spectrogramData.name;
    this.duration = spectrogramData.duration || 2.0;
    this.sampleRate = spectrogramData.sampleRate || 48000;

    this.options = {
      colormap: 'inferno',
      maxFreq: options.maxFreq || 8000, // Default display up to 8 kHz (audible vocal/instrument harmonics)
      minDb: options.minDb !== undefined ? options.minDb : -80,
      maxDb: options.maxDb !== undefined ? options.maxDb : 0,
      showPitchTrack: options.showPitchTrack !== undefined ? options.showPitchTrack : true,
      folding: options.folding || false,
      ...options
    };

    // Plot margins for axes and labels
    this.margin = {
      left: 60,
      right: 20,
      top: 30,
      bottom: 28
    };

    this.cursor = { active: false, x: 0, y: 0, time: 0, freq: 0 };
    this.playheadTime = -1;

    // Cache pre-rendered heat map buffer
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCtx = this.offscreenCanvas.getContext('2d');
    this.needsHeatmapRedraw = true;

    this.setupDPI();
  }

  setupDPI() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = Math.max(300, Math.floor(rect.width || this.canvas.clientWidth || 300));
    this.height = Math.max(220, Math.floor(rect.height || this.canvas.clientHeight || 320));

    this.canvas.width = Math.floor(this.width * dpr);
    this.canvas.height = Math.floor(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.plotWidth = Math.max(10, this.width - this.margin.left - this.margin.right);
    this.plotHeight = Math.max(10, this.height - this.margin.top - this.margin.bottom);

    this.offscreenCanvas.width = this.plotWidth;
    this.offscreenCanvas.height = this.plotHeight;

    this.needsHeatmapRedraw = true;
  }

  setColormap(name) {
    if (this.options.colormap !== name) {
      this.options.colormap = name;
      this.needsHeatmapRedraw = true;
      this.render();
    }
  }

  setMaxFreq(freq) {
    if (this.options.maxFreq !== freq) {
      this.options.maxFreq = freq;
      this.needsHeatmapRedraw = true;
      this.render();
    }
  }

  setDbRange(minDb, maxDb) {
    if (this.options.minDb !== minDb || this.options.maxDb !== maxDb) {
      this.options.minDb = minDb;
      this.options.maxDb = maxDb;
      this.needsHeatmapRedraw = true;
      this.render();
    }
  }

  setShowPitchTrack(show) {
    if (this.options.showPitchTrack !== show) {
      this.options.showPitchTrack = show;
      this.render();
    }
  }

  setFolding(folding) {
    if (this.options.folding !== folding) {
      this.options.folding = folding;
      this.needsHeatmapRedraw = true;
      this.render();
    }
  }

  setPlayhead(time) {
    this.playheadTime = time;
    this.render();
  }

  setCursor(active, x, y) {
    this.cursor.active = active;
    if (active) {
      // Map canvas pixel position to plot bounds
      const clampedX = Math.max(this.margin.left, Math.min(this.margin.left + this.plotWidth, x));
      const clampedY = Math.max(this.margin.top, Math.min(this.margin.top + this.plotHeight, y));

      const normX = (clampedX - this.margin.left) / this.plotWidth;
      const normY = 1.0 - (clampedY - this.margin.top) / this.plotHeight;

      this.cursor.time = normX * this.data.duration;
      this.cursor.freq = normY * this.options.maxFreq;
      this.cursor.x = clampedX;
      this.cursor.y = clampedY;
    }
    this.render();
  }

  /**
   * Find slice at physical time t (seconds)
   */
  findSliceAtTime(t) {
    const slices = this.data.slices;
    if (!slices || slices.length === 0) return null;

    let low = 0;
    let high = slices.length - 1;

    while (low <= high) {
      const mid = (low + high) >> 1;
      const s = slices[mid];
      if (Math.abs(s.centerTime - t) < 0.0005) {
        return s;
      }
      if (s.centerTime < t) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (low >= slices.length) return slices[slices.length - 1];
    if (high < 0) return slices[0];
    const dLow = Math.abs(slices[low].centerTime - t);
    const dHigh = Math.abs(slices[high].centerTime - t);
    return dLow < dHigh ? slices[low] : slices[high];
  }

  /**
   * Samples the decibel amplitude at physical time t and physical frequency f
   */
  sampleDbAt(t, f) {
    const slice = this.findSliceAtTime(t);
    if (!slice) return -120;

    const sampleRate = this.data.sampleRate || this.sampleRate || 48000;
    const M = slice.M || 4096;

    // Physical frequency to FFT bin mapping:
    // f = bin * (sampleRate / M) => bin = f * (M / sampleRate)
    const bin = f * (M / sampleRate);
    if (this.options.folding) {
      if (bin < 4) return -120;
      const dBs = slice.foldedDbs || slice.dBs;
      if (bin <= 0) return dBs[0];
      if (bin >= dBs.length - 1) return dBs[dBs.length - 1];

      const i0 = Math.floor(bin);
      const i1 = i0 + 1;
      const frac = bin - i0;
      return dBs[i0] * (1.0 - frac) + dBs[i1] * frac;
    }

    const dBs = slice.dBs;

    if (bin <= 0) return dBs[0];
    if (bin >= dBs.length - 1) return dBs[dBs.length - 1];

    const i0 = Math.floor(bin);
    const i1 = i0 + 1;
    const frac = bin - i0;

    return dBs[i0] * (1.0 - frac) + dBs[i1] * frac;
  }

  renderHeatmap() {
    if (!this.data || !this.data.slices || this.data.slices.length === 0) return;

    const pw = this.plotWidth;
    const ph = this.plotHeight;
    const imgData = this.offscreenCtx.createImageData(pw, ph);
    const pixels = imgData.data;

    const isFolding = !!this.options.folding;
    const lut = COLORMAPS[this.options.colormap] || COLORMAPS.inferno;
    const duration = this.data.duration || this.duration || 2.0;
    const maxFreq = this.options.maxFreq;
    const sampleRate = this.data.sampleRate || this.sampleRate || 48000;
    const minDb = this.options.minDb;
    const maxDb = this.options.maxDb;
    const dbSpan = Math.max(1, maxDb - minDb);

    // Render column by column (time slices)
    for (let x = 0; x < pw; x++) {
      const t = (x / Math.max(1, pw - 1)) * duration;
      const slice = this.findSliceAtTime(t);
      if (!slice) continue;

      const dBs = isFolding ? (slice.foldedDbs || slice.dBs) : slice.dBs;
      const foldedNorm = slice.foldedNorm;
      const numBins = dBs.length;
      const M = slice.M || 4096;

      // Scaling factor: bin = f * (M / sampleRate)
      const binScale = M / sampleRate;

      for (let y = 0; y < ph; y++) {
        // y = 0 is highest freq (maxFreq), y = ph - 1 is 0 Hz
        const freq = (1.0 - y / Math.max(1, ph - 1)) * maxFreq;
        const bin = freq * binScale;

        let norm = 0;
        if (isFolding) {
          // Ignore first 4 buckets (0, 1, 2, 3 = black)
          if (bin < 4) {
            norm = 0;
          } else if (foldedNorm && bin < numBins - 1) {
            const i0 = Math.floor(bin);
            const i1 = i0 + 1;
            const frac = bin - i0;
            const val = foldedNorm[i0] * (1.0 - frac) + foldedNorm[i1] * frac;
            // Gamma curve (0.6) so fundamentals glow with intense contrast
            norm = Math.max(0, Math.min(255, Math.round(Math.pow(val, 0.6) * 255)));
          }
        } else {
          let dbVal = minDb;
          if (bin >= 0 && bin < numBins - 1) {
            const i0 = Math.floor(bin);
            const i1 = i0 + 1;
            const frac = bin - i0;
            dbVal = dBs[i0] * (1.0 - frac) + dBs[i1] * frac;
          } else if (bin >= numBins - 1 && bin <= numBins + 2) {
            dbVal = dBs[numBins - 1];
          }
          norm = Math.max(0, Math.min(255, Math.round(((dbVal - minDb) / dbSpan) * 255)));
        }

        const lutIdx = norm * 4;
        const pixelIdx = (y * pw + x) * 4;
        pixels[pixelIdx] = lut[lutIdx];
        pixels[pixelIdx + 1] = lut[lutIdx + 1];
        pixels[pixelIdx + 2] = lut[lutIdx + 2];
        pixels[pixelIdx + 3] = 255;
      }
    }

    this.offscreenCtx.putImageData(imgData, 0, 0);
    this.needsHeatmapRedraw = false;
  }

  render() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const { left, right, top, bottom } = this.margin;
    const pw = this.plotWidth;
    const ph = this.plotHeight;
    const duration = this.data.duration || this.duration || 2.0;

    // Clear background
    ctx.fillStyle = '#090d16'; // Deep obsidian slate
    ctx.fillRect(0, 0, w, h);

    if (this.needsHeatmapRedraw) {
      this.renderHeatmap();
    }

    // Draw spectrogram heat map
    ctx.drawImage(this.offscreenCanvas, left, top, pw, ph);

    // Draw Plot Frame Border
    ctx.strokeStyle = '#1e293b'; // slate-800
    ctx.lineWidth = 1;
    ctx.strokeRect(left, top, pw, ph);

    // Draw Frequency and Time Grid Lines
    this.renderGrid(ctx, left, top, pw, ph);

    // Draw Pitch Track Curve Overlay (only for pitch-dependent spectrograms if enabled)
    if ((this.type === 'pitch-dependent' || this.type === 'pitch-hamming') && this.options.showPitchTrack) {
      this.renderPitchTrack(ctx, left, top, pw, ph);
    }

    // Draw Axes Labels and Title
    this.renderAxesLabels(ctx, left, top, pw, ph);

    // Draw Playhead if active
    if (this.playheadTime >= 0 && this.playheadTime <= duration) {
      const playheadX = left + (this.playheadTime / duration) * pw;
      ctx.strokeStyle = '#38bdf8'; // sky-400
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(playheadX, top);
      ctx.lineTo(playheadX, top + ph);
      ctx.stroke();

      // Playhead handle marker
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(playheadX, top, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw Crosshair & HUD if cursor active
    if (this.cursor.active) {
      this.renderCrosshair(ctx, left, top, pw, ph);
    }
  }

  renderGrid(ctx, left, top, pw, ph) {
    const duration = this.data.duration || this.duration || 2.0;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);

    // Horizontal frequency grid lines (every 1 kHz or 2 kHz depending on maxFreq)
    const freqStep = this.options.maxFreq <= 5000 ? 1000 : 2000;
    for (let f = freqStep; f < this.options.maxFreq; f += freqStep) {
      const y = top + (1.0 - f / this.options.maxFreq) * ph;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + pw, y);
      ctx.stroke();
    }

    // Vertical time grid lines (every 0.25s or 0.5s)
    const timeStep = 0.5;
    for (let t = timeStep; t < duration; t += timeStep) {
      const x = left + (t / duration) * pw;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + ph);
      ctx.stroke();
    }
    ctx.restore();
  }

  renderPitchTrack(ctx, left, top, pw, ph) {
    const slices = this.data.slices;
    if (!slices || slices.length === 0) return;
    const duration = this.data.duration || this.duration || 2.0;

    ctx.save();
    ctx.strokeStyle = '#06b6d4'; // Laser cyan
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();

    let started = false;
    for (const slice of slices) {
      if (slice.hasPitch && slice.pitchFreq > 0 && slice.pitchFreq <= this.options.maxFreq) {
        const x = left + (slice.centerTime / duration) * pw;
        const y = top + (1.0 - slice.pitchFreq / this.options.maxFreq) * ph;

        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      } else {
        started = false;
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  renderAxesLabels(ctx, left, top, pw, ph) {
    const duration = this.data.duration || this.duration || 2.0;
    ctx.save();
    ctx.fillStyle = '#94a3b8'; // slate-400
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    // Y-Axis (Frequency ticks)
    const freqStep = this.options.maxFreq <= 5000 ? 1000 : 2000;
    for (let f = 0; f <= this.options.maxFreq; f += freqStep) {
      const y = top + (1.0 - f / this.options.maxFreq) * ph;
      const label = f >= 1000 ? `${(f / 1000).toFixed(0)}k` : `${f}`;
      ctx.fillText(label, left - 8, y);
    }

    // X-Axis (Time ticks)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const timeStep = 0.5;
    for (let t = 0; t <= duration + 0.01; t += timeStep) {
      const x = left + (t / duration) * pw;
      ctx.fillText(`${t.toFixed(1)}s`, x, top + ph + 6);
    }

    // Title & Legend at Top
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '600 12px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = '#f1f5f9'; // slate-100
    ctx.fillText(this.title, left, top - 20);

    // Mode badge descriptor
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = this.options.folding ? '#38bdf8' : '#64748b'; // cyan if folding active
    let badgeText = '';
    if (this.options.folding) {
      badgeText = 'Harmonic Folded (Buckets 0-3 Muted · Harmonic Multiples Averaged)';
    } else if (this.type === 'rectangular') {
      badgeText = 'N=4096 · No Windowing · Spectral Leakage Baseline';
    } else if (this.type === 'hamming') {
      badgeText = 'N=4096 · Hamming Window · Mainlobe Broadening';
    } else if (this.type === 'pitch-hamming') {
      badgeText = 'Variable M <= 4096 · Integer Cycles + Hamming Window Taper';
    } else {
      badgeText = 'Variable M <= 4096 · Time-Stretched Integer Cycles · Pure Rectangular';
    }
    ctx.fillText(badgeText, left + ctx.measureText(this.title).width + 12, top - 19);

    ctx.restore();
  }

  renderCrosshair(ctx, left, top, pw, ph) {
    const { x, y, time, freq } = this.cursor;

    ctx.save();
    // Crosshair Lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);

    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(left + pw, y);
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + ph);
    ctx.stroke();
    ctx.setLineDash([]);

    // Sample dB at cursor position
    const dbAtCursor = this.sampleDbAt(time, freq);

    // Crosshair info pill on top right inside plot
    const slice = this.findSliceAtTime(time);
    let hudText = `${time.toFixed(3)}s  ${freq.toFixed(1)}Hz  ${dbAtCursor.toFixed(1)}dB`;
    if (this.type === 'pitch-dependent' && slice) {
      if (slice.hasPitch) {
        hudText += `  [F0: ${slice.pitchFreq.toFixed(1)}Hz  M: ${Math.round(slice.M)}smp  k: ${slice.k}]`;
      } else {
        hudText += `  [Unvoiced / M: 4096]`;
      }
    }

    ctx.font = '11px "JetBrains Mono", monospace';
    const textWidth = ctx.measureText(hudText).width;
    const hudPadding = 6;
    const hudX = left + pw - textWidth - hudPadding * 2 - 8;
    const hudY = top + 8;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.fillRect(hudX, hudY, textWidth + hudPadding * 2, 22);
    ctx.strokeRect(hudX, hudY, textWidth + hudPadding * 2, 22);

    ctx.fillStyle = '#38bdf8'; // Laser cyan
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(hudText, hudX + hudPadding, hudY + 11);

    ctx.restore();
  }
}
