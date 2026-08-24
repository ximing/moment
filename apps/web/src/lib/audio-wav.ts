// 录音产物转码（spec voice-moment §5）：MediaRecorder 采集的 webm/opus 不在 ASR 白名单
// （dto AUDIO_MIME_TYPES 不收 audio/webm|ogg），浏览器内解码 → 重采样 16kHz mono → PCM16 WAV。
// 纯 Web API 无依赖；5 分钟 ≈ 9.6MB，远低于 25MB 上限。

/** 目标采样率：16kHz mono（ASR 通用输入规格） */
export const WAV_SAMPLE_RATE = 16000;

/** Float32 PCM → 16bit PCM WAV（RIFF 头 + 数据块）。 */
export function encodeWavPcm16(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * bytesPerSample, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/** MediaRecorder 产物（任意浏览器可解码容器）→ 16kHz mono WAV + 时长（秒，≥1 整数，供 presign durationSeconds）。 */
export async function recorderBlobToWav(raw: Blob): Promise<{ blob: Blob; durationSeconds: number }> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await raw.arrayBuffer());
    const frames = Math.max(1, Math.ceil(decoded.duration * WAV_SAMPLE_RATE));
    // OfflineAudioContext 一并完成重采样与 down-mix 单声道（channelCount=1）
    const offline = new OfflineAudioContext(1, frames, WAV_SAMPLE_RATE);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    const rendered = await offline.startRendering();
    return {
      blob: encodeWavPcm16(rendered.getChannelData(0), WAV_SAMPLE_RATE),
      durationSeconds: Math.max(1, Math.round(rendered.duration)),
    };
  } finally {
    void ctx.close();
  }
}
