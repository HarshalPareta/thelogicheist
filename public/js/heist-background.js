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
  let notes = [];

  function makeNote(initial = false) {
    const depth = Math.random();
    return {
      x: Math.random() * width,
      y: initial ? Math.random() * height : -70,
      depth,
      size: 25 + depth * 42,
      speed: 20 + depth * 48,
      sway: Math.random() * Math.PI * 2,
      swaySpeed: 0.35 + Math.random() * 0.6,
      swayAmount: 8 + Math.random() * 24,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.8,
      flip: Math.random() * Math.PI * 2,
      flipSpeed: 0.8 + Math.random() * 1.2,
    };
  }

  function resize() {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    const targetCount = width < 600 ? 12 : 24;
    while (notes.length < targetCount) notes.push(makeNote(true));
    notes.length = targetCount;
  }

  function drawNote(note) {
    const alpha = 0.045 + note.depth * 0.16;
    const noteWidth = note.size;
    const noteHeight = note.size * 0.52;
    const x = note.x + Math.sin(note.sway) * note.swayAmount;

    context.save();
    context.globalAlpha = alpha;
    context.translate(x, note.y);
    context.rotate(note.rotation);
    context.scale(Math.max(0.08, Math.abs(Math.cos(note.flip))), 1);
    context.filter = `blur(${(1 - note.depth) * 1.25}px)`;

    context.fillStyle = '#d9cdb9';
    context.strokeStyle = '#a91622';
    context.lineWidth = Math.max(0.7, note.depth * 1.2);
    context.fillRect(-noteWidth / 2, -noteHeight / 2, noteWidth, noteHeight);
    context.strokeRect(-noteWidth / 2 + 2, -noteHeight / 2 + 2, noteWidth - 4, noteHeight - 4);

    context.beginPath();
    context.ellipse(0, 0, noteWidth * 0.12, noteHeight * 0.29, 0, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(-noteWidth * 0.35, 0);
    context.lineTo(-noteWidth * 0.18, 0);
    context.moveTo(noteWidth * 0.18, 0);
    context.lineTo(noteWidth * 0.35, 0);
    context.stroke();
    context.restore();
  }

  function render(timestamp) {
    if (document.hidden) {
      animationFrame = null;
      return;
    }

    const elapsed = previousFrame ? Math.min((timestamp - previousFrame) / 1000, 0.05) : 0;
    previousFrame = timestamp;
    context.clearRect(0, 0, width, height);

    notes.forEach((note) => {
      note.y += note.speed * elapsed;
      note.sway += note.swaySpeed * elapsed;
      note.rotation += note.rotationSpeed * elapsed;
      note.flip += note.flipSpeed * elapsed;
      if (note.y > height + 80) Object.assign(note, makeNote());
      drawNote(note);
    });

    animationFrame = window.requestAnimationFrame(render);
  }

  function start() {
    if (animationFrame === null) {
      previousFrame = 0;
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
