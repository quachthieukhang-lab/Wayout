# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"Way Out" — a first-person horror game in plain JavaScript (ES modules) + three.js, bundled with Vite. The player collects 5 keys in an abandoned hospital and reaches the exit while a monster patrols, sees, hears and chases them. All in-game text is English.

## Commands

```bash
npm run dev                          # Vite dev server on http://localhost:5173 (vite.config.js: host true, opens browser)
npm run build                        # production build into dist/
npm test                             # vitest run (all tests)
npm run coverage                     # tests + per-module coverage table (@vitest/coverage-v8)
npx vitest run test/monster.test.js  # one file
npx vitest run -t "drags out"        # tests whose name matches
npm run check                        # lint (ESLint) + typecheck (tsc on JSDoc, files stay .js) + Prettier check + tests
npm run format                       # Prettier --write
npm run models                       # re-compress model-originals/*.glb into public/models (meshopt + WebP)
```

- The game must be served by Vite (localhost:5173). Opening `index.html` with VS Code Live Server (:5500) fails with `Failed to resolve module specifier "three"`.
- Git remote: https://github.com/quachthieukhang-lab/Wayout (branch `main`). Run `npm run check` before calling work done; `npm run typecheck` reads the JSDoc types, so keep them accurate (enum-like `state` fields carry an explicit `@type`).
- Headless smoke check for runtime errors: `--dump-dom` with `--virtual-time-budget` does not wait for the models to load (it stays on "Loading… 0%") and logs no console output, so it proves little. Instead start Chrome headless with `--remote-debugging-port=9222` (plus `--use-angle=swiftshader --enable-unsafe-swiftshader`), connect over the DevTools Protocol, enable `Runtime`, navigate, and collect `Runtime.consoleAPICalled` / `Runtime.exceptionThrown`; after ~20 s `#start-hint` should read "Click to start". The only expected warning is `KHR_parallel_shader_compile`. Gameplay needs pointer lock, which headless Chrome cannot take; instead, under npm run dev the page exposes window.wayOut = { game, player, input }, so a DevTools session can start a run with game.setPaused(false), dispatch KeyboardEvent keydown/keyup on window and read player.position (this is how movement was checked in headless Chrome and Edge).

## Architecture

Source is grouped by feature under `src/`; `main.js` (the entry `index.html` loads) stays at the top:

