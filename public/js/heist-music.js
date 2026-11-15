(() => {
  const button = document.getElementById('musicBtn');
  const volumeControl = document.getElementById('musicVolume');
  const bars = document.getElementById('musicBars');
  if (!button || !volumeControl || !bars) return;

  const STORAGE_KEY = 'heistMusic';
  const VOLUME_KEY = 'heistMusicVolume';
  const AudioContext = window.AudioContext || window.webkitAudioContext;

  let context = null;
  let master = null;
  let echoBus = null;
  let noiseBuffer = null;
  let timer = null;
  let step = 0;
  let nextNoteTime = 0;
  const savedVolume = localStorage.getItem(VOLUME_KEY);
  let volume = savedVolume === null ? 0.3 : Number(savedVolume);
  let isPlaying = false;
  let isMuted = false;
  const bpm = 96;
  const bass = [
    45, 0, 45, 0, 45, 45, 0, 45,
    46, 0, 46, 0, 46, 46, 0, 46,
    45, 0, 45, 0, 45, 45, 0, 45,
    40, 0, 40, 0, 40, 40, 0, 40,
  ];
  const lead = [
    69, 0, 72, 0, 76, 0, 72, 0,
    70, 0, 74, 0, 77, 0, 74, 0,
    69, 0, 72, 0, 76, 0, 81, 0,
    80, 0, 76, 0, 72, 0, 71, 0,
  ];
  const pads = [[57, 60, 64], [58, 62, 65], [57, 60, 64], [56, 59, 64]];

  if (!Number.isFinite(volume)) volume = 0.3;
  volume = Math.min(1, Math.max(0, volume));
  volumeControl.value = String(Math.round(volume * 100));

  function frequency(note) {
    return 440 * (2 ** ((note - 69) / 12));
  }

  function initializeAudio() {
    if (!AudioContext) {
      button.textContent = 'Music unavailable';
      button.disabled = true;
      volumeControl.disabled = true;
      return false;
    }

    if (context) return true;
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = isMuted ? 0 : volume;
    const compressor = context.createDynamicsCompressor();
    master.connect(compressor);
    compressor.connect(context.destination);

    echoBus = context.createGain();
    const delay = context.createDelay();
    delay.delayTime.value = 0.28;
    const feedback = context.createGain();
    feedback.gain.value = 0.35;
    const lowPass = context.createBiquadFilter();
    lowPass.type = 'lowpass';
    lowPass.frequency.value = 1800;
    echoBus.connect(master);
    echoBus.connect(delay);
    delay.connect(lowPass);
    lowPass.connect(feedback);
    feedback.connect(delay);
    lowPass.connect(master);

    noiseBuffer = context.createBuffer(1, Math.floor(context.sampleRate * 0.1), context.sampleRate);
    const noise = noiseBuffer.getChannelData(0);
    for (let index = 0; index < noise.length; index += 1) {
      noise[index] = Math.random() * 2 - 1;
    }
    return true;
  }

  function playTone(type, hz, at, duration, level, cutoff) {
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.value = hz;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(level, at + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(echoBus);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.05);
  }

  function playKick(at) {
    const oscillator = context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(120, at);
    oscillator.frequency.exponentialRampToValueAtTime(40, at + 0.15);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.42, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(at);
    oscillator.stop(at + 0.3);
  }

  function playHat(at) {
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7000;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.07, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(at);
  }

  function playPad(notes, at, duration) {
    notes.forEach((note) => {
      [-6, 6].forEach((detune) => {
        const oscillator = context.createOscillator();
        oscillator.type = 'sawtooth';
        oscillator.frequency.value = frequency(note);
        oscillator.detune.value = detune;
        const filter = context.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 700;
        const gain = context.createGain();
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.linearRampToValueAtTime(0.025, at + duration * 0.4);
        gain.gain.linearRampToValueAtTime(0.0001, at + duration);
        oscillator.connect(filter);
        filter.connect(gain);
        gain.connect(echoBus);
        oscillator.start(at);
        oscillator.stop(at + duration + 0.1);
      });
    });
  }

  function scheduleNotes() {
    const stepDuration = 60 / bpm / 2;
    while (nextNoteTime < context.currentTime + 0.2) {
      const currentStep = step % 32;
      const at = nextNoteTime;
      if (bass[currentStep]) {
        playTone('sawtooth', frequency(bass[currentStep]), at, stepDuration * 1.6, 0.22, 320);
      }
      if (step >= 8 && lead[currentStep]) {
        playTone('triangle', frequency(lead[currentStep]), at, stepDuration * 2.2, 0.11, 2400);
      }
      if (currentStep % 2 === 0) playKick(at);
      else playHat(at);
      if (currentStep % 8 === 0) playPad(pads[Math.floor(currentStep / 8)], at, stepDuration * 8);
      step += 1;
      nextNoteTime += stepDuration;
    }
  }

  function updateButton() {
    button.textContent = isPlaying ? 'Music on' : 'Music off';
    button.setAttribute('aria-pressed', String(isPlaying));
    bars.classList.toggle('on', isPlaying);
  }

  async function startMusic() {
    if (!initializeAudio()) return;
    try {
      await context.resume();
      if (timer) return;
      isPlaying = true;
      step = 0;
      nextNoteTime = context.currentTime + 0.1;
      timer = window.setInterval(scheduleNotes, 25);
      localStorage.setItem(STORAGE_KEY, 'on');
      updateButton();
    } catch (error) {
      if (error.name !== 'NotAllowedError') {
        console.error('Unable to start background music.', error);
      }
    }
  }

  function stopMusic() {
    if (timer) window.clearInterval(timer);
    timer = null;
    isPlaying = false;
    localStorage.setItem(STORAGE_KEY, 'off');
    updateButton();
  }

  button.addEventListener('click', () => {
    if (isPlaying) stopMusic();
    else startMusic();
  });

  volumeControl.addEventListener('input', () => {
    volume = Number(volumeControl.value) / 100;
    localStorage.setItem(VOLUME_KEY, String(volume));
    if (master && !isMuted) {
      master.gain.setTargetAtTime(volume, context.currentTime, 0.05);
    }
  });

  window.addEventListener('pagehide', () => {
    if (timer) window.clearInterval(timer);
    timer = null;
  });

  if (localStorage.getItem(STORAGE_KEY) === 'on') {
    startMusic();
    document.addEventListener('pointerdown', (event) => {
      if (event.target !== button && !button.contains(event.target)) {
        startMusic();
      }
    }, { once: true });
  }
})();
