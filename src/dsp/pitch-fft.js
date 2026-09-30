/**
 * Frequency-Domain Pitch Detection via Hamming-Windowed 4096 FFT
 * 
 * Uses Harmonic Product Spectrum (HPS) with parabolic sub-bin interpolation
 * directly on the 4096 Hamming FFT magnitude spectrum.
 * 
 * Advantages over time-domain YIN:
 * 1. Immune to vocal tract formant resonance pulling (F1/F2).
 * 2. Harmonic Product Spectrum reinforces the true fundamental by downsampling
 *    and multiplying harmonic peaks.
 * 3. Parabolic interpolation on log-magnitude achieves sub-Hertz frequency resolution.
 */

import { FFT_SIZE } from './fft.js';

/**
 * Detects fundamental pitch frequency using Harmonic Product Spectrum (HPS)
 * on a 4096 Hamming FFT magnitude array.
 * 
 * @param {Float32Array} magnitudes 2049 FFT magnitude bins from Hamming 4096 FFT
 * @param {Float32Array} rawSamples 4096 original audio samples
 * @param {number} sampleRate Audio sampling rate in Hz (e.g. 48000)
 * @param {object} options
 * @returns {{ hasPitch: boolean, period: number, frequency: number, confidence: number, refinedM: number }}
 */
