/**
 * High-precision YIN Pitch Detection Algorithm
 * De-facto DSP standard for fundamental frequency (F0) estimation.
 * Operates on a 4096-sample audio segment.
 */

const YIN_WINDOW_SIZE = 2048; // Window size for difference function
const YIN_DEFAULT_THRESHOLD = 0.18; // Typical dip threshold for harmonic periodicity

/**
 * Detects the fundamental pitch period of a 4096-sample buffer.
 * @param {Float32Array} samples 4096 audio samples
 * @param {number} sampleRate Audio sampling rate in Hz (e.g. 44100 or 48000)
 * @param {number} minFreq Minimum detectable frequency in Hz (default: 50 Hz)
 * @param {number} maxFreq Maximum detectable frequency in Hz (default: 2000 Hz)
 * @returns {{ hasPitch: boolean, period: number, frequency: number, confidence: number }}
 */
export function detectPitchYIN(samples, sampleRate, minFreq = 50, maxFreq = 2000) {
  const minPeriod = Math.max(4, Math.floor(sampleRate / maxFreq));
  const maxPeriod = Math.min(Math.floor(sampleRate / minFreq), 4096 - YIN_WINDOW_SIZE - 2);

  // Compute RMS energy to gate silent or near-silent sections
  let energySum = 0;
  for (let i = 0; i < samples.length; i++) {
    energySum += samples[i] * samples[i];
  }
  const rms = Math.sqrt(energySum / samples.length);
  if (rms < 0.003) {
    return { hasPitch: false, period: 4096, frequency: 0, confidence: 0 };
  }

  // Step 1: Difference function d(tau)
  const d = new Float32Array(maxPeriod + 2);
  for (let tau = 1; tau <= maxPeriod + 1; tau++) {
    let sum = 0;
    for (let j = 0; j < YIN_WINDOW_SIZE; j++) {
      const diff = samples[j] - samples[j + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }

  // Step 2: Cumulative mean normalized difference function d'(tau)
  const dPrime = new Float32Array(maxPeriod + 2);
  dPrime[0] = 1.0;
  let runningSum = 0;

  for (let tau = 1; tau <= maxPeriod + 1; tau++) {
    runningSum += d[tau];
    dPrime[tau] = runningSum > 0 ? (d[tau] * tau) / runningSum : 1.0;
  }

  // Step 3: Absolute thresholding
  let tauFound = -1;
  for (let tau = minPeriod; tau <= maxPeriod; tau++) {
    if (dPrime[tau] < YIN_DEFAULT_THRESHOLD) {
      // Find local minimum
      while (tau + 1 <= maxPeriod && dPrime[tau + 1] < dPrime[tau]) {
        tau++;
      }
      tauFound = tau;
      break;
    }
  }

  // Fallback: If no dip was below the primary threshold, find the best global minimum
  if (tauFound === -1) {
    let bestTau = -1;
    let minVal = 0.35; // Looser threshold for noisier or weaker voiced sounds
    for (let tau = minPeriod; tau <= maxPeriod; tau++) {
      if (dPrime[tau] < minVal && dPrime[tau] < dPrime[tau - 1] && dPrime[tau] < dPrime[tau + 1]) {
        minVal = dPrime[tau];
        bestTau = tau;
      }
    }
    if (bestTau !== -1) {
      tauFound = bestTau;
    }
  }

  if (tauFound === -1) {
    // Unvoiced, noise, or no distinct periodicity
    return { hasPitch: false, period: 4096, frequency: 0, confidence: 0 };
  }

  // Step 4: Parabolic interpolation for sub-sample accuracy
  const x0 = tauFound > 1 ? tauFound - 1 : tauFound;
  const x2 = tauFound + 1 <= maxPeriod ? tauFound + 1 : tauFound;
  let betterTau = tauFound;

  if (x0 !== tauFound && x2 !== tauFound) {
    const s0 = dPrime[x0];
    const s1 = dPrime[tauFound];
    const s2 = dPrime[x2];
    const denom = 2.0 * (2.0 * s1 - s0 - s2);
    if (Math.abs(denom) > 1e-6) {
      const delta = (s2 - s0) / denom;
      betterTau = tauFound + delta;
    }
  }

  const confidence = Math.max(0, Math.min(1.0, 1.0 - dPrime[tauFound]));
  const frequency = sampleRate / betterTau;

  return {
    hasPitch: true,
    period: betterTau,
    frequency,
    confidence
  };
}
