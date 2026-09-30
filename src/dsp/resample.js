/**
 * High-fidelity Resampling / Time-Stretching Module
 * Uses Catmull-Rom cubic spline interpolation to time-stretch
 * M samples (an exact integer multiple of wavelengths) to 4096 samples.
 */

const TARGET_SIZE = 4096;

/**
 * Catmull-Rom cubic spline sample interpolation
 * @param {Float32Array} audio Full audio buffer
 * @param {number} pos Fractional sample position
 * @returns {number} Interpolated sample amplitude
 */
function interpolateCatmullRom(audio, pos) {
  const len = audio.length;
  const idx = Math.floor(pos);
  const frac = pos - idx;

  const i0 = Math.max(0, Math.min(len - 1, idx - 1));
  const i1 = Math.max(0, Math.min(len - 1, idx));
  const i2 = Math.max(0, Math.min(len - 1, idx + 1));
  const i3 = Math.max(0, Math.min(len - 1, idx + 2));

  const y0 = audio[i0];
  const y1 = audio[i1];
  const y2 = audio[i2];
  const y3 = audio[i3];

  const a0 = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
  const a1 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
  const a2 = -0.5 * y0 + 0.5 * y2;
  const a3 = y1;

  return a0 * frac * frac * frac + a1 * frac * frac + a2 * frac + a3;
}

/**
 * Resamples M samples starting at startOffset into exactly 4096 samples.
 * If M === 4096, performs direct copy.
 * 
 * @param {Float32Array} fullAudio Entire audio buffer
 * @param {number} startOffset Start index in fullAudio
 * @param {number} M Number of original audio samples to stretch (M <= 4096)
 * @param {Float32Array} [outBuffer] Optional pre-allocated Float32Array(4096)
 * @returns {Float32Array} Stretched buffer of length 4096
 */
export function timeStretchTo4096(fullAudio, startOffset, M, outBuffer = null) {
  const out = outBuffer || new Float32Array(TARGET_SIZE);

  if (Math.abs(M - TARGET_SIZE) < 1e-4) {
    // Exact 4096 copy
    for (let i = 0; i < TARGET_SIZE; i++) {
      const idx = startOffset + i;
      out[i] = idx < fullAudio.length ? fullAudio[idx] : 0;
    }
    return out;
  }

  // Time-stretch M samples into 4096 samples
  // Each step in target buffer advances by M / TARGET_SIZE in the original audio
  const step = M / TARGET_SIZE;
  for (let i = 0; i < TARGET_SIZE; i++) {
    const origPos = startOffset + i * step;
    if (origPos >= fullAudio.length) {
      out[i] = 0;
    } else {
      out[i] = interpolateCatmullRom(fullAudio, origPos);
    }
  }

  return out;
}
