/**
 * Audio Recording and Synthetic Benchmark Engine
 * - Captures exact 2 seconds of real microphone audio via Web Audio API
 * - Generates high-fidelity synthetic benchmark audio (vocal, harmonic tone, vibrato, chirp)
 * - Manages audio playback and synchronized playhead tracking
 */

/**
 * Audio Recording and Synthetic Benchmark Engine
 * - Captures exact 2 seconds of real microphone audio via Web Audio API
 * - Generates high-fidelity synthetic benchmark audio (vocal, harmonic tone, vibrato, chirp)
 * - Manages audio playback and synchronized playhead tracking
 */

/**
 * Records exactly 2.0 seconds of audio from the user's microphone.
 * Creates a dedicated AudioContext only when the recording action is triggered.
 * 
 * @param {(progress: number, level: number) => void} onProgress Callback with progress (0..1) and RMS level
 * @returns {Promise<{ audioBuffer: Float32Array, sampleRate: number }>}
 */
export async function recordTwoSecondsAudio(onProgress = () => {}) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Your browser or current iframe environment does not support navigator.mediaDevices.getUserMedia. Please ensure HTTPS is enabled and microphone permissions are allowed.');
  }

  let stream;
  try {
    // Attempt standard audio stream
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      throw new Error('Microphone permission was denied. Please allow microphone access in your browser address bar settings, or use the "Upload Audio" button.');
    } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      throw new Error('No microphone hardware input was found on this system.');
    } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      throw new Error('The microphone is currently in use or blocked by another application.');
    } else if (err.name === 'SecurityError') {
      throw new Error('Microphone access was blocked by the browser iframe security policy. Please open this app directly or use the "Upload Audio" button.');
    } else {
      throw new Error(`${err.name || 'Error'}: ${err.message || 'Could not access microphone.'}`);
    }
  }

  // Create AudioContext strictly upon demand inside the user gesture
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('Web Audio API is not supported in this browser.');
  }

  const audioCtx = new AudioContextClass();
  if (audioCtx.state === 'suspended') {
    try {
      await audioCtx.resume();
    } catch (e) {
      console.warn('AudioContext resume deferred:', e);
    }
  }

  const sampleRate = audioCtx.sampleRate || 48000;
  const targetSamples = Math.floor(sampleRate * 2.0); // Exact 2.0 seconds
  const recordedData = new Float32Array(targetSamples);

  const sourceNode = audioCtx.createMediaStreamSource(stream);
  const bufferSize = 2048;
  const scriptNode = audioCtx.createScriptProcessor(bufferSize, 1, 1);

  // Silent gain node to avoid screeching acoustic feedback through speakers
  const muteNode = audioCtx.createGain();
  muteNode.gain.value = 0;

  let samplesRecorded = 0;
  let isCleanedUp = false;

  return new Promise((resolve, reject) => {
    // Safety timeout in case stream freezes
    const timeoutId = setTimeout(() => {
      if (samplesRecorded > sampleRate * 0.5) {
        cleanup();
        resolve({
          audioBuffer: recordedData,
          sampleRate
        });
      } else {
        cleanup();
        reject(new Error('Microphone recording timed out. No audio data was received from the device.'));
      }
    }, 4500);

    scriptNode.onaudioprocess = (e) => {
      if (isCleanedUp) return;
      const input = e.inputBuffer.getChannelData(0);
      let chunkRms = 0;

      for (let i = 0; i < input.length; i++) {
        const s = input[i];
        chunkRms += s * s;
        if (samplesRecorded < targetSamples) {
          recordedData[samplesRecorded++] = s;
        }
      }

      chunkRms = Math.sqrt(chunkRms / input.length);
      const progress = Math.min(1.0, samplesRecorded / targetSamples);
      onProgress(progress, chunkRms);

      if (samplesRecorded >= targetSamples) {
        clearTimeout(timeoutId);
        cleanup();
        resolve({
          audioBuffer: recordedData,
          sampleRate
        });
      }
    };

    function cleanup() {
      if (isCleanedUp) return;
      isCleanedUp = true;
      clearTimeout(timeoutId);
      try {
        scriptNode.disconnect();
        muteNode.disconnect();
        sourceNode.disconnect();
        stream.getTracks().forEach((track) => track.stop());
        audioCtx.close().catch(() => {});
      } catch {
        // ignore cleanup errors
      }
    }

    sourceNode.connect(scriptNode);
    scriptNode.connect(muteNode);
    muteNode.connect(audioCtx.destination);
  });
}

