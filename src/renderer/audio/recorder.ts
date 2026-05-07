export interface RecorderHandle {
  stop: () => Promise<Blob>;
  cancel: () => void;
  getLevel: () => number;
}

export type RecordingSource = 'loopback' | 'mic';

export async function startRecorder(
  audioContext: AudioContext,
  source: RecordingSource
): Promise<RecorderHandle> {
  const audioStream =
    source === 'mic' ? await openMicStream() : await openLoopbackStream();
  return runRecorder(audioContext, audioStream);
}

export async function startLoopbackRecorder(
  audioContext: AudioContext
): Promise<RecorderHandle> {
  return startRecorder(audioContext, 'loopback');
}

async function openLoopbackStream(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    audio: true,
    video: true
  });

  for (const track of stream.getVideoTracks()) {
    stream.removeTrack(track);
    track.stop();
  }

  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    stream.getTracks().forEach((t) => t.stop());
    throw new DOMException(
      'No system audio track returned by getDisplayMedia.',
      'NotFoundError'
    );
  }
  return new MediaStream(audioTracks);
}

async function openMicStream(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    },
    video: false
  });
  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach((t) => t.stop());
    throw new DOMException(
      'No microphone audio track returned by getUserMedia.',
      'NotFoundError'
    );
  }
  return stream;
}

function runRecorder(
  audioContext: AudioContext,
  audioStream: MediaStream
): RecorderHandle {
  const sourceNode = audioContext.createMediaStreamSource(audioStream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  sourceNode.connect(analyser);

  const meterBuffer = new Float32Array(analyser.fftSize);

  const recorder = new MediaRecorder(audioStream, {
    mimeType: pickMime()
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const stopped = new Promise<Blob>((resolveStop, rejectStop) => {
    recorder.onstop = () => {
      cleanup();
      resolveStop(new Blob(chunks, { type: recorder.mimeType }));
    };
    recorder.onerror = (e) => {
      cleanup();
      rejectStop(e);
    };
  });

  recorder.start(250);

  function cleanup(): void {
    try {
      sourceNode.disconnect();
      analyser.disconnect();
    } catch {
      /* ignore */
    }
    audioStream.getTracks().forEach((t) => t.stop());
  }

  return {
    stop: () => {
      if (recorder.state !== 'inactive') recorder.stop();
      return stopped;
    },
    cancel: () => {
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } finally {
        cleanup();
      }
    },
    getLevel: () => {
      analyser.getFloatTimeDomainData(meterBuffer);
      let peak = 0;
      for (let i = 0; i < meterBuffer.length; i++) {
        const v = Math.abs(meterBuffer[i] ?? 0);
        if (v > peak) peak = v;
      }
      return peak;
    }
  };
}

function pickMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  for (const m of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}
