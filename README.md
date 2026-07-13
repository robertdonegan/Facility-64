# FACILITY 64 — ONLINE

A GoldenEye-inspired multiplayer browser FPS. Node.js WebSocket server + Three.js client, no build step, one dependency (`ws`).

Players join **rooms** — leave the room code blank for the public lobby, or enter any code to spin up a private arena for your group. First to 10 eliminations wins the round, then the match auto-resets. A kill-streak announcer calls out DOUBLE KILLs and RAMPAGEs, and every shot is validated by **server-side raycasting** so kills can't be faked.

## Quick start

```bash
npm install
npm start
# → http://localhost:8080
```

Open the URL, pick a codename, choose a map and music track, and enter the arena. Open a second browser window to see multiplayer working immediately. Works on desktop (mouse + keyboard), gamepads (PS5 / Xbox), and mobile (landscape, touch controls).

## Playing with friends

- **Same network (LAN):** share `http://<your-lan-ip>:8080` (find it with `ipconfig` / `ifconfig`).
- **Over the internet, no deploy:** run a tunnel — e.g. `npx localtunnel --port 8080` or `cloudflared tunnel --url http://localhost:8080` — and share the HTTPS URL it prints. The client auto-upgrades to `wss://` on HTTPS pages.
- **Hosted:** deploy anywhere that runs Node and supports WebSockets (Render, Railway, Fly.io, a VPS). It listens on `process.env.PORT`.

## Controls

| Input | Bindings |
|---|---|
| **Keyboard + mouse** | WASD move · mouse aim · click fire · right-click scope · **R** reload · **1–5** / scroll switch weapon · **Shift** sprint · **Tab** scoreboard · **M** mute music · **Esc** pause |
| **PS5 / Xbox pad** | Sticks move + look · **RT** fire · **LT** scope · **LB/RB** switch weapon · **X/Square** reload · **L3** sprint · **Select/Share** scoreboard · **Start/Options** pause |
| **Mobile (landscape)** | Left thumb: floating stick to move · right thumb: drag to look · FIRE / RLD / SWAP / SCOPE buttons · GYRO toggles tilt aim (asks device permission) |

Desktop aim needs pointer lock, which browsers only grant on a click — if you see **CLICK TO TAKE CONTROL**, click the game view once. Controllers use the W3C standard mapping, so DualSense and Xbox pads work identically, plugged in or Bluetooth.

## Arsenal

| # | Weapon | Behaviour |
|---|---|---|
| 1 | **Judo Chop** (always carried) | 50 dmg melee, 2.2u reach |
| 2 | **P9 Silenced** (spawn weapon) | 34 dmg semi-auto pistol |
| 3 | **S12 Shotgun** | 6-pellet volley, 12 dmg per pellet, devastating close, useless past 26u |
| 4 | **K74 Rifle** | full-auto, 16 dmg |
| 5 | **D5K Marksman** | 80 dmg bolt rhythm, right-click/LT scope zoom |
| 6 | **GL-40 Launcher** | lobbed grenades — gravity, wall/floor bounces, 2s fuse, 5u blast (hurts you too) |
| 7 | **M7 Proximity Mine** | place at your feet, arms in 0.5s, detonates on enemy proximity with AoE falloff |

Weapons are pickups; you keep everything you've grabbed until you die and switch freely between them. Powerful weapons kick the camera on firing. Bullets spark where they land. Armor absorbs 70% of incoming damage, ammo crates refill whatever you're holding.

## Game modes

Pick a **MODE** when creating a room:

- **DEATHMATCH** (default): free-for-all, first to 10 eliminations. Alone in a deathmatch room? After a 10-second grace the announcer calls **TRAINING SIM ACTIVE** and hostile bots arrive at mid-distance spawns — each kill raises the wave (faster, tougher, more accurate, up to four at once) and they withdraw the moment a second human joins.
- **HORDE — CO-OP VS BOTS**: everyone teams up against zombie-style waves. Wave *n* sends 3+2*n* hostiles — early waves are relentless melee chasers, wave 3+ mixes in gunners — and each wave they get faster, tougher, and hit harder. Friendly fire is off, downed agents respawn while a teammate still stands, and the match ends only when the whole squad is dead at once (**THE HORDE — WAVE N** takes the round, then it resets). The HUD shows the current wave; kills count on the scoreboard.

## Terrain themes

Levels declare one of five themes, which drive textures, lighting, fog, and cosmetic props: **facility** (concrete, hazard stripes, pipe runs, barrels), **jungle** (mossy ruins, vines, perimeter trees, ferns), **office** (drywall, carpet tiles, ceiling panels, potted plants, filing cabinets), **church** (ashlar stone, stained glass, candle stands, chandeliers), **rooftop** (weathered brick, open sky, a lit city skyline ringing the arena, AC units). Props are seeded deterministically from the level name so every client sees the same set.

## Ready-made maps

Five maps ship in the MAP dropdown: **FACILITY** (built-in), plus **JUNGLE TEMPLE**, **HEADQUARTERS**, **CATHEDRAL**, and **SKYLINE** — one per theme, stored as JSON in `levels/`. Pick **RANDOM** and the server generates a fresh procedural layout for that room — random size, random theme, always fully connected. The first player to create a room picks its map (and music); everyone joining plays it.

## The editors

All four are linked from the main menu and need no build step:

