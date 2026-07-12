/* Shared level system.
   Loaded by the browser client (window.LEVEL) AND required by server.js,
   so hit validation on the server uses exactly the client's geometry.

   A level is plain data:
     { name, arena, blocks:[[cx,cz,sx,sz,sy,kind],...], spawns:[[x,z],...],
       pickups:[{kind,x,z},...] }
   makeLevel(data) adds the perimeter walls and returns collision helpers. */
(function (root) {

  const DEFAULT_LEVEL_DATA = {
    name: 'FACILITY',
    theme: 'facility',
    arena: 44,
    blocks: [
      [0, 0, 12, 1.2, 5, 'wall'],
      [-6, -6, 1.2, 12, 5, 'wall'],
      [6, 6, 1.2, 12, 5, 'wall'],
      [-20, -14, 16, 1.2, 5, 'wall'],
      [20, 14, 16, 1.2, 5, 'wall'],
      [-14, 20, 1.2, 16, 5, 'wall'],
      [14, -20, 1.2, 16, 5, 'wall'],
      [-28, 8, 1.2, 20, 5, 'wall'],
      [28, -8, 1.2, 20, 5, 'wall'],
      [-8, 30, 24, 1.2, 5, 'wall'],
      [8, -30, 24, 1.2, 5, 'wall'],
      [34, 30, 12, 1.2, 5, 'wall'],
      [-34, -30, 12, 1.2, 5, 'wall'],
      [-18, 2, 2.2, 2.2, 2.2, 'crate'], [18, -2, 2.2, 2.2, 2.2, 'crate'],
      [3, 18, 2.2, 2.2, 2.2, 'crate'], [-3, -18, 2.2, 2.2, 2.2, 'crate'],
      [26, 26, 2.2, 2.2, 2.2, 'crate'], [-26, -26, 2.2, 2.2, 2.2, 'crate'],
      [36, -18, 2.2, 2.2, 2.2, 'crate'], [-36, 18, 2.2, 2.2, 2.2, 'crate'],
      [10, 36, 2.2, 2.2, 2.2, 'crate'], [-10, -36, 2.2, 2.2, 2.2, 'crate'],
    ],
    spawns: [
      [-38, -38], [38, 38], [-38, 38], [38, -38], [0, -38], [0, 38], [-38, 0], [38, 0], [22, 6], [-22, -6],
    ],
    pickups: [
      { kind: 'rifle', x: 0, z: -3.5 }, { kind: 'rifle', x: 32, z: 32 },
      { kind: 'armor', x: -32, z: -32 }, { kind: 'armor', x: 24, z: -24 },
      { kind: 'ammo', x: -24, z: 24 }, { kind: 'ammo', x: 0, z: 3.5 },
      { kind: 'ammo', x: 38, z: -38 }, { kind: 'ammo', x: -38, z: 38 },
      { kind: 'mines', x: -30, z: 0 }, { kind: 'mines', x: 30, z: 0 },
      { kind: 'shotgun', x: 14, z: 32 }, { kind: 'sniper', x: -14, z: -32 },
      { kind: 'launcher', x: -14, z: 32 },
    ],
  };

  const PICKUP_KINDS = ['rifle', 'shotgun', 'sniper', 'launcher', 'armor', 'ammo', 'mines'];
  const THEMES = ['facility', 'jungle', 'office', 'church', 'rooftop'];
  const LIMITS = { arenaMin: 16, arenaMax: 80, blocks: 300, spawns: 32, pickups: 32, nameLen: 16 };

  /* Validate untrusted level data. Returns { ok, error?, clean? } where clean
     is a sanitized copy safe to run on the server. */
  function validateLevel(data) {
    const fail = (error) => ({ ok: false, error });
    if (!data || typeof data !== 'object') return fail('level must be an object');
    const arena = +data.arena;
    if (!isFinite(arena) || arena < LIMITS.arenaMin || arena > LIMITS.arenaMax) {
      return fail(`arena must be ${LIMITS.arenaMin}-${LIMITS.arenaMax}`);
    }
    const name = String(data.name || 'UNTITLED').toUpperCase().replace(/[^A-Z0-9 _-]/g, '').slice(0, LIMITS.nameLen) || 'UNTITLED';
    const theme = THEMES.includes(data.theme) ? data.theme : 'facility';

    if (!Array.isArray(data.blocks) || data.blocks.length > LIMITS.blocks) return fail(`blocks must be an array of at most ${LIMITS.blocks}`);
    const blocks = [];
    for (const b of data.blocks) {
      if (!Array.isArray(b) || b.length < 6) return fail('each block must be [cx,cz,sx,sz,sy,kind]');
      const [cx, cz, sx, sz, sy] = b.map(Number);
      const kind = b[5] === 'crate' ? 'crate' : 'wall';
      if (![cx, cz, sx, sz, sy].every(isFinite)) return fail('block values must be numbers');
      if (sx < 0.5 || sz < 0.5 || sx > arena * 2 || sz > arena * 2) return fail('block footprint out of range');
      if (sy < 1 || sy > 10) return fail('block height must be 1-10');
      if (Math.abs(cx) > arena || Math.abs(cz) > arena) return fail('block centre outside arena');
      blocks.push([cx, cz, sx, sz, sy, kind]);
    }

    if (!Array.isArray(data.spawns) || data.spawns.length < 2 || data.spawns.length > LIMITS.spawns) {
      return fail(`need 2-${LIMITS.spawns} spawn points`);
    }
    const spawns = [];
    for (const s of data.spawns) {
      if (!Array.isArray(s) || s.length < 2) return fail('each spawn must be [x,z]');
      const [x, z] = s.map(Number);
      if (!isFinite(x) || !isFinite(z) || Math.abs(x) > arena - 1 || Math.abs(z) > arena - 1) return fail('spawn outside arena');
      spawns.push([x, z]);
    }

    if (!Array.isArray(data.pickups) || data.pickups.length > LIMITS.pickups) return fail(`pickups must be an array of at most ${LIMITS.pickups}`);
    const pickups = [];
    for (const p of data.pickups) {
      if (!p || !PICKUP_KINDS.includes(p.kind)) return fail('pickup kind must be one of ' + PICKUP_KINDS.join('/'));
      const x = +p.x, z = +p.z;
      if (!isFinite(x) || !isFinite(z) || Math.abs(x) > arena - 1 || Math.abs(z) > arena - 1) return fail('pickup outside arena');
      pickups.push({ kind: p.kind, x, z });
    }

    return { ok: true, clean: { name, arena, theme, blocks, spawns, pickups } };
  }

  /* Build a runnable level (perimeter walls + collision helpers) from data. */
  function makeLevel(data) {
    const ARENA = +data.arena;
    const BLOCKS = [
      [0, -ARENA, ARENA * 2, 1, 5, 'wall'], [0, ARENA, ARENA * 2, 1, 5, 'wall'],
      [-ARENA, 0, 1, ARENA * 2, 5, 'wall'], [ARENA, 0, 1, ARENA * 2, 5, 'wall'],
      ...data.blocks,
    ];
    const SPAWNS = data.spawns.map(s => [+s[0], +s[1]]);
    const PICKUPS = data.pickups.map(p => ({ kind: p.kind, x: +p.x, z: +p.z }));
    const COLLIDERS = BLOCKS.map(([cx, cz, sx, sz, sy]) => ({
      minX: cx - sx / 2, maxX: cx + sx / 2, minZ: cz - sz / 2, maxZ: cz + sz / 2, h: sy,
    }));

    function collides(x, z, r) {
      if (x < -ARENA + r + 0.5 || x > ARENA - r - 0.5 || z < -ARENA + r + 0.5 || z > ARENA - r - 0.5) return true;
      for (const c of COLLIDERS) {
        if (x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r) return true;
      }
      return false;
    }

    // Liang-Barsky segment vs AABB (2D top-down; every block is tall enough to block fire)
    function segHitsRect(ax, az, bx, bz, c) {
      let t0 = 0, t1 = 1;
      const dx = bx - ax, dz = bz - az;
      const p = [-dx, dx, -dz, dz];
      const q = [ax - c.minX, c.maxX - ax, az - c.minZ, c.maxZ - az];
      for (let i = 0; i < 4; i++) {
        if (Math.abs(p[i]) < 1e-9) { if (q[i] < 0) return false; }
        else {
          const t = q[i] / p[i];
          if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
          else { if (t < t0) return false; if (t < t1) t1 = t; }
        }
      }
      return true;
    }
    function segBlocked(ax, az, bx, bz) {
      for (const c of COLLIDERS) if (segHitsRect(ax, az, bx, bz, c)) return true;
      return false;
    }

    return { name: data.name || 'UNTITLED', theme: THEMES.includes(data.theme) ? data.theme : 'facility', ARENA, BLOCKS, SPAWNS, PICKUPS, COLLIDERS, collides, segBlocked };
  }

  /* Procedurally generate a full level: an NxN room grid carved with a randomized
     Kruskal spanning tree (every room reachable), extra open edges for loops, walls
     with door gaps, then crates/spawns/pickups collision-checked against the result.
     Pure data — used by the editor's GENERATE button AND by the server for the
     RANDOM map option. */
  function generateArena(opts) {
    opts = opts || {};
    const arena = Math.max(LIMITS.arenaMin, Math.min(LIMITS.arenaMax, Math.round(opts.arena || 44)));
    const rng = opts.rng || Math.random;
    const theme = THEMES.includes(opts.theme) ? opts.theme : THEMES[Math.floor(rng() * THEMES.length)];
    const N = Math.max(2, Math.min(6, Math.round((arena * 2) / 22)));
    const cell = (arena * 2) / N;
    const ox = -arena, oz = -arena;
    const cellCenter = (cx, cz) => [ox + (cx + 0.5) * cell, oz + (cz + 0.5) * cell];
    const idx = (cx, cz) => cz * N + cx;

    const parent = Array.from({ length: N * N }, (_, i) => i);
    const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra === rb) return false; parent[ra] = rb; return true; };

    const edges = [];
    for (let cz = 0; cz < N; cz++) for (let cx = 0; cx < N; cx++) {
      if (cx < N - 1) edges.push({ a: idx(cx, cz), b: idx(cx + 1, cz), cx, cz, dir: 'v' });
      if (cz < N - 1) edges.push({ a: idx(cx, cz), b: idx(cx, cz + 1), cx, cz, dir: 'h' });
    }
    for (let i = edges.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [edges[i], edges[j]] = [edges[j], edges[i]]; }

    const openEdges = new Set();
    for (const e of edges) {
      const key = e.dir + ':' + e.cx + ',' + e.cz;
      if (union(e.a, e.b) || rng() < 0.3) openEdges.add(key);
    }

    const blocks = [];
    const THICK = 1.2, HEIGHT = 5, DOORW = 4;
    function addWallWithDoor(orientation, fixedCoord, from, to) {
      const span = to - from;
      const gapW = Math.min(DOORW, span * 0.5);
      const gapCenter = from + span * 0.3 + rng() * span * 0.4;
      const gapLo = gapCenter - gapW / 2, gapHi = gapCenter + gapW / 2;
      if (gapLo - from > 1) {
        const len = gapLo - from, c = (from + gapLo) / 2;
        blocks.push(orientation === 'v' ? [fixedCoord, c, THICK, len, HEIGHT, 'wall'] : [c, fixedCoord, len, THICK, HEIGHT, 'wall']);
      }
      if (to - gapHi > 1) {
        const len = to - gapHi, c = (gapHi + to) / 2;
        blocks.push(orientation === 'v' ? [fixedCoord, c, THICK, len, HEIGHT, 'wall'] : [c, fixedCoord, len, THICK, HEIGHT, 'wall']);
      }
    }
    for (let cz = 0; cz < N; cz++) for (let cx = 0; cx < N; cx++) {
      if (cx < N - 1 && !openEdges.has('v:' + cx + ',' + cz)) {
        addWallWithDoor('v', ox + (cx + 1) * cell, oz + cz * cell, oz + (cz + 1) * cell);
      }
      if (cz < N - 1 && !openEdges.has('h:' + cx + ',' + cz)) {
        addWallWithDoor('h', oz + (cz + 1) * cell, ox + cx * cell, ox + (cx + 1) * cell);
      }
    }

    for (let cz = 0; cz < N; cz++) for (let cx = 0; cx < N; cx++) {
      if (rng() < 0.45) {
        const [ccx, ccz] = cellCenter(cx, cz);
        blocks.push([ccx + (rng() - 0.5) * cell * 0.5, ccz + (rng() - 0.5) * cell * 0.5, 2.2, 2.2, 2.2, 'crate']);
      }
    }

    const testLevel = makeLevel({ arena, blocks, spawns: [[0, 0], [1, 1]], pickups: [] });
    function randomFreeSpot(cx, cz, tries) {
      for (let i = 0; i < tries; i++) {
        const [ccx, ccz] = cellCenter(cx, cz);
        const x = Math.max(-(arena - 1), Math.min(arena - 1, ccx + (rng() - 0.5) * cell * 0.55));
        const z = Math.max(-(arena - 1), Math.min(arena - 1, ccz + (rng() - 0.5) * cell * 0.55));
        if (!testLevel.collides(x, z, 0.8)) return [Math.round(x), Math.round(z)];
      }
      return null;
    }

    const cellOrder = [];
    for (let cz = 0; cz < N; cz++) for (let cx = 0; cx < N; cx++) cellOrder.push([cx, cz]);
    for (let i = cellOrder.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [cellOrder[i], cellOrder[j]] = [cellOrder[j], cellOrder[i]]; }

    const spawns = [];
    const maxSpawns = Math.min(16, cellOrder.length);
    for (let i = 0; i < maxSpawns; i++) {
      const spot = randomFreeSpot(cellOrder[i][0], cellOrder[i][1], 12);
      if (spot) spawns.push(spot);
    }
    if (spawns.length < 2) { spawns.push([-(arena - 2), -(arena - 2)]); spawns.push([arena - 2, arena - 2]); }

    const pool = ['rifle', 'rifle', 'shotgun', 'sniper', 'launcher', 'armor', 'armor', 'ammo', 'ammo', 'ammo', 'ammo', 'mines', 'mines'];
    const pickups = [];
    let ci = maxSpawns % cellOrder.length;
    for (const kind of pool) {
      for (let attempt = 0; attempt < cellOrder.length; attempt++) {
        const [cx, cz] = cellOrder[(ci + attempt) % cellOrder.length];
        const spot = randomFreeSpot(cx, cz, 8);
        if (spot) { pickups.push({ kind, x: spot[0], z: spot[1] }); break; }
      }
      ci++;
    }

    return { name: opts.name || 'RANDOM', theme, arena, blocks, spawns, pickups };
  }

  const LEVEL = { DEFAULT_LEVEL_DATA, makeLevel, validateLevel, generateArena, LIMITS, THEMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = LEVEL;
  else root.LEVEL = LEVEL;
})(typeof self !== 'undefined' ? self : this);
