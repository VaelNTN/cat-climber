import { AccessoryId, CatColor, EyeColorId } from '../data/cats';
import { drawCartoonCat } from './catRenderer';

interface ClimbPopup {
  x: number;
  y: number;
  text: string;
  isTreat: boolean;
  life: number;
  maxLife: number;
}

interface PuffParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  kind: 'puff' | 'spark' | 'ember';
  life: number;
  maxLife: number;
}

interface SpeedLine {
  x: number;
  y: number;
  len: number;
  speed: number;
  alpha: number;
  color: string;
  life: number;
  maxLife: number;
}

export interface ClimberStageCallbacks {
  onClimbStep: (deltaMeters: number) => void;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function lerpColor(hexA: string, hexB: string, t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const a = parseInt(hexA.slice(1), 16);
  const b = parseInt(hexB.slice(1), 16);
  const r = Math.round(lerp((a >> 16) & 255, (b >> 16) & 255, clamped));
  const g = Math.round(lerp((a >> 8) & 255, (b >> 8) & 255, clamped));
  const bl = Math.round(lerp(a & 255, b & 255, clamped));
  return `rgb(${r}, ${g}, ${bl})`;
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
  private climbAnim = 1;
  private smoothClimbAnim = 1;
  private bounceOffset = 0;
  private clock = 0;
  private comboHeat = 0;
  private tapStreak = 0;
  private lastTapClock = -10;

  private popups: ClimbPopup[] = [];
  private particles: PuffParticle[] = [];
  private speedLines: SpeedLine[] = [];

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
    this.onContextMenu = this.onContextMenu.bind(this);
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
    this.bounceOffset = 0;
    this.comboHeat = 0;
    this.tapStreak = 0;
    this.popups = [];
    this.particles = [];
    this.speedLines = [];
  }

