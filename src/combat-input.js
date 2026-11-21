// Combat uses shoulder buttons while RT keeps the established exploration sprint.
// Each sampler owns its edges so exploration polling cannot consume attack presses.
// Forward keydown/up to keyDown/keyUp: event latches retain a complete tap or
// release/repress between frames. sample(keys,pad) still supports polling-only
// callers. heavyHeld is a level; guard is held or a one-sample tap-parry pulse.
// Other returned fields are edges.
// reset() clears event-held keys and all pending edges (call on blur).
export function createCombatControls() {
  const actions = new Map([
    ["KeyJ", "light"],
    ["KeyK", "heavy"],
    ["AltLeft", "dodge"],
    ["AltRight", "dodge"],
    ["KeyQ", "guard"],
    ["KeyF", "lock"],
  ]);
  const keyboard = new Set();
  const presses = new Set();
  let previous = {};
  let heavyReleased = false;
  let padHeavyHeld = false;
  return {
    keyDown(code) {
      const action = actions.get(code);
      if (!action || keyboard.has(code)) return;
      keyboard.add(code);
      presses.add(action);
    },
    keyUp(code) {
      // Releasing one source while LB remains held does not release a charge.
      if (code === "KeyK" && keyboard.has(code) && !padHeavyHeld)
        heavyReleased = true;
      keyboard.delete(code);
    },
    sample(keys = new Set(), pad) {
      const down = (code) => keyboard.has(code) || keys.has(code);
      const held = {
        light: down("KeyJ") || !!pad?.buttons?.[5]?.pressed,
        heavy: down("KeyK") || !!pad?.buttons?.[4]?.pressed,
        dodge:
          down("AltLeft") ||
          down("AltRight") ||
          !!pad?.buttons?.[1]?.pressed,
        guard: down("KeyQ") || !!pad?.buttons?.[6]?.pressed,
        lock: down("KeyF") || !!pad?.buttons?.[11]?.pressed,
      };
      const input = Object.fromEntries(
        Object.entries(held).map(([name, value]) => [
          name,
          name === "guard"
            ? value || presses.has("guard")
            : presses.has(name) || (value && !previous[name]),
        ]),
      );
      input.heavyHeld = held.heavy;
      input.heavyRelease = heavyReleased || !!(previous.heavy && !held.heavy);
      previous = held;
      padHeavyHeld = !!pad?.buttons?.[4]?.pressed;
      presses.clear();
      heavyReleased = false;
      return input;
    },
    reset() {
      previous = {};
      keyboard.clear();
      presses.clear();
      heavyReleased = false;
      padHeavyHeld = false;
    },
  };
}
