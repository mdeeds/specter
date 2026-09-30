/**
 * Spectrogram Generation Engine
 * Produces three synchronized spectrogram representations:
 * 1) Simple rectangular 4096 sample FFT (no windowing)
 * 2) Hamming windowed 4096 FFT
 * 3) Pitch-dependent window (time-stretched to integer wavelengths)
 */

import { computeFFT4096, FFT_SIZE } from './fft.js';
import { detectPitchYIN } from './pitch.js';
import { detectPitchFromHammingFFT, detectPitchFromFoldedHamming } from './pitch-fft.js';
import { timeStretchTo4096 } from './resample.js';

const DEFAULT_HOP_SIZE = 512; // 1/8 overlap for 4096 window

/**
 * Computes all 4 spectrograms for a given audio buffer:
 * 1. Rectangular 4096 FFT
 * 2. Hamming Windowed 4096 FFT
 * 3. Pitch-Dependent Adaptive Window (Time-Stretched, Rectangular / No window)
 * 4. Pitch-Dependent Adaptive Window + Hamming Taper (Time-Stretched + Hamming window)
 * 
 * @param {Float32Array} audioBuffer Raw audio data
 * @param {number} sampleRate Sampling frequency in Hz
 * @param {object} options Optional parameters (hopSize, pitchDetector: 'folded-hamming-fft' | 'hamming-fft' | 'yin')
 */
