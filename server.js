/* ============================================================
   FACILITY 64 ONLINE — game server (v2)
   - Rooms/lobbies: players join a room code; each room is its own match
   - Server-side raycasting: the server decides every hit using the
     shared level geometry (public/level.js) — clients can't fake kills
   - Kill-streak & multi-kill announcer events
   Run:  npm install && npm start   →  http://localhost:8080
   ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const LEVEL = require('./public/level.js');
const MUSIC = require('./public/music.js');

const PORT = process.env.PORT || 8080;
const WIN_SCORE = parseInt(process.env.WIN_SCORE || '10', 10);
const TICK_MS = 50;               // 20 Hz snapshots
const RESPAWN_MS = 2500;
const RESET_MS = 8000;
const MULTI_KILL_WINDOW_MS = 4500;

const EYE_Y = 1.6, CHEST_Y = 1.3, HIT_RADIUS = 0.75, MAX_RANGE = 60;
const WEAPON_DMG = { chop: 50, pistol: 34, rifle: 16, shotgun: 12, sniper: 80 };
const WEAPON_ROF = { chop: 450, pistol: 300, rifle: 95, shotgun: 780, sniper: 1300, launcher: 850 };   // ms, small tolerance vs client
const SHOTGUN_MAX_PELLETS = 6;
const SHOTGUN_MAX_RANGE = 26;      // pellets fall off hard past mid range
const CHOP_RANGE = 2.2;            // melee reach

const MINE_DMG = 95, MINE_BLAST_R = 4.2, MINE_TRIGGER_R = 1.6;
const MINE_ARM_MS = 500, MINE_PLACE_COOLDOWN_MS = 500, MAX_MINES_PER_ROOM = 24;

const NADE_SPEED = 17, NADE_GRAVITY = 22, NADE_FUSE_MS = 2000;
const NADE_DMG = 90, NADE_BLAST_R = 5, MAX_NADES_PER_ROOM = 12;

/* PvE bots: spawned when a room has exactly one human, scale up each wave */
const BOT_NAMES = ['DRONE', 'HUNTER', 'STALKER', 'REAPER'];
const BOT_COLOR = 0x3a3a3a;
const BOT_DMG = 14, BOT_RESPAWN_GAP_MS = 1500;
const RAID_FLOORS = parseInt(process.env.RAID_FLOORS || '20', 10);
const BOT_GRACE_MS = parseInt(process.env.BOT_GRACE_MS || '10000', 10);   // solo time before hostiles arrive
const LOBBY_BOT_GRACE_MS = parseInt(process.env.LOBBY_BOT_GRACE_MS || '30000', 10);   // lobby waits longer so humans can join

/* ---------- custom levels ---------- */
const LEVELS_DIR = path.join(__dirname, 'levels');
if (!fs.existsSync(LEVELS_DIR)) fs.mkdirSync(LEVELS_DIR, { recursive: true });

const levelFileName = (name) =>
  String(name || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 16);

function listLevels() {
  const files = fs.readdirSync(LEVELS_DIR).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
  return ['FACILITY', 'RANDOM', ...files.sort()];
}
function loadLevelData(name) {
  const clean = levelFileName(name);
  if (!clean || clean === 'FACILITY') return LEVEL.DEFAULT_LEVEL_DATA;
  if (clean === 'RANDOM') {
    // fresh procedural layout per room — random size and theme every time
    const gen = LEVEL.generateArena({ arena: 36 + Math.floor(Math.random() * 21) });
    const v = LEVEL.validateLevel(gen);
    if (v.ok) return v.clean;
    console.warn(`[levels] RANDOM generation failed validation (${v.error}) — using FACILITY`);
    return LEVEL.DEFAULT_LEVEL_DATA;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(LEVELS_DIR, clean + '.json'), 'utf8'));
    const v = LEVEL.validateLevel(raw);
    if (v.ok) return v.clean;
    console.warn(`[levels] ${clean} failed validation (${v.error}) — using FACILITY`);
  } catch (e) { /* fall through to default */ }
  return LEVEL.DEFAULT_LEVEL_DATA;
}

/* ---------- custom music tracks ---------- */
const MUSIC_DIR = path.join(__dirname, 'music');
if (!fs.existsSync(MUSIC_DIR)) fs.mkdirSync(MUSIC_DIR, { recursive: true });

const musicFileName = (name) =>
  String(name || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 16);

function listMusic() {
  const files = fs.readdirSync(MUSIC_DIR).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
  return [MUSIC.DEFAULT_TRACK.name, ...files.sort()];
}
function loadMusicData(name) {
  const clean = musicFileName(name);
  if (!clean || clean === musicFileName(MUSIC.DEFAULT_TRACK.name)) return MUSIC.DEFAULT_TRACK;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(MUSIC_DIR, clean + '.json'), 'utf8'));
    const v = MUSIC.validateTrack(raw);
    if (v.ok) return v.clean;
    console.warn(`[music] ${clean} failed validation (${v.error}) — using default theme`);
  } catch (e) { /* fall through to default */ }
  return MUSIC.DEFAULT_TRACK;
}