- `core/` — `game.js` (rules), `tutorial.js` (tutorial steps), `input.js`, `settings.js`, `difficulty.js`
- `level/` — `level.js` (map, rooms, grid queries), `tutorial-map.js`, `pathfinding.js`, `scatter.js` (random keys/throwables)
- `world/` — `world.js` (builds the scene), `doors.js`, `radios.js`, `furniture.js`, `lockers.js`, `rooms.js` (room paint + door signs), `textures.js`, `dust.js`
- `player/` — `player.js`, `viewmodel.js`, `flashlight.js`, `hand-model.js`
- `monster/` — `monster.js` (AI), `monster-model.js`
- `items/` — `pickups.js`, `inventory.js` (the bag's slots), `throwables.js` (throwing, cannon-es physics), `key-sense.js`
- `render/` — `graphics.js`, `gltf.js`, `dev-tools.js`; `audio/` — `audio.js`; `ui/` — `hud.js`, `style.css`

`src/main.js` wires everything: renderer → `scatterItems(parseLevel(LEVEL_MAP))` → `createWorld(level, ROOMS)` → `Player`, `ViewModel`, `Flashlight`, `Monster`, pickups, `HorrorAudio`, HUD → `Game`. The `Game` object (`core/game.js`) owns the rules and calls every subsystem's `update` each frame; `main.js` only forwards mouse look, pointer-lock pause and settings.

**The level grid is the single source of truth.** `level/level.js` holds `LEVEL_MAP` (ASCII rows, one char = one 3 m cell; legend at the top of the file). `parseLevel` turns it into lists of cells plus two boolean grids:

- `walls` — blocks movement (`# E S T`). Used by pathfinding (`isWalkable`).
- `opaque` — blocks sight (`# E S`). Beds `T` block movement but not sight, except for a crouched target (`hasLineOfSight(..., isWalkable)`).
- Vents `V` are walkable for the player but excluded from `monsterCells` / `isMonsterWalkable`.
- Lockers `H` must touch a `#` cell (`lockerWall`), or `parseLevel` throws.

Everything else derives from those cells: `world.js` builds wall instances only from `#` tiles, `furniture.js` merges beds/shelves into one mesh per material, `lockers.js` builds hiding spots, `pickups.js` places keys/batteries/throwables. When editing the map, keep rows equal length and keep `test/level.test.js` green (it checks reachability of every floor cell for the player and every monster cell for the monster, lockers and vents).

**Random layout per run.** `LEVEL_MAP` has no `K` tiles (small test maps still may): `scatterItems(level, rng)` returns a copy with `KEY_COUNT` keys on plain floor (`.`/`L`), at least `KEY_SPACING` cells apart and `KEY_MIN_WALK` steps from the spawn, plus `THROWABLE_COUNT` bottles/cans, one within `STARTER_WALK` steps of the spawn. Every pick is reachable (BFS from the spawn); `test/scatter.test.js` checks this over many seeds.

**Rooms.** `ROOMS` in `level.js` names cell rectangles of `LEVEL_MAP` with a colour (`isHall` for the two corridors). `rooms.js` paints a coloured band over the lower wall panel of each room (one `InstancedMesh`, per-instance colour) and hangs a name plate on the hall side of every doorway; lamps take a little of their room's colour. Changing the map means updating `ROOMS`; `level.test.js` checks that the rooms fit, do not overlap, and cover every floor cell except doorways/vents.

**The bag.** Bottles, cans and batteries go into `Inventory` (`items/inventory.js`, `INVENTORY_SLOTS` boxes); keys are only counted. 1-4 or the mouse wheel (`WheelUp`/`WheelDown` in `Input`) select a slot, G / left click use it (`Game.useSelected`: throw a bottle/can, or put a battery in the flashlight; a battery is never used up automatically, and is refused while the light is full), X drops it in front of the feet (`pickups.drop`). With a full bag, E on an item swaps it for the selected one (`Game.swapFor`). The HUD draws the slots as a row of boxes at the bottom center, the vitals bottom left, the keys top right.

**Throwing.** A thrown bottle or can (`PickupType.BOTTLE/CAN`) leaves the bag through `Throwing.throwFrom(item, camera, velocity)`. `throwables.js` simulates them in a cannon-es world that mirrors the static `world.colliders` as boxes (the opened exit door's box is dropped); it steps only while something flies. A bottle smashes on its first hard impact; a can bounces, sleeps and is put back as a pickup. The first impact calls `monster.hearNoise(position, radius)`: it investigates (or, mid-chase, retargets once it has lost sight of the player).

**Two kinds of collision.** The player (`player/player.js`) collides against `world.colliders` (`THREE.Box3[]`: wall cells, floor/ceiling slabs, vent ducts, furniture, lockers, the exit door until opened). The monster ignores colliders: it moves along BFS cell paths (`level/pathfinding.js`) through cell centers, or straight at the player when close with line of sight. `Monster.nearestOpenCell` handles it or the player standing in a non-walkable cell.

**Monster AI** (`monster/monster.js`) is a state machine: PATROL / SEARCH / CHASE / STUNNED. It does not chase on first contact. An `awareness` meter fills while it sees the player (view cone, range longer when the flashlight is on, shorter when crouched) or hears them (`player.noiseRadius`, muffled through walls). It investigates at `SUSPICIOUS`, and at 1 it roars (`REACTION_TIME`) then chases. A hidden player (`target.isHidden`) is undetectable unless the monster was chasing and saw them enter (`sawHiding`). `update()` returns `'spotted' | 'caught' | null`, and `Game` reacts (growl, grab QTE, jumpscare). The tunables are named constants at the top of each module.

**Screens.** `#overlay` is the title screen, shown until the first start: the pitch and the start button on the left, and Story / Controls / Settings tabs on the right (`bindTitleTabs` in `hud.js`; clicks inside `.title-side` never start the game). The HUD stays hidden until the first start. After that, losing pointer lock (Esc) shows `#pause` (Resume / Settings / Restart / Exit to title); `hud.setPaused` picks which one. The pause menu's Settings view borrows the same `#settings` form (it is moved into `#pause-settings` and back). Restart and Exit reload the page for a fresh random run; Restart sets a `sessionStorage` flag (`way-out-restart`) so the next load shows a compact "click to start" title (`#overlay.quick`). Resuming needs a click because browsers only lock the pointer on a user gesture, and Chrome refuses a re-lock for about a second after Esc.

**Story.** The title's Story tab only sets the scene; the rest comes out during play. `STORY_NOTES` (`core/story.js`, one per key, `KEY_COUNT` of them) are pages of Dr. Marrow's journal: picking up the n-th key shows page n as a note card (`hud.showNote`, `Game.revealNote`), and the pause menu's Notes view lists every page found. The tutorial shows none.

**Tutorial.** The title screen's "Play the tutorial" button reloads with `sessionStorage` `way-out-launch` = `'tutorial'` (`'restart'` = a new run with the compact title; absent = full title). `main.js` then builds `TUTORIAL_MAP` / `TUTORIAL_ROOMS` (fixed layout, `O` tiles = hand-placed bottle/can) and passes a `Tutorial` to `Game`. `TUTORIAL_STEPS` (`core/tutorial.js`) each have objective text, an optional tip, a checkpoint cell, `isDone(state, flags)` (state = player cell/room, keys, batteries, hidden, monster state; flags such as `'hid'`, `'stunned'` are noted during the step) and `setup(director, isRetry)`, which stages the monster through a `MonsterDirector` that `Game` implements (`sleep`, `place`, `investigate`, `guard`, `charge`). In the tutorial, being caught never kills: `Game.retryStep` puts the player back at the step's checkpoint and re-runs its setup. Difficulty is forced to Easy. The monster supports the staging with `setDormant`, `place`, `calm`, `setPatrolArea` (a penned-in monster does not drift toward the player) and `alert(position, reactionTime)`. `test/tutorial.test.js` checks the map, the step order and the staging.

**Chase music.** `audio.setChase(isChasing)` (called every frame from `Game.update`, and with `false` in `endRun`) fades a synthesized loop in and out: a dissonant low drone pulsing on a 150 bpm beat, a high shivering cluster, and drums scheduled from `audio.update`.

**Hiding the arms.** `ViewModel.setShown` moves the arm/torch meshes to layer 1 (not rendered) instead of `root.visible = false`: hiding the hand light with them changed the light count and recompiled every shader, a hitch on entering a locker or being grabbed. Never toggle `visible` on anything that contains a light.

**Doors, radios, noisy floors** (map tiles `D`, `R`, `G`/`W`). `world/doors.js`: double doors that start open; `setOpen` flips the cell in `level.opaque` (sight) and adds/removes the door's Box3 in `world.colliders` (the player; `Throwing.syncColliders` mirrors it for physics). Door cells stay walkable in the grid, so paths go through them; when the monster's next path cell is a closed door within reach, `Game.updateMonsterAtDoors` makes it `hold` while it forces the door open (slow swing, loud creak). `world/radios.js`: switched on with E, a radio plays for `PLAY_TIME` and pulses `monster.hearNoise(position, RADIO_NOISE)` every 2 s, then rests. `noisyFloorAt` (level.js): a careless step on glass/boards calls `hearNoise` from the player's position; crouching or walking quietly only makes a soft sound. `Game.findInteraction` picks what E does: pickup, locker, door, radio. `test/interactables.test.js` covers them.

**Game states** (`GameState` in game.js): PLAYING → GRABBED (mash Space to break free) → DYING (jumpscare close-up) → DEAD, or WON at the exit. Hiding in a locker is a sub-mode of PLAYING (`game.hidingSpot`): `player.update` is skipped and only the camera/look runs.

**Assets.** Everything except two models is procedural: canvas textures (`textures.js`), WebAudio synthesized sounds (`audio.js`, no audio files), and procedural geometry. `public/models/monster.glb` and `hand.glb` are compressed copies of `model-originals/` (edit the originals, then `npm run models`); `gltf.js` loads them with the Meshopt decoder and treats an HTML response as missing (Vite serves index.html for unknown paths). Both have fallbacks (`createStalkerModel`, box hands). Their CC BY / CC BY-SA credits are in `index.html` and must stay. GLTFLoader strips `.` from node names, so bone regexes in `hand-model.js` allow an optional dot.

**Rendering and sound.** `graphics.js` renders through pmndrs `postprocessing` (bloom + ACES tone mapping in one `EffectPass`); the renderer itself uses `NoToneMapping`, and `renderer.toneMappingExposure` is the brightness setting. Only emissive light sources (lamp panels, flashlight lens) are bright enough to pass the bloom threshold. `audio.js` routes world sounds (monster, key-sense chime, distant noises) through three's `AudioListener` + `PositionalAudio`, so panning and distance fall-off are automatic; callers pass world positions, not pan values. The start screen stays on "Loading…" until both models load and shaders are precompiled. Under `npm run dev` only, `dev-tools.js` adds a stats.js FPS meter and a lil-gui tuning panel.

**Settings** (`settings.js`) are bound to `#settings` form inputs and selects via `data-setting` attributes, validated with zod (each bad field falls back to its default on its own) and persisted in `localStorage` (`way-out-settings`).

The settings form is a list of sections (Gameplay, Audio, Controls, Display; `.settings-menu` buttons) that each open their own page (`fieldset[data-section]`, back button `.settings-back`), wired by `bindSettingsMenu`; the pause menu resets it to the list.

**Difficulty** (`difficulty.js`: Easy / Normal / Hard) is a setting, and the title screen asks for it before every normal run (`#difficulty-picker`; the pick is written through the settings form select, so storage and game follow). The tutorial skips the picker. Each preset scales Normal's tunables: monster speeds (`speedScale`) and hearing (`hearingScale`), flashlight drain (`drainScale`) and key-sense cooldown (`cooldownScale`). `Game.setDifficulty` applies it at once, even mid-run.

## Deploy

Static site: `npm run build` → `dist/`. `netlify.toml` sets the build command, publish directory and Node version. Deploys go out from this machine with the Netlify CLI (project `wayout-khangqt`): `npm run deploy` runs `check`, builds and uploads `dist/` to production with an exact, pinned `netlify-cli` version (bump it on purpose; an unpinned `npx` would run whatever version is newest with your Netlify login). The one-time `npx netlify-cli login` + `npx netlify-cli link --name wayout-khangqt` store the link in `.netlify/` (git-ignored).

## Tests

Vitest in a Node environment (no DOM/WebGL). Tests cover the pure logic: `level.test.js` (parsing, pathfinding, line of sight, main-map reachability, rooms), `scatter.test.js` (random placement over seeds via `seedrandom`), `player.test.js` (movement, stamina, noise via a fake input `{ keys: Set }`), `monster.test.js` (AI behaviour on small ASCII maps with a seeded RNG, thrown noises, difficulty, plus the flashlight), `throwables.test.js` (cannon-es flights against a floor and a wall), `tutorial.test.js` (tutorial map, steps, monster staging), `interactables.test.js` (doors, radios, noisy floors), `pickups.test.js`, `inventory.test.js`, `input.test.js` (events on a plain `EventTarget`), `key-sense.test.js`, `settings.test.js`, and `game.test.js`: the rules (keys and exit, doors and jams, radios, floors, the bag (battery, drop, swap, slot keys), grab / break free / death, tutorial retry, the frame loop) on a small map with the real player, monster, doors, radios and pickups, and `inert()` Proxy stubs for the HUD, audio and arms. Modules that touch `document` (hud, textures, world, audio) are not unit-tested. Keep them out of the imports of tested modules.
