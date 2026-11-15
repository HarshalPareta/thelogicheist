(() => {
  const canvas = document.getElementById('bgFx');
  if (!canvas) return;

  const context = canvas.getContext('2d');
  if (!context || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    canvas.hidden = true;
    return;
  }

  let width = 0;
  let height = 0;
  let animationFrame = null;
  let previousFrame = 0;
  let lastTick = 0;
  const FRAME_INTERVAL = 1000 / 15;
  let notes = [];

  function makeNote(initial = false) {
    const depth = Math.random();
    return {
      x: Math.random() * width,
      y: initial ? Math.random() * height : -70,
      depth,
      size: 16 + depth * 24,
      speed: 12 + depth * 24,
      sway: Math.random() * Math.PI * 2,
      swaySpeed: 0.25 + Math.random() * 0.4,
      swayAmount: 5 + Math.random() * 12,
    };
  }

  function resize() {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    const targetCount = width < 600 ? 6 : 12;
    while (notes.length < targetCount) notes.push(makeNote(true));
    notes.length = targetCount;
  }

  function drawNote(note) {
    const alpha = 0.05 + note.depth * 0.12;
    const w = note.size;
    const h = note.size * 0.5;
    const x = note.x + Math.sin(note.sway) * note.swayAmount;

    context.globalAlpha = alpha;
    context.fillStyle = '#d9cdb9';
    context.fillRect(x - w / 2, note.y - h / 2, w, h);
    context.strokeStyle = 'rgba(169, 22, 34, 0.5)';
    context.lineWidth = 1;
    context.strokeRect(x - w / 2 + 1, note.y - h / 2 + 1, w - 2, h - 2);
  }

  function render(timestamp) {
    if (document.hidden) {
      animationFrame = null;
      return;
    }

    if (timestamp - lastTick < FRAME_INTERVAL) {
      animationFrame = window.requestAnimationFrame(render);
      return;
    }
    lastTick = timestamp;

    const elapsed = previousFrame ? Math.min((timestamp - previousFrame) / 1000, 0.05) : 0;
    previousFrame = timestamp;
    context.clearRect(0, 0, width, height);

    notes.forEach((note) => {
      note.y += note.speed * elapsed;
      note.sway += note.swaySpeed * elapsed;
      if (note.y > height + 80) Object.assign(note, makeNote());
      drawNote(note);
    });

    animationFrame = window.requestAnimationFrame(render);
  }

  function start() {
    if (animationFrame === null) {
      previousFrame = 0;
      lastTick = 0;
      animationFrame = window.requestAnimationFrame(render);
    }
  }

  function stop() {
    if (animationFrame !== null) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
  }

  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });
  resize();
  start();
})();