export function detectPitchFromHammingFFT(magnitudes, rawSamples, sampleRate, options = {}) {
  const minFreq = options.minFreq || 55;   // ~A1
  const maxFreq = options.maxFreq || 1800; // ~A6
  const numHarmonics = options.numHarmonics || 5;

  const binFreq = sampleRate / FFT_SIZE; // e.g. 48000 / 4096 ≈ 11.71875 Hz
  const minBin = Math.max(2, Math.floor(minFreq / binFreq));
  const maxBin = Math.min(Math.floor(magnitudes.length / numHarmonics), Math.floor(maxFreq / binFreq));

  // Compute RMS to gate silence
  let energy = 0;
  for (let i = 0; i < rawSamples.length; i++) {
    energy += rawSamples[i] * rawSamples[i];
  }
  const rms = Math.sqrt(energy / rawSamples.length);
  if (rms < 0.003) {
    return { hasPitch: false, period: FFT_SIZE, frequency: 0, confidence: 0, refinedM: FFT_SIZE };
  }

  // Harmonic Product Spectrum (in log domain to prevent numerical underflow)
  // HPS(k) = log(X[k]) + log(X[2k]) + log(X[3k]) + ...
  const hps = new Float32Array(maxBin + 1);
  const eps = 1e-9;

  for (let k = minBin; k <= maxBin; k++) {
    let sumLog = Math.log(magnitudes[k] + eps);
    for (let h = 2; h <= numHarmonics; h++) {
      const harmIdx = k * h;
      if (harmIdx < magnitudes.length) {
        sumLog += Math.log(magnitudes[harmIdx] + eps);
      }
    }
    hps[k] = sumLog;
  }

  // Find peak in HPS
  let bestBin = -1;
  let maxVal = -Infinity;
  for (let k = minBin; k <= maxBin; k++) {
    if (hps[k] > maxVal && hps[k] > hps[k - 1] && hps[k] > hps[k + 1]) {
      maxVal = hps[k];
      bestBin = k;
    }
  }

  if (bestBin <= 0) {
    return { hasPitch: false, period: FFT_SIZE, frequency: 0, confidence: 0, refinedM: FFT_SIZE };
  }

  // Parabolic sub-bin interpolation on log magnitude
  const y0 = hps[bestBin - 1];
  const y1 = hps[bestBin];
  const y2 = hps[bestBin + 1];
  const denom = 2.0 * (2.0 * y1 - y0 - y2);

  let delta = 0;
  if (Math.abs(denom) > 1e-7) {
    delta = (y2 - y0) / denom;
    delta = Math.max(-0.5, Math.min(0.5, delta));
  }

  const refinedBin = bestBin + delta;
  const frequency = refinedBin * binFreq;
  const period = sampleRate / frequency;

  // Calculate integer number of cycles that fit in 4096
  const kCycles = Math.floor(FFT_SIZE / period);
  if (kCycles < 1) {
    return { hasPitch: false, period: FFT_SIZE, frequency: 0, confidence: 0, refinedM: FFT_SIZE };
  }

  const idealM = kCycles * period;

  // Boundary-Phase Zero-Crossing Matching:
  // Search within +/- 0.5 * period around idealM to find sample index where:
  // 1. Amplitude matches rawSamples[0] closely
  // 2. Slope / direction matches rawSamples[0]'s derivative
  const targetVal = rawSamples[0];
  const targetSlope = rawSamples[1] - rawSamples[0];

  const searchRadius = Math.max(3, Math.round(period * 0.45));
  const centerIdx = Math.round(idealM);
  let bestIdx = centerIdx;
  let bestDist = Infinity;

  const minSearch = Math.max(16, centerIdx - searchRadius);
  const maxSearch = Math.min(FFT_SIZE - 2, centerIdx + searchRadius);

  for (let idx = minSearch; idx <= maxSearch; idx++) {
    const valDiff = Math.abs(rawSamples[idx] - targetVal);
    const slope = rawSamples[idx + 1] - rawSamples[idx];
    const slopeMatch = (slope >= 0 && targetSlope >= 0) || (slope < 0 && targetSlope < 0);

    const cost = valDiff + (slopeMatch ? 0 : 0.5);
    if (cost < bestDist) {
      bestDist = cost;
      bestIdx = idx;
    }
  }

  // Interpolate fractional zero-crossing if adjacent samples straddle targetVal
  let refinedM = bestIdx;
  if (bestIdx > 0 && bestIdx < rawSamples.length - 1) {
    const s0 = rawSamples[bestIdx - 1];
    const s1 = rawSamples[bestIdx];
    const s2 = rawSamples[bestIdx + 1];
    if ((s0 <= targetVal && s1 >= targetVal) || (s0 >= targetVal && s1 <= targetVal)) {
      const frac = Math.abs(s1 - s0) > 1e-6 ? (targetVal - s0) / (s1 - s0) : 0.5;
      refinedM = (bestIdx - 1) + frac;
    } else if ((s1 <= targetVal && s2 >= targetVal) || (s1 >= targetVal && s2 <= targetVal)) {
      const frac = Math.abs(s2 - s1) > 1e-6 ? (targetVal - s1) / (s2 - s1) : 0.5;
      refinedM = bestIdx + frac;
    }
  }

  return {
    hasPitch: true,
    period,
    frequency,
    confidence: Math.min(1.0, Math.max(0.2, (magnitudes[bestBin] / (rms * 10)))),
    k: kCycles,
    idealM,
    refinedM: Math.max(period, Math.min(FFT_SIZE, refinedM))
  };
}

/**
 * Detects fundamental pitch frequency using Harmonic Folding on the Hamming window FFT.
 * 
 * Bins 0..3 are ignored.
 * For each bucket b >= 4, the average of all integer multiple buckets above it (b, 2b, 3b, ...)
 * is computed to fold harmonics down onto the fundamental.
 * Peak-picking with parabolic sub-bin interpolation gives the exact fundamental frequency.
 * 
 * @param {Float32Array} magnitudes 2049 FFT magnitude bins from Hamming 4096 FFT
 * @param {Float32Array} rawSamples 4096 original audio samples
 * @param {number} sampleRate Audio sampling rate in Hz (e.g. 48000)
 * @param {object} options
 * @returns {{ hasPitch: boolean, period: number, frequency: number, confidence: number, refinedM: number, k: number }}
 */
