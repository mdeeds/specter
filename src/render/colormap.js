/**
 * High-performance scientific colormaps for spectrogram rendering
 * Includes Inferno (default), Viridis, and Turbo palettes.
 */

// 256-step Inferno colormap (optimized RGB triplets)
// Formatted as flat Uint8ClampedArray [R, G, B, A, R, G, B, A, ...]
function generateInferno() {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    // High-accuracy polynomial approximations for Inferno
    const r = Math.max(0, Math.min(255, Math.round(255 * (0.0002 + 0.407 * t + 1.83 * t * t - 1.24 * t * t * t))));
    const g = Math.max(0, Math.min(255, Math.round(255 * (0.0016 + 0.038 * t + 0.99 * t * t - 0.03 * t * t * t))));
    const b = Math.max(0, Math.min(255, Math.round(255 * (0.016 + 1.25 * t - 1.62 * t * t + 0.35 * t * t * t))));

    const idx = i * 4;
    lut[idx] = r;
    lut[idx + 1] = g;
    lut[idx + 2] = b;
    lut[idx + 3] = 255;
  }
  return lut;
}

// 256-step Viridis colormap
function generateViridis() {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const r = Math.max(0, Math.min(255, Math.round(255 * (0.2777 - 0.1065 * t + 0.8105 * t * t))));
    const g = Math.max(0, Math.min(255, Math.round(255 * (0.0055 + 1.4045 * t - 0.4101 * t * t))));
    const b = Math.max(0, Math.min(255, Math.round(255 * (0.3340 + 1.3846 * t - 1.7186 * t * t))));

    const idx = i * 4;
    lut[idx] = r;
    lut[idx + 1] = g;
    lut[idx + 2] = b;
    lut[idx + 3] = 255;
  }
  return lut;
}

// 256-step Turbo colormap
function generateTurbo() {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    const r = Math.max(0, Math.min(255, Math.round(255 * (0.1357 + 4.6153 * x - 42.6603 * Math.pow(x, 2) + 132.131 * Math.pow(x, 3) - 152.942 * Math.pow(x, 4) + 59.2863 * Math.pow(x, 5)))));
    const g = Math.max(0, Math.min(255, Math.round(255 * (0.0914 + 2.1941 * x + 4.8429 * Math.pow(x, 2) - 14.185 * Math.pow(x, 3) + 4.2772 * Math.pow(x, 4) + 2.8295 * Math.pow(x, 5)))));
    const b = Math.max(0, Math.min(255, Math.round(255 * (0.1066 + 12.559 * x - 60.135 * Math.pow(x, 2) + 109.074 * Math.pow(x, 3) - 88.506 * Math.pow(x, 4) + 26.8183 * Math.pow(x, 5)))));

    const idx = i * 4;
    lut[idx] = r;
    lut[idx + 1] = g;
    lut[idx + 2] = b;
    lut[idx + 3] = 255;
  }
  return lut;
}

export const COLORMAPS = {
  inferno: generateInferno(),
  viridis: generateViridis(),
  turbo: generateTurbo()
};
