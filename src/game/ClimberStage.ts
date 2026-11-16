import { AccessoryId, CatColor, EyeColorId } from '../data/cats';
import { drawCartoonCat } from './catRenderer';

interface ClimbPopup {
  x: number;
  y: number;
  text: string;
  life: number;
  maxLife: number;
}

interface PuffParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
}

export interface ClimberStageCallbacks {
  onClimbStep: (deltaMeters: number) => void;
}

export class ClimberStage {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private color: CatColor;
  private eyeColor: EyeColorId;
  private accessory: AccessoryId;
  private callbacks: ClimberStageCallbacks;

  private width = 0;
  private height = 0;
  private dpr = 1;
  private active = false;
  private rafId: number | null = null;
  private lastTime = 0;

  private targetMeters = 0;
  private visualMeters = 0;
  private bestMeters = 0;
  private climbStepDir = 1;
  private climbAnim = 0;
  private bounceOffset = 0;
  private clock = 0;

  private popups: ClimbPopup[] = [];
  private particles: PuffParticle[] = [];

  private readonly pxPerMeter = 28;

  constructor(
    canvas: HTMLCanvasElement,
    opts: {
      color: CatColor;
      eyeColor: EyeColorId;
      accessory: AccessoryId;
      initialMeters: number;
      bestMeters: number;
    },
    callbacks: ClimberStageCallbacks
  ) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D unavailable');
    this.ctx = context;
    this.color = opts.color;
    this.eyeColor = opts.eyeColor;
    this.accessory = opts.accessory;
    this.targetMeters = opts.initialMeters;
    this.visualMeters = opts.initialMeters;
    this.bestMeters = opts.bestMeters;
    this.callbacks = callbacks;

