# DUSKLINE

A complete round-based tactical FPS in three.js, built for the make.fun
threejs-fps-02 competition. Five attackers (you + four bots) against five
defender bots on Relay K-7, a desert relay station at dusk. Plant the
demolition charge at Site A or B, or eliminate the other team. First to
5 rounds wins the match.

## Play it

Serve `game/` as static files and open `index.html` in desktop Chrome:

```sh
node serve.ts        # then open http://localhost:8080/
```

No build step, no network: three.js 0.187.0 is vendored under
`game/vendor/three/`, textures are drawn on canvases at boot, and all sound
is synthesised with WebAudio.

## The game

- **Full loop:** menu → buy phase → live round → round banner → next round →
  match-end screen with stats and restart. Pause on pointer-lock loss.
- **Objective:** a demolition charge carried by one attacker. Plant (hold E,
  3.5 s) at Site A or B; defenders defuse (5 s, halved with a kit) before the
  40 s fuse. Wiping the defenders ends the round at once; wiping the
  attackers after a plant does not — the fuse still decides.
- **Gunplay:** five weapons (pistol, SMG, rifle, marksman rifle with zoom,
  shotgun) with damage falloff, headshot multipliers, spread that grows with
  movement and sustained fire, and recoil. Standing still and firing in
  bursts wins fights; running and spraying loses them.
- **Grenades:** frag, flash and smoke charges with bounce physics, fuses,
  line-of-sight blast checks, view-based blinding and sight-blocking smoke.
- **Economy:** $800 start, kill/round/objective rewards, loss-streak bonus,
  $9,000 cap. Buy menu (B) during freeze and the first 12 s of a round.
- **Bots:** nine bots with roles (site rushes, holds, mid), waypoint-graph
  pathfinding, sight cones, hearing, reaction times, aim error that shrinks
  while stationary, burst fire, strafing, objective play (plant, defuse,
  rotate, pick up a dropped charge) and simple buy logic.
- **Map:** Relay K-7 — three lanes, a connector building, a mid window wall,
  containers, crates, sandbags and a silo, all with collision, shadows and a
  dusk sky.
- **HUD:** health/armour bars, money, ammo, grenades, round timer, team
  scores, bomb status, kill feed, dynamic crosshair, hitmarkers, damage
  direction, plant/defuse progress, buy menu, scoreboard, spectating.

## Controls

WASD move · mouse aim/fire · Shift sneak · Ctrl/C crouch · Space jump ·
R reload · 1/2 weapons · right-click zoom (DMR-7) · 4/5/6 select grenade ·
G throw · E plant/defuse · B buy · Tab scoreboard · P pause.

## Code layout

`game/src/` is one module per system, written to be read and reused:

| Module | Job |
| --- | --- |
| `config.js` | Every tuning number: weapons, economy, rounds, bots |
| `state.js` | The one state object + the event queue |
| `rng.js` | Seeded random streams (deterministic replays) |
| `physics.js` | AABB movement, line-of-sight and smoke tests |
| `world.js` | The map: geometry, colliders, waypoints, hold spots |
| `actors.js` | Bodies, hitboxes, damage and armour |
| `weapons.js` | Hitscan firing, spread/recoil, first-person view models |
| `grenades.js` | Throw physics, fuses, frag/flash/smoke effects |
| `particles.js` | Pooled tracers, sparks, blood, smoke, explosions |
| `audio.js` | Synthesised WebAudio effects with distance/pan |
| `bots.js` | Perception, pathfinding, combat, objectives |
| `rounds.js` | Round/match machine, economy, bomb rules |
| `hud.js` | All DOM: HUD, buy menu, scoreboard, banners |
| `input.js` | Pointer lock, keys, edge-triggered actions |
| `main.js` | Boot, fixed-step loop, player, camera, screenshots |

The simulation runs at a fixed 60 Hz, separate from rendering, and all
gameplay randomness flows through seeded streams, so `?seed=N` replays the
same match.

## Screenshots

The four screenshots in `screenshots/` are deterministic renders of this
code, captured headlessly from `?shot=menu|combat|buy|objective&seed=1337`.
Each mode sets the scene up, renders twice, and sets `window.__shotReady`.

## Entry shape

`main.ts` (Node 22, standard library only) copies `game/` and `screenshots/`
to the output directory and writes `dossier.json` with the kit-shipped
`vendor/makefun-threejs.ts`. Run it twice with `MAKEFUN_OUTPUT_DIR` set to
two directories and diff them: the outputs are byte-identical.

## Licence

MIT — see `LICENSE`. three.js is vendored under its own MIT licence in
`game/vendor/three/LICENSE`.