/**
 * Decodes and loads an uploaded audio file (.wav, .mp3, .m4a, .ogg)
 * Creates a temporary AudioContext solely for decoding, then closes it.
 * 
 * @param {File} file
 * @returns {Promise<{ audioBuffer: Float32Array, sampleRate: number, name: string }>}
 */
export async function loadAudioFile(file) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error('Web Audio API is not supported in this browser.');
  }
  const audioCtx = new AudioContextClass();
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    const channelData = decodedBuffer.getChannelData(0);
    const sampleRate = decodedBuffer.sampleRate;

    // Take first 2 to 4 seconds of audio (cap at 4 seconds for fast FFT processing)
    const maxSeconds = 2.5;
    const numSamples = Math.min(channelData.length, Math.floor(sampleRate * maxSeconds));
    const audioBuffer = new Float32Array(numSamples);
    audioBuffer.set(channelData.subarray(0, numSamples));

    return {
      audioBuffer,
      sampleRate,
      name: file.name
    };
  } finally {
    audioCtx.close().catch(() => {});
  }
}

/**
 * Generates synthetic reference audio signals (2.0 seconds) for immediate testing
 * @param {'vocal' | 'vibrato' | 'chirp' | 'chord'} presetType
 * @param {number} [sampleRate=48000]
 * @returns {{ audioBuffer: Float32Array, sampleRate: number }}
 */
export function generateSyntheticAudio(presetType = 'vocal', sampleRate = 48000) {
  const numSamples = sampleRate * 2; // 2 seconds
  const buffer = new Float32Array(numSamples);

  if (presetType === 'vibrato') {
    // 440 Hz flute / violin tone with 5.5 Hz vibrato and natural harmonic series
    const baseFreq = 440.0;
    const vibratoRate = 5.5;
    const vibratoDepth = 12.0; // +/- 12 Hz

    let phase = 0;
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const instFreq = baseFreq + vibratoDepth * Math.sin(2 * Math.PI * vibratoRate * t);
      phase += (2 * Math.PI * instFreq) / sampleRate;

      // Harmonic series with decaying amplitudes
      let sample = 0.50 * Math.sin(phase) +
                   0.25 * Math.sin(phase * 2) +
                   0.15 * Math.sin(phase * 3) +
                   0.08 * Math.sin(phase * 4) +
                   0.04 * Math.sin(phase * 5);

      // Smooth attack/decay envelope
      const env = Math.min(1.0, t * 15) * Math.min(1.0, (2.0 - t) * 10);
      buffer[i] = sample * env * 0.8;
    }
  } else if (presetType === 'vocal') {
    // Synthetic singing voice vowel /a/ around 220 Hz with glottal pulse harmonics
    const f0 = 220.0;
    let phase = 0;

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      // Slight pitch drift
      const instF0 = f0 + 2.0 * Math.sin(2 * Math.PI * 1.5 * t);
      phase += (2 * Math.PI * instF0) / sampleRate;

      // Vocal formants F1 ≈ 700 Hz, F2 ≈ 1200 Hz, F3 ≈ 2800 Hz
      let sample = 0;
      for (let h = 1; h <= 18; h++) {
        const harmonicFreq = h * instF0;
        // Formant filter envelope weights
        const f1Weight = Math.exp(-Math.pow((harmonicFreq - 720) / 250, 2));
        const f2Weight = 0.7 * Math.exp(-Math.pow((harmonicFreq - 1240) / 300, 2));
        const f3Weight = 0.4 * Math.exp(-Math.pow((harmonicFreq - 2600) / 400, 2));
        const baseRolloff = 1.0 / Math.pow(h, 0.8);
        const amp = (baseRolloff * 0.3 + f1Weight * 0.8 + f2Weight * 0.5 + f3Weight * 0.3);

        sample += amp * Math.sin(phase * h);
      }

      const env = Math.min(1.0, t * 20) * Math.min(1.0, (2.0 - t) * 10);
      buffer[i] = sample * env * 0.35;
    }
  } else if (presetType === 'chirp') {
    // Linear frequency sweep from 200 Hz to 1200 Hz
    const fStart = 200;
    const fEnd = 1200;
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const freq = fStart + ((fEnd - fStart) * t) / 2.0;
      const phase = 2 * Math.PI * (fStart * t + 0.5 * ((fEnd - fStart) / 2.0) * t * t);
      const sample = 0.6 * Math.sin(phase) + 0.3 * Math.sin(2 * phase) + 0.15 * Math.sin(3 * phase);
      const env = Math.min(1.0, t * 15) * Math.min(1.0, (2.0 - t) * 10);
      buffer[i] = sample * env;
    }
  } else {
    // Harmonic Chord: C4 (261.63 Hz) + G4 (392.00 Hz)
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const s1 = 0.4 * Math.sin(2 * Math.PI * 261.63 * t) + 0.2 * Math.sin(2 * Math.PI * 523.25 * t);
      const s2 = 0.35 * Math.sin(2 * Math.PI * 392.00 * t) + 0.15 * Math.sin(2 * Math.PI * 784.00 * t);
      const env = Math.min(1.0, t * 15) * Math.min(1.0, (2.0 - t) * 10);
      buffer[i] = (s1 + s2) * env;
    }
  }

  return { audioBuffer: buffer, sampleRate };
}

