import './style.css';
import {
  GlobalClimberEntry,
  fetchGlobalClimberHighscores,
  submitGlobalClimberScore,
} from './api/highscores';
import {
  ACCESSORIES,
  CAT_COLORS,
  EYE_COLORS,
  getCatColor,
} from './data/cats';
import { drawCartoonCat } from './game/catRenderer';
import { ClimberStage } from './game/ClimberStage';
import { soundFX } from './game/SoundFX';
import {
  ClimberState,
  loadClimberState,
  resolveDeviceId,
  saveClimberState,
  startNewClimberRun,
  updateClimberHighscore,
} from './storage/state';

type ScreenName = 'home' | 'options' | 'game' | 'highscores';
type HsMode = 'global' | 'local';

let state: ClimberState;
let currentScreen: ScreenName = 'home';
let hsMode: HsMode = 'global';
let optionsFromPlay = false;
let stage: ClimberStage | null = null;
let homeAnimId: number | null = null;
let syncTimeout: number | null = null;
let hsPollInterval: number | null = null;
let hsHeadingTapCount = 0;
let hsHeadingTapTimer: number | null = null;
let confirmQuitArmed = false;

function renderCatThumb(
  canvas: HTMLCanvasElement,
  colorId: number,
  size: number
): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  drawCartoonCat(ctx, size / 2, size * 0.42, size * 0.24, {
    color: getCatColor(colorId),
    eyeColor: state.eyeColor,
    accessory: state.accessory,
    pose: 'portrait',
  });
}

function syncSoundButtons(): void {
  const homeBtn = document.getElementById('btn-home-sound');
  if (homeBtn) homeBtn.textContent = state.soundEnabled ? '🔊' : '🔇';
  const gameBtn = document.getElementById('btn-game-sound');
  if (gameBtn) gameBtn.textContent = state.soundEnabled ? '🔊' : '🔇';
}

function toggleSound(): void {
  state.soundEnabled = !state.soundEnabled;
  soundFX.enabled = state.soundEnabled;
  saveClimberState(state);
  syncSoundButtons();
  if (state.soundEnabled) soundFX.playUiTap();
}

function openPauseModal(): void {
  if (!stage) return;
  stage.setPaused(true);
  scheduleClimberSync(100);
  confirmQuitArmed = false;
  const quitBtn = document.getElementById('btn-pause-quit')!;
  quitBtn.textContent = '🚪 Quit to Menu';
  quitBtn.classList.remove('armed');
  document.getElementById('pause-modal')?.classList.remove('hidden');
}

function closePauseModal(resume = true): void {
  document.getElementById('pause-modal')?.classList.add('hidden');
  confirmQuitArmed = false;
  const quitBtn = document.getElementById('btn-pause-quit');
  if (quitBtn) {
    quitBtn.textContent = '🚪 Quit to Menu';
    quitBtn.classList.remove('armed');
  }
  if (resume && stage) {
    stage.setPaused(false);
  }
}

