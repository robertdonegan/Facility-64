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
    ],
  };

  const PICKUP_KINDS = ['rifle', 'armor', 'ammo'];
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
      if (!p || !PICKUP_KINDS.includes(p.kind)) return fail('pickup kind must be rifle/armor/ammo');
      const x = +p.x, z = +p.z;
      if (!isFinite(x) || !isFinite(z) || Math.abs(x) > arena - 1 || Math.abs(z) > arena - 1) return fail('pickup outside arena');
      pickups.push({ kind: p.kind, x, z });
    }

    return { ok: true, clean: { name, arena, blocks, spawns, pickups } };
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

    return { name: data.name || 'UNTITLED', ARENA, BLOCKS, SPAWNS, PICKUPS, COLLIDERS, collides, segBlocked };
  }

  const LEVEL = { DEFAULT_LEVEL_DATA, makeLevel, validateLevel, LIMITS };
  if (typeof module !== 'undefined' && module.exports) module.exports = LEVEL;
  else root.LEVEL = LEVEL;
})(typeof self !== 'undefined' ? self : this);
