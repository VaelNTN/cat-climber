import { AccessoryId, CatColor, EyeColorId } from '../data/cats';
import { drawCartoonCat } from './catRenderer';

interface ClimbPopup {
  x: number;
  y: number;
  text: string;
  color: string;
  big?: boolean;
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

interface GlowingFish {
  kind: 'branch' | 'float';
  side: -1 | 1;
  meterPos: number;
  y: number;
  vy: number;
  swayPhase: number;
  collected: boolean;
}

interface FallingAcorn {
  side: -1 | 1;
  y: number;
  vy: number;
  telegraph: number;
  rot: number;
  resolved: boolean;
}

export interface ClimberStageCallbacks {
  onClimbStep: (deltaMeters: number, eventType?: 'normal' | 'fever' | 'dodge' | 'bonk') => void;
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
  private paused = false;
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
  private bonkShake = 0;
  private clock = 0;
  private comboHeat = 0;
  private tapStreak = 0;
  private lastTapClock = -10;
  private feverTimer = 0;

  private catLane: -1 | 1 = 1;
  private catOffsetX = 0;
  private fishTreats: GlowingFish[] = [];
  private nextBranchFishMeter = 7;
  private nextFloatFishIn = 5.5;
  private acorns: FallingAcorn[] = [];
  private nextAcornIn = 4.4;

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
    this.nextBranchFishMeter = Math.floor(opts.initialMeters / 8 + 1) * 8;
    this.callbacks = callbacks;

    this.handleResize = this.handleResize.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
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

  public isPaused(): boolean {
    return this.paused;
  }

  public setPaused(next: boolean): void {
    if (this.paused === next) return;
    this.paused = next;
    if (!next) this.lastTime = performance.now();
  }