function buildApp(): void {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <!-- HOME SCREEN -->
    <section id="screen-home" class="screen home-screen">
      <div class="home-topbar">
        <button id="btn-home-more" class="btn btn-small">✨ More Games</button>
        <button id="btn-home-sound" class="btn btn-small" aria-label="Toggle sound">🔊</button>
      </div>
      <div class="home-content">
        <div class="home-hero">
          <canvas id="home-cat-canvas" class="cat-preview-canvas"></canvas>
          <h1 class="game-title">Cat Climber</h1>
          <p class="game-subtitle">Tap left & right to climb, grab Glowing Fish & dodge acorns!</p>
          <div id="home-best-pill" class="best-pill hidden"></div>
        </div>
        <div class="home-actions">
          <button id="btn-home-play" class="btn btn-primary">▶ Play</button>
          <div class="home-secondary-row">
            <button id="btn-home-options" class="btn btn-secondary">🐱 Style</button>
            <button id="btn-home-highscores" class="btn btn-secondary">🏆 Ranks</button>
          </div>
        </div>
      </div>
    </section>

    <!-- CAT STYLE SCREEN -->
    <section id="screen-options" class="screen hidden">
      <div class="top-nav">
        <button id="btn-options-back" class="btn btn-small">← Back</button>
        <h2 id="options-heading" class="screen-heading">Cat Style</h2>
        <span style="width:60px"></span>
      </div>

      <div class="options-scroll">
        <div>
          <p class="section-label">Player Name</p>
          <input id="player-name-input" class="name-input" type="text" maxlength="20" placeholder="Player" />
        </div>

        <div>
          <p class="section-label">Cat Color</p>
          <div id="cat-color-grid" class="color-grid"></div>
        </div>

        <div>
          <p class="section-label">Eye Color</p>
          <div id="eye-chips" class="chip-row"></div>
        </div>

        <div>
          <p class="section-label">Accessory</p>
          <div id="acc-chips" class="chip-row"></div>
        </div>

        <button id="btn-options-start" class="btn btn-primary" style="margin-top:6px;">Play Now</button>
      </div>
    </section>

    <!-- GAME SCREEN -->
    <section id="screen-game" class="screen game-screen hidden">
      <div class="game-hud-bar">
        <button id="btn-game-pause" class="btn btn-small" aria-label="Pause">⏸ Pause</button>
        <div class="hud-center">
          <div class="meters-pill">
            <span id="meters-value" class="meters-value">0.0 m</span>
          </div>
          <div id="meters-best" class="meters-best">Best: 0.0 m</div>
        </div>
        <button id="btn-game-sound" class="btn btn-small" aria-label="Toggle sound">🔊</button>
      </div>

      <div class="stage-wrap">
        <canvas id="climber-canvas" class="stage-canvas"></canvas>
      </div>
    </section>

    <!-- LEADERBOARD SCREEN -->
    <section id="screen-highscores" class="screen hidden">
      <div class="top-nav">
        <button id="btn-hs-back" class="btn btn-small">← Back</button>
        <h2 id="hs-heading" class="screen-heading">Leaderboard</h2>
        <button id="btn-hs-refresh" class="btn btn-small">Refresh</button>
      </div>

      <div class="hs-mode-tabs">
        <button id="btn-hs-global" class="hs-mode-btn active" type="button">🌐 Global</button>
        <button id="btn-hs-local" class="hs-mode-btn" type="button">📱 Local</button>
      </div>

      <div class="hs-status-bar">
        <span id="hs-status-text">Connecting...</span>
      </div>

      <div id="hs-config-panel" class="hs-config-panel hidden">
        <p class="hs-config-help">
          Developer endpoint URL for shared scores:
        </p>
        <div class="hs-url-row">
          <input
            id="api-url-input"
            class="name-input"
            type="url"
            placeholder="https://example.com"
          />
          <button id="btn-save-api-url" class="btn btn-small" type="button">Save</button>
        </div>
      </div>

      <div id="hs-list" class="hs-list"></div>
    </section>

    <!-- PAUSE MODAL -->
    <div id="pause-modal" class="modal-backdrop hidden">
      <div class="modal-card">
        <h3 class="modal-title">⏸ Paused</h3>
        <p class="modal-sub">Catch a catnap — your climb progress is safe!</p>
        <button id="btn-pause-resume" class="btn btn-primary" style="height:48px;">▶ Resume</button>
        <button id="btn-pause-options" class="btn btn-secondary">🐱 Cat Style</button>
        <button id="btn-pause-new" class="btn btn-secondary">↻ New Climb</button>
        <button id="btn-pause-quit" class="btn btn-danger">🚪 Quit to Menu</button>
      </div>
    </div>

    <!-- MORE GAMES MODAL -->
    <div id="more-games-modal" class="modal-backdrop hidden">
      <div class="modal-card">
        <h3 class="modal-title">✨ More Games by VaelNTN</h3>
        <p class="modal-sub">Handcrafted arcade games from VaelNTN Studios.</p>
        <div class="more-games-list">
          <a class="more-game-item featured" href="https://github.com/VaelNTN/starforge-survivors/releases/latest" target="_blank" rel="noopener noreferrer">
            <div>
              <div class="more-game-name">⭐ Starforge Survivors</div>
              <div class="more-game-desc">Flagship sci-fi roguelite — 6 heroes, 6 bosses & zero ads</div>
            </div>
            <span class="more-game-badge">FLAGSHIP</span>
          </a>
          <a class="more-game-item" href="https://github.com/VaelNTN/cat-hanger/releases/latest" target="_blank" rel="noopener noreferrer">
            <div>
              <div class="more-game-name">🐱 Cat Hanger</div>
              <div class="more-game-desc">Brave sunset wind gusts & hit rhythmic grip boosts</div>
            </div>
          </a>
          <a class="more-game-item" href="https://github.com/VaelNTN/dog-climber/releases/latest" target="_blank" rel="noopener noreferrer">
            <div>
              <div class="more-game-name">🐕 Dog Climber</div>
              <div class="more-game-desc">Grab Golden Bones & dodge falling pinecones up the ladder</div>
            </div>
          </a>
          <a class="more-game-item" href="https://github.com/VaelNTN/dog-hanger/releases/latest" target="_blank" rel="noopener noreferrer">
            <div>
              <div class="more-game-name">🐶 Dog Hanger</div>
              <div class="more-game-desc">Hold on tight & catch flying frisbees over the sunny pool</div>
            </div>
          </a>
        </div>
        <button id="btn-more-close" class="btn btn-secondary" style="height:44px;">Close</button>
      </div>
    </div>
  `;

  populateOptions();
  syncSoundButtons();
  wireEvents();
  refreshHome();
  startHomePreview();
}

function populateOptions(): void {
  const nameInput = document.getElementById('player-name-input') as HTMLInputElement;
  nameInput.value = state.playerName;

  const grid = document.getElementById('cat-color-grid')!;
  grid.innerHTML = '';
  for (const c of CAT_COLORS) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `color-card${state.colorId === c.id ? ' selected' : ''}`;
    const cvs = document.createElement('canvas');
    renderCatThumb(cvs, c.id, 54);
    const lbl = document.createElement('span');
    lbl.className = 'color-card-name';
    lbl.textContent = c.name;
    card.appendChild(cvs);
    card.appendChild(lbl);
    card.addEventListener('click', () => {
      soundFX.playUiTap();
      state.colorId = c.id;
      saveClimberState(state);
      populateOptions();
    });
    grid.appendChild(card);
  }

  const eyeRow = document.getElementById('eye-chips')!;
  eyeRow.innerHTML = '';
  for (const e of EYE_COLORS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `chip-btn${state.eyeColor === e.id ? ' selected' : ''}`;
    btn.textContent = e.name;
    btn.addEventListener('click', () => {
      soundFX.playUiTap();
      state.eyeColor = e.id;
      saveClimberState(state);
      populateOptions();
    });
    eyeRow.appendChild(btn);
  }

  const accRow = document.getElementById('acc-chips')!;
  accRow.innerHTML = '';
  for (const a of ACCESSORIES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `chip-btn${state.accessory === a.id ? ' selected' : ''}`;
    btn.textContent = a.name;
    btn.addEventListener('click', () => {
      soundFX.playUiTap();
      state.accessory = a.id;
      saveClimberState(state);
      populateOptions();
    });
    accRow.appendChild(btn);
  }
}

function scheduleClimberSync(delayMs = 2500): void {
  if (!state.apiBaseUrl || state.bestMeters <= 0) return;
  if (syncTimeout !== null) {
    window.clearTimeout(syncTimeout);
  }
  syncTimeout = window.setTimeout(() => {
    syncTimeout = null;
    void submitGlobalClimberScore(state.apiBaseUrl, {
      deviceId: state.deviceId,
      playerName: state.playerName.trim() || 'Player',
      meters: state.bestMeters,
      colorId: state.colorId,
      eyeColor: state.eyeColor,
      accessory: state.accessory,
    });
  }, delayMs);
}

function showScreen(target: ScreenName): void {
  currentScreen = target;
  closePauseModal(false);
  document.getElementById('more-games-modal')?.classList.add('hidden');
  const map: Record<ScreenName, HTMLElement> = {
    home: document.getElementById('screen-home')!,
    options: document.getElementById('screen-options')!,
    game: document.getElementById('screen-game')!,
    highscores: document.getElementById('screen-highscores')!,
  };
  (Object.keys(map) as ScreenName[]).forEach((k) => {
    map[k].classList.toggle('hidden', k !== target);
  });

  if (target === 'home') {
    stopHighscorePolling();
    stopGameStage();
    scheduleClimberSync(200);
    refreshHome();
    startHomePreview();
  } else if (target === 'options') {
    stopHighscorePolling();
    stopHomePreview();
    stopGameStage();
    populateOptions();
    document.getElementById('options-heading')!.textContent = 'Cat Style';
  } else if (target === 'game') {
    stopHighscorePolling();
    stopHomePreview();
    startGameStage();
  } else if (target === 'highscores') {
    stopHomePreview();
    stopGameStage();
    document.getElementById('hs-config-panel')!.classList.add('hidden');
    void loadHighscores();
    startHighscorePolling();
  }
}

function refreshHome(): void {
  syncSoundButtons();
  const pill = document.getElementById('home-best-pill')!;
  if (state.bestMeters > 0) {
    pill.textContent = `Best Climb: ${state.bestMeters.toFixed(1)} m`;
    pill.classList.remove('hidden');
  } else {
    pill.classList.add('hidden');
  }
}

function startHomePreview(): void {
  if (homeAnimId !== null) return;
  const canvas = document.getElementById('home-cat-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  const size = 150;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let phase = 0;
  let last = performance.now();
  const tick = (now: number) => {
    if (currentScreen !== 'home') {
      homeAnimId = null;
      return;
    }
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now;
    phase += dt * 3;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    drawCartoonCat(ctx, size / 2, size * 0.44, 34, {
      color: getCatColor(state.colorId),
      eyeColor: state.eyeColor,
      accessory: state.accessory,
      pose: 'climbing',
      phase,
      climbStep: Math.sin(phase) > 0 ? 1 : -1,
    });
    homeAnimId = requestAnimationFrame(tick);
  };
  homeAnimId = requestAnimationFrame(tick);
}

function stopHomePreview(): void {
  if (homeAnimId !== null) {
    cancelAnimationFrame(homeAnimId);
    homeAnimId = null;
  }
}

function updateMetersHud(): void {
  document.getElementById('meters-value')!.textContent = `${state.currentMeters.toFixed(1)} m`;
  document.getElementById('meters-best')!.textContent = `Best: ${state.bestMeters.toFixed(1)} m`;
}

function startGameStage(): void {
  updateMetersHud();
  syncSoundButtons();

  const canvas = document.getElementById('climber-canvas') as HTMLCanvasElement;
  const appearance = {
    color: getCatColor(state.colorId),
    eyeColor: state.eyeColor,
    accessory: state.accessory,
  };

  if (stage) {
    stage.setCatAppearance(appearance);
    stage.setMeters(state.currentMeters, state.bestMeters);
    stage.start();
    return;
  }

  stage = new ClimberStage(
    canvas,
    {
      ...appearance,
      initialMeters: state.currentMeters,
      bestMeters: state.bestMeters,
    },
    {
      onClimbStep: (delta, eventType) => {
        if (eventType === 'bonk') {
          soundFX.playBonk();
          return;
        }
        if (eventType === 'fever') soundFX.playFever();
        else soundFX.playClimb();
        state.currentMeters += delta;
        updateClimberHighscore(state);
        updateMetersHud();
        scheduleClimberSync(2500);
      },
    }
  );
  stage.start();
}

function stopGameStage(): void {
  stage?.stop();
}

async function loadHighscores(): Promise<void> {
  document.getElementById('btn-hs-global')!.classList.toggle('active', hsMode === 'global');
  document.getElementById('btn-hs-local')!.classList.toggle('active', hsMode === 'local');

  const statusEl = document.getElementById('hs-status-text')!;
  const apiInput = document.getElementById('api-url-input') as HTMLInputElement;
  apiInput.value = state.apiBaseUrl;

  if (hsMode === 'local') {
    statusEl.textContent = `Local History (${state.highscores.length} climbs)`;
    renderLocalHighscores();
    return;
  }

  if (!state.apiBaseUrl) {
    statusEl.textContent = 'Offline Mode — Local Records';
    renderLocalHighscores();
    return;
  }

  statusEl.textContent = 'Connecting...';
  try {
    if (state.bestMeters > 0) {
      await submitGlobalClimberScore(state.apiBaseUrl, {
        deviceId: state.deviceId,
        playerName: state.playerName.trim() || 'Player',
        meters: state.bestMeters,
        colorId: state.colorId,
        eyeColor: state.eyeColor,
        accessory: state.accessory,
      });
    }
    const res = await fetchGlobalClimberHighscores(state.apiBaseUrl, state.deviceId, 50);
    statusEl.textContent = `Live • ${res.entries.length} players worldwide`;
    renderGlobalHighscores(res.entries);
  } catch {
    statusEl.textContent = 'Offline Mode — Local Records';
    renderLocalHighscores();
  }
}

function renderGlobalHighscores(entries: GlobalClimberEntry[]): void {
  const list = document.getElementById('hs-list')!;
  if (entries.length === 0) {
    list.innerHTML = `<div class="empty-msg">No climbs yet! Play Cat Climber to set the first height.</div>`;
    return;
  }

  list.innerHTML = '';
  entries.forEach((item) => {
    const row = document.createElement('div');
    const isMe = item.deviceId === state.deviceId;
    row.className = `hs-row${isMe ? ' is-me' : ''}`;

    const rank = document.createElement('div');
    rank.className = 'hs-rank';
    rank.textContent = `#${item.rank}`;

    const icon = document.createElement('canvas');
    icon.className = 'hs-icon';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    icon.width = 38 * dpr;
    icon.height = 38 * dpr;
    const ctx = icon.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
      drawCartoonCat(ctx, 19, 17, 10, {
        color: getCatColor(item.colorId),
        eyeColor: item.eyeColor,
        accessory: item.accessory,
        pose: 'portrait',
      });
    }

    const info = document.createElement('div');
    info.className = 'hs-info';
    const name = document.createElement('div');
    name.className = 'hs-name';
    name.textContent = isMe ? `${item.playerName} (You)` : item.playerName;
    const sub = document.createElement('div');
    sub.className = 'hs-sub';
    sub.textContent = getCatColor(item.colorId).name;
    info.appendChild(name);
    info.appendChild(sub);

    const score = document.createElement('div');
    score.className = 'hs-score';
    score.textContent = `${item.meters.toFixed(1)} m`;

    row.appendChild(rank);
    row.appendChild(icon);
    row.appendChild(info);
    row.appendChild(score);
    list.appendChild(row);
  });
}