  public start(): void {
    if (this.active) return;
    this.active = true;
    this.handleResize();
    window.addEventListener('resize', this.handleResize);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  public stop(): void {
    this.active = false;
    window.removeEventListener('resize', this.handleResize);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private onContextMenu(ev: Event): void {
    ev.preventDefault();
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
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;

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
    this.bounceOffset = -9;

    // Combo heat rises on quick taps
    if (this.clock - this.lastTapClock < 0.45) {
      this.tapStreak += 1;
      this.comboHeat = Math.min(1, this.comboHeat + 0.14);
    } else {
      this.tapStreak = 1;
      this.comboHeat = Math.max(0.12, this.comboHeat * 0.65);
    }
    this.lastTapClock = this.clock;

    const rect = this.canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;

    this.popups.push({
      x: Math.max(46, Math.min(this.width - 46, px)),
      y: Math.max(28, py - 14),
      text: treatHit ? `FISH +${step.toFixed(1)}m!` : `+${step.toFixed(1)} m`,
      isTreat: treatHit,
      life: 0,
      maxLife: treatHit ? 0.95 : 0.65,
    });

    const cx = this.width * 0.5;
    const catY = this.height * 0.58;

    // Puff cloud burst under paws
    const puffCount = treatHit ? 10 : 6;
    for (let i = 0; i < puffCount; i++) {
      this.particles.push({
        x: cx + (Math.random() - 0.5) * 34,
        y: catY + 26 + (Math.random() - 0.5) * 10,
        vx: (Math.random() - 0.5) * 95,
        vy: 35 + Math.random() * 75,
        size: 4 + Math.random() * 5,
        color: '#f0fdfa',
        kind: 'puff',
        life: 0,
        maxLife: 0.34 + Math.random() * 0.22,
      });
    }

    // Golden treat sparkles on fish collection
    if (treatHit) {
      for (let i = 0; i < 16; i++) {
        const ang = (Math.PI * 2 * i) / 16;
        const spd = 85 + Math.random() * 140;
        this.particles.push({
          x: cx,
          y: catY - 12,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd,
          size: 3.5 + Math.random() * 3,
          color: i % 2 === 0 ? '#fde047' : '#2dd4bf',
          kind: 'spark',
          life: 0,
          maxLife: 0.5 + Math.random() * 0.25,
        });
      }
    }

    // Upward speed lines rushing downward on every tap
    const streakCount = 3 + Math.floor(this.comboHeat * 4);
    for (let i = 0; i < streakCount; i++) {
      const side = Math.random() > 0.5 ? 1 : -1;
      const sx = cx + side * (46 + Math.random() * Math.max(40, this.width * 0.38));
      this.speedLines.push({
        x: sx,
        y: -20 + Math.random() * (this.height * 0.55),
        len: 26 + Math.random() * 44,
        speed: 440 + Math.random() * 320 + this.comboHeat * 240,
        alpha: 0.32 + this.comboHeat * 0.35,
        color: this.comboHeat > 0.55 && i % 2 === 0 ? '#fbbf24' : '#e0f2fe',
        life: 0,
        maxLife: 0.28 + Math.random() * 0.14,
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
    this.smoothClimbAnim += (this.climbAnim - this.smoothClimbAnim) * Math.min(1, dt * 22);
    this.bounceOffset *= Math.pow(0.002, dt);

    // Decay combo heat smoothly if idle
    if (this.clock - this.lastTapClock > 0.35) {
      this.comboHeat = Math.max(0, this.comboHeat - dt * 0.55);
      if (this.comboHeat <= 0.02) {
        this.tapStreak = 0;
      }
    }

    // Spawn rising combo fire embers when combo is hot
    if (this.comboHeat > 0.4 && Math.random() < dt * (12 + this.comboHeat * 18)) {
      const cx = this.width * 0.5;
      const catY = this.height * 0.58;
      this.particles.push({
        x: cx + (Math.random() - 0.5) * 44,
        y: catY + 20 + Math.random() * 24,
        vx: (Math.random() - 0.5) * 35,
        vy: -55 - Math.random() * 75,
        size: 2.5 + Math.random() * 3,
        color: Math.random() > 0.4 ? '#fb923c' : '#fde047',
        kind: 'ember',
        life: 0,
        maxLife: 0.35 + Math.random() * 0.25,
      });
    }

    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.life += dt;
      p.y -= 52 * dt;
      if (p.life >= p.maxLife) this.popups.splice(i, 1);
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life += dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      if (pt.life >= pt.maxLife) this.particles.splice(i, 1);
    }

    for (let i = this.speedLines.length - 1; i >= 0; i--) {
      const sl = this.speedLines[i];
      sl.life += dt;
      sl.y += sl.speed * dt;
      if (sl.life >= sl.maxLife) this.speedLines.splice(i, 1);
    }
  }

  private render(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    this.drawSkyByAltitude(ctx);

    const cx = this.width * 0.5;
    const catBaseY = this.height * 0.58;

    // Ground park/garden meadow when near 0m
    const groundY = catBaseY + 62 + this.visualMeters * this.pxPerMeter;
    if (groundY < this.height + 140) {
      // Rolling sunlit garden hills
      ctx.fillStyle = '#0f766e';
      ctx.beginPath();
      ctx.moveTo(0, groundY);
      ctx.quadraticCurveTo(this.width * 0.22, groundY - 38, this.width * 0.52, groundY);
      ctx.quadraticCurveTo(this.width * 0.78, groundY - 30, this.width, groundY);
      ctx.lineTo(this.width, groundY + 48);
      ctx.lineTo(0, groundY + 48);
      ctx.closePath();
      ctx.fill();

      // Garden grass & bushes
      ctx.fillStyle = '#059669';
      ctx.fillRect(0, groundY, this.width, this.height - groundY + 140);
      ctx.fillStyle = '#34d399';
      ctx.fillRect(0, groundY, this.width, 8);

      // Cute park bushes & blossoms
      for (const bxFrac of [0.14, 0.28, 0.72, 0.87]) {
        const bx = this.width * bxFrac;
        ctx.fillStyle = '#047857';
        ctx.beginPath();
        ctx.arc(bx, groundY + 2, 16, Math.PI, 0);
        ctx.arc(bx - 12, groundY + 4, 11, Math.PI, 0);
        ctx.arc(bx + 12, groundY + 4, 11, Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = '#fde047';
        ctx.beginPath();
        ctx.arc(bx - 5, groundY - 4, 2.2, 0, Math.PI * 2);
        ctx.arc(bx + 7, groundY - 2, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Detailed treehouse wooden ladder & vine trunk
    const ladderTop = 0;
    const ladderBottom = Math.min(this.height, groundY);
    const railHalf = 20;

    // Subtle tree trunk shadow backdrop behind ladder
    const trunkGrad = ctx.createLinearGradient(cx - 26, 0, cx + 26, 0);
    trunkGrad.addColorStop(0, 'rgba(69, 26, 3, 0.35)');
    trunkGrad.addColorStop(0.5, 'rgba(120, 53, 15, 0.25)');
    trunkGrad.addColorStop(1, 'rgba(69, 26, 3, 0.35)');
    ctx.fillStyle = trunkGrad;
    ctx.fillRect(cx - 26, ladderTop, 52, ladderBottom);

    // Ladder wooden side rails with grain highlights
    ctx.fillStyle = '#5c2808';
    ctx.fillRect(cx - railHalf - 5, ladderTop, 10, ladderBottom);
    ctx.fillRect(cx + railHalf - 5, ladderTop, 10, ladderBottom);
    ctx.fillStyle = '#92400e';
    ctx.fillRect(cx - railHalf - 3, ladderTop, 6, ladderBottom);
    ctx.fillRect(cx + railHalf - 3, ladderTop, 6, ladderBottom);
    ctx.fillStyle = '#d97706';
    ctx.fillRect(cx - railHalf - 2, ladderTop, 2, ladderBottom);
    ctx.fillRect(cx + railHalf - 2, ladderTop, 2, ladderBottom);

    // Curling green vines & leaves up the rails
    this.drawVinesOnRails(ctx, cx, railHalf, ladderBottom);

    // Wooden rungs scrolling downward as cat climbs
    const rungSpacing = 32;
    const offset = (this.visualMeters * this.pxPerMeter) % rungSpacing;
    for (let y = offset - rungSpacing; y < ladderBottom; y += rungSpacing) {
      if (y < -10) continue;
      ctx.fillStyle = '#78350f';
      ctx.beginPath();
      ctx.roundRect(cx - railHalf - 3, y, (railHalf + 3) * 2, 8, 3.5);
      ctx.fill();
      ctx.fillStyle = '#b45309';
      ctx.fillRect(cx - railHalf + 1, y + 1, (railHalf - 1) * 2, 4);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(cx - railHalf + 3, y + 1.2, (railHalf - 3) * 2, 1.5);
    }

    // Alternating treehouse platform ledges every 5 meters
    const minM = Math.max(5, Math.floor((this.visualMeters - 15) / 5) * 5);
    const maxM = Math.ceil((this.visualMeters + 18) / 5) * 5;
    ctx.font = '700 12px ui-monospace, SFMono-Regular, Menlo, monospace';
    for (let m = minM; m <= maxM; m += 5) {
      const markerY = catBaseY - (m - this.visualMeters) * this.pxPerMeter;
      if (markerY < -24 || markerY > this.height + 24) continue;

      const onRight = (m / 5) % 2 === 1;
      const ledgeW = 66;
      const ledgeX = onRight ? cx + railHalf + 5 : cx - railHalf - 5 - ledgeW;

      // Support bracket
      ctx.fillStyle = '#5c2808';
      ctx.beginPath();
      if (onRight) {
        ctx.moveTo(ledgeX, markerY + 4);
        ctx.lineTo(ledgeX + 20, markerY + 4);
        ctx.lineTo(ledgeX, markerY + 18);
      } else {
        ctx.moveTo(ledgeX + ledgeW, markerY + 4);
        ctx.lineTo(ledgeX + ledgeW - 20, markerY + 4);
        ctx.lineTo(ledgeX + ledgeW, markerY + 18);
      }
      ctx.closePath();
      ctx.fill();

      // Ledge plank
      ctx.fillStyle = '#78350f';
      ctx.beginPath();
      ctx.roundRect(ledgeX, markerY - 5, ledgeW, 10, 4);
      ctx.fill();
      ctx.fillStyle = '#d97706';
      ctx.fillRect(ledgeX + 4, markerY - 4, ledgeW - 8, 3);

      // Cute leaf tuft on outer corner of ledge
      const leafX = onRight ? ledgeX + ledgeW - 6 : ledgeX + 6;
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.ellipse(leafX, markerY - 6, 7, 3.5, onRight ? -0.4 : 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#34d399';
      ctx.beginPath();
      ctx.ellipse(leafX + (onRight ? -4 : 4), markerY - 8, 5, 2.5, onRight ? -0.8 : 0.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(240, 253, 250, 0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx + 28, markerY);
      ctx.lineTo(this.width - 14, markerY);
      ctx.stroke();

      ctx.fillStyle = 'rgba(240, 253, 250, 0.9)';
      ctx.textAlign = 'left';
      ctx.fillText(`${m} m`, cx + 30, markerY - 9);
    }

    // Shiny glowing golden fish treat with sparkle rings on next 10m rung
    const treatY = catBaseY - (this.nextTreatMeter - this.visualMeters) * this.pxPerMeter;
    if (treatY >= -34 && treatY <= this.height + 34) {
      const bob = Math.sin(this.clock * 4) * 3.5;
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

    // Upward speed lines
    for (const sl of this.speedLines) {
      const t = sl.life / sl.maxLife;
      ctx.save();
      ctx.strokeStyle = sl.color;
      ctx.globalAlpha = sl.alpha * (1 - t);
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sl.x, sl.y);
      ctx.lineTo(sl.x, sl.y + sl.len);
      ctx.stroke();
      ctx.restore();
    }

    // Particles (puffs, sparks, combo embers)
    for (const pt of this.particles) {
      const t = pt.life / pt.maxLife;
      ctx.save();
      ctx.globalAlpha = (pt.kind === 'puff' ? 0.78 : 0.92) * (1 - t);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size * (pt.kind === 'puff' ? 0.65 + t * 0.55 : 1 - t * 0.5), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Combo Fire Aura around cat when tapping fast!
    const catSize = Math.max(26, Math.min(36, Math.min(this.width, this.height) * 0.085));
    const catY = catBaseY + this.bounceOffset;
    if (this.comboHeat > 0.25) {
      const auraIntensity = (this.comboHeat - 0.25) / 0.75;
      const flicker = 0.85 + 0.15 * Math.sin(this.clock * 22);
      const auraR = catSize * (2.1 + auraIntensity * 0.75) * flicker;
      const fireGrad = ctx.createRadialGradient(cx, catY + 12, catSize * 0.4, cx, catY + 12, auraR);
      fireGrad.addColorStop(0, `rgba(253, 224, 71, ${0.38 * auraIntensity})`);
      fireGrad.addColorStop(0.55, `rgba(249, 115, 22, ${0.28 * auraIntensity})`);
      fireGrad.addColorStop(1, 'rgba(239, 68, 68, 0)');
      ctx.fillStyle = fireGrad;
      ctx.beginPath();
      ctx.arc(cx, catY + 12, auraR, 0, Math.PI * 2);
      ctx.fill();

      // Flame tongues behind cat
      ctx.save();
      ctx.globalAlpha = 0.45 * auraIntensity;
      for (const side of [-1, 0, 1]) {
        const fx = cx + side * catSize * 0.65;
        const fh = catSize * (0.9 + auraIntensity * 0.8) * (0.85 + 0.2 * Math.sin(this.clock * 18 + side));
        ctx.fillStyle = side === 0 ? '#fde047' : '#fb923c';
        ctx.beginPath();
        ctx.moveTo(fx - 10, catY + 28);
        ctx.quadraticCurveTo(fx, catY + 28 - fh * 1.4, fx + 10, catY + 28);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    // Cartoon Cat climbing upward paw-over-paw
    drawCartoonCat(ctx, cx, catY, catSize, {
      color: this.color,
      eyeColor: this.eyeColor,
      accessory: this.accessory,
      pose: 'climbing',
      phase: this.clock * 2.4,
      climbStep: this.smoothClimbAnim,
      comboHeat: this.comboHeat,
    });

    // Combo badge when streak >= 5
    if (this.comboHeat > 0.45 && this.tapStreak >= 5) {
      ctx.save();
      ctx.font = '800 13px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fde047';
      ctx.shadowColor = 'rgba(249, 115, 22, 0.8)';
      ctx.shadowBlur = 8;
      ctx.fillText(`🔥 x${this.tapStreak} COMBO`, cx, catY - catSize * 1.65);
      ctx.restore();
    }

    // Floating popups
    for (const p of this.popups) {
      const t = p.life / p.maxLife;
      ctx.save();
      ctx.globalAlpha = 1 - t;
      ctx.font = p.isTreat
        ? '800 18px ui-monospace, SFMono-Regular, Menlo, monospace'
        : '800 16px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = p.isTreat ? '#2dd4bf' : '#fde047';
      ctx.fillText(p.text, p.x, p.y);
      ctx.restore();
    }

    ctx.restore();
  }

  private drawVinesOnRails(
    ctx: CanvasRenderingContext2D,
    cx: number,
    railHalf: number,
    ladderBottom: number
  ): void {
    const vineStep = 64;
    const scroll = this.visualMeters * this.pxPerMeter;
    const startIdx = Math.floor((scroll - this.height) / vineStep) - 1;
    const endIdx = Math.ceil((scroll + 40) / vineStep) + 1;

    ctx.save();
    for (let idx = startIdx; idx <= endIdx; idx++) {
      const y = scroll - idx * vineStep;
      if (y < -40 || y > ladderBottom + 40) continue;

      const side = idx % 2 === 0 ? -1 : 1;
      const rx = cx + side * (railHalf + 1);

      // Vine stem segment curling around rail
      ctx.strokeStyle = '#15803d';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(rx - side * 4, y - 24);
      ctx.quadraticCurveTo(rx + side * 8, y, rx - side * 3, y + 24);
      ctx.stroke();

      // Sprouting leaf
      ctx.fillStyle = idx % 3 === 0 ? '#34d399' : '#22c55e';
      ctx.beginPath();
      ctx.ellipse(rx + side * 7, y - 2, 6, 3.2, side * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawFishTreat(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.save();
    ctx.translate(x, y);

    // Pulsing glow halo
    const pulse = 0.5 + 0.5 * Math.sin(this.clock * 6);
    const halo = ctx.createRadialGradient(0, 0, 4, 0, 0, 24 + pulse * 5);
    halo.addColorStop(0, 'rgba(253, 224, 71, 0.55)');
    halo.addColorStop(0.6, 'rgba(45, 212, 191, 0.25)');
    halo.addColorStop(1, 'rgba(45, 212, 191, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, 26 + pulse * 5, 0, Math.PI * 2);
    ctx.fill();

    // Rotating sparkle ring
    ctx.strokeStyle = `rgba(254, 240, 138, ${0.5 + pulse * 0.35})`;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([4, 5]);
    ctx.save();
    ctx.rotate(this.clock * 2.2);
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.setLineDash([]);

    // Orbiting mini sparkle stars
    for (let i = 0; i < 2; i++) {
      const a = this.clock * 3.2 + i * Math.PI;
      const sx = Math.cos(a) * 18;
      const sy = Math.sin(a) * 18;
      ctx.fillStyle = '#fef9c3';
      ctx.beginPath();
      ctx.arc(sx, sy, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Fish tail
    ctx.fillStyle = '#f59e0b';
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(16, -6.5);
    ctx.lineTo(16, 6.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Fish body
    const fishGrad = ctx.createLinearGradient(-12, -8, 10, 8);
    fishGrad.addColorStop(0, '#fef08a');
    fishGrad.addColorStop(0.55, '#fbbf24');
    fishGrad.addColorStop(1, '#d97706');
    ctx.fillStyle = fishGrad;
    ctx.beginPath();
    ctx.ellipse(-2, 0, 11.5, 7.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Gleaming highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.beginPath();
    ctx.ellipse(-4, -3, 4.5, 1.8, -0.2, 0, Math.PI * 2);
    ctx.fill();

    // Eye
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(-7.5, -1.5, 1.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private drawSkyByAltitude(ctx: CanvasRenderingContext2D): void {
    const m = this.visualMeters;
    let topColor: string;
    let botColor: string;

    if (m < 60) {
      // Lush sunny park / garden -> crisp sky
      const t = m / 60;
      topColor = lerpColor('#0284c7', '#0369a1', t);
      botColor = lerpColor('#bae6fd', '#5eead4', t);
    } else if (m < 140) {
      // Treetops & fluffy clouds -> sunset stratosphere
      const t = (m - 60) / 80;
      topColor = lerpColor('#0369a1', '#4c1d95', t);
      botColor = lerpColor('#5eead4', '#fb7185', t);
    } else if (m < 240) {
      // Sunset stratosphere -> starry aurora space
      const t = (m - 140) / 100;
      topColor = lerpColor('#4c1d95', '#090d24', t);
      botColor = lerpColor('#fb7185', '#0f3443', t);
    } else {
      topColor = '#070a1c';
      botColor = '#0c2d3c';
    }

    const grad = ctx.createLinearGradient(0, 0, 0, this.height);
    grad.addColorStop(0, topColor);
    grad.addColorStop(1, botColor);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.width, this.height);

    // Warm golden sun at low altitude, fading into moon/space orb higher up
    if (m < 150) {
      const sunAlpha = Math.max(0, 1 - m / 150);
      const sunX = this.width * 0.8;
      const sunY = this.height * 0.16 + m * 0.5;
      const sunGlow = ctx.createRadialGradient(sunX, sunY, 8, sunX, sunY, 54);
      sunGlow.addColorStop(0, `rgba(254, 240, 138, ${0.55 * sunAlpha})`);
      sunGlow.addColorStop(0.5, `rgba(253, 224, 71, ${0.2 * sunAlpha})`);
      sunGlow.addColorStop(1, 'rgba(253, 224, 71, 0)');
      ctx.fillStyle = sunGlow;
      ctx.beginPath();
      ctx.arc(sunX, sunY, 54, 0, Math.PI * 2);
      ctx.fill();
    }

    // Starfield in stratosphere & aurora space (110m+)
    if (m > 110) {
      const starAlpha = Math.min(0.95, (m - 110) / 110);
      for (let i = 0; i < 40; i++) {
        const sx = ((i * 97 + 19) % 100) * 0.01 * this.width;
        const sy = (((i * 53 + this.visualMeters * 2.5) % 100) * 0.01) * this.height;
        const twinkle = 0.55 + 0.45 * Math.sin(this.clock * 2.4 + i);
        ctx.fillStyle = i % 5 === 0 ? '#bae6fd' : '#f8fafc';
        ctx.globalAlpha = starAlpha * twinkle;
        ctx.beginPath();
        ctx.arc(sx, sy, (i % 3) * 0.65 + 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Shimmering Aurora Borealis ribbons in space (190m+)
    if (m > 190) {
      const auroraAlpha = Math.min(0.55, ((m - 190) / 90) * 0.55);
      ctx.save();
      for (let r = 0; r < 2; r++) {
        const baseY = this.height * (0.22 + r * 0.16);
        const aGrad = ctx.createLinearGradient(0, baseY - 36, 0, baseY + 36);
        aGrad.addColorStop(0, 'rgba(45, 212, 191, 0)');
        aGrad.addColorStop(0.5, r === 0 ? `rgba(52, 211, 153, ${auroraAlpha})` : `rgba(56, 189, 248, ${auroraAlpha * 0.85})`);
        aGrad.addColorStop(1, 'rgba(168, 85, 247, 0)');
        ctx.fillStyle = aGrad;
        ctx.beginPath();
        ctx.moveTo(0, baseY + 34);
        for (let x = 0; x <= this.width; x += 24) {
          const wave = Math.sin(x * 0.02 + this.clock * (1.1 + r * 0.4) + r) * 18;
          ctx.lineTo(x, baseY - 22 + wave);
        }
        ctx.lineTo(this.width, baseY + 36);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    // Distant treetop silhouettes (0m to 75m)
    if (m < 75) {
      const treeOffset = m * 6;
      const treeAlpha = Math.max(0, 1 - m / 75) * 0.55;
      ctx.fillStyle = `rgba(6, 95, 70, ${treeAlpha})`;
      for (let i = 0; i < 6; i++) {
        const tx = (i / 5) * this.width;
        const ty = this.height - 20 + treeOffset;
        ctx.beginPath();
        ctx.arc(tx, ty, 38 + (i % 2) * 12, Math.PI, 0);
        ctx.fill();
      }
    }

    // Parallax fluffy clouds below 200m
    if (m < 200) {
      const cloudAlpha = Math.max(0.08, 0.44 * (1 - m / 200));
      ctx.fillStyle = m > 120 ? `rgba(254, 215, 170, ${cloudAlpha})` : `rgba(255, 255, 255, ${cloudAlpha})`;
      for (let i = 0; i < 6; i++) {
        const drift = (this.clock * (8 + (i % 3) * 4)) % (this.width + 120);
        const cy = ((i * 155 + this.visualMeters * 13) % (this.height + 120)) - 60;
        const cx = ((i * 137 + drift) % (this.width + 120)) - 60;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 48, 17, 0, 0, Math.PI * 2);
        ctx.ellipse(cx - 22, cy + 4, 24, 12, 0, 0, Math.PI * 2);
        ctx.ellipse(cx + 22, cy + 4, 24, 12, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
