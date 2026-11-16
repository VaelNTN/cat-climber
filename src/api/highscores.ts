import { AccessoryId, EyeColorId } from '../data/cats';

export interface GlobalClimberEntry {
  rank: number;
  deviceId: string;
  playerName: string;
  meters: number;
  colorId: number;
  eyeColor: EyeColorId;
  accessory: AccessoryId;
  updatedAt: string;
}

export interface GlobalClimberResponse {
  ok: boolean;
  entries: GlobalClimberEntry[];
  player: GlobalClimberEntry | null;
}

function cleanUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export async function fetchGlobalClimberHighscores(
  baseUrl: string,
  deviceId: string,
  limit = 50
): Promise<GlobalClimberResponse> {
  const base = cleanUrl(baseUrl);
  if (!base) throw new Error('NO_BACKEND_URL');
  const res = await fetch(
    `${base}/api/cat-climber/highscores?limit=${limit}&deviceId=${encodeURIComponent(deviceId)}`,
    { method: 'GET' }
  );
  if (!res.ok) throw new Error(`HTTP_${res.status}`);
  return (await res.json()) as GlobalClimberResponse;
}

export async function submitGlobalClimberScore(
  baseUrl: string,
  payload: {
    deviceId: string;
    playerName: string;
    meters: number;
    colorId: number;
    eyeColor: EyeColorId;
    accessory: AccessoryId;
  }
): Promise<void> {
  const base = cleanUrl(baseUrl);
  if (!base || payload.meters <= 0) return;

  try {
    await fetch(`${base}/api/cat-climber/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: payload.deviceId,
        playerName: payload.playerName.trim() || 'Kattenbaas',
        meters: payload.meters,
        colorId: payload.colorId,
        eyeColor: payload.eyeColor,
        accessory: payload.accessory,
      }),
    });
  } catch {
    // Offline fallback stays silent
  }
}