function renderLocalHighscores(): void {
  const list = document.getElementById('hs-list')!;
  if (state.highscores.length === 0) {
    list.innerHTML = `<div class="empty-msg">No climbs yet! Play Cat Climber to set a record.</div>`;
    return;
  }

  list.innerHTML = '';
  state.highscores.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'hs-row';

    const rank = document.createElement('div');
    rank.className = 'hs-rank';
    rank.textContent = `#${idx + 1}`;

    const icon = document.createElement('canvas');
    icon.className = 'hs-icon';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    icon.width = 38 * dpr;
    icon.height = 38 * dpr;
    const ctx = icon.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
      drawCartoonCat(ctx, 19, 17, 10, {
        color: getCatColor(item.colorId),
        eyeColor: item.eyeColor,
        accessory: item.accessory,
        pose: 'portrait',
      });
    }

    const info = document.createElement('div');
    info.className = 'hs-info';
    const name = document.createElement('div');
    name.className = 'hs-name';
    name.textContent = item.playerName;
    const sub = document.createElement('div');
    sub.className = 'hs-sub';
    sub.textContent = getCatColor(item.colorId).name;
    info.appendChild(name);
    info.appendChild(sub);

    const score = document.createElement('div');
    score.className = 'hs-score';
    score.textContent = `${item.meters.toFixed(1)} m`;

    row.appendChild(rank);
    row.appendChild(icon);
    row.appendChild(info);
    row.appendChild(score);
    list.appendChild(row);
  });
}