/* ---------- static file server + levels API ---------- */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

  if (url === '/api/levels' && req.method === 'GET') {
    return json(200, { levels: listLevels() });
  }
  if (url.startsWith('/api/levels/') && req.method === 'GET') {
    const name = levelFileName(decodeURIComponent(url.slice('/api/levels/'.length)));
    return json(200, { name, data: loadLevelData(name) });
  }
  if (url === '/api/levels' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 200000) { json(413, { error: 'level too large' }); req.destroy(); } });
    req.on('end', () => {
      let data;
      try { data = JSON.parse(body); } catch { return json(400, { error: 'invalid JSON' }); }
      const v = LEVEL.validateLevel(data);
      if (!v.ok) return json(400, { error: v.error });
      const fname = levelFileName(v.clean.name);
      if (!fname || fname === 'FACILITY' || fname === 'RANDOM') return json(400, { error: 'pick a different level name' });
      fs.writeFileSync(path.join(LEVELS_DIR, fname + '.json'), JSON.stringify(v.clean, null, 2));
      console.log(`[levels] saved ${fname} (${v.clean.blocks.length} blocks, ${v.clean.spawns.length} spawns)`);
      return json(200, { ok: true, name: fname });
    });
    return;
  }

  if (url === '/api/rooms' && req.method === 'GET') {
    // menu "match live" indicator: LOBBY details are public, private rooms only as counts
    const lobby = rooms.get('LOBBY');
    let privateRooms = 0, privateAgents = 0;
    for (const [code, r] of rooms) {
      if (code === 'LOBBY') continue;
      privateRooms++; privateAgents += r.humanCount();
    }
    return json(200, {
      lobby: lobby ? {
        agents: lobby.humanCount(), map: lobby.levelName, mode: lobby.mode,
        wave: lobby.mode === 'horde' ? lobby.hordeWave : undefined,
      } : null,
      privateRooms, privateAgents,
    });
  }

  if (url === '/api/music' && req.method === 'GET') {
    return json(200, { tracks: listMusic() });
  }
  if (url.startsWith('/api/music/') && req.method === 'GET') {
    const name = musicFileName(decodeURIComponent(url.slice('/api/music/'.length)));
    return json(200, { name, data: loadMusicData(name) });
  }
  if (url === '/api/music' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 200000) { json(413, { error: 'track too large' }); req.destroy(); } });
    req.on('end', () => {
      let data;
      try { data = JSON.parse(body); } catch { return json(400, { error: 'invalid JSON' }); }
      const v = MUSIC.validateTrack(data);
      if (!v.ok) return json(400, { error: v.error });
      const fname = musicFileName(v.clean.name);
      if (!fname || fname === musicFileName(MUSIC.DEFAULT_TRACK.name)) return json(400, { error: 'pick a different track name' });
      fs.writeFileSync(path.join(MUSIC_DIR, fname + '.json'), JSON.stringify(v.clean, null, 2));
      console.log(`[music] saved ${fname} (${v.clean.bpm} bpm, ${v.clean.steps} steps)`);
      return json(200, { ok: true, name: fname });
    });
    return;
  }

  let file = url === '/' ? '/index.html' : url;
  file = path.normalize(file).replace(/^(\.\.[\/\\])+/, '');
  const full = path.join(__dirname, 'public', file);
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  });
});

/* ---------- rooms ---------- */
const rooms = new Map();   // code -> Room
let nextId = 1;

class Room {
  constructor(code, levelName, musicName, mode) {
    this.code = code;
    this.mode = ['horde', 'maze', 'raid'].includes(mode) ? mode : 'dm';
    this.levelName = levelFileName(levelName) || 'FACILITY';
    this.levelData = loadLevelData(this.levelName);
    if (this.mode === 'maze') {
      const v = LEVEL.validateLevel(LEVEL.generateMaze({ cells: 9 }));
      if (v.ok) { this.levelData = v.clean; this.levelName = 'THE MAZE'; }
    }
    if (this.mode === 'raid') {
      this.raidFloor = 1;
      this.raidUp = Math.random() < 0.5;   // half the towers you climb, half you descend
      this.loadRaidFloor();
    }
    this.level = LEVEL.makeLevel(this.levelData);
    this.musicName = musicFileName(musicName) || musicFileName(MUSIC.DEFAULT_TRACK.name);
    this.musicData = loadMusicData(this.musicName);
    this.players = new Map();
    this.gameOver = false;
    this.resetTimer = null;
    this.pickups = this.level.PICKUPS.map((p, i) => ({ ...p, idx: i, active: true, respawnAt: 0 }));
    this.mines = [];
    this.nextMineId = 1;
    this.nades = [];
    this.nextNadeId = 1;
    this.botWave = 0;
    this.botSeq = 0;
    this.nextBotAt = 0;
    this.botsAnnounced = false;
    this.hordeWave = 0;          // horde mode: current wave (0 = not started)
    this.waveBotsLeft = 0;       // horde mode: bots still to spawn this wave
    this.intermissionUntil = 0;  // horde mode: pause between waves
    this.hordeLegacy = 0;        // horde mode: waves survived in past runs — each run starts harder
    this.secretsOpen = [];       // BLOCKS indices of opened secret walls
  }

  /* -------- Wolfenstein pushwalls -------- */
  handleUse(player, d) {
    if (!player.alive || this.gameOver) return;
    if (!Array.isArray(d) || d.length !== 2 || d.some(v => !isFinite(+v))) return;
    let [fx, fz] = d.map(Number);
    const len = Math.hypot(fx, fz);
    if (len < 1e-6) return;
    fx /= len; fz /= len;
    for (const reach of [0.9, 1.7, 2.5]) {   // probe forward from the player's chest
      const idx = this.level.secretAt(player.x + fx * reach, player.z + fz * reach, 0.3);
      if (idx >= 0) {
        this.level.openSecret(idx);
        this.secretsOpen.push(idx);
        this.broadcast({ t: 'secretOpen', idx });
        return;
      }
    }
  }

  broadcast(obj, exceptId = null) {
    const msg = JSON.stringify(obj);
    for (const p of this.players.values()) {
      if (p.id === exceptId || !p.ws) continue;
      if (p.ws.readyState === 1) p.ws.send(msg);
    }
  }

  humanCount() { return [...this.players.values()].filter(p => !p.bot).length; }
  announce(text, say) { this.broadcast({ t: 'announce', text, say: say || text }); }

  farSpawn() {
    const live = [...this.players.values()].filter(p => p.alive);
    let best = this.level.SPAWNS[0], bestD = -1;
    for (const s of this.level.SPAWNS) {
      let d = Infinity;
      for (const p of live) d = Math.min(d, (p.x - s[0]) ** 2 + (p.z - s[1]) ** 2);
      if (live.length === 0) d = Math.random();
      if (d > bestD) { bestD = d; best = s; }
    }
    return best;
  }

  spawnPlayer(p, spot) {
    const [x, z] = spot || this.farSpawn();
    const y = this.level.topAt(x, z);   // spawn on whatever surface is here (usually the floor)
    p.x = x; p.z = z; p.y = y; p.yaw = Math.atan2(-x, -z);
    p.hp = 100; p.armor = 0; p.alive = true; p.weapon = 'pistol';
    p.owned = { chop: true, pistol: true, rifle: false, shotgun: false, sniper: false, launcher: false, mines: false };
    this.broadcast({ t: 'respawn', id: p.id, x, y, z, yaw: p.yaw });
  }

