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
  private nextTreatMeter = 10;
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
    this.nextTreatMeter = Math.floor(opts.initialMeters / 10 + 1) * 10;
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
    this.nextTreatMeter = Math.floor(meters / 10 + 1) * 10;
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
    let step = 0.5;
    let treatHit = false;
    if (this.targetMeters + step >= this.nextTreatMeter) {
      step += 1.0;
      treatHit = true;
      this.nextTreatMeter += 10;
    }

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
      text: treatHit ? `TREAT +${step.toFixed(1)}m!` : `+${step.toFixed(1)} m`,
      life: 0,
      maxLife: treatHit ? 0.9 : 0.65,
    });

    const catY = this.height * 0.56;
    const particleCount = treatHit ? 12 : 6;
    for (let i = 0; i < particleCount; i++) {
      this.particles.push({
        x: this.width * 0.5 + (Math.random() - 0.5) * 28,
        y: catY + 26,
        vx: (Math.random() - 0.5) * 85,
        vy: 30 + Math.random() * 65,
        size: 2.5 + Math.random() * 3.2,
        life: 0,
        maxLife: 0.35 + Math.random() * 0.25,
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

    // Ground meadow when near 0m
    const groundY = catBaseY + 62 + this.visualMeters * this.pxPerMeter;
    if (groundY < this.height + 120) {
      // Distant emerald hills
      ctx.fillStyle = '#0f766e';
      ctx.beginPath();
      ctx.moveTo(0, groundY);
      ctx.quadraticCurveTo(this.width * 0.25, groundY - 34, this.width * 0.55, groundY);
      ctx.quadraticCurveTo(this.width * 0.8, groundY - 26, this.width, groundY);
      ctx.lineTo(this.width, groundY + 40);
      ctx.lineTo(0, groundY + 40);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#059669';
      ctx.fillRect(0, groundY, this.width, this.height - groundY + 120);
      ctx.fillStyle = '#34d399';
      ctx.fillRect(0, groundY, this.width, 8);
    }

    // Wooden climbing ladder rails centered
    const ladderTop = 0;
    const ladderBottom = Math.min(this.height, groundY);
    const railHalf = 19;

    // Ladder side rails
    ctx.fillStyle = '#78350f';
    ctx.fillRect(cx - railHalf - 4, ladderTop, 8, ladderBottom);
    ctx.fillRect(cx + railHalf - 4, ladderTop, 8, ladderBottom);
    ctx.fillStyle = '#b45309';
    ctx.fillRect(cx - railHalf - 2, ladderTop, 3, ladderBottom);
    ctx.fillRect(cx + railHalf - 2, ladderTop, 3, ladderBottom);

    // Wooden rungs scrolling downward as cat climbs
    const rungSpacing = 32;
    const offset = (this.visualMeters * this.pxPerMeter) % rungSpacing;
    for (let y = offset - rungSpacing; y < ladderBottom; y += rungSpacing) {
      if (y < -10) continue;
      ctx.fillStyle = '#92400e';
      ctx.beginPath();
      ctx.roundRect(cx - railHalf - 2, y, (railHalf + 2) * 2, 7, 3);
      ctx.fill();
      ctx.fillStyle = '#d97706';
      ctx.fillRect(cx - railHalf + 2, y + 1, (railHalf - 2) * 2, 2.5);
    }

    // Alternating wooden ledges every 5 meters
    const minM = Math.max(5, Math.floor((this.visualMeters - 15) / 5) * 5);
    const maxM = Math.ceil((this.visualMeters + 18) / 5) * 5;
    ctx.font = '700 12px ui-monospace, SFMono-Regular, Menlo, monospace';
    for (let m = minM; m <= maxM; m += 5) {
      const markerY = catBaseY - (m - this.visualMeters) * this.pxPerMeter;
      if (markerY < -24 || markerY > this.height + 24) continue;

      const onRight = (m / 5) % 2 === 1;
      const ledgeW = 62;
      const ledgeX = onRight ? cx + railHalf + 4 : cx - railHalf - 4 - ledgeW;

      ctx.fillStyle = '#92400e';
      ctx.beginPath();
      ctx.roundRect(ledgeX, markerY - 4, ledgeW, 9, 4);
      ctx.fill();
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(ledgeX + 4, markerY - 3, ledgeW - 8, 2);

      ctx.strokeStyle = 'rgba(240, 253, 250, 0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx + 26, markerY);
      ctx.lineTo(this.width - 14, markerY);
      ctx.stroke();

      ctx.fillStyle = 'rgba(240, 253, 250, 0.84)';
      ctx.textAlign = 'left';
      ctx.fillText(`${m} m`, cx + 28, markerY - 9);
    }

    // Cat treat collectible (golden fish treat on next 10m rung)
    const treatY = catBaseY - (this.nextTreatMeter - this.visualMeters) * this.pxPerMeter;
    if (treatY >= -30 && treatY <= this.height + 30) {
      const bob = Math.sin(this.clock * 4) * 3;
      this.drawFishTreat(ctx, cx, treatY - 12 + bob);
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
        ctx.lineTo(cx - 28, bestY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#fde047';
        ctx.textAlign = 'left';
        ctx.fillText(`Best ${this.bestMeters.toFixed(1)}m`, 16, bestY - 6);
      }
    }

    // Particles
    for (const pt of this.particles) {
      const t = pt.life / pt.maxLife;
      ctx.fillStyle = `rgba(204, 251, 241, ${0.75 * (1 - t)})`;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size * (1 - t * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }

    // Cartoon Cat climbing upward
    const catSize = Math.max(26, Math.min(36, Math.min(this.width, this.height) * 0.085));
    drawCartoonCat(ctx, cx, catBaseY + this.bounceOffset, catSize, {
      color: this.color,
      eyeColor: this.eyeColor,
      accessory: this.accessory,
      pose: 'climbing',
      phase: this.clock * 2,
      climbStep: this.climbAnim,
    });

    // Floating popups
    for (const p of this.popups) {
      const t = p.life / p.maxLife;
      ctx.save();
      ctx.globalAlpha = 1 - t;
      ctx.font = '800 17px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = p.text.startsWith('TREAT') ? '#2dd4bf' : '#fde047';
      ctx.fillText(p.text, p.x, p.y);
      ctx.restore();
    }

    ctx.restore();
  }

  private drawFishTreat(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.save();
    ctx.translate(x, y);

    // Subtle glow
    ctx.fillStyle = 'rgba(45, 212, 191, 0.25)';
    ctx.beginPath();
    ctx.arc(0, 0, 17, 0, Math.PI * 2);
    ctx.fill();

    // Fish tail
    ctx.fillStyle = '#f59e0b';
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(15, -6);
    ctx.lineTo(15, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Fish body
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.ellipse(-2, 0, 11, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Eye
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(-7, -1.5, 1.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private drawSkyByAltitude(ctx: CanvasRenderingContext2D): void {
    const m = this.visualMeters;
    let topColor = '#0284c7';
    let botColor = '#99f6e4';
    if (m >= 250) {
      topColor = '#022c22';
      botColor = '#042f2e';
    } else if (m >= 120) {
      topColor = '#042f2e';
      botColor = '#0f766e';
    } else if (m >= 50) {
      topColor = '#0369a1';
      botColor = '#14b8a6';
    }

    const grad = ctx.createLinearGradient(0, 0, 0, this.height);
    grad.addColorStop(0, topColor);
    grad.addColorStop(1, botColor);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.width, this.height);

    // Subtle sun / moon halo
    const orbAlpha = m >= 120 ? 0.14 : 0.24;
    ctx.fillStyle = `rgba(240, 253, 250, ${orbAlpha})`;
    ctx.beginPath();
    ctx.arc(this.width * 0.8, this.height * 0.16, 36, 0, Math.PI * 2);
    ctx.fill();

    // Stars at high altitude
    if (m > 100) {
      const starAlpha = Math.min(0.85, (m - 100) / 150);
      ctx.fillStyle = `rgba(240, 253, 250, ${starAlpha})`;
      for (let i = 0; i < 36; i++) {
        const sx = ((i * 97) % 100) * 0.01 * this.width;
        const sy = (((i * 53 + this.visualMeters * 3) % 100) * 0.01) * this.height;
        ctx.beginPath();
        ctx.arc(sx, sy, (i % 3) * 0.7 + 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Parallax fluffy clouds below 180m
    if (m < 180) {
      const cloudAlpha = Math.max(0.08, 0.34 * (1 - m / 180));
      ctx.fillStyle = `rgba(255, 255, 255, ${cloudAlpha})`;
      for (let i = 0; i < 5; i++) {
        const cy = ((i * 170 + this.visualMeters * 14) % (this.height + 120)) - 60;
        const cx = ((i * 137 + 40) % Math.max(100, this.width - 60)) + 30;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 48, 17, 0, 0, Math.PI * 2);
        ctx.ellipse(cx - 22, cy + 4, 24, 12, 0, 0, Math.PI * 2);
        ctx.ellipse(cx + 22, cy + 4, 24, 12, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