- **Level editor (`/editor.html`):** top-down grid — drag walls, click to place crates, spawns, and every pickup type; pick a theme; or hit **GENERATE ARENA** for a procedural layout (randomized spanning tree, so every room is always reachable, with door gaps, cover, spawns, and pickups). **SAVE TO SERVER** validates and writes to `levels/`, instantly selectable in the game menu.
- **Music editor (`/music.html`):** a step sequencer (8/16/32 steps, 60–220 BPM) with lead and bass pitch grids plus kick/snare/hat rows. Preview in-browser, then **SAVE TO SERVER** — the track appears in the MUSIC dropdown and plays as the room's soundtrack via a Web Audio lookahead scheduler.
- **Weapon workshop (`/weapons.html`):** every gun (first-person view *and* the model other players hold) is a stack of primitive parts — box/cylinder/sphere/cone with size, position, rotation, colour, glow/flash flags. Edit them against a live orbitable 3D preview, save, and the game uses your designs. Export/import JSON to share.
- **Texture studio (`/textures.html`):** paint the walls and floors of all five themes, the crate faces, and the rooftop skyline windows as 128px pixel art — brush, flood fill, colour picker, undo, and a tiled preview for checking seams. Export/import PNG.

Weapon designs and texture paint-jobs are **cosmetic and client-side** (stored in your browser); maps and music are **server-side** and shared by everyone in the room.

## Configuration

| Env var     | Default | Meaning                        |
|-------------|---------|--------------------------------|
| `PORT`      | 8080    | HTTP + WebSocket port          |
| `WIN_SCORE` | 10      | Eliminations needed to win     |

## Architecture

```
server.js            authoritative match logic, one Room per lobby code (Node + ws),
                     plus the /api/levels and /api/music REST endpoints
public/level.js      shared level system — validation, themes, perimeter walls,
                     collision + segment-occlusion math (loaded by BOTH sides)
public/music.js      shared track format — validation + Web Audio sequencer
public/weapons.js    shared weapon model format — part validation + mesh builder
public/textures.js   shared surface painters + paint-job override loading
public/index.html    self-contained client (Three.js r128 via CDN)
public/editor.html   level editor          public/music.html     music editor
public/weapons.html  weapon workshop       public/textures.html  texture studio
levels/              maps (4 ship in the repo; the editor saves here too)
music/               custom tracks saved by the music editor
test.js              integration test: full matches over real sockets
```

- **Rooms / lobbies:** every player joins a room code (blank = the public `LOBBY`). Each room is an independent match with its own map, music, pickups, mines, scores, and win/reset cycle. On joining, the client sets a shareable `#CODE` URL hash. Empty rooms are torn down automatically.
- **Server-side raycasting (anti-cheat):** clients report *shot directions*, never hits. The server raycasts each ray itself — fire-rate check, ray-vs-chest-cylinder test, then Liang-Barsky segment-vs-AABB occlusion against the shared level geometry. Shotgun volleys are capped at 6 pellets server-side; mine ownership, arming delay, trigger radius, and blast falloff are all server-authoritative. A hacked client can spam packets all day — it cannot manufacture a kill it didn't aim.
- **Kill-streak announcer:** DOUBLE/TRIPLE KILL, KILLING SPREE, RAMPAGE, UNSTOPPABLE, GODLIKE, and spree-ending callouts, shown as a banner and spoken via browser speech synthesis.
- **Client-predicted movement:** each client simulates its own movement/collision and streams position at 20 Hz; remote players are interpolated between snapshots and render the weapon their owner is actually holding.

### Protocol (JSON over WebSocket)

Client → server: `join {name, room, level, music}` · `state {x,z,yaw,mv}` · `shoot {d:[x,y,z]}` or `shoot {p:[[x,y,z],…]}` (shotgun pellets) · `switch {weapon}` · `placeMine {x,z}` · `pickup {idx}` · `ping`

Server → client: `welcome {room, levelName, level, musicName, music}` · `snap {players[] incl. weapon}` (20 Hz) · `respawn` · `shot` · `damage` · `death` · `mineArm {id,x,z,owner}` · `mineBlast {id,x,z}` · `announce` · `pickup` · `joined/left` · `gameOver` · `reset` · `pong`

## Testing

```bash
npm test
```

Spins up the server and runs scripted matches over real sockets across rooms, verifying room isolation, server-validated hits, wall occlusion, fire-rate limiting, streak announcements, win/reset cycle, the level API, and custom-map raycasting (22 assertions). Note: one test (`welcome carries the custom level`) has a rare timing flake — rerun if it trips.

## GitHub + hosting

GitHub Pages only serves static files, so it can't run the WebSocket server — host the code on GitHub and run the server on a free Node host that deploys from your repo.

- **Render** (free tier, easiest — `render.yaml` blueprint included): dashboard → **New → Blueprint** → select the repo → Apply. Auto-redeploys on push.
- **Railway:** New Project → Deploy from GitHub repo — it detects Node and runs `npm start`.
- **Fly.io / anything Docker-based:** the included `Dockerfile` works as-is (`fly launch`).

Share the resulting URL (plus `#ROOMCODE` for a private room) and you're playing.

**Caveat — editor saves on free hosts:** most free tiers have an *ephemeral* filesystem, so maps/tracks saved via the editors vanish on redeploy. The durable workflow: EXPORT from the editor, commit the JSON into `levels/` or `music/`, and push — exactly how the four shipped maps work. (Free Render instances also sleep when idle; the first visitor waits ~30s.)

## Known limitations / next steps

- No lag compensation (rewind): high-ping players lead their shots slightly.
- Movement is client-predicted with only bounds clamping — full server-side movement simulation is the next hardening step.
- Gyro aim mapping varies by device/orientation; drag-look stays active as the reliable fallback.
- The announcer uses whatever system voice the browser provides.
- No jumping. This is authentic.