/**
 * Audio Player for playback and playhead tracking
 */
export class AudioPlaybackController {
  constructor() {
    this.rawSamples = null;
    this.audioBuffer = null;
    this.sampleRate = 48000;
    this.audioCtx = null;
    this.sourceNode = null;
    this.isPlaying = false;
    this.startTime = 0;
    this.pausedAt = 0;
    this.onPlayheadUpdate = null;
    this.onStateChange = null;
    this.animFrameId = null;
  }

  loadAudio(float32Array, sampleRate) {
    this.stop();
    this.rawSamples = float32Array;
    this.sampleRate = sampleRate;
    this.audioBuffer = null; // instantiated only when play() is pressed
    this.pausedAt = 0;
  }

  async play() {
    if (!this.rawSamples) return;

    if (this.isPlaying) {
      this.pause();
      return;
    }

    // Create or resume AudioContext strictly inside user play gesture
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContextClass();
    }
    if (this.audioCtx.state === 'suspended') {
      try {
        await this.audioCtx.resume();
      } catch (e) {
        console.warn('Playback audioCtx resume:', e);
      }
    }

    if (!this.audioBuffer) {
      this.audioBuffer = this.audioCtx.createBuffer(1, this.rawSamples.length, this.sampleRate);
      this.audioBuffer.copyToChannel(this.rawSamples, 0);
    }

    this.sourceNode = this.audioCtx.createBufferSource();
    this.sourceNode.buffer = this.audioBuffer;
    this.sourceNode.connect(this.audioCtx.destination);

    const offset = this.pausedAt % this.audioBuffer.duration;
    this.startTime = this.audioCtx.currentTime - offset;
    this.sourceNode.start(0, offset);
    this.isPlaying = true;

    this.sourceNode.onended = () => {
      if (this.isPlaying) {
        this.isPlaying = false;
        this.pausedAt = 0;
        if (this.onPlayheadUpdate) this.onPlayheadUpdate(-1);
        if (this.onStateChange) this.onStateChange(false);
        cancelAnimationFrame(this.animFrameId);
      }
    };

    if (this.onStateChange) this.onStateChange(true);
    this.startPlayheadLoop();
  }

  pause() {
    if (!this.isPlaying) return;
    if (this.audioCtx) {
      this.pausedAt = this.audioCtx.currentTime - this.startTime;
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.stop();
        this.sourceNode.disconnect();
      } catch (e) {
        // ignore
      }
    }
    this.isPlaying = false;
    cancelAnimationFrame(this.animFrameId);
    if (this.onStateChange) this.onStateChange(false);
  }

  stop() {
    this.pause();
    this.pausedAt = 0;
    if (this.onPlayheadUpdate) this.onPlayheadUpdate(-1);
  }

  seek(timeInSeconds) {
    const wasPlaying = this.isPlaying;
    this.stop();
    this.pausedAt = Math.max(0, Math.min(2.0, timeInSeconds));
    if (this.onPlayheadUpdate) this.onPlayheadUpdate(this.pausedAt);
    if (wasPlaying) {
      this.play();
    }
  }

  startPlayheadLoop() {
    if (!this.audioBuffer || !this.audioCtx) return;
    const duration = this.audioBuffer.duration;

    const tick = () => {
      if (!this.isPlaying || !this.audioCtx) return;
      const current = (this.audioCtx.currentTime - this.startTime) % duration;
      if (this.onPlayheadUpdate) {
        this.onPlayheadUpdate(current);
      }
      this.animFrameId = requestAnimationFrame(tick);
    };

    this.animFrameId = requestAnimationFrame(tick);
  }
}