    this.handleResize = this.handleResize.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.loop = this.loop.bind(this);
  }

  public setCatAppearance(opts: {
    color: CatColor;
    eyeColor: EyeColorId;
    accessory: AccessoryId;
  }): void {
    this.color = opts.color;
    this.eyeColor = opts.eyeColor;
    this.accessory = opts.accessory;
  }

  public setMeters(meters: number, bestMeters: number): void {
    this.targetMeters = meters;
    this.visualMeters = meters;
    this.bestMeters = bestMeters;
  }

  public start(): void {
    if (this.active) return;
    this.active = true;
    this.handleResize();
    window.addEventListener('resize', this.handleResize);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  public stop(): void {
    this.active = false;
    window.removeEventListener('resize', this.handleResize);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private handleResize(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
  }

  private onPointerDown(ev: PointerEvent): void {
    ev.preventDefault();
    const step = 0.5;
    this.targetMeters += step;
    if (this.targetMeters > this.bestMeters) {
      this.bestMeters = this.targetMeters;
    }
    this.climbStepDir *= -1;
    this.climbAnim = this.climbStepDir;
    this.bounceOffset = -8;

    const rect = this.canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;

    this.popups.push({
      x: px,
      y: py - 14,
      text: `+${step.toFixed(1)} m`,
      life: 0,
      maxLife: 0.65,
    });

    const catY = this.height * 0.56;
    for (let i = 0; i < 6; i++) {
      this.particles.push({
        x: this.width * 0.5 + (Math.random() - 0.5) * 26,
        y: catY + 28,
        vx: (Math.random() - 0.5) * 70,
        vy: 30 + Math.random() * 60,
        size: 2.5 + Math.random() * 3,
        life: 0,
        maxLife: 0.35 + Math.random() * 0.2,
      });
    }

    this.callbacks.onClimbStep(step);
  }

  private loop(now: number): void {
    if (!this.active) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;

    this.update(dt);
    this.render();

    this.rafId = requestAnimationFrame(this.loop);
  }

  private update(dt: number): void {
    this.clock += dt;
    this.visualMeters += (this.targetMeters - this.visualMeters) * Math.min(1, dt * 16);
    this.bounceOffset *= Math.pow(0.002, dt);

    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.life += dt;
      p.y -= 48 * dt;
      if (p.life >= p.maxLife) this.popups.splice(i, 1);
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life += dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      if (pt.life >= pt.maxLife) this.particles.splice(i, 1);
    }
  }

  private render(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, this.width, this.height);

    this.drawSkyByAltitude(ctx);

    const cx = this.width * 0.5;
    const catBaseY = this.height * 0.58;

    // Ground grass when near 0m
    const groundY = catBaseY + 62 + this.visualMeters * this.pxPerMeter;
    if (groundY < this.height + 80) {
      ctx.fillStyle = '#15803d';
      ctx.fillRect(0, groundY, this.width, this.height - groundY + 80);
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(0, groundY, this.width, 10);
    }

    // Endless climbing rope / trunk centered
    ctx.fillStyle = '#92400e';
    ctx.fillRect(cx - 10, 0, 20, Math.min(this.height, groundY));

    // Rope/trunk texture notches scrolling downward as cat climbs up
    const notchSpacing = 36;
    const offset = (this.visualMeters * this.pxPerMeter) % notchSpacing;
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 3;
    for (let y = offset - notchSpacing; y < Math.min(this.height, groundY); y += notchSpacing) {
      ctx.beginPath();
      ctx.moveTo(cx - 9, y);
      ctx.lineTo(cx + 9, y + 10);
      ctx.stroke();
    }

    // Altitude markers every 5 meters
    const minM = Math.max(5, Math.floor((this.visualMeters - 15) / 5) * 5);
    const maxM = Math.ceil((this.visualMeters + 18) / 5) * 5;
    ctx.font = '700 12px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'left';
    for (let m = minM; m <= maxM; m += 5) {
      const markerY = catBaseY - (m - this.visualMeters) * this.pxPerMeter;
      if (markerY < -20 || markerY > this.height + 20) continue;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx + 22, markerY);
      ctx.lineTo(this.width - 16, markerY);
      ctx.stroke();
      ctx.fillStyle = 'rgba(248, 250, 252, 0.72)';
      ctx.fillText(`${m} m`, cx + 26, markerY - 5);
    }

    // Personal Best line
    if (this.bestMeters >= 1) {
      const bestY = catBaseY - (this.bestMeters - this.visualMeters) * this.pxPerMeter;
      if (bestY >= 0 && bestY <= this.height) {
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.moveTo(16, bestY);
        ctx.lineTo(cx - 24, bestY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#fde047';
        ctx.textAlign = 'left';
        ctx.fillText(`Record ${this.bestMeters.toFixed(1)}m`, 16, bestY - 6);
      }
    }

    // Particles
    for (const pt of this.particles) {
      const t = pt.life / pt.maxLife;
      ctx.fillStyle = `rgba(255, 255, 255, ${0.7 * (1 - t)})`;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size * (1 - t * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }

    // Same Cartoon Cat climbing upward!
    const catSize = Math.max(26, Math.min(36, Math.min(this.width, this.height) * 0.085));
    drawCartoonCat(ctx, cx, catBaseY + this.bounceOffset, catSize, {
      color: this.color,
      eyeColor: this.eyeColor,
      accessory: this.accessory,
      pose: 'climbing',
      phase: this.clock * 2,
      climbStep: this.climbAnim,
    });

    // Floating +0.5 m popups
    for (const p of this.popups) {
      const t = p.life / p.maxLife;
      ctx.save();
      ctx.globalAlpha = 1 - t;
      ctx.font = '700 17px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fde047';
      ctx.fillText(p.text, p.x, p.y);
      ctx.restore();
    }

    ctx.restore();
  }

  private drawSkyByAltitude(ctx: CanvasRenderingContext2D): void {
    const m = this.visualMeters;
    let topColor = '#0284c7';
    let botColor = '#7dd3fc';
    if (m >= 250) {
      topColor = '#020617';
      botColor = '#1e1b4b';
    } else if (m >= 120) {
      topColor = '#0f172a';
      botColor = '#312e81';
    } else if (m >= 50) {
      topColor = '#1e3a8a';
      botColor = '#0ea5e9';
    }

    const grad = ctx.createLinearGradient(0, 0, 0, this.height);
    grad.addColorStop(0, topColor);
    grad.addColorStop(1, botColor);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.width, this.height);

    // Stars at high altitude
    if (m > 100) {
      const starAlpha = Math.min(0.85, (m - 100) / 150);
      ctx.fillStyle = `rgba(255, 255, 255, ${starAlpha})`;
      for (let i = 0; i < 36; i++) {
        const sx = ((i * 97) % 100) * 0.01 * this.width;
        const sy = (((i * 53 + this.visualMeters * 3) % 100) * 0.01) * this.height;
        ctx.beginPath();
        ctx.arc(sx, sy, (i % 3) * 0.7 + 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Parallax clouds below 180m
    if (m < 180) {
      const cloudAlpha = Math.max(0.06, 0.25 * (1 - m / 180));
      ctx.fillStyle = `rgba(255, 255, 255, ${cloudAlpha})`;
      for (let i = 0; i < 4; i++) {
        const cy = ((i * 190 + this.visualMeters * 14) % (this.height + 120)) - 60;
        const cx = ((i * 137 + 40) % Math.max(100, this.width - 60)) + 30;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 55, 20, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
