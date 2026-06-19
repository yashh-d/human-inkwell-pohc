import React, { useEffect, useRef } from 'react';

/**
 * Full-viewport, pointer-reactive "ink in water" canvas for the landing page.
 * As the cursor moves it seeds soft cyan ink blooms that diffuse and fade,
 * evoking ink spreading on wet paper. Purely decorative: fixed, behind content,
 * pointer-events off. Honors prefers-reduced-motion.
 */
type Bloom = {
  x: number;
  y: number;
  baseR: number;
  maxR: number;
  life: number;
  maxLife: number;
  hue: number;
  alpha: number;
};

const MAX_BLOOMS = 170;
const SPAWN_THROTTLE_MS = 26;

const InkCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let dpr = 1;
    let raf = 0;
    let lastSpawn = 0;
    const blooms: Bloom[] = [];

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const spawn = (x: number, y: number, count: number) => {
      for (let i = 0; i < count; i++) {
        blooms.push({
          x: x + (Math.random() - 0.5) * 26,
          y: y + (Math.random() - 0.5) * 26,
          baseR: 3 + Math.random() * 6,
          maxR: 46 + Math.random() * 86,
          life: 0,
          maxLife: 60 + Math.random() * 60,
          hue: 187 + Math.random() * 16, // around cyan #00b4d8
          alpha: 0.05 + Math.random() * 0.07,
        });
      }
      if (blooms.length > MAX_BLOOMS) blooms.splice(0, blooms.length - MAX_BLOOMS);
    };

    const onMove = (e: PointerEvent) => {
      const now = e.timeStamp || performance.now();
      if (now - lastSpawn < SPAWN_THROTTLE_MS) return;
      lastSpawn = now;
      spawn(e.clientX, e.clientY, 1 + Math.floor(Math.random() * 2));
    };

    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'multiply';
      for (let i = blooms.length - 1; i >= 0; i--) {
        const p = blooms[i];
        p.life += 1;
        const t = p.life / p.maxLife;
        if (t >= 1) {
          blooms.splice(i, 1);
          continue;
        }
        const ease = 1 - Math.pow(1 - t, 3);
        const r = p.baseR + (p.maxR - p.baseR) * ease;
        const a = p.alpha * (1 - t);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, `hsla(${p.hue}, 88%, 42%, ${a})`);
        g.addColorStop(0.6, `hsla(${p.hue}, 88%, 46%, ${a * 0.5})`);
        g.addColorStop(1, `hsla(${p.hue}, 88%, 50%, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(tick);
    };

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', (e) => spawn(e.clientX, e.clientY, 5), {
      passive: true,
    });
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
    };
  }, []);

  return <canvas ref={canvasRef} className="lp-ink" aria-hidden="true" />;
};

export default InkCanvas;
