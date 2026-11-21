export const SAVE_KEY = "komorebi.journey.v1";
export function readJourney(storage, fallback) {
  try {
    const data = JSON.parse(storage.getItem(SAVE_KEY));
    if (
      data?.version !== 1 ||
      !Array.isArray(data.position) ||
      data.position.length !== 3 ||
      !data.position.every(Number.isFinite) ||
      Math.abs(data.position[0]) > 70 ||
      Math.abs(data.position[2]) > 70 ||
      Math.abs(data.position[1]) > 100
    )
      return fallback;
    return {
      position: data.position,
      lit: [
        ...new Set(
          (Array.isArray(data.lit) ? data.lit : []).filter(
            (i) => Number.isInteger(i) && i >= 0 && i < 7,
          ),
        ),
      ],
      yaw: Number.isFinite(data.yaw) ? data.yaw % (Math.PI * 2) : 0,
      ...(Number.isFinite(data.pitch) ? { pitch: data.pitch } : {}),
    };
  } catch {
    return fallback;
  }
}

// Browser storage may be disabled or full. Callers surface failure and keep playing.
export function writeJourney(storage, state) {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify({ version: 1, ...state }));
    return true;
  } catch {
    return false;
  }
}
export function deadzone(value) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.16) return 0;
  return (Math.max(-1, Math.min(1, value)) - Math.sign(value) * 0.16) / 0.84;
}
export function connectedGamepad(navigatorObject) {
  try {
    return Array.from(navigatorObject.getGamepads?.() || []).find(
      (p) => p?.mapping === "standard" && p.connected !== false,
    );
  } catch {
    return undefined;
  }
}
export function frameDelta(now, previous) {
  if (!Number.isFinite(now) || !Number.isFinite(previous)) return 0;
  // The first RAF timestamp can predate initialization work within that frame.
  return Math.max(0, Math.min((now-previous)/1000, .05));
}
