/**
 * High-performance 4096-point Radix-2 Cooley-Tukey Fast Fourier Transform
 * Pure JavaScript with precomputed bit-reversal and twiddle factor lookup tables.
 */

const FFT_SIZE = 4096;

// Precompute bit-reversal permutation table for N = 4096
const bitReverseTable = new Uint32Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) {
  let rev = 0;
  let temp = i;
  for (let j = 0; j < 12; j++) { // 2^12 = 4096
    rev = (rev << 1) | (temp & 1);
    temp >>= 1;
  }
  bitReverseTable[i] = rev;
}

// Precompute twiddle factors (cos and -sin)
const cosTable = new Float32Array(FFT_SIZE / 2);
const sinTable = new Float32Array(FFT_SIZE / 2);
for (let i = 0; i < FFT_SIZE / 2; i++) {
  const angle = (-2.0 * Math.PI * i) / FFT_SIZE;
  cosTable[i] = Math.cos(angle);
  sinTable[i] = Math.sin(angle);
}

// Precompute Hamming window coefficients for N = 4096
// w[n] = 0.54 - 0.46 * cos(2 * pi * n / (N - 1))
const hammingWindow = new Float32Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) {
  hammingWindow[i] = 0.54 - 0.46 * Math.cos((2.0 * Math.PI * i) / (FFT_SIZE - 1));
}

// Working buffers to avoid allocations per FFT call
const realBuffer = new Float32Array(FFT_SIZE);
const imagBuffer = new Float32Array(FFT_SIZE);

/**
 * Computes in-place Radix-2 FFT on real & imag buffers of length 4096
 */
function transform(real, imag) {
  // Bit-reversal permutation
  for (let i = 0; i < FFT_SIZE; i++) {
    const j = bitReverseTable[i];
    if (j > i) {
      const tr = real[i];
      real[i] = real[j];
      real[j] = tr;

      const ti = imag[i];
      imag[i] = imag[j];
      imag[j] = ti;
    }
  }

  // Cooley-Tukey Radix-2 decimation-in-time
  for (let halfSize = 1; halfSize < FFT_SIZE; halfSize <<= 1) {
    const step = halfSize << 1;
    const twiddleStep = FFT_SIZE / step;

    for (let m = 0; m < halfSize; m++) {
      const twiddleIdx = m * twiddleStep;
      const wr = cosTable[twiddleIdx];
      const wi = sinTable[twiddleIdx];

      for (let i = m; i < FFT_SIZE; i += step) {
        const j = i + halfSize;
        const tr = wr * real[j] - wi * imag[j];
        const ti = wr * imag[j] + wi * real[j];

        real[j] = real[i] - tr;
        imag[j] = imag[i] - ti;
        real[i] += tr;
        imag[i] += ti;
      }
    }
  }
}

/**
 * Computes the magnitude spectrum of a 4096-sample audio segment
 * @param {Float32Array} samples 4096 samples
 * @param {'none' | 'hamming'} windowType Windowing function
 * @returns {{ magnitudes: Float32Array, dBs: Float32Array }} 2049 frequency bins (0 to Nyquist)
 */
export function computeFFT4096(samples, windowType = 'none') {
  const numBins = (FFT_SIZE / 2) + 1; // 2049 bins
  const magnitudes = new Float32Array(numBins);
  const dBs = new Float32Array(numBins);

  if (windowType === 'hamming') {
    for (let i = 0; i < FFT_SIZE; i++) {
      realBuffer[i] = samples[i] * hammingWindow[i];
      imagBuffer[i] = 0;
    }
  } else {
    // Rectangular / None
    for (let i = 0; i < FFT_SIZE; i++) {
      realBuffer[i] = samples[i];
      imagBuffer[i] = 0;
    }
  }

  transform(realBuffer, imagBuffer);

  // Compute magnitude and dB
  // Normalize by FFT_SIZE / 2 (or FFT_SIZE for DC/Nyquist)
  const normFactor = 2.0 / FFT_SIZE;
  const eps = 1e-12; // Avoid log(0)

  for (let k = 0; k < numBins; k++) {
    const r = realBuffer[k];
    const im = imagBuffer[k];
    const mag = Math.sqrt(r * r + im * im) * normFactor;
    magnitudes[k] = mag;
    // Decibels: 20 * log10(mag)
    dBs[k] = 20.0 * Math.log10(Math.max(mag, eps));
  }

  return { magnitudes, dBs };
}

export { FFT_SIZE, hammingWindow };