  /* -------- proximity mines -------- */
  placeMine(player, x, z) {
    if (!player.alive || this.gameOver) return;
    if (!player.owned || !player.owned.mines) return;
    const nowMs = Date.now();
    if (nowMs - (player.lastMine || 0) < MINE_PLACE_COOLDOWN_MS) return;
    x = +x; z = +z;
    if (!isFinite(x) || !isFinite(z)) return;
    if ((x - player.x) ** 2 + (z - player.z) ** 2 > 4) return;
    if (this.mines.length >= MAX_MINES_PER_ROOM) return;
    player.lastMine = nowMs;
    const y = player.y || 0;
    const mine = { id: this.nextMineId++, ownerId: player.id, x, z, y, armedAt: nowMs + MINE_ARM_MS };
    this.mines.push(mine);
    this.broadcast({ t: 'mineArm', id: mine.id, x, z, y, owner: player.id });
  }

  tickMines(nowMs) {
    if (!this.mines.length || this.gameOver) return;
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const mn = this.mines[i];
      if (nowMs < mn.armedAt) continue;
      let triggered = false;
      for (const p of this.players.values()) {
        if (!p.alive || p.id === mn.ownerId) continue;
        if (Math.abs((p.y || 0) - mn.y) > 1.6) continue;   // different storey — safe
        if ((p.x - mn.x) ** 2 + (p.z - mn.z) ** 2 < MINE_TRIGGER_R * MINE_TRIGGER_R) { triggered = true; break; }
      }
      if (!triggered) continue;
      this.mines.splice(i, 1);
      this.broadcast({ t: 'mineBlast', id: mn.id, x: mn.x, z: mn.z, y: mn.y });
      const owner = this.players.get(mn.ownerId);
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        const dist = Math.hypot(p.x - mn.x, (p.y || 0) - mn.y, p.z - mn.z);
        if (dist > MINE_BLAST_R) continue;
        const dmg = MINE_DMG * (1 - dist / MINE_BLAST_R);
        if (dmg > 3) this.applyDamage(p, owner || p, dmg);
      }
    }
  }

  /* -------- authoritative shooting -------- */
  // raycast one sanitized direction against players + level; returns the struck player or null
  raycastRay(shooter, d, maxRange) {
    if (!Array.isArray(d) || d.length !== 3 || d.some(v => !isFinite(+v))) return null;
    let [dx, dy, dz] = d.map(Number);
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return null;
    dx /= len; dy /= len; dz /= len;

    // nearest target whose chest cylinder the ray passes through (full 3D now)
    const ey = (shooter.y || 0) + EYE_Y;
    let hit = null, hitD = Infinity;
    for (const t of this.players.values()) {
      if (t === shooter || !t.alive) continue;
      const tox = t.x - shooter.x, toy = ((t.y || 0) + CHEST_Y) - ey, toz = t.z - shooter.z;
      const proj = tox * dx + toy * dy + toz * dz;
      if (proj < 0.5 || proj > maxRange) continue;
      const cx = dx * proj - tox, cy = dy * proj - toy, cz = dz * proj - toz;
      if (Math.hypot(cx, cy, cz) < HIT_RADIUS && proj < hitD) { hit = t; hitD = proj; }
    }
    if (!hit) return null;
    // occlusion in 3D — platforms only block rays that cross their vertical span
    if (this.level.seg3DBlocked(shooter.x, ey, shooter.z, hit.x, (hit.y || 0) + CHEST_Y, hit.z)) return null;
    return hit;
  }

  handleShoot(shooter, m) {
    if (!shooter.alive || this.gameOver) return;
    const nowMs = Date.now();
    if (nowMs - shooter.lastShot < (WEAPON_ROF[shooter.weapon] || 300)) return;
    shooter.lastShot = nowMs;
    this.broadcast({ t: 'shot', id: shooter.id, w: shooter.weapon }, shooter.id);

    const dmg = WEAPON_DMG[shooter.weapon] || 16;
    if (shooter.weapon === 'shotgun') {
      // pellet volley: each pellet raycast independently, damage stacks per pellet
      if (!Array.isArray(m.p)) return;
      for (const d of m.p.slice(0, SHOTGUN_MAX_PELLETS)) {
        const hit = this.raycastRay(shooter, d, SHOTGUN_MAX_RANGE);
        if (hit) this.applyDamage(hit, shooter, dmg);
      }
    } else if (shooter.weapon === 'chop') {
      const hit = this.raycastRay(shooter, m.d, CHOP_RANGE);
      if (hit) this.applyDamage(hit, shooter, dmg);
    } else {
      const hit = this.raycastRay(shooter, m.d, MAX_RANGE);
      if (hit) this.applyDamage(hit, shooter, dmg);
    }
  }

  /* -------- grenades (server-simulated projectiles) -------- */
  handleLaunch(shooter, d) {
    if (!shooter.alive || this.gameOver) return;
    if (shooter.weapon !== 'launcher' || !shooter.owned || !shooter.owned.launcher) return;
    const nowMs = Date.now();
    if (nowMs - shooter.lastShot < (WEAPON_ROF.launcher || 850)) return;
    if (this.nades.length >= MAX_NADES_PER_ROOM) return;
    if (!Array.isArray(d) || d.length !== 3 || d.some(v => !isFinite(+v))) return;
    let [dx, dy, dz] = d.map(Number);
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return;
    dx /= len; dy /= len; dz /= len;
    shooter.lastShot = nowMs;
    this.broadcast({ t: 'shot', id: shooter.id, w: 'launcher' }, shooter.id);
    this.nades.push({
      id: this.nextNadeId++, ownerId: shooter.id,
      x: shooter.x + dx * 0.6, y: (shooter.y || 0) + EYE_Y - 0.2, z: shooter.z + dz * 0.6,
      vx: dx * NADE_SPEED, vy: dy * NADE_SPEED + 2.5, vz: dz * NADE_SPEED,
      explodeAt: nowMs + NADE_FUSE_MS,
    });
  }

  tickNades(nowMs, dt) {
    for (let i = this.nades.length - 1; i >= 0; i--) {
      const n = this.nades[i];
      n.vy -= NADE_GRAVITY * dt;
      // axis-separated moves so wall hits reflect the right component (at flight height)
      const nx = n.x + n.vx * dt;
      if (this.level.collides3D(nx, n.z, 0.25, n.y)) n.vx *= -0.45; else n.x = nx;
      const nz = n.z + n.vz * dt;
      if (this.level.collides3D(n.x, nz, 0.25, n.y)) n.vz *= -0.45; else n.z = nz;
      n.y += n.vy * dt;
      const floor = this.level.groundAt(n.x, n.z, n.y) + 0.15;   // bounce off whatever surface is under it
      if (n.y < floor && n.vy < 0) { n.y = floor; n.vy *= -0.45; n.vx *= 0.75; n.vz *= 0.75; }
      if (nowMs < n.explodeAt) continue;
      this.nades.splice(i, 1);
      this.broadcast({ t: 'nadeBlast', id: n.id, x: +n.x.toFixed(2), y: +n.y.toFixed(2), z: +n.z.toFixed(2) });
      const owner = this.players.get(n.ownerId);
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        const dist = Math.hypot(p.x - n.x, (p.y || 0) - n.y, p.z - n.z);
        if (dist > NADE_BLAST_R) continue;
        const dmg = NADE_DMG * (1 - dist / NADE_BLAST_R);
        if (dmg > 3) this.applyDamage(p, owner || p, dmg);
      }
    }
  }

  applyDamage(target, attacker, dmg) {
    if (!target.alive || this.gameOver) return;
    // horde and maze are co-op: humans cannot hurt each other (self-damage still applies)
    if (this.mode !== 'dm' && !attacker.bot && !target.bot && attacker.id !== target.id) return;
    const absorbed = Math.min(target.armor, dmg * 0.7);
    target.armor = Math.round((target.armor - absorbed) * 10) / 10;
    target.hp -= (dmg - absorbed);
    this.broadcast({ t: 'damage', id: target.id, hp: Math.max(0, Math.round(target.hp)), armor: target.armor, from: attacker.id, dmg });
    if (target.hp <= 0) {
      target.hp = 0; target.alive = false;
      if (attacker.id !== target.id) attacker.score++;
      this.broadcast({ t: 'death', victim: target.id, killer: attacker.id });
      this.handleStreaks(attacker, target);
      this.checkWin(attacker);
      if (target.bot) {
        if (this.mode !== 'dm') {
          this.players.delete(target.id);   // horde waves and maze guards stay down
        } else {
          this.botWave++;
          if (this.botWave % 3 === 0) this.announce(`HOSTILE REINFORCEMENTS — MARK ${1 + this.botWave / 3}`, 'Reinforcements inbound');
        }
      }
      if (this.mode === 'horde' && !target.bot) {
        // squad wiped?
        if (![...this.players.values()].some(p => !p.bot && p.alive)) { this.hordeOver(); return; }
      }
      if (!this.gameOver && !(this.mode !== 'dm' && target.bot)) {
        setTimeout(() => {
          if (this.players.has(target.id) && !this.gameOver) {
            this.spawnPlayer(target);
            if (target.bot) this.scaleBot(target);   // respawn stronger each wave
          }
        }, RESPAWN_MS);
      }
    }
  }

  /* -------- PvE bots -------- */
  scaleBot(bot) {
    const wave = this.botWave;
    bot.botSpeed = Math.min(6.5, 3 + wave * 0.25);
    bot.botAimErr = Math.max(0.05, 0.3 - wave * 0.02);
    bot.botRof = Math.max(500, 1400 - wave * 70);
    bot.hp = Math.min(180, 70 + wave * 12);
  }

  spawnBot() {
    const wave = this.botWave;
    const bot = {
      id: nextId++, ws: null, bot: true,
      name: BOT_NAMES[Math.min(BOT_NAMES.length - 1, Math.floor(wave / 3))] + '-' + (++this.botSeq),
      color: BOT_COLOR,
      x: 0, z: 0, yaw: 0, hp: 100, armor: 0, score: 0, streak: 0, multi: 0, lastKillAt: 0,
      alive: false, weapon: 'pistol', lastShot: 0, lastMine: 0,
      owned: { chop: true, pistol: true, rifle: false, shotgun: false, sniper: false, launcher: false, mines: false },
      strafeT: Math.random() * 10,
    };
    this.players.set(bot.id, bot);
    this.broadcast({ t: 'joined', id: bot.id, name: bot.name });
    this.spawnPlayer(bot, this.botSpawnSpot());
    this.scaleBot(bot);
  }

  // bots arrive at mid distance — not on top of the player, not across the map
  botSpawnSpot() {
    const humans = [...this.players.values()].filter(p => !p.bot && p.alive);
    const scored = this.level.SPAWNS.map(s => {
      let d = Infinity;
      for (const h of humans) d = Math.min(d, Math.hypot(h.x - s[0], h.z - s[1]));
      return { s, d };
    }).filter(e => e.d > 10);
    if (!scored.length) return this.farSpawn();
    scored.sort((a, b) => a.d - b.d);
    const near = scored.slice(0, Math.max(1, Math.ceil(scored.length / 2)));
    return near[Math.floor(Math.random() * near.length)].s;
  }

  removeBots(announce) {
    const bots = [...this.players.values()].filter(p => p.bot);
    if (!bots.length) return;
    for (const b of bots) {
      this.players.delete(b.id);
      this.broadcast({ t: 'left', id: b.id, name: b.name });
    }
    this.botWave = 0;
    this.botsAnnounced = false;
    if (announce) this.announce('HOSTILES WITHDRAW — AGENTS ON SITE', 'Hostiles withdraw');
  }

  manageBots(nowMs) {
    if (this.mode === 'horde') return this.manageHorde(nowMs);
    if (this.mode === 'maze') return this.manageMaze();
    if (this.mode === 'raid') return this.manageRaid();
    const humans = this.humanCount();
    if (humans !== 1 || this.gameOver) {
      this.soloSince = 0;
      if (humans >= 2) this.removeBots(true);
      return;
    }
    if (!this.soloSince) this.soloSince = nowMs;
    if (nowMs - this.soloSince < (this.code === 'LOBBY' ? LOBBY_BOT_GRACE_MS : BOT_GRACE_MS)) return;
    const targetCount = Math.min(4, 2 + Math.floor(this.botWave / 3));
    const bots = [...this.players.values()].filter(p => p.bot);
    if (bots.length < targetCount && nowMs >= this.nextBotAt) {
      this.nextBotAt = nowMs + BOT_RESPAWN_GAP_MS;
      if (!this.botsAnnounced) {
        this.botsAnnounced = true;
        this.announce('TRAINING SIM ACTIVE — HOSTILES INBOUND', 'Hostiles inbound');
      }
      this.spawnBot();
    }
  }

  /* -------- horde mode: co-op waves for any number of humans -------- */
  startWave(n, nowMs) {
    this.hordeWave = n;
    this.waveBotsLeft = Math.min(14, 3 + n * 2);
    this.intermissionUntil = 0;
    this.nextBotAt = nowMs;
    this.announce(`WAVE ${n} — ${this.waveBotsLeft} HOSTILES`, `Wave ${n}`);
  }

  spawnHordeBot() {
    // effective difficulty climbs with waves survived in previous runs too
    const w = this.hordeWave + Math.floor(this.hordeLegacy / 3);
    const melee = this.hordeWave < 3 || Math.random() < 0.7;   // early waves are pure chasers
    const bot = {
      id: nextId++, ws: null, bot: true,
      name: (melee ? 'ZOMBIE' : 'GUNNER') + '-' + (++this.botSeq),
      color: BOT_COLOR,
      x: 0, z: 0, yaw: 0, hp: 100, armor: 0, score: 0, streak: 0, multi: 0, lastKillAt: 0,
      alive: false, weapon: 'pistol', lastShot: 0, lastMine: 0,
      owned: { chop: true, pistol: true, rifle: false, shotgun: false, sniper: false, launcher: false, mines: false },
      strafeT: Math.random() * 10,
      botMelee: melee,
      botSpeed: Math.min(7, (melee ? 3.6 : 3.0) + w * 0.2),
      botAimErr: Math.max(0.06, 0.28 - w * 0.015),
      botRof: melee ? 900 : Math.max(600, 1300 - w * 50),
      botDmg: melee ? Math.min(35, 16 + w * 2) : BOT_DMG,
    };
    this.players.set(bot.id, bot);
    this.broadcast({ t: 'joined', id: bot.id, name: bot.name });
    this.spawnPlayer(bot, this.botSpawnSpot());
    bot.weapon = melee ? 'chop' : 'pistol';
    bot.hp = Math.min(200, 60 + w * 10);
  }

  manageHorde(nowMs) {
    if (this.gameOver || this.humanCount() === 0) return;
    const liveBots = [...this.players.values()].filter(p => p.bot).length;
    if (this.hordeWave === 0) {
      if (!this.intermissionUntil) {
        this.intermissionUntil = nowMs + BOT_GRACE_MS;
        this.announce('HORDE SIM ACTIVE — DEFEND TOGETHER', 'Horde sim active');
      }
      if (nowMs < this.intermissionUntil) return;
      return this.startWave(1, nowMs);
    }
    if (this.waveBotsLeft > 0) {
      const cap = Math.min(8, 3 + this.hordeWave);
      if (liveBots < cap && nowMs >= this.nextBotAt) {
        this.nextBotAt = nowMs + 500;
        this.spawnHordeBot();
        this.waveBotsLeft--;
      }
    } else if (liveBots === 0) {
      if (!this.intermissionUntil) {
        this.intermissionUntil = nowMs + 6000;
        this.announce(`WAVE ${this.hordeWave} CLEARED`, 'Wave cleared');
      } else if (nowMs >= this.intermissionUntil) {
        this.startWave(this.hordeWave + 1, nowMs);
      }
    }
  }

  /* -------- guard bots: shared by maze (fixed tier) and raid (tier = floor) -------- */
  spawnMazeGuard(spot, tier = 2) {
    const melee = Math.random() < 0.6;
    const bot = {
      id: nextId++, ws: null, bot: true,
      name: (melee ? 'LURKER' : 'WARDEN') + '-' + (++this.botSeq),
      color: BOT_COLOR,
      x: 0, z: 0, yaw: 0, hp: 100, armor: 0, score: 0, streak: 0, multi: 0, lastKillAt: 0,
      alive: false, weapon: 'pistol', lastShot: 0, lastMine: 0,
      owned: { chop: true, pistol: true, rifle: false, shotgun: false, sniper: false, launcher: false, mines: false },
      strafeT: Math.random() * 10,
      botMelee: melee,
      botGuard: true, botAggro: 11, enraged: false,
      botSpeed: Math.min(6.5, (melee ? 4.0 : 3.1) + tier * 0.18),
      botAimErr: Math.max(0.06, 0.24 - tier * 0.012),
      botRof: Math.max(550, (melee ? 900 : 1150) - tier * 30),
      botDmg: melee ? Math.min(32, 16 + tier * 2) : BOT_DMG,
    };
    this.players.set(bot.id, bot);
    this.broadcast({ t: 'joined', id: bot.id, name: bot.name });
    this.spawnPlayer(bot, spot);
    bot.weapon = melee ? 'chop' : 'pistol';
    bot.hp = Math.min(190, 70 + tier * 10);
  }

  mazeFreeSpot(minSpawnDist) {
    const A = this.level.ARENA;
    for (let i = 0; i < 60; i++) {
      const x = Math.round((Math.random() * 2 - 1) * (A - 2));
      const z = Math.round((Math.random() * 2 - 1) * (A - 2));
      if (this.level.collides(x, z, 0.7)) continue;
      if (this.level.SPAWNS.some(s => Math.hypot(s[0] - x, s[1] - z) < minSpawnDist)) continue;
      return [x, z];
    }
    return null;
  }

  manageMaze() {
    if (this.gameOver || this.mazePopulated || this.humanCount() === 0) return;
    this.mazePopulated = true;
    const trophy = this.level.PICKUPS.find(p => p.kind === 'trophy');
    // two guards watch the trophy chamber approaches, the rest lurk in corridors
    let placed = 0;
    for (let i = 0; i < 30 && placed < 2; i++) {
      const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 4;
      const x = Math.round(trophy.x + Math.cos(a) * r), z = Math.round(trophy.z + Math.sin(a) * r);
      if (!this.level.collides(x, z, 0.7)) { this.spawnMazeGuard([x, z]); placed++; }
    }
    const lurkers = 5 + Math.round(this.level.ARENA / 9);
    for (let i = 0; i < lurkers; i++) {
      const spot = this.mazeFreeSpot(9);
      if (spot) this.spawnMazeGuard(spot);
    }
    this.announce('THE MAZE IS WATCHING — CLAIM THE TROPHY', 'The maze is watching');
  }

  /* -------- raid mode: 20 storeys, stairwell to stairwell -------- */
  loadRaidFloor() {
    const v = LEVEL.validateLevel(LEVEL.generateFloor({ floor: this.raidFloor }));
    if (v.ok) this.levelData = v.clean;
    this.levelName = (this.raidUp ? 'TOWER FL ' : 'SUBLEVEL ') + this.raidFloor;
    this.mazePopulated = false;
  }

  manageRaid() {
    if (this.gameOver || this.mazePopulated || this.humanCount() === 0) return;
    this.mazePopulated = true;
    const f = this.raidFloor;
    const stairs = this.level.PICKUPS.find(p => p.kind === 'stairs');
    let placed = 0;   // a couple of guards watch the stairwell
    for (let i = 0; i < 30 && placed < Math.min(2, 1 + (f >> 3)); i++) {
      const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 4;
      const x = Math.round(stairs.x + Math.cos(a) * r), z = Math.round(stairs.z + Math.sin(a) * r);
      if (!this.level.collides(x, z, 0.7)) { this.spawnMazeGuard([x, z], f); placed++; }
    }
    const lurkers = Math.min(9, 3 + Math.ceil(f / 2));
    for (let i = 0; i < lurkers; i++) {
      const spot = this.mazeFreeSpot(8);
      if (spot) this.spawnMazeGuard(spot, f);
    }
    if (f === 1) this.announce(this.raidUp ? 'RAID START — REACH THE ROOF, 20 FLOORS UP' : 'RAID START — REACH THE VAULT, 20 LEVELS DOWN', 'Raid start');
  }

  advanceFloor(player) {
    if (this.gameOver) return;
    if (this.raidFloor >= RAID_FLOORS) return this.raidWin(player);
    this.raidFloor++;
    this.loadRaidFloor();
    this.level = LEVEL.makeLevel(this.levelData);
    this.secretsOpen = [];
    this.pickups = this.level.PICKUPS.map((p, i) => ({ ...p, idx: i, active: true, respawnAt: 0 }));
    this.mines = []; this.nades = [];
    this.removeBots(false);
    for (const p of this.players.values()) if (!p.bot) this.spawnPlayer(p);
    this.broadcast({ t: 'reset', pickups: this.pickups.map(p => p.active), level: this.levelData, levelName: this.levelName });
    this.announce(`${player.name} FOUND THE STAIRS — ${this.raidUp ? 'FLOOR' : 'SUBLEVEL'} ${this.raidFloor} OF ${RAID_FLOORS}`, `Floor ${this.raidFloor}`);
  }

  raidWin(player) {
    if (this.gameOver) return;
    this.gameOver = true;
    const board = [...this.players.values()].filter(p => !p.bot)
      .sort((a, b) => b.score - a.score)
      .map(p => ({ name: p.name, score: p.score }));
    const where = this.raidUp ? 'THE ROOF' : 'THE VAULT';
    this.announce(`${player.name} REACHED ${where}`, `${player.name} reached ${where.toLowerCase()}`);
    this.broadcast({ t: 'gameOver', winner: player.id, winnerName: player.name, board, resetIn: RESET_MS });
    this.resetTimer = setTimeout(() => this.resetMatch(), RESET_MS);
  }

  trophyWin(player) {
    if (this.gameOver) return;
    this.gameOver = true;
    const board = [...this.players.values()].filter(p => !p.bot)
      .sort((a, b) => b.score - a.score)
      .map(p => ({ name: p.name, score: p.score }));
    this.announce(`${player.name} CLAIMED THE TROPHY`, `${player.name} claimed the trophy`);
    this.broadcast({ t: 'gameOver', winner: player.id, winnerName: player.name, board, resetIn: RESET_MS });
    this.resetTimer = setTimeout(() => this.resetMatch(), RESET_MS);
  }

  hordeOver() {
    this.gameOver = true;
    this.hordeLegacy += this.hordeWave;   // next run in this room starts meaner
    const board = [...this.players.values()].filter(p => !p.bot)
      .sort((a, b) => b.score - a.score)
      .map(p => ({ name: p.name, score: p.score }));
    this.broadcast({ t: 'gameOver', winner: -1, winnerName: `THE HORDE — WAVE ${this.hordeWave}`, board, resetIn: RESET_MS });
    this.resetTimer = setTimeout(() => this.resetMatch(), RESET_MS);
  }

  tickBots(nowMs, dt) {
    if (this.gameOver) return;
    const humans = [...this.players.values()].filter(p => !p.bot && p.alive);
    if (!humans.length) return;
    for (const b of this.players.values()) {
      if (!b.bot || !b.alive) continue;
      let target = null, best = Infinity;
      for (const h of humans) {
        const d2 = (h.x - b.x) ** 2 + (h.z - b.z) ** 2;
        if (d2 < best) { best = d2; target = h; }
      }
      const dx = target.x - b.x, dz = target.z - b.z;
      const dist = Math.hypot(dx, dz) || 1e-6;
      const nx = dx / dist, nz = dz / dist;

      // maze guards hold their post until someone comes close — then never calm down
      if (b.botGuard && !b.enraged) {
        if (dist > b.botAggro || this.level.segBlocked(b.x, b.z, target.x, target.z)) { b.moving = false; continue; }
        b.enraged = true;
      }

      b.strafeT += dt;
      const strafe = Math.sin(b.strafeT * 1.7 + b.id);
      let mx = 0, mz = 0;
      if (b.botMelee) {
        // relentless chaser: close the gap, weave a little
        mx = nx; mz = nz;
        mx += -nz * strafe * 0.35; mz += nx * strafe * 0.35;
      } else {
        // gunner: chase to mid range, back off when crowded, strafe constantly
        if (dist > 13) { mx = nx; mz = nz; }
        else if (dist < 7) { mx = -nx; mz = -nz; }
        mx += -nz * strafe * 0.8; mz += nx * strafe * 0.8;
      }
      const ml = Math.hypot(mx, mz);
      const fy = b.y || 0;
      if (ml > 1e-6) {
        const step = b.botSpeed * dt;
        const sx = b.x + (mx / ml) * step;
        if (!this.level.collides3D(sx, b.z, 0.55, fy)) b.x = sx;
        const sz = b.z + (mz / ml) * step;
        if (!this.level.collides3D(b.x, sz, 0.55, fy)) b.z = sz;
        b.moving = true;
      } else b.moving = false;
      // walk up ramps / low steps, drop off ledges (no jumping)
      b.y = this.level.groundAt(b.x, b.z, fy);
      b.yaw = Math.atan2(dx, dz);

      const dyTgt = (target.y || 0) - (b.y || 0);   // height gap to the target
      if (b.botMelee) {
        if (dist < 2 && Math.abs(dyTgt) < 1.6 && nowMs - b.lastShot >= b.botRof) {
          b.lastShot = nowMs;
          this.applyDamage(target, b, b.botDmg);
        }
      } else if (nowMs - b.lastShot >= b.botRof && dist < 42 && !this.level.seg3DBlocked(b.x, (b.y||0)+EYE_Y, b.z, target.x, (target.y||0)+CHEST_Y, target.z)) {
        b.lastShot = nowMs;
        this.broadcast({ t: 'shot', id: b.id, w: 'pistol' });
        const err = b.botAimErr;
        // aim toward the real height difference (rise/run), not a flat lane
        const aimY = (dyTgt + (CHEST_Y - EYE_Y)) / dist;
        const d = [nx + (Math.random() - .5) * err, aimY + (Math.random() - .5) * err, nz + (Math.random() - .5) * err];
        const hit = this.raycastRay(b, d, MAX_RANGE);
        if (hit && !hit.bot) this.applyDamage(hit, b, b.botDmg || BOT_DMG);
      }
    }
  }

  /* -------- announcer -------- */
  handleStreaks(attacker, victim) {
    const nowMs = Date.now();
    // victim's spree ends
    if ((victim.streak || 0) >= 3) {
      this.announce(`${attacker.name} ENDED ${victim.name}'S SPREE`, `${attacker.name} ended the spree`);
    }
    victim.streak = 0; victim.multi = 0; victim.lastKillAt = 0;

    // attacker multi-kill (kills in quick succession)
    attacker.multi = (nowMs - (attacker.lastKillAt || 0) < MULTI_KILL_WINDOW_MS) ? (attacker.multi || 1) + 1 : 1;
    attacker.lastKillAt = nowMs;
    attacker.streak = (attacker.streak || 0) + 1;

    // multi-kills and streak milestones announce independently —
    // a kill can be both a DOUBLE KILL and the start of a spree
    if (attacker.multi === 2) this.announce(`${attacker.name} — DOUBLE KILL`, 'Double kill');
    else if (attacker.multi === 3) this.announce(`${attacker.name} — TRIPLE KILL`, 'Triple kill');
    else if (attacker.multi >= 4) this.announce(`${attacker.name} — KILL FRENZY`, 'Kill frenzy');

    if (attacker.streak === 3) this.announce(`${attacker.name} IS ON A KILLING SPREE`, 'Killing spree');
    else if (attacker.streak === 5) this.announce(`${attacker.name} IS ON A RAMPAGE`, 'Rampage');
    else if (attacker.streak === 7) this.announce(`${attacker.name} IS UNSTOPPABLE`, 'Unstoppable');
    else if (attacker.streak >= 10 && attacker.streak % 5 === 0) this.announce(`${attacker.name} IS GODLIKE`, 'Godlike');
  }

  checkWin(candidate) {
    if (this.mode !== 'dm') return;   // horde ends on squad wipe, maze on the trophy — not on score
    if (this.gameOver || candidate.score < WIN_SCORE) return;
    this.gameOver = true;
    const board = [...this.players.values()]
      .sort((a, b) => b.score - a.score)
      .map(p => ({ name: p.name, score: p.score }));
    this.broadcast({ t: 'gameOver', winner: candidate.id, winnerName: candidate.name, board, resetIn: RESET_MS });
    this.resetTimer = setTimeout(() => this.resetMatch(), RESET_MS);
  }

  resetMatch() {
    this.gameOver = false;
    if (this.mode === 'maze') {
      // a fresh labyrinth every round
      const v = LEVEL.validateLevel(LEVEL.generateMaze({ cells: 9 }));
      if (v.ok) this.levelData = v.clean;
      this.mazePopulated = false;
    }
    if (this.mode === 'raid') {
      this.raidFloor = 1;
      this.raidUp = Math.random() < 0.5;
      this.loadRaidFloor();
    }
    this.level = LEVEL.makeLevel(this.levelData);   // recloses secret walls
    this.secretsOpen = [];
    this.pickups = this.level.PICKUPS.map((p, i) => ({ ...p, idx: i, active: true, respawnAt: 0 }));
    this.mines = [];
    this.nades = [];
    this.removeBots(false);   // fresh waves next round
    this.hordeWave = 0; this.waveBotsLeft = 0; this.intermissionUntil = 0;
    for (const p of this.players.values()) {
      p.score = 0; p.streak = 0; p.multi = 0;
      this.spawnPlayer(p);
    }
    this.broadcast({
      t: 'reset', pickups: this.pickups.map(p => p.active),
      ...(this.mode === 'maze' || this.mode === 'raid' ? { level: this.levelData, levelName: this.levelName } : {}),
    });
  }

  tick(nowMs) {
    for (const p of this.pickups) {
      if (!p.active && nowMs >= p.respawnAt) {
        p.active = true;
        this.broadcast({ t: 'pickup', idx: p.idx, active: true });
      }
    }
    this.tickMines(nowMs);
    this.tickNades(nowMs, TICK_MS / 1000);
    this.manageBots(nowMs);
    this.tickBots(nowMs, TICK_MS / 1000);
    if (this.players.size === 0) return;
    this.broadcast({
      t: 'snap',
      ...(this.mode === 'horde' ? { wave: this.hordeWave } : {}),
      ...(this.mode === 'raid' ? { floor: this.raidFloor } : {}),
      nades: this.nades.map(n => ({ id: n.id, x: +n.x.toFixed(2), y: +n.y.toFixed(2), z: +n.z.toFixed(2) })),
      players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, color: p.color,
        x: +p.x.toFixed(2), z: +p.z.toFixed(2), yaw: +p.yaw.toFixed(3),
        ...(p.y ? { y: +p.y.toFixed(2) } : {}),
        hp: Math.round(p.hp), armor: Math.round(p.armor),
        score: p.score, streak: p.streak || 0, alive: p.alive, mv: p.moving ? 1 : 0,
        weapon: p.weapon,
        ...(p.avatar && p.avatar !== 'agent' ? { av: p.avatar } : {}),
        ...(p.bot ? { cls: p.botMelee ? 'zombie' : 'bot' } : {}),
      })),
    });
  }
}

