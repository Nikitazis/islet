// A soft two-note chime made with WebAudio, so no sound file ships with the app.

let context = null;

export function chime({ repeat = 1 } = {}) {
  try {
    context ??= new AudioContext();
    const start = context.currentTime + 0.02;
    for (let r = 0; r < repeat; r++) {
      [880, 1318.5].forEach((frequency, i) => {
        const at = start + r * 0.9 + i * 0.16;
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.type = 'sine';
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.18, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.9);
        osc.connect(gain).connect(context.destination);
        osc.start(at);
        osc.stop(at + 1);
      });
    }
  } catch {
    // No audio device: the notification still shows.
  }
}
