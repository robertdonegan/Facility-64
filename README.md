# FACILITY 64 — ONLINE (v2)

A GoldenEye-inspired multiplayer browser FPS. Node.js WebSocket server + Three.js client, no build step, one dependency (`ws`).

Players join **rooms** — leave the room code blank for the public lobby, or enter any code to spin up a private arena for your group. First to 10 eliminations wins the round, then the match auto-resets. A kill-streak announcer calls out DOUBLE KILLs and RAMPAGEs, and every shot is validated by **server-side raycasting** so kills can't be faked.

## Quick start

```bash
npm install
npm start
# → http://localhost:8080
```

Open the URL in a desktop browser (needs mouse + keyboard — pointer lock doesn't work on touch devices), pick a codename, and enter the arena. Open a second browser window to see multiplayer working immediately.

## Playing with friends

- **Same network (LAN):** share `http://<your-lan-ip>:8080` (find it with `ipconfig` / `ifconfig`).
- **Over the internet, no deploy:** run a tunnel — e.g. `npx localtunnel --port 8080` or `cloudflared tunnel --url http://localhost:8080` — and share the HTTPS URL it prints. The client auto-upgrades to `wss://` on HTTPS pages.
- **Hosted:** deploy anywhere that runs Node and supports WebSockets (Railway, Fly.io, Render, a VPS). It listens on `process.env.PORT`.

## Controls

WASD move · mouse aim · click fire · **R** reload · **Shift** sprint · **Esc** pause (the match carries on without you)

Mouse aim and firing need pointer lock, which browsers only grant on a click — if you ever see **CLICK TO TAKE CONTROL**, click the game view once and you're locked in. Esc releases the mouse and pauses.

## Configuration

| Env var     | Default | Meaning                        |
|-------------|---------|--------------------------------|
| `PORT`      | 8080    | HTTP + WebSocket port          |
| `WIN_SCORE` | 10      | Eliminations needed to win     |

## Architecture

```
server.js            authoritative match logic, one Room per lobby code (Node + ws),
                     plus the /api/levels REST endpoints
public/level.js      shared level system — validation, perimeter walls, collision +
                     segment-occlusion math, loaded by BOTH server and client
public/index.html    self-contained client (Three.js r128 via CDN)
public/editor.html   the level editor
levels/              custom maps saved by the editor (created on first save)
test.js              integration test: full matches over real sockets
```

- **Level editor (`/editor.html`):** a top-down grid where you drag out walls, click to place crates, spawn points, and rifle/armor/ammo pickups, with erase, import/export JSON, and load-from-server. **SAVE TO SERVER** validates the map and writes it to `levels/` — it's instantly selectable from the MAP dropdown in the game menu. The first player to create a room picks its map; everyone joining that room plays it. Perimeter walls are added automatically, and the same validated data drives both client rendering and server raycasting, so custom walls block bullets exactly like built-in ones.

- **Rooms / lobbies:** every player joins a room code (blank = the public `LOBBY`). Each room is a fully independent match with its own map, pickups, scores, and win/reset cycle. On joining, the client sets a shareable `#CODE` URL hash — send that link to a friend and they land in your room. Empty rooms are torn down automatically.
- **Server-side raycasting (anti-cheat):** clients no longer report hits — they report *shot directions*. The server raycasts each shot itself: fire-rate check, ray-vs-chest-cylinder test against every opponent, then Liang-Barsky segment-vs-AABB occlusion against the level geometry in `public/level.js`. Because that exact module is loaded by both sides, what blocks your view on screen provably blocks bullets on the server. A hacked client can spam packets all day — it cannot manufacture a kill it didn't aim.
- **Kill-streak announcer:** the server tracks per-player streaks (kills without dying) and multi-kills (kills within 4.5 s). Milestones — DOUBLE/TRIPLE KILL, KILLING SPREE, RAMPAGE, UNSTOPPABLE, GODLIKE, and "X ENDED Y'S SPREE" — are broadcast to the room; the client shows a punch-in banner and speaks the line via the browser's speech synthesis for proper late-90s arena energy.
- **Client-predicted movement:** each client simulates its own movement/collision and streams position at 20 Hz; remote players are interpolated between snapshots.

### Protocol (JSON over WebSocket)

Client → server: `join {name, room, level}` · `state {x,z,yaw,mv}` · `shoot {d:[x,y,z]}` · `pickup {idx}` · `ping`

Server → client: `welcome {room, levelName, level}` · `snap {players[]}` (20 Hz) · `respawn` · `shot` · `damage` · `death` · `announce {text,say}` · `pickup` · `joined/left` · `gameOver {board}` · `reset` · `pong`

## Testing

```bash
npm test
```

Spins up the server and runs scripted matches over real sockets across two rooms, verifying: room isolation, server-validated aimed hits (exactly 3 pistol hits to kill), rejection of shots aimed away from the target, wall occlusion of perfectly-aimed shots, fire-rate limiting, DOUBLE KILL and KILLING SPREE announcements, win condition, match reset, level-API validation, and that a saved custom map's walls block server-side shots while clear lines hit. (22 assertions, all passing at ship time.)

## Known limitations / next steps

- No lag compensation (rewind): the server raycasts against players' latest positions, so high-ping players lead their shots slightly. A rewind buffer of recent snapshots would fix this.
- Movement is still client-predicted with only bounds clamping — a modified client could speed-hack. Full server-side movement simulation is the next hardening step.
- The announcer uses whatever system voice the browser provides; recording real voice lines would sound better.
- No jumping. This is authentic.