function getRoom(code, levelName, musicName, mode) {
  let r = rooms.get(code);
  if (!r) {
    r = new Room(code, levelName, musicName, mode);
    rooms.set(code, r);
    console.log(`[room ${code}] opened — map ${r.levelName}, music ${r.musicName}, mode ${r.mode}`);
  }
  return r;
}

/* ---------- websocket handling ---------- */
const COLORS = [0x7a1f1f, 0xcfcfcf, 0x27406e, 0x9fd05a, 0xc9c27f, 0x8a4fd0, 0xd07a2f, 0x2fd0c4];
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let me = null;
  let room = null;

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.t === 'join' && !me) {
      const name = String(m.name || 'AGENT').toUpperCase().replace(/[^A-Z0-9 _-]/g, '').slice(0, 12) || 'AGENT';
      const avatar = ['agent', 'commando', 'scientist', 'spy'].includes(m.avatar) ? m.avatar : 'agent';
      const code = String(m.room || 'LOBBY').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'LOBBY';
      room = getRoom(code, m.level, m.music, m.mode);
      me = {
        id: nextId++, ws, name, avatar,
        color: COLORS[(nextId - 2) % COLORS.length],
        x: 0, z: 0, yaw: 0, hp: 100, armor: 0, score: 0, streak: 0, multi: 0, lastKillAt: 0,
        alive: false, weapon: 'pistol', lastShot: 0, lastMine: 0,
        owned: { chop: true, pistol: true, rifle: false, shotgun: false, sniper: false, launcher: false, mines: false },
      };
      room.players.set(me.id, me);
      ws.send(JSON.stringify({
        t: 'welcome', id: me.id, color: me.color, winScore: WIN_SCORE, room: code,
        mode: room.mode,
        levelName: room.levelName, level: room.levelData,
        musicName: room.musicName, music: room.musicData,
        secrets: room.secretsOpen,
        pickups: room.pickups.map(p => p.active),
      }));
      room.broadcast({ t: 'joined', id: me.id, name: me.name }, me.id);
      room.spawnPlayer(me);
      console.log(`[room ${code}] + ${me.name} (#${me.id}) — ${room.players.size} in arena`);
      return;
    }
    if (!me || !room) return;

    switch (m.t) {
      case 'state': {
        if (!me.alive) break;
        const x = +m.x, z = +m.z, yaw = +m.yaw;
        if (!isFinite(x) || !isFinite(z) || !isFinite(yaw)) break;
        const A = room.level.ARENA;
        me.x = Math.max(-A, Math.min(A, x));
        me.z = Math.max(-A, Math.min(A, z));
        // clamp height to this column's surface plus a jump's worth of air, so a
        // client can't float over open ground or reach nests it hasn't climbed to
        if (isFinite(+m.y)) {
          const surf = room.level.topAt(me.x, me.z);
          me.y = Math.max(0, Math.min(surf + 2.4, +m.y));
        }
        me.yaw = yaw;
        me.moving = !!m.mv;
        break;
      }
      case 'shoot':
        room.handleShoot(me, m);
        break;
      case 'switch': {
        const w = String(m.weapon || '');
        if (!me.owned || !me.owned[w]) break;
        me.weapon = w;
        break;
      }
      case 'placeMine':
        room.placeMine(me, m.x, m.z);
        break;
      case 'use':
        room.handleUse(me, m.d);
        break;
      case 'launch':
        room.handleLaunch(me, m.d);
        break;
      case 'pickup': {
        if (!me.alive || room.gameOver) break;
        const p = room.pickups[+m.idx];
        if (!p || !p.active) break;
        if ((p.x - me.x) ** 2 + (p.z - me.z) ** 2 > 2.5) break;
        if (p.kind === 'trophy') {
          if (room.mode !== 'maze') break;
          p.active = false;
          room.broadcast({ t: 'pickup', idx: p.idx, active: false, by: me.id, kind: p.kind });
          room.trophyWin(me);
          break;
        }
        if (p.kind === 'stairs') {
          if (room.mode !== 'raid') break;
          room.advanceFloor(me);
          break;
        }
        if (p.kind === 'rifle' || p.kind === 'shotgun' || p.kind === 'sniper' || p.kind === 'launcher') { me.weapon = p.kind; me.owned[p.kind] = true; }
        else if (p.kind === 'armor') { if (me.armor >= 100) break; me.armor = 100; }
        else if (p.kind === 'health') { if (me.hp >= 100) break; me.hp = Math.min(100, me.hp + 50); }
        else if (p.kind === 'mines') { me.owned.mines = true; }
        // ammo/mine count is client-side flavour; server just cycles the pickup
        p.active = false; p.respawnAt = Date.now() + 15000;
        room.broadcast({ t: 'pickup', idx: p.idx, active: false, by: me.id, kind: p.kind });
        break;
      }
      case 'ping': ws.send(JSON.stringify({ t: 'pong', c: m.c })); break;
    }
  });

  ws.on('close', () => {
    if (!me || !room) return;
    room.players.delete(me.id);
    room.broadcast({ t: 'left', id: me.id, name: me.name });
    console.log(`[room ${room.code}] - ${me.name} (#${me.id}) — ${room.players.size} in arena`);
    if (room.humanCount() === 0) {   // bots alone don't keep a room alive
      if (room.resetTimer) clearTimeout(room.resetTimer);
      rooms.delete(room.code);
      console.log(`[room ${room.code}] closed`);
    }
  });
});

/* ---------- 20 Hz tick across all rooms ---------- */
setInterval(() => {
  const nowMs = Date.now();
  for (const room of rooms.values()) room.tick(nowMs);
}, TICK_MS);

server.listen(PORT, () => {
  console.log(`FACILITY 64 ONLINE — http://localhost:${PORT}`);
  console.log(`Rooms enabled: share a room code (or a #CODE link) to play in a private arena.`);
});