export function generateSpectrograms(audioBuffer, sampleRate, options = {}) {
  const hopSize = options.hopSize || DEFAULT_HOP_SIZE;
  const hopRatio = hopSize / FFT_SIZE; // Typically 512 / 4096 = 0.125
  const pitchDetector = options.pitchDetector || 'folded-hamming-fft';
  const totalSamples = audioBuffer.length;
  const duration = totalSamples / sampleRate;

  // -------------------------------------------------------------
  // 1 & 2: Fixed 4096 FFTs (Rectangular & Hamming)
  // -------------------------------------------------------------
  const rectSlices = [];
  const hammingSlices = [];

  const tempWindow = new Float32Array(FFT_SIZE);

  for (let pos = 0; pos <= totalSamples - FFT_SIZE; pos += hopSize) {
    // Extract 4096 samples
    for (let i = 0; i < FFT_SIZE; i++) {
      tempWindow[i] = audioBuffer[pos + i];
    }

    const centerTime = (pos + FFT_SIZE / 2) / sampleRate;
    const startTime = pos / sampleRate;
    const endTime = (pos + FFT_SIZE) / sampleRate;

    // 1) Rectangular window
    const rectResult = computeFFT4096(tempWindow, 'none');
    rectSlices.push({
      pos,
      startTime,
      endTime,
      centerTime,
      M: FFT_SIZE,
      dBs: rectResult.dBs,
      magnitudes: rectResult.magnitudes
    });

    // 2) Hamming window
    const hammingResult = computeFFT4096(tempWindow, 'hamming');
    hammingSlices.push({
      pos,
      startTime,
      endTime,
      centerTime,
      M: FFT_SIZE,
      dBs: hammingResult.dBs,
      magnitudes: hammingResult.magnitudes
    });
  }

  // -------------------------------------------------------------
  // 3 & 4: Pitch-Dependent Windows (Rectangular & Hamming-Tapered)
  // -------------------------------------------------------------
  const pitchSlices = [];
  const pitchHammingSlices = [];
  const stretchedBuffer = new Float32Array(FFT_SIZE);
  let pos = 0;

  while (pos < totalSamples) {
    const remaining = totalSamples - pos;
    if (remaining < 256) break;

    // Fill pitch analysis window (4096 samples or zero-padded if near end)
    for (let i = 0; i < FFT_SIZE; i++) {
      const idx = pos + i;
      tempWindow[i] = idx < totalSamples ? audioBuffer[idx] : 0;
    }

    // Determine fundamental pitch of the 4096 samples
    let pitch;
    let M = FFT_SIZE;
    let k = 0;
    let hasPitch = false;

    if (pitchDetector === 'folded-hamming-fft') {
      // Frequency-domain pitch detection using harmonic folded version of Hamming window FFT
      const hammingResult = computeFFT4096(tempWindow, 'hamming');
      pitch = detectPitchFromFoldedHamming(hammingResult.magnitudes, tempWindow, sampleRate);
      if (pitch.hasPitch && pitch.period > 4 && pitch.period <= FFT_SIZE) {
        k = pitch.k;
        M = k * pitch.period; // Exact fractional samples to time-stretch (e.g. 99.8 * 41 = 4091.8)
        hasPitch = true;
      }
    } else if (pitchDetector === 'hamming-fft') {
      // Frequency-domain pitch detection via Hamming 4096 FFT + Harmonic Product Spectrum
      const hammingResult = computeFFT4096(tempWindow, 'hamming');
      pitch = detectPitchFromHammingFFT(hammingResult.magnitudes, tempWindow, sampleRate);
      if (pitch.hasPitch && pitch.period > 4 && pitch.period <= FFT_SIZE) {
        k = pitch.k;
        M = k * pitch.period;
        hasPitch = true;
      }
    } else {
      // Time-domain YIN algorithm
      pitch = detectPitchYIN(tempWindow, sampleRate);
      if (pitch.hasPitch && pitch.period > 4 && pitch.period <= FFT_SIZE) {
        const numCycles = Math.floor(FFT_SIZE / pitch.period);
        if (numCycles >= 1) {
          k = numCycles;
          M = k * pitch.period; // Exact continuous duration in samples
          hasPitch = true;
        }
      }
    }

    // Ensure M does not overrun available samples near buffer end
    if (pos + M > totalSamples) {
      M = Math.min(FFT_SIZE, totalSamples - pos);
    }

    const startTime = pos / sampleRate;
    const sliceDuration = M / sampleRate;
    const centerTime = (pos + M / 2) / sampleRate;

    // Time-stretch the M samples to 4096 samples
    timeStretchTo4096(audioBuffer, pos, M, stretchedBuffer);

    // 3) Pitch-dependent with NO windowing function (pure rectangular)
    const fftResultNoWindow = computeFFT4096(stretchedBuffer, 'none');

    // 4) Pitch-dependent with Hamming window applied to the stretched buffer
    const fftResultHammingTaper = computeFFT4096(stretchedBuffer, 'hamming');

    pitchSlices.push({
      pos,
      startTime,
      endTime: startTime + sliceDuration,
      centerTime,
      M,
      k,
      hasPitch,
      pitchPeriod: hasPitch ? pitch.period : 4096,
      pitchFreq: hasPitch ? pitch.frequency : 0,
      pitchConfidence: pitch.confidence,
      dBs: fftResultNoWindow.dBs,
      magnitudes: fftResultNoWindow.magnitudes
    });

    pitchHammingSlices.push({
      pos,
      startTime,
      endTime: startTime + sliceDuration,
      centerTime,
      M,
      k,
      hasPitch,
      pitchPeriod: hasPitch ? pitch.period : 4096,
      pitchFreq: hasPitch ? pitch.frequency : 0,
      pitchConfidence: pitch.confidence,
      dBs: fftResultHammingTaper.dBs,
      magnitudes: fftResultHammingTaper.magnitudes
    });

    // Advance window forward (truncating step down, e.g. 4091 samples for full window or proportional hop)
    const step = Math.max(1, Math.floor(M * hopRatio));
    pos += step;
  }

  // Calculate dynamic range stats
  let minDb = 0;
  let maxDb = -200;

  const sampledB = (slices) => {
    for (const slice of slices) {
      for (let i = 0; i < slice.dBs.length; i++) {
        const val = slice.dBs[i];
        if (Number.isFinite(val)) {
          if (val > maxDb) maxDb = val;
          if (val < minDb) minDb = val;
        }
      }
    }
  };

  sampledB(rectSlices);
  sampledB(hammingSlices);
  sampledB(pitchSlices);

  // -------------------------------------------------------------
  // Harmonic Folding:
  // Ignore first 4 buckets (0..3 = black/0).
  // For each bucket b >= 4, average all integer multiple buckets (b, 2b, 3b, ...)
  // Normalize intensities across all buckets in all time slices.
  // -------------------------------------------------------------
  const processFoldedSpectrum = (slices) => {
    if (!slices || slices.length === 0) return;
    const numBins = slices[0].magnitudes.length;

    let globalMax = 0;

    for (const slice of slices) {
      const mags = slice.magnitudes;
      const folded = new Float32Array(numBins);

      // Buckets 0, 1, 2, 3 remain 0 (black/ignored)
      for (let b = 4; b < numBins; b++) {
        let sum = 0;
        let count = 0;
        for (let mult = b; mult < numBins; mult += b) {
          sum += mags[mult];
          count++;
        }
        const avg = count > 0 ? sum / count : 0;
        folded[b] = avg;
        if (avg > globalMax) {
          globalMax = avg;
        }
      }
      slice.folded = folded;
    }

    const normScale = globalMax > 1e-12 ? 1.0 / globalMax : 1.0;

    for (const slice of slices) {
      const folded = slice.folded;
      const foldedNorm = new Float32Array(numBins);
      const foldedDbs = new Float32Array(numBins);

      for (let b = 4; b < numBins; b++) {
        const val = folded[b] * normScale;
        foldedNorm[b] = val;
        // dB scale relative to normalized peak (0 dB down to -80 dB)
        foldedDbs[b] = 20.0 * Math.log10(Math.max(val, 1e-4));
      }

      // Buckets 0..3 are -120 dB / 0
      for (let b = 0; b < 4; b++) {
        foldedNorm[b] = 0;
        foldedDbs[b] = -120;
      }

      slice.foldedNorm = foldedNorm;
      slice.foldedDbs = foldedDbs;
    }
  };

  processFoldedSpectrum(rectSlices);
  processFoldedSpectrum(hammingSlices);
  processFoldedSpectrum(pitchSlices);
  processFoldedSpectrum(pitchHammingSlices);

  return {
    sampleRate,
    duration,
    totalSamples,
    nyquist: sampleRate / 2,
    dbRange: { minDb, maxDb },
    rect: {
      type: 'rectangular',
      name: 'Rectangular 4096 FFT (No Window)',
      slices: rectSlices,
      windowSize: FFT_SIZE,
      duration,
      sampleRate,
      totalSamples,
      nyquist: sampleRate / 2
    },
    hamming: {
      type: 'hamming',
      name: 'Hamming Windowed 4096 FFT',
      slices: hammingSlices,
      windowSize: FFT_SIZE,
      duration,
      sampleRate,
      totalSamples,
      nyquist: sampleRate / 2
    },
    pitchDependent: {
      type: 'pitch-dependent',
      name: 'Pitch-Dependent Adaptive Window (Time-Stretched)',
      slices: pitchSlices,
      windowSize: FFT_SIZE,
      duration,
      sampleRate,
      totalSamples,
      nyquist: sampleRate / 2
    },
    pitchHamming: {
      type: 'pitch-hamming',
      name: 'Pitch-Dependent Adaptive Window + Hamming Taper',
      slices: pitchHammingSlices,
      windowSize: FFT_SIZE,
      duration,
      sampleRate,
      totalSamples,
      nyquist: sampleRate / 2
    }
  };
}
