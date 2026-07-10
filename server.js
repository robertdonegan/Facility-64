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

const PORT = process.env.PORT || 8080;
const WIN_SCORE = parseInt(process.env.WIN_SCORE || '10', 10);
const TICK_MS = 50;               // 20 Hz snapshots
const RESPAWN_MS = 2500;
const RESET_MS = 8000;
const MULTI_KILL_WINDOW_MS = 4500;

const EYE_Y = 1.6, CHEST_Y = 1.3, HIT_RADIUS = 0.75, MAX_RANGE = 60;
const WEAPON_DMG = { pistol: 34, rifle: 16 };
const WEAPON_ROF = { pistol: 300, rifle: 95 };   // ms, small tolerance vs client

/* ---------- custom levels ---------- */
const LEVELS_DIR = path.join(__dirname, 'levels');
if (!fs.existsSync(LEVELS_DIR)) fs.mkdirSync(LEVELS_DIR, { recursive: true });

const levelFileName = (name) =>
  String(name || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 16);

function listLevels() {
  const files = fs.readdirSync(LEVELS_DIR).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
  return ['FACILITY', ...files.sort()];
}
function loadLevelData(name) {
  const clean = levelFileName(name);
  if (!clean || clean === 'FACILITY') return LEVEL.DEFAULT_LEVEL_DATA;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(LEVELS_DIR, clean + '.json'), 'utf8'));
    const v = LEVEL.validateLevel(raw);
    if (v.ok) return v.clean;
    console.warn(`[levels] ${clean} failed validation (${v.error}) — using FACILITY`);
  } catch (e) { /* fall through to default */ }
  return LEVEL.DEFAULT_LEVEL_DATA;
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
      if (!fname || fname === 'FACILITY') return json(400, { error: 'pick a different level name' });
      fs.writeFileSync(path.join(LEVELS_DIR, fname + '.json'), JSON.stringify(v.clean, null, 2));
      console.log(`[levels] saved ${fname} (${v.clean.blocks.length} blocks, ${v.clean.spawns.length} spawns)`);
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
  constructor(code, levelName) {
    this.code = code;
    this.levelName = levelFileName(levelName) || 'FACILITY';
    this.levelData = loadLevelData(this.levelName);
    this.level = LEVEL.makeLevel(this.levelData);
    this.players = new Map();
    this.gameOver = false;
    this.resetTimer = null;
    this.pickups = this.level.PICKUPS.map((p, i) => ({ ...p, idx: i, active: true, respawnAt: 0 }));
  }

  broadcast(obj, exceptId = null) {
    const msg = JSON.stringify(obj);
    for (const p of this.players.values()) {
      if (p.id === exceptId) continue;
      if (p.ws.readyState === 1) p.ws.send(msg);
    }
  }
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

  spawnPlayer(p) {
    const [x, z] = this.farSpawn();
    p.x = x; p.z = z; p.yaw = Math.atan2(-x, -z);
    p.hp = 100; p.armor = 0; p.alive = true; p.weapon = 'pistol';
    this.broadcast({ t: 'respawn', id: p.id, x, z, yaw: p.yaw });
  }

  /* -------- authoritative shooting -------- */
  handleShoot(shooter, d) {
    if (!shooter.alive || this.gameOver) return;
    const nowMs = Date.now();
    if (nowMs - shooter.lastShot < (WEAPON_ROF[shooter.weapon] || 300)) return;
    shooter.lastShot = nowMs;
    this.broadcast({ t: 'shot', id: shooter.id }, shooter.id);

    // sanitize direction
    if (!Array.isArray(d) || d.length !== 3 || d.some(v => !isFinite(+v))) return;
    let [dx, dy, dz] = d.map(Number);
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return;
    dx /= len; dy /= len; dz /= len;

    // nearest target whose chest cylinder the ray passes through
    let hit = null, hitD = Infinity;
    for (const t of this.players.values()) {
      if (t === shooter || !t.alive) continue;
      const tox = t.x - shooter.x, toy = CHEST_Y - EYE_Y, toz = t.z - shooter.z;
      const proj = tox * dx + toy * dy + toz * dz;
      if (proj < 0.5 || proj > MAX_RANGE) continue;
      const cx = dx * proj - tox, cy = dy * proj - toy, cz = dz * proj - toz;
      if (Math.hypot(cx, cy, cz) < HIT_RADIUS && proj < hitD) { hit = t; hitD = proj; }
    }
    if (!hit) return;
    // occlusion against the shared level geometry
    if (this.level.segBlocked(shooter.x, shooter.z, hit.x, hit.z)) return;
    this.applyDamage(hit, shooter, WEAPON_DMG[shooter.weapon] || 16);
  }

  applyDamage(target, attacker, dmg) {
    if (!target.alive || this.gameOver) return;
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
      if (!this.gameOver) {
        setTimeout(() => {
          if (this.players.has(target.id) && !this.gameOver) this.spawnPlayer(target);
        }, RESPAWN_MS);
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
    this.pickups = this.level.PICKUPS.map((p, i) => ({ ...p, idx: i, active: true, respawnAt: 0 }));
    for (const p of this.players.values()) {
      p.score = 0; p.streak = 0; p.multi = 0;
      this.spawnPlayer(p);
    }
    this.broadcast({ t: 'reset', pickups: this.pickups.map(p => p.active) });
  }

  tick(nowMs) {
    for (const p of this.pickups) {
      if (!p.active && nowMs >= p.respawnAt) {
        p.active = true;
        this.broadcast({ t: 'pickup', idx: p.idx, active: true });
      }
    }
    if (this.players.size === 0) return;
    this.broadcast({
      t: 'snap',
      players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, color: p.color,
        x: +p.x.toFixed(2), z: +p.z.toFixed(2), yaw: +p.yaw.toFixed(3),
        hp: Math.round(p.hp), armor: Math.round(p.armor),
        score: p.score, streak: p.streak || 0, alive: p.alive, mv: p.moving ? 1 : 0,
      })),
    });
  }
}

function getRoom(code, levelName) {
  let r = rooms.get(code);
  if (!r) {
    r = new Room(code, levelName);
    rooms.set(code, r);
    console.log(`[room ${code}] opened — map ${r.levelName}`);
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
      const code = String(m.room || 'LOBBY').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'LOBBY';
      room = getRoom(code, m.level);
      me = {
        id: nextId++, ws, name,
        color: COLORS[(nextId - 2) % COLORS.length],
        x: 0, z: 0, yaw: 0, hp: 100, armor: 0, score: 0, streak: 0, multi: 0, lastKillAt: 0,
        alive: false, weapon: 'pistol', lastShot: 0,
      };
      room.players.set(me.id, me);
      ws.send(JSON.stringify({
        t: 'welcome', id: me.id, color: me.color, winScore: WIN_SCORE, room: code,
        levelName: room.levelName, level: room.levelData,
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
        me.yaw = yaw;
        me.moving = !!m.mv;
        break;
      }
      case 'shoot':
        room.handleShoot(me, m.d);
        break;
      case 'pickup': {
        if (!me.alive || room.gameOver) break;
        const p = room.pickups[+m.idx];
        if (!p || !p.active) break;
        if ((p.x - me.x) ** 2 + (p.z - me.z) ** 2 > 2.5) break;
        if (p.kind === 'rifle') me.weapon = 'rifle';
        else if (p.kind === 'armor') { if (me.armor >= 100) break; me.armor = 100; }
        // ammo count is client-side flavour; server just cycles the pickup
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
    if (room.players.size === 0) {
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
