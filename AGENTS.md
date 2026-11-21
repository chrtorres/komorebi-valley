# Valley: non-negotiable acceptance requirements

Keep these four functional requirements intact through every change:

1. **Xbox controller support:** a physical Xbox controller must drive exploration and combat end to end. Verify discovery, activation, axes, buttons, disconnect/reconnect, and held/edge inputs. Synthetic standard-mapped Gamepad tests alone do not satisfy hardware acceptance. Show actionable controller diagnostics instead of silently falling back.
2. **Third-person playable character:** gameplay must retain a visible controllable character and a following third-person camera, including combat and obstruction handling.
3. **Persistent saves:** journey position, restored lanterns, combat vitality and defeated wardens must survive reloads on the same browser origin. Preserve existing saves and clearly report storage failures.
4. **Detailed combat with physics:** preserve buffered light/heavy combos, launchers/aerial follow-ups, guard/parry, dodge invulnerability, stamina, hit detection, knockback/gravity and death/respawn behavior.

The visual target also remains modern, cinematic Japanese landscape graphics comparable to AAA games in this genre. Do not declare that qualitative target met solely because automated tests pass.

## Delivery rules

- Work in this repository; origin is the user-designated Valley repository. Keep feature work on feature branches and have another engineer review implementation and regression coverage locally.
- Run meaningful regression tests before shipping a feature. Label simulated input, physical hardware checks, visual review and untested capabilities separately.
- Keep the user preview URL stable. A browser/host/port change creates a different save origin; do not silently present an empty journey as lost or reset progress.
- Maintain the acceptance matrix in DEVELOPMENT.md. Record failures and exact source-linked evidence outside the repository; do not claim completion while a hard requirement is failed or unverified.
- Publish user-authorized inspection checkpoints on feature branches with honest incomplete/known-failure notes. An inspection checkpoint is not a release or a passing acceptance gate.
