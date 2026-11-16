import { AccessoryId, EyeColorId } from '../data/cats';

const SAVE_KEY = 'cat_climber_save_v1';

export interface ClimberHighscore {
  id: string;
  playerName: string;
  meters: number;
  colorId: number;
  eyeColor: EyeColorId;
  accessory: AccessoryId;
  createdAt: string;
}

export interface ClimberState {
  colorId: number;
  eyeColor: EyeColorId;
  accessory: AccessoryId;
  playerName: string;
  soundEnabled: boolean;
  currentMeters: number;
  bestMeters: number;
  activeRunId: string;
  highscores: ClimberHighscore[];
}

function makeRunId(): string {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function loadClimberState(): ClimberState {
  const base: ClimberState = {
    colorId: 0,
    eyeColor: 'amber',
    accessory: 'none',
    playerName: 'Kattenbaas',
    soundEnabled: true,
    currentMeters: 0,
    bestMeters: 0,
    activeRunId: makeRunId(),
    highscores: [],
  };

  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<ClimberState>;
    const currentMeters = Math.max(0, Number(parsed.currentMeters || 0));
    const bestMeters = Math.max(currentMeters, Number(parsed.bestMeters || 0));
    return {
      colorId: typeof parsed.colorId === 'number' ? parsed.colorId : 0,
      eyeColor: parsed.eyeColor || 'amber',
      accessory: parsed.accessory || 'none',
      playerName:
        typeof parsed.playerName === 'string' && parsed.playerName.trim()
          ? parsed.playerName.trim()
          : 'Kattenbaas',
      soundEnabled: parsed.soundEnabled !== false,
      currentMeters,
      bestMeters,
      activeRunId: typeof parsed.activeRunId === 'string' && parsed.activeRunId ? parsed.activeRunId : makeRunId(),
      highscores: Array.isArray(parsed.highscores) ? parsed.highscores : [],
    };
  } catch {
    return base;
  }
}

export function saveClimberState(state: ClimberState): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage issues
  }
}

export function updateClimberHighscore(state: ClimberState): void {
  const rounded = Math.round(state.currentMeters * 10) / 10;
  if (rounded <= 0) return;

  if (rounded > state.bestMeters) {
    state.bestMeters = rounded;
  }

  const idx = state.highscores.findIndex((h) => h.id === state.activeRunId);
  const entry: ClimberHighscore = {
    id: state.activeRunId,
    playerName: state.playerName.trim() || 'Kattenbaas',
    meters: rounded,
    colorId: state.colorId,
    eyeColor: state.eyeColor,
    accessory: state.accessory,
    createdAt: new Date().toISOString(),
  };

  if (idx >= 0) {
    if (rounded >= state.highscores[idx].meters) {
      state.highscores[idx] = entry;
    }
  } else {
    state.highscores.push(entry);
  }

  state.highscores = state.highscores
    .sort((a, b) => b.meters - a.meters)
    .slice(0, 50);

  saveClimberState(state);
}

export function startNewClimberRun(state: ClimberState): void {
  state.currentMeters = 0;
  state.activeRunId = makeRunId();
  saveClimberState(state);
}
