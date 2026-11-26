const SAMPLE_RATE = 16000;

function wave(samples) {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const tag = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  tag(0, 'RIFF');
  view.setUint32(4, bytes.byteLength - 8, true);
  tag(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => view.setInt16(44 + i * 2, sample, true));
  return new Blob([bytes], {type:'audio/wav'});
}

export async function beginVoiceRecording(signal) {
  if (!navigator.mediaDevices?.getUserMedia || !globalThis.AudioWorkletNode) throw Error('voice_unsupported');
  const stream = await navigator.mediaDevices.getUserMedia({audio:true, video:false});
  let context, recorder, timer, stopTimer;
  function release() {
    clearTimeout(timer);
    clearTimeout(stopTimer);
    stream.getTracks().forEach(track => track.stop());
    recorder?.port.close();
    if (context && context.state !== 'closed') void context.close().catch(()=>{});
  }
  signal.addEventListener('abort', release, {once:true});
  try {
    signal.throwIfAborted();
    context = new AudioContext({sampleRate:SAMPLE_RATE});
    if (context.sampleRate !== SAMPLE_RATE) throw Error('voice_capture');
    try {
      await context.audioWorklet.addModule(new URL('./voice-worklet.js', import.meta.url));
    } catch (cause) {
      throw new Error('voice_module', {cause});
    }
    signal.throwIfAborted();
    const source = context.createMediaStreamSource(stream);
    recorder = new AudioWorkletNode(context, 'arcade-social-voice', {channelCount:1,channelCountMode:'explicit'});
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(recorder).connect(mute).connect(context.destination);
    await context.resume();
    signal.throwIfAborted();
    let rejectCapture;
    const result = new Promise((resolve, reject) => {
      rejectCapture = reject;
      signal.addEventListener('abort', () => reject(signal.reason), {once:true});
      recorder.addEventListener('processorerror', () => reject(Error('voice_capture')), {once:true});
      stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => reject(Error('voice_capture')), {once:true}));
      recorder.port.onmessage = ({data}) => {
        if (data instanceof Int16Array && data.length >= SAMPLE_RATE / 5) resolve(wave(data));
        else reject(Error('voice_duration'));
      };
    }).finally(release);
    const stop = () => {
      if (stopTimer) return;
      recorder.port.postMessage('finish');
      stopTimer = setTimeout(() => rejectCapture(Error('voice_capture')), 1500);
    };
    timer = setTimeout(stop, 30_000);
    return {stop, result};
  } catch (error) {
    release();
    throw error;
  }
}
