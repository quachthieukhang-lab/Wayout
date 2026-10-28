# Way Out

A first-person horror game that runs in the browser, built with three.js.

You wake up in an abandoned hospital. The emergency exit is locked by **5 keys** scattered across its wards, and you
are not alone: something patrols the halls. It sees you, it hears you, and it does not stop once it is sure. Find the
keys, keep out of its sight, and get out.

## Features

- **A monster that hunts, not just chases.** It patrols, grows suspicious, investigates, roars and charges. It sees
  farther when your flashlight is on and hears your footsteps, which are muffled through walls. Once it loses you, it
  searches where it last saw you.
- **Hide and sneak.** Crouch behind beds, slip through vents it cannot follow you into, or hide in lockers. It will
  not find you there unless it saw you climb in.
- **Lure it away.** Pick up bottles and cans and throw them. The noise draws it toward where they land. Bottles are
  loud and smash; cans are quieter but you can pick them up again.
- **Never the same run twice.** The keys and throwables are placed at random each time, and every key is always
  reachable.
- **Easy, Normal or Hard.** Difficulty sets how fast it moves, how far it hears, how fast your battery drains and how
  often you can sense the keys.
- **Flashlight with a flash burst.** It stuns the monster if it is caught in your beam, at the cost of battery.
- **Rooms you can tell apart.** Each ward has its own wall colour and a name plate at every door.
- **Procedural everything.** Textures are drawn on canvas and every sound is synthesized with the Web Audio API. Only
  the monster and the hand are 3D models.
- **A tutorial.** Seven small rooms teach one skill each: sneaking, vents, the flashlight, sensing keys, hiding, luring
  and the flash burst. Getting caught there just sends you back to the start of the step.
- **Positional audio and chase music.** Use headphones: its footsteps tell you which way it is coming from, and the
  music kicks in when it is hunting you.

## Controls

| Key              | Action                                                 |
| ---------------- | ------------------------------------------------------ |
| `W` `A` `S` `D`  | Move                                                   |
| `Shift`          | Sprint (drains stamina, very loud)                     |
| `Z` (hold)       | Walk quietly                                           |
| `C` (hold)       | Crouch: sneak, and crawl through vents                 |
| `Space`          | Jump; mash it to break free when grabbed               |
| `F`              | Flashlight on / off                                    |
| `Q`              | Flash burst: stuns the monster if it is in your beam   |
| `E`              | Pick up / hide in a locker / get out                   |
| `G` / left click | Throw a bottle or can                                  |
| `R`              | Sense the nearest key (then the exit, once it is open) |
| `Esc`            | Pause menu: Resume, Settings, Restart, Exit to title   |

New to the game? Click **New here? Play the tutorial** on the start screen.

## Getting started

Requires [Node.js](https://nodejs.org/) 22.

```bash
npm install
npm run dev      # http://localhost:5173
```

The game must be served by Vite. Opening `index.html` directly, or through a plain static server such as VS Code Live
Server, fails to resolve the `three` import.

### Scripts

| Command           | What it does                                                              |
| ----------------- | ------------------------------------------------------------------------- |
| `npm run dev`     | Dev server with hot reload, an FPS meter and a tuning panel               |
| `npm run build`   | Production build into `dist/` (installable as an offline PWA)             |
| `npm run preview` | Serve the production build                                                |
| `npm test`        | Unit tests (Vitest)                                                       |
| `npm run check`   | Lint (ESLint) + type check (TypeScript on JSDoc) + Prettier check + tests |
| `npm run format`  | Format everything with Prettier                                           |
| `npm run models`  | Re-compress `model-originals/*.glb` into `public/models/`                 |

## Project structure

```
index.html          start screen, HUD, pause menu and end screen markup
src/
  main.js           wires everything together and runs the frame loop
  core/             game rules, tutorial steps, input, settings, difficulty
  level/            the maps (ASCII grids, rooms, the tutorial), pathfinding, random placement
  world/            builds the hospital: walls, furniture, lockers, room paint, textures
  player/           movement and collision, first-person arms, flashlight
  monster/          AI state machine and its model
  items/            keys, batteries, throwables (cannon-es physics), key sense
  render/           post-processing, model loading, dev tools
  audio/            synthesized, positional sound
  ui/               HUD and styles
test/               Vitest unit tests for the pure game logic
public/models/      compressed models served to the browser
model-originals/    source models (edit these, then `npm run models`)
```

The level is an ASCII grid in `src/level/level.js`, where one character is one 3 m cell. Walls, furniture, lockers,
vents and the exit are all built from it.

## Tech

[three.js](https://threejs.org/) · [postprocessing](https://github.com/pmndrs/postprocessing) ·
[cannon-es](https://github.com/pmndrs/cannon-es) · [tween.js](https://github.com/tweenjs/tween.js) ·
[zod](https://zod.dev/) · [Vite](https://vite.dev/) · [Vitest](https://vitest.dev/)

## Deploy

It is a static site. `npm run build` writes `dist/`, and `netlify.toml` already holds the Netlify build settings.

## Credits

- Monster model: "Smily horror monster" by Bento ([sketchfab.com/gostbento](https://sketchfab.com/gostbento)),
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Hand model: "Rigged hand" by Elena FF ([sketchfab.com/elenaferfor](https://sketchfab.com/elenaferfor)),
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)

A game by **Quách Thiếu Khang**.
