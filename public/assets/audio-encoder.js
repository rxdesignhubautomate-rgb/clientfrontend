/* MP3 encoding runs away from the chat UI. lamejs: LGPL-3.0. */
importScripts("lame.min.js");
self.onmessage = (event) => {
  try {
    const { samples, sampleRate } = event.data;
    const encoder = new lamejs.Mp3Encoder(1, sampleRate, 128),
      output = [];
    for (let offset = 0; offset < samples.length; offset += 1152) {
      const pcm = new Int16Array(Math.min(1152, samples.length - offset));
      for (let i = 0; i < pcm.length; i++) {
        const value = Math.max(-1, Math.min(1, samples[offset + i]));
        pcm[i] = value < 0 ? value * 32768 : value * 32767;
      }
      const block = encoder.encodeBuffer(pcm);
      if (block.length) output.push(new Uint8Array(block));
    }
    const end = encoder.flush();
    if (end.length) output.push(new Uint8Array(end));
    self.postMessage({ blob: new Blob(output, { type: "audio/mpeg" }) });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
