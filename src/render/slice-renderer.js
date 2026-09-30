/**
 * Slice Spectrum Inspector Canvas Renderer
 * Plots comparative 1D frequency spectrum curves (dB vs Hz) at a selected time point:
 * - Rectangular 4096 FFT (spectral leakage baseline)
 * - Hamming Windowed 4096 FFT (mainlobe broadening trade-off)
 * - Pitch-Dependent Adaptive Window (needle-sharp harmonic peaks, zero leakage)
 */

export class SliceRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} spectrograms Object with rect, hamming, pitchDependent data
   */
  constructor(canvas, spectrograms) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.spectrograms = spectrograms;

    this.currentTime = 0.5; // Default slice time in seconds
    this.maxFreq = 8000;
    this.minDb = -80;
    this.maxDb = 0;
    this.folding = false;

    this.margin = {
      left: 55,
      right: 20,
      top: 24,
      bottom: 24
    };

    this.setupDPI();
  }

  setupDPI() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = Math.max(300, Math.floor(rect.width || this.canvas.clientWidth || 300));
    this.height = Math.max(200, Math.floor(rect.height || this.canvas.clientHeight || 280));

    this.canvas.width = Math.floor(this.width * dpr);
    this.canvas.height = Math.floor(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.plotWidth = Math.max(10, this.width - this.margin.left - this.margin.right);
    this.plotHeight = Math.max(10, this.height - this.margin.top - this.margin.bottom);
  }

  setFolding(folding) {
    if (this.folding !== folding) {
      this.folding = folding;
      this.render();
    }
  }

  setTime(t) {
    this.currentTime = Math.max(0, Math.min(this.spectrograms.duration || 2.0, t));
    this.render();
  }

  setMaxFreq(freq) {
    this.maxFreq = freq;
    this.render();
  }

  setDbRange(minDb, maxDb) {
    this.minDb = minDb;
    this.maxDb = maxDb;
    this.render();
  }

  findSlice(spectrogram, t) {
    const slices = spectrogram.slices;
    if (!slices || slices.length === 0) return null;

    let closest = slices[0];
    let minDiff = Math.abs(closest.centerTime - t);

    for (let i = 1; i < slices.length; i++) {
      const diff = Math.abs(slices[i].centerTime - t);
      if (diff < minDiff) {
        minDiff = diff;
        closest = slices[i];
      }
    }
    return closest;
  }

  sampleDb(slice, sampleRate, freq) {
    if (!slice) return -120;
    const M = slice.M || 4096;
    const bin = freq * (M / sampleRate);

    if (this.folding) {
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

  render() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const { left, top } = this.margin;
    const pw = this.plotWidth;
    const ph = this.plotHeight;

    ctx.fillStyle = '#090d16'; // Deep obsidian slate
    ctx.fillRect(0, 0, w, h);

    // Grid and axes
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.strokeRect(left, top, pw, ph);

    // Draw grid lines
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);

    // dB grid lines (every 20 dB)
    for (let db = this.maxDb; db >= this.minDb; db -= 20) {
      const normY = (this.maxDb - db) / (this.maxDb - this.minDb);
      const y = top + normY * ph;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + pw, y);
      ctx.stroke();
    }

    // Frequency grid lines
    const freqStep = this.maxFreq <= 5000 ? 1000 : 2000;
    for (let f = freqStep; f < this.maxFreq; f += freqStep) {
      const x = left + (f / this.maxFreq) * pw;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + ph);
      ctx.stroke();
    }
    ctx.restore();

    // Axis tick labels
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let db = this.maxDb; db >= this.minDb; db -= 20) {
      const normY = (this.maxDb - db) / (this.maxDb - this.minDb);
      const y = top + normY * ph;
      ctx.fillText(`${db}dB`, left - 6, y);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let f = 0; f <= this.maxFreq; f += freqStep) {
      const x = left + (f / this.maxFreq) * pw;
      const label = f >= 1000 ? `${(f / 1000).toFixed(0)}k` : `${f}`;
      ctx.fillText(label, x, top + ph + 6);
    }

    // Find active slices at currentTime
    const sampleRate = this.spectrograms.sampleRate;
    const rectSlice = this.findSlice(this.spectrograms.rect, this.currentTime);
    const hammingSlice = this.findSlice(this.spectrograms.hamming, this.currentTime);
    const pitchSlice = this.findSlice(this.spectrograms.pitchDependent, this.currentTime);
    const pitchHammingSlice = this.findSlice(this.spectrograms.pitchHamming, this.currentTime);

    // Draw spectrum curves
    const numPoints = Math.min(pw, 600);

    const drawCurve = (slice, color, lineWidth, lineDash = []) => {
      if (!slice) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.setLineDash(lineDash);
      ctx.beginPath();

      for (let i = 0; i < numPoints; i++) {
        const freq = (i / (numPoints - 1)) * this.maxFreq;
        const db = this.sampleDb(slice, sampleRate, freq);
        const normY = Math.max(0, Math.min(1.0, (this.maxDb - db) / (this.maxDb - this.minDb)));
        const x = left + (i / (numPoints - 1)) * pw;
        const y = top + normY * ph;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.restore();
    };

    // 1) Rectangular (Rose/Red dashed)
    drawCurve(rectSlice, '#f43f5e', 1.5, [4, 2]);

    // 2) Hamming (Amber)
    drawCurve(hammingSlice, '#f59e0b', 1.5);

    // 3) Pitch-dependent pure rectangular (Cyan)
    drawCurve(pitchSlice, '#06b6d4', 1.8);

    // 4) Pitch-dependent + Hamming taper (Emerald green, prominent)
    drawCurve(pitchHammingSlice, '#10b981', 2.0);

    // Header title & legend
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '600 12px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = '#f1f5f9';
    const titleText = this.folding
      ? `Harmonic Folded Spectrum Cross-Section at t = ${this.currentTime.toFixed(3)}s`
      : `Spectrum Cross-Section at t = ${this.currentTime.toFixed(3)}s`;
    ctx.fillText(titleText, left, top - 18);

    // Legend items
    ctx.font = '10px "JetBrains Mono", monospace';
    const legendY = top - 17;
    let legendX = left + 260;

    const drawLegendItem = (name, color, dashed) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash(dashed ? [3, 2] : []);
      ctx.beginPath();
      ctx.moveTo(legendX, legendY + 5);
      ctx.lineTo(legendX + 16, legendY + 5);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#cbd5e1';
      ctx.fillText(name, legendX + 22, legendY);
      legendX += ctx.measureText(name).width + 36;
    };

    drawLegendItem('Rectangular (Leakage)', '#f43f5e', true);
    drawLegendItem('Hamming (Tapered)', '#f59e0b', false);
    drawLegendItem('Pitch-Stretched', '#06b6d4', false);
    drawLegendItem('Pitch-Stretched + Hamming', '#10b981', false);

    // Pitch info footer badge if pitch detected
    if (pitchSlice && pitchSlice.hasPitch) {
      ctx.fillStyle = '#06b6d4';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillText(
        `Pitch: ${pitchSlice.pitchFreq.toFixed(2)} Hz · Wavelength: ${pitchSlice.pitchPeriod.toFixed(2)} smp · Stretched M: ${pitchSlice.M.toFixed(1)} smp (${pitchSlice.k} wavelengths)`,
        left + 8,
        top + 10
      );
    }
  }
}