export function detectPitchFromFoldedHamming(magnitudes, rawSamples, sampleRate, options = {}) {
  const minFreq = options.minFreq || 55;
  const maxFreq = options.maxFreq || 1800;
  const binFreq = sampleRate / FFT_SIZE; // e.g. 48000 / 4096 ≈ 11.71875 Hz
  const minBin = Math.max(4, Math.floor(minFreq / binFreq)); // ignore first 4 buckets
  const maxBin = Math.min(magnitudes.length - 1, Math.floor(maxFreq / binFreq));

  // Compute RMS to gate silence
  let energy = 0;
  for (let i = 0; i < rawSamples.length; i++) {
    energy += rawSamples[i] * rawSamples[i];
  }
  const rms = Math.sqrt(energy / rawSamples.length);
  if (rms < 0.003) {
    return { hasPitch: false, period: FFT_SIZE, frequency: 0, confidence: 0, refinedM: FFT_SIZE, k: 0 };
  }

  // Harmonic Folding: For each bucket b, average all integer multiple buckets (b, 2b, 3b, ...)
  const folded = new Float32Array(maxBin + 1);
  for (let b = minBin; b <= maxBin; b++) {
    let sum = 0;
    let count = 0;
    for (let mult = b; mult < magnitudes.length; mult += b) {
      sum += magnitudes[mult];
      count++;
    }
    folded[b] = count > 0 ? sum / count : 0;
  }

  // Find peak in the harmonic-folded spectrum
  let bestBin = -1;
  let maxVal = -Infinity;
  for (let b = minBin + 1; b < maxBin; b++) {
    if (folded[b] > maxVal && folded[b] > folded[b - 1] && folded[b] >= folded[b + 1]) {
      maxVal = folded[b];
      bestBin = b;
    }
  }

  if (bestBin <= 0 || maxVal <= 0) {
    return { hasPitch: false, period: FFT_SIZE, frequency: 0, confidence: 0, refinedM: FFT_SIZE, k: 0 };
  }

  // Fractional Pitch via Two-Bucket Weighted Average:
  // "Say bucket 100 is the strongest bucket and bucket 99 is stronger than bucket 101.
  // We compute a weighted average between 100 and 99. Say we come up with 99.8.
  // This means that the frequency is 48000/99.8 = 480.9619 Hz.
  // We can fit 41.04 wavelengths in the buffer, so we need to time stretch 99.8 * 41 = 4091.8 samples to fit into the 4096 window size.
  // Then, when we move forward, it's okay to truncate down to moving forward 4091 samples."
  const vCenter = folded[bestBin];
  const vLeft = bestBin > minBin ? folded[bestBin - 1] : 0;
  const vRight = bestBin < maxBin ? folded[bestBin + 1] : 0;

  let refinedBin = bestBin;
  if (vLeft >= vRight && vLeft > 0) {
    // Left neighbor is stronger than right neighbor (e.g. 99 vs 101)
    refinedBin = (bestBin * vCenter + (bestBin - 1) * vLeft) / (vCenter + vLeft);
  } else if (vRight > vLeft && vRight > 0) {
    // Right neighbor is stronger than left neighbor
    refinedBin = (bestBin * vCenter + (bestBin + 1) * vRight) / (vCenter + vRight);
  }

  const frequency = refinedBin * binFreq;
  const period = sampleRate / frequency; // Fractional wavelength in samples (e.g. 99.8)

  const wavelengthsInBuffer = FFT_SIZE / period; // e.g. 4096 / 99.8 = 41.04
  const kCycles = Math.floor(wavelengthsInBuffer); // e.g. 41 integer wavelengths
  if (kCycles < 1) {
    return { hasPitch: false, period: FFT_SIZE, frequency: 0, confidence: 0, refinedM: FFT_SIZE, k: 0 };
  }

  // Exact fractional samples to time-stretch: 99.8 * 41 = 4091.8 samples
  const exactM = kCycles * period;

  return {
    hasPitch: true,
    period,
    frequency,
    confidence: Math.min(1.0, Math.max(0.2, (folded[bestBin] / (rms * 10)))),
    k: kCycles,
    idealM: exactM,
    refinedM: exactM
  };
}