  public setMeters(meters: number, bestMeters: number): void {
    this.targetMeters = meters;
    this.visualMeters = meters;
    this.bestMeters = bestMeters;
    this.nextTreatMeter = Math.floor(meters / 10 + 1) * 10;
    this.nextBranchFishMeter = Math.floor(meters / 8 + 1) * 8;
    this.bounceOffset = 0;
    this.bonkShake = 0;
    this.comboHeat = 0;
    this.tapStreak = 0;
    this.feverTimer = 0;
    this.catLane = 1;
    this.catOffsetX = 0;
    this.fishTreats = [];
    this.acorns = [];
    this.nextFloatFishIn = 5.5;
    this.nextAcornIn = 4.4;
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
    window.addEventListener('keydown', this.onKeyDown);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  public stop(): void {
    this.active = false;
    this.paused = false;
    window.removeEventListener('resize', this.handleResize);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('keydown', this.onKeyDown);
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

  private getFishScreenPos(f: GlowingFish): { x: number; y: number } {
    const cx = this.width * 0.5;
    if (f.kind === 'branch') {
      const y = this.height * 0.58 - (f.meterPos - this.visualMeters) * this.pxPerMeter;
      return { x: cx + f.side * 66, y };
    }
    const sway = Math.sin(this.clock * 3.4 + f.swayPhase) * 20;
    return { x: cx + f.side * 54 + sway, y: f.y };
  }

  private collectGlowingFish(f: GlowingFish, x: number, y: number): void {
    if (f.collected) return;
    f.collected = true;
    this.feverTimer = 3.6;
    this.comboHeat = 1;
    this.tapStreak += 4;
    this.lastTapClock = this.clock;
    const bonus = 2.0;
    this.targetMeters += bonus;
    if (this.targetMeters > this.bestMeters) this.bestMeters = this.targetMeters;

    this.popups.push({
      x: Math.max(76, Math.min(this.width - 76, x)),
      y: Math.max(40, y - 10),
      text: '🐟 FEVER BURST! +2.0m',
      color: '#2dd4bf',
      big: true,
      life: 0,
      maxLife: 1.05,
    });
    for (let i = 0; i < 16; i++) {
      const ang = (Math.PI * 2 * i) / 16;
      const spd = 85 + Math.random() * 145;
      this.particles.push({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        size: 3.5 + Math.random() * 3,
        color: i % 2 === 0 ? '#fde047' : '#2dd4bf',
        kind: 'spark',
        life: 0,
        maxLife: 0.55,
      });
    }
    this.callbacks.onClimbStep(bonus, 'fever');
  }

  private onKeyDown(ev: KeyboardEvent): void {
    if (this.paused) return;
    if (ev.code === 'ArrowLeft' || ev.code === 'KeyA') {
      ev.preventDefault();
      this.triggerClimbTap(-1, this.width * 0.35, this.height * 0.5);
    } else if (ev.code === 'ArrowRight' || ev.code === 'KeyD') {
      ev.preventDefault();
      this.triggerClimbTap(1, this.width * 0.65, this.height * 0.5);
    } else if (ev.code === 'Space' || ev.code === 'ArrowUp' || ev.code === 'KeyW') {
      ev.preventDefault();
      this.triggerClimbTap(this.catLane, this.width * 0.5, this.height * 0.5);
    }
  }

  private onPointerDown(ev: PointerEvent): void {
    ev.preventDefault();
    if (this.paused) return;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;

    const rect = this.canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;

    // 1. Direct tap on a glowing Fish Treat (floating or on a branch)
    for (const f of this.fishTreats) {
      if (f.collected) continue;
      const pos = this.getFishScreenPos(f);
      if (Math.hypot(px - pos.x, py - pos.y) <= 58) {
        this.catLane = f.side;
        this.collectGlowingFish(f, pos.x, pos.y);
        return;
      }
    }

    // 2. Direct tap on a falling Acorn to swat it away
    const cx = this.width * 0.5;
    for (const ac of this.acorns) {
      if (ac.resolved || ac.telegraph > 0) continue;
      const acX = cx + ac.side * 22;
      if (Math.hypot(px - acX, py - ac.y) <= 54) {
        ac.resolved = true;
        this.tapStreak += 2;
        this.comboHeat = Math.min(1, this.comboHeat + 0.2);
        this.lastTapClock = this.clock;
        const swatBonus = 0.8;
        this.targetMeters += swatBonus;
        if (this.targetMeters > this.bestMeters) this.bestMeters = this.targetMeters;
        this.popups.push({
          x: acX,
          y: Math.max(36, ac.y - 10),
          text: 'BATTED! +0.8m',
          color: '#34d399',
          big: true,
          life: 0,
          maxLife: 0.85,
        });
        this.callbacks.onClimbStep(swatBonus, 'dodge');
        return;
      }
    }

    const side: -1 | 1 = px < this.width * 0.5 ? -1 : 1;
    this.triggerClimbTap(side, px, py);
  }

  private triggerClimbTap(side: -1 | 1, px: number, py: number): void {
    this.catLane = side;
    const feverMult = this.feverTimer > 0 ? 1.75 : 1;
    const comboMult = this.tapStreak >= 10 ? 1.25 : 1;
    let step = 0.5 * feverMult * comboMult;
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

    // Auto-collect branch fish treat if climbing past on the matching side
    for (const f of this.fishTreats) {
      if (!f.collected && f.kind === 'branch' && f.side === this.catLane && Math.abs(this.targetMeters - f.meterPos) <= 1.25) {
        const pos = this.getFishScreenPos(f);
        this.collectGlowingFish(f, pos.x, pos.y);
      }
    }

    if (this.clock - this.lastTapClock < 0.55) {
      this.tapStreak += 1;
      this.comboHeat = Math.min(1, this.comboHeat + 0.14);
    } else {
      this.tapStreak = 1;
      this.comboHeat = Math.max(0.14, this.comboHeat * 0.65);
    }
    this.lastTapClock = this.clock;

    this.popups.push({
      x: Math.max(46, Math.min(this.width - 46, px)),
      y: Math.max(28, py - 14),
      text: treatHit ? `FISH +${step.toFixed(1)}m!` : `+${step.toFixed(1)} m`,
      color: treatHit || this.feverTimer > 0 ? '#2dd4bf' : '#fde047',
      big: treatHit || this.feverTimer > 0,
      life: 0,
      maxLife: treatHit ? 0.95 : 0.65,
    });

    const cx = this.width * 0.5 + this.catOffsetX;
    const catY = this.height * 0.58;

    const puffCount = treatHit ? 10 : 6;
    for (let i = 0; i < puffCount; i++) {
      this.particles.push({
        x: cx + (Math.random() - 0.5) * 34,
        y: catY + 26 + (Math.random() - 0.5) * 10,
        vx: (Math.random() - 0.5) * 95,
        vy: 35 + Math.random() * 75,
        size: 4 + Math.random() * 5,
        color: this.feverTimer > 0 ? '#5eead4' : '#f0fdfa',
        kind: 'puff',
        life: 0,
        maxLife: 0.34 + Math.random() * 0.22,
      });
    }

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

    const streakCount = 3 + Math.floor(this.comboHeat * 4);
    for (let i = 0; i < streakCount; i++) {
      const sSide = Math.random() > 0.5 ? 1 : -1;
      const sx = this.width * 0.5 + sSide * (46 + Math.random() * Math.max(40, this.width * 0.38));
      this.speedLines.push({
        x: sx,
        y: -20 + Math.random() * (this.height * 0.55),
        len: 26 + Math.random() * 44,
        speed: 440 + Math.random() * 320 + this.comboHeat * 240,
        alpha: 0.32 + this.comboHeat * 0.35,
        color: this.feverTimer > 0 || (this.comboHeat > 0.55 && i % 2 === 0) ? '#fbbf24' : '#e0f2fe',
        life: 0,
        maxLife: 0.28 + Math.random() * 0.14,
      });
    }

    this.callbacks.onClimbStep(step, treatHit ? 'fever' : 'normal');
  }

  private loop(now: number): void {
    if (!this.active) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;

    if (!this.paused) {
      this.update(dt);
    }
    this.render();

    this.rafId = requestAnimationFrame(this.loop);
  }

  private update(dt: number): void {
    this.clock += dt;
    this.visualMeters += (this.targetMeters - this.visualMeters) * Math.min(1, dt * 16);
    this.smoothClimbAnim += (this.climbAnim - this.smoothClimbAnim) * Math.min(1, dt * 22);
    this.bounceOffset *= Math.pow(0.002, dt);
    this.bonkShake = Math.max(0, this.bonkShake - dt * 2.6);

    const targetOff = this.catLane * 17;
    this.catOffsetX += (targetOff - this.catOffsetX) * Math.min(1, dt * 15);

    if (this.feverTimer > 0) {
      this.feverTimer = Math.max(0, this.feverTimer - dt);
      this.comboHeat = Math.max(this.comboHeat, 0.85);
    }

    if (this.clock - this.lastTapClock > 0.45 && this.feverTimer <= 0) {
      this.comboHeat = Math.max(0, this.comboHeat - dt * 0.52);
      if (this.comboHeat <= 0.02) {
        this.tapStreak = 0;
      }
    }

    // Spawn branch Fish Treats ahead
    while (this.nextBranchFishMeter <= this.visualMeters + 14) {
      const side: -1 | 1 = Math.random() > 0.5 ? 1 : -1;
      this.fishTreats.push({
        kind: 'branch',
        side,
        meterPos: this.nextBranchFishMeter,
        y: 0,
        vy: 0,
        swayPhase: Math.random() * Math.PI * 2,
        collected: false,
      });
      this.nextBranchFishMeter += 8 + Math.floor(Math.random() * 4);
    }

    // Spawn gently floating Fish Treats
    if (this.targetMeters >= 3 && this.height > 0) {
      this.nextFloatFishIn -= dt;
      if (this.nextFloatFishIn <= 0) {
        this.nextFloatFishIn = 6.5 + Math.random() * 3.5;
        this.fishTreats.push({
          kind: 'float',
          side: Math.random() > 0.5 ? 1 : -1,
          meterPos: this.visualMeters,
          y: -18,
          vy: 74,
          swayPhase: Math.random() * Math.PI * 2,
          collected: false,
        });
      }
    }

    for (const f of this.fishTreats) {
      if (f.collected) continue;
      if (f.kind === 'float') {
        f.y += f.vy * dt;
      }
    }
    this.fishTreats = this.fishTreats.filter((f) => {
      if (f.collected) return false;
      if (f.kind === 'branch') return f.meterPos >= this.visualMeters - 8;
      return f.y < this.height + 40;
    });

    // Spawn telegraphed falling acorns
    if (this.targetMeters >= 4 && this.height > 0) {
      this.nextAcornIn -= dt;
      if (this.nextAcornIn <= 0) {
        this.nextAcornIn = Math.max(3.3, 5.4 - Math.min(1.8, this.targetMeters * 0.008)) + Math.random() * 1.4;
        const side: -1 | 1 = Math.random() > 0.45 ? this.catLane : ((this.catLane * -1) as -1 | 1);
        this.acorns.push({
          side,
          y: 30,
          vy: 210 + Math.min(95, this.targetMeters * 0.35),
          telegraph: 0.9,
          rot: 0,
          resolved: false,
        });
      }
    }

    const catY = this.height * 0.58;
    for (const ac of this.acorns) {
      if (ac.resolved) continue;
      if (ac.telegraph > 0) {
        ac.telegraph = Math.max(0, ac.telegraph - dt);
      } else {
        ac.y += ac.vy * dt;
        ac.rot += dt * 6.5 * ac.side;
        if (Math.abs(ac.y - catY) < 34) {
          if (ac.side === this.catLane) {
            ac.resolved = true;
            this.tapStreak = Math.floor(this.tapStreak / 2);
            this.comboHeat *= 0.38;
            this.bonkShake = 1;
            this.popups.push({
              x: this.width * 0.5 + ac.side * 22,
              y: catY - 24,
              text: 'ACORN BONK!',
              color: '#fb7185',
              big: true,
              life: 0,
              maxLife: 0.85,
            });
            this.callbacks.onClimbStep(0, 'bonk');
          }
        } else if (ac.y > catY + 38) {
          ac.resolved = true;
          this.tapStreak += 2;
          this.comboHeat = Math.min(1, this.comboHeat + 0.16);
          const dodgeBonus = 0.7;
          this.targetMeters += dodgeBonus;
          if (this.targetMeters > this.bestMeters) this.bestMeters = this.targetMeters;
          this.popups.push({
            x: this.width * 0.5 + this.catOffsetX,
            y: catY - 34,
            text: 'DODGED! +0.7m',
            color: '#34d399',
            life: 0,
            maxLife: 0.8,
          });
          this.callbacks.onClimbStep(dodgeBonus, 'dodge');
        }
      }
    }
    this.acorns = this.acorns.filter((ac) => !ac.resolved && ac.y < this.height + 50);

    if (this.comboHeat > 0.4 && Math.random() < dt * (12 + this.comboHeat * 18)) {
      const cx = this.width * 0.5 + this.catOffsetX;
      this.particles.push({
        x: cx + (Math.random() - 0.5) * 44,
        y: catY + 20 + Math.random() * 24,
        vx: (Math.random() - 0.5) * 35,
        vy: -55 - Math.random() * 75,
        size: 2.5 + Math.random() * 3,
        color: this.feverTimer > 0 ? '#2dd4bf' : Math.random() > 0.4 ? '#fb923c' : '#fde047',
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

    const groundY = catBaseY + 62 + this.visualMeters * this.pxPerMeter;
    if (groundY < this.height + 140) {
      ctx.fillStyle = '#0f766e';
      ctx.beginPath();
      ctx.moveTo(0, groundY);
      ctx.quadraticCurveTo(this.width * 0.22, groundY - 38, this.width * 0.52, groundY);
      ctx.quadraticCurveTo(this.width * 0.78, groundY - 30, this.width, groundY);
      ctx.lineTo(this.width, groundY + 48);
      ctx.lineTo(0, groundY + 48);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#059669';
      ctx.fillRect(0, groundY, this.width, this.height - groundY + 140);
      ctx.fillStyle = '#34d399';
      ctx.fillRect(0, groundY, this.width, 8);

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

    const ladderTop = 0;
    const ladderBottom = Math.min(this.height, groundY);
    const railHalf = 26;

    const trunkGrad = ctx.createLinearGradient(cx - 32, 0, cx + 32, 0);
    trunkGrad.addColorStop(0, 'rgba(69, 26, 3, 0.35)');
    trunkGrad.addColorStop(0.5, 'rgba(120, 53, 15, 0.25)');
    trunkGrad.addColorStop(1, 'rgba(69, 26, 3, 0.35)');
    ctx.fillStyle = trunkGrad;
    ctx.fillRect(cx - 32, ladderTop, 64, ladderBottom);

    ctx.fillStyle = '#5c2808';
    ctx.fillRect(cx - railHalf - 5, ladderTop, 10, ladderBottom);
    ctx.fillRect(cx + railHalf - 5, ladderTop, 10, ladderBottom);
    ctx.fillStyle = '#92400e';
    ctx.fillRect(cx - railHalf - 3, ladderTop, 6, ladderBottom);
    ctx.fillRect(cx + railHalf - 3, ladderTop, 6, ladderBottom);
    ctx.fillStyle = '#d97706';
    ctx.fillRect(cx - railHalf - 2, ladderTop, 2, ladderBottom);
    ctx.fillRect(cx + railHalf - 2, ladderTop, 2, ladderBottom);

    this.drawVinesOnRails(ctx, cx, railHalf, ladderBottom);

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

    const minM = Math.max(5, Math.floor((this.visualMeters - 15) / 5) * 5);
    const maxM = Math.ceil((this.visualMeters + 18) / 5) * 5;
    ctx.font = '700 12px ui-monospace, SFMono-Regular, Menlo, monospace';
    for (let m = minM; m <= maxM; m += 5) {
      const markerY = catBaseY - (m - this.visualMeters) * this.pxPerMeter;
      if (markerY < -24 || markerY > this.height + 24) continue;

      const onRight = (m / 5) % 2 === 1;
      const ledgeW = 66;
      const ledgeX = onRight ? cx + railHalf + 5 : cx - railHalf - 5 - ledgeW;

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

      ctx.fillStyle = '#78350f';
      ctx.beginPath();
      ctx.roundRect(ledgeX, markerY - 5, ledgeW, 10, 4);
      ctx.fill();
      ctx.fillStyle = '#d97706';
      ctx.fillRect(ledgeX + 4, markerY - 4, ledgeW - 8, 3);

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
      ctx.moveTo(cx + 34, markerY);
      ctx.lineTo(this.width - 14, markerY);
      ctx.stroke();

      ctx.fillStyle = 'rgba(240, 253, 250, 0.9)';
      ctx.textAlign = 'left';
      ctx.fillText(`${m} m`, cx + 36, markerY - 9);
    }

    // Center 10m milestone fish treat
    const treatY = catBaseY - (this.nextTreatMeter - this.visualMeters) * this.pxPerMeter;
    if (treatY >= -34 && treatY <= this.height + 34) {
      const bob = Math.sin(this.clock * 4) * 3.5;
      this.drawFishTreat(ctx, cx, treatY - 12 + bob);
    }

    // Interactive Glowing Fish Treats (branch-perched & floating down)
    for (const f of this.fishTreats) {
      if (f.collected) continue;
      const pos = this.getFishScreenPos(f);
      if (pos.y < -40 || pos.y > this.height + 40) continue;
      if (f.kind === 'branch') {
        const railX = cx + f.side * railHalf;
        ctx.save();
        ctx.strokeStyle = '#78350f';
        ctx.lineWidth = 8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(railX, pos.y + 12);
        ctx.lineTo(pos.x + f.side * 10, pos.y + 12);
        ctx.stroke();
        ctx.strokeStyle = '#b45309';
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.restore();
      } else {
        // Tiny leaf parachute above floating fish
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(pos.x - 10, pos.y - 22);
        ctx.lineTo(pos.x, pos.y - 6);
        ctx.moveTo(pos.x + 10, pos.y - 22);
        ctx.lineTo(pos.x, pos.y - 6);
        ctx.stroke();
        ctx.fillStyle = '#34d399';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y - 20, 13, Math.PI, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      const bob = Math.sin(this.clock * 5.2 + f.swayPhase) * 3;
      this.drawFishTreat(ctx, pos.x, pos.y + bob);
    }

    // Telegraphed & Falling Acorns
    for (const ac of this.acorns) {
      if (ac.resolved) continue;
      const acX = cx + ac.side * 22;
      if (ac.telegraph > 0) {
        const flash = 0.5 + 0.5 * Math.sin(this.clock * 22);
        ctx.save();
        ctx.strokeStyle = `rgba(251, 146, 60, ${0.32 + flash * 0.45})`;
        ctx.setLineDash([6, 6]);
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(acX, 34);
        ctx.lineTo(acX, catBaseY);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = `rgba(234, 88, 12, ${0.82 + flash * 0.18})`;
        ctx.beginPath();
        ctx.roundRect(acX - 28, 12, 56, 22, 11);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = '900 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⚠️ 🌰', acX, 23);
        ctx.restore();
      } else {
        this.drawAcorn(ctx, acX, ac.y, ac.rot);
      }
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
        ctx.lineTo(cx - 32, bestY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#fde047';
        ctx.textAlign = 'left';
        ctx.fillText(`Best ${this.bestMeters.toFixed(1)}m`, 16, bestY - 6);
      }
    }

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

    const catSize = Math.max(24, Math.min(35, Math.min(this.width, this.height) * 0.082));
    const shakeX = this.bonkShake > 0 ? Math.sin(this.clock * 60) * 6 * this.bonkShake : 0;
    const catX = cx + this.catOffsetX + shakeX;
    const catY = catBaseY + this.bounceOffset;

    if (this.comboHeat > 0.25 || this.feverTimer > 0) {
      const auraIntensity = this.feverTimer > 0 ? 1 : (this.comboHeat - 0.25) / 0.75;
      const flicker = 0.85 + 0.15 * Math.sin(this.clock * 22);
      const auraR = catSize * (2.1 + auraIntensity * 0.75) * flicker;
      const fireGrad = ctx.createRadialGradient(catX, catY + 12, catSize * 0.4, catX, catY + 12, auraR);
      fireGrad.addColorStop(0, this.feverTimer > 0 ? 'rgba(45, 212, 191, 0.5)' : `rgba(253, 224, 71, ${0.38 * auraIntensity})`);
      fireGrad.addColorStop(0.55, `rgba(249, 115, 22, ${0.28 * auraIntensity})`);
      fireGrad.addColorStop(1, 'rgba(239, 68, 68, 0)');
      ctx.fillStyle = fireGrad;
      ctx.beginPath();
      ctx.arc(catX, catY + 12, auraR, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.globalAlpha = 0.45 * auraIntensity;
      for (const side of [-1, 0, 1]) {
        const fx = catX + side * catSize * 0.65;
        const fh = catSize * (0.9 + auraIntensity * 0.8) * (0.85 + 0.2 * Math.sin(this.clock * 18 + side));
        ctx.fillStyle = this.feverTimer > 0 ? '#2dd4bf' : side === 0 ? '#fde047' : '#fb923c';
        ctx.beginPath();
        ctx.moveTo(fx - 10, catY + 28);
        ctx.quadraticCurveTo(fx, catY + 28 - fh * 1.4, fx + 10, catY + 28);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    drawCartoonCat(ctx, catX, catY, catSize, {
      color: this.color,
      eyeColor: this.eyeColor,
      accessory: this.accessory,
      pose: 'climbing',
      phase: this.clock * 2.4,
      climbStep: this.smoothClimbAnim,
      comboHeat: this.comboHeat,
    });

    // Fever badge (top-left of canvas, strictly below HUD)
    if (this.feverTimer > 0) {
      ctx.save();
      ctx.fillStyle = 'rgba(45, 212, 191, 0.94)';
      ctx.beginPath();
      ctx.roundRect(14, 12, 122, 26, 13);
      ctx.fill();
      ctx.fillStyle = '#042f2e';
      ctx.font = '900 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`🐟 FEVER ${this.feverTimer.toFixed(1)}s`, 75, 25);
      ctx.restore();
    }

    // Combo badge (top-right of canvas, strictly below HUD)
    if (this.tapStreak >= 4) {
      ctx.save();
      ctx.fillStyle = this.tapStreak >= 10 ? 'rgba(250, 204, 21, 0.94)' : 'rgba(15, 23, 42, 0.82)';
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(this.width - 110, 12, 96, 26, 13);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = this.tapStreak >= 10 ? '#042f2e' : '#fde047';
      ctx.font = '900 12px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`🔥 x${this.tapStreak}`, this.width - 62, 25);
      ctx.restore();
    }

    if (this.visualMeters < 3) {
      ctx.save();
      ctx.fillStyle = 'rgba(4, 47, 46, 0.78)';
      ctx.beginPath();
      ctx.roundRect(cx - 130, this.height - 40, 260, 26, 13);
      ctx.fill();
      ctx.fillStyle = '#ccfbf1';
      ctx.font = '700 11.5px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Tap Left/Right to climb & dodge • Catch Fish!', cx, this.height - 27);
      ctx.restore();
    }

    for (const p of this.popups) {
      const t = p.life / p.maxLife;
      ctx.save();
      ctx.globalAlpha = 1 - t;
      ctx.font = p.big
        ? '800 17px ui-monospace, SFMono-Regular, Menlo, monospace'
        : '800 15px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(2, 6, 23, 0.82)';
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
      ctx.restore();
    }

    ctx.restore();
  }

  private drawAcorn(ctx: CanvasRenderingContext2D, x: number, y: number, rot: number): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    // Nut body
    ctx.fillStyle = '#b45309';
    ctx.strokeStyle = '#451a03';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 4, 10, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Textured cap
    ctx.fillStyle = '#78350f';
    ctx.beginPath();
    ctx.arc(0, -3, 11.5, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Stem
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(2, -20);
    ctx.stroke();
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

      ctx.strokeStyle = '#15803d';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(rx - side * 4, y - 24);
      ctx.quadraticCurveTo(rx + side * 8, y, rx - side * 3, y + 24);
      ctx.stroke();

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

    const pulse = 0.5 + 0.5 * Math.sin(this.clock * 6);
    const halo = ctx.createRadialGradient(0, 0, 4, 0, 0, 24 + pulse * 5);
    halo.addColorStop(0, 'rgba(253, 224, 71, 0.55)');
    halo.addColorStop(0.6, 'rgba(45, 212, 191, 0.25)');
    halo.addColorStop(1, 'rgba(45, 212, 191, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, 26 + pulse * 5, 0, Math.PI * 2);
    ctx.fill();

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

    for (let i = 0; i < 2; i++) {
      const a = this.clock * 3.2 + i * Math.PI;
      const sx = Math.cos(a) * 18;
      const sy = Math.sin(a) * 18;
      ctx.fillStyle = '#fef9c3';
      ctx.beginPath();
      ctx.arc(sx, sy, 2, 0, Math.PI * 2);
      ctx.fill();
    }

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

    const fishGrad = ctx.createLinearGradient(-12, -8, 10, 8);
    fishGrad.addColorStop(0, '#fef08a');
    fishGrad.addColorStop(0.55, '#fbbf24');
    fishGrad.addColorStop(1, '#d97706');
    ctx.fillStyle = fishGrad;
    ctx.beginPath();
    ctx.ellipse(-2, 0, 11.5, 7.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.beginPath();
    ctx.ellipse(-4, -3, 4.5, 1.8, -0.2, 0, Math.PI * 2);
    ctx.fill();

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
      const t = m / 60;
      topColor = lerpColor('#0284c7', '#0369a1', t);
      botColor = lerpColor('#bae6fd', '#5eead4', t);
    } else if (m < 140) {
      const t = (m - 60) / 80;
      topColor = lerpColor('#0369a1', '#4c1d95', t);
      botColor = lerpColor('#5eead4', '#fb7185', t);
    } else if (m < 240) {
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