function startHighscorePolling(): void {
  stopHighscorePolling();
  hsPollInterval = window.setInterval(() => {
    if (currentScreen === 'highscores' && hsMode === 'global') {
      void loadHighscores();
    }
  }, 6000);
}

function stopHighscorePolling(): void {
  if (hsPollInterval !== null) {
    window.clearInterval(hsPollInterval);
    hsPollInterval = null;
  }
}

function wireEvents(): void {
  document.getElementById('btn-home-play')!.addEventListener('click', () => {
    soundFX.playUiTap();
    showScreen('game');
  });

  document.getElementById('btn-home-options')!.addEventListener('click', () => {
    soundFX.playUiTap();
    optionsFromPlay = false;
    showScreen('options');
  });

  document.getElementById('btn-home-highscores')!.addEventListener('click', () => {
    soundFX.playUiTap();
    showScreen('highscores');
  });

  document.getElementById('btn-home-sound')!.addEventListener('click', toggleSound);

  document.getElementById('btn-home-more')!.addEventListener('click', () => {
    soundFX.playUiTap();
    document.getElementById('more-games-modal')?.classList.remove('hidden');
  });

  document.getElementById('btn-more-close')!.addEventListener('click', () => {
    soundFX.playUiTap();
    document.getElementById('more-games-modal')?.classList.add('hidden');
  });

  document.getElementById('more-games-modal')!.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      document.getElementById('more-games-modal')?.classList.add('hidden');
    }
  });

  document.getElementById('btn-options-back')!.addEventListener('click', () => {
    soundFX.playUiTap();
    showScreen(optionsFromPlay ? 'game' : 'home');
  });

  document.getElementById('btn-options-start')!.addEventListener('click', () => {
    soundFX.playUiTap();
    showScreen('game');
  });

  document.getElementById('player-name-input')!.addEventListener('input', (ev) => {
    state.playerName = (ev.target as HTMLInputElement).value.slice(0, 20);
    saveClimberState(state);
  });

  document.getElementById('btn-game-pause')!.addEventListener('click', () => {
    soundFX.playUiTap();
    openPauseModal();
  });

  document.getElementById('btn-game-sound')!.addEventListener('click', toggleSound);

  document.getElementById('btn-pause-resume')!.addEventListener('click', () => {
    soundFX.playUiTap();
    closePauseModal(true);
  });

  document.getElementById('btn-pause-options')!.addEventListener('click', () => {
    soundFX.playUiTap();
    optionsFromPlay = true;
    showScreen('options');
  });

  document.getElementById('btn-pause-new')!.addEventListener('click', () => {
    soundFX.playUiTap();
    scheduleClimberSync(100);
    closePauseModal(true);
    startNewClimberRun(state);
    stage?.setMeters(0, state.bestMeters);
    updateMetersHud();
  });

  document.getElementById('btn-pause-quit')!.addEventListener('click', () => {
    soundFX.playUiTap();
    const quitBtn = document.getElementById('btn-pause-quit')!;
    if (!confirmQuitArmed) {
      confirmQuitArmed = true;
      quitBtn.textContent = '⚠️ Confirm Quit?';
      quitBtn.classList.add('armed');
    } else {
      showScreen('home');
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && currentScreen === 'game') {
      const modal = document.getElementById('pause-modal');
      if (modal && !modal.classList.contains('hidden')) closePauseModal(true);
      else openPauseModal();
    }
  });

  document.getElementById('btn-hs-back')!.addEventListener('click', () => {
    soundFX.playUiTap();
    showScreen('home');
  });

  document.getElementById('btn-hs-refresh')!.addEventListener('click', () => {
    soundFX.playUiTap();
    void loadHighscores();
  });

  document.getElementById('btn-hs-global')!.addEventListener('click', () => {
    soundFX.playUiTap();
    hsMode = 'global';
    void loadHighscores();
  });

  document.getElementById('btn-hs-local')!.addEventListener('click', () => {
    soundFX.playUiTap();
    hsMode = 'local';
    void loadHighscores();
  });

  document.getElementById('hs-heading')!.addEventListener('click', () => {
    hsHeadingTapCount += 1;
    if (hsHeadingTapTimer !== null) {
      window.clearTimeout(hsHeadingTapTimer);
    }
    if (hsHeadingTapCount >= 5) {
      hsHeadingTapCount = 0;
      document.getElementById('hs-config-panel')!.classList.toggle('hidden');
    } else {
      hsHeadingTapTimer = window.setTimeout(() => {
        hsHeadingTapCount = 0;
      }, 1500);
    }
  });

  document.getElementById('btn-save-api-url')!.addEventListener('click', () => {
    soundFX.playUiTap();
    const input = document.getElementById('api-url-input') as HTMLInputElement;
    state.apiBaseUrl = input.value.trim().replace(/\/+$/, '');
    saveClimberState(state);
    document.getElementById('hs-config-panel')!.classList.add('hidden');
    hsMode = 'global';
    void loadHighscores();
  });
}

async function init(): Promise<void> {
  const deviceId = await resolveDeviceId();
  state = loadClimberState(deviceId);
  soundFX.enabled = state.soundEnabled;
  buildApp();
  showScreen('home');
}

void init();
