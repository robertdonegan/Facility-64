/* Shared weapon model system.
   Loaded by the game client (window.WEAPONRY) and the weapon workshop (/weapons.html).

   A weapon model is plain data — a list of primitive parts:
     { shape:'box'|'cyl'|'sphere'|'cone',
       size:[...], pos:[x,y,z], rot:[degX,degY,degZ]?,
       color:'#hex', glow?:true, flash?:true }
   size by shape: box [w,h,d] · cyl [rTop,rBottom,height] · sphere [r] · cone [r,height]
   glow  → unlit material (always bright, e.g. LEDs)
   flash → unlit material, hidden until the game blinks it as a muzzle flash

   Each weapon has two views: `fp` (first-person, hangs off the camera around
   x .25, y -.2, z -.7) and `world` (held by other players' avatars, around
   x .58, y 1.05, z -.8). buildParts(THREE, parts) turns a list into a THREE.Group
   with userData.flash pointing at the flash part.

   Custom designs are cosmetic and client-side: the game reads an override set
   from localStorage key `f64-weapons` (written by the workshop), validated by
   validateModels so a bad import can never break rendering. */
(function (root) {

  const WEAPON_KEYS = ['pistol', 'shotgun', 'rifle', 'sniper', 'mines'];
  const SHAPES = ['box', 'cyl', 'sphere', 'cone'];
  const LIMITS = { parts: 40 };
  const STORAGE_KEY = 'f64-weapons';

  const DEFAULT_MODELS = {
    pistol: {
      fp: [
        { shape:'box', size:[.09,.22,.14], pos:[.25,-.28,-.55], color:'#232323' },
        { shape:'box', size:[.1,.1,.5],    pos:[.25,-.16,-.75], color:'#232323' },
        { shape:'box', size:[.16,.16,.16], pos:[.25,-.16,-1.05], color:'#ffe08a', flash:true },
      ],
      world: [
        { shape:'box', size:[.14,.14,.55], pos:[.58,1.05,-.65], color:'#232323' },
        { shape:'box', size:[.24,.24,.24], pos:[.58,1.05,-.98], color:'#ffe08a', flash:true },
      ],
    },
    shotgun: {
      fp: [
        { shape:'box', size:[.11,.11,.8],  pos:[.27,-.13,-.9],  color:'#232323' },
        { shape:'box', size:[.09,.09,.7],  pos:[.27,-.23,-.85], color:'#232323' },
        { shape:'box', size:[.14,.12,.28], pos:[.27,-.24,-.95], color:'#5a3d20' },
        { shape:'box', size:[.1,.18,.35],  pos:[.27,-.22,-.28], color:'#5a3d20' },
        { shape:'box', size:[.24,.24,.24], pos:[.27,-.13,-1.32], color:'#ffe08a', flash:true },
      ],
      world: [
        { shape:'box', size:[.14,.15,.85], pos:[.58,1.06,-.85], color:'#232323' },
        { shape:'box', size:[.16,.13,.25], pos:[.58,.95,-1.0],  color:'#5a3d20' },
        { shape:'box', size:[.12,.18,.3],  pos:[.58,1.06,-.35], color:'#5a3d20' },
        { shape:'box', size:[.3,.3,.3],    pos:[.58,1.06,-1.35], color:'#ffe08a', flash:true },
      ],
    },
    rifle: {
      fp: [
        { shape:'box', size:[.08,.1,.85],  pos:[.27,-.14,-1.0], color:'#232323' },
        { shape:'box', size:[.1,.16,.4],   pos:[.27,-.18,-.5],  color:'#232323' },
        { shape:'box', size:[.08,.13,.28], pos:[.27,-.2,-.15],  color:'#232323' },
        { shape:'box', size:[.08,.32,.12], pos:[.27,-.42,-.55], color:'#232323' },
        { shape:'box', size:[.07,.2,.1],   pos:[.27,-.32,-.85], color:'#232323' },
        { shape:'box', size:[.18,.18,.18], pos:[.27,-.14,-1.42], color:'#ffe08a', flash:true },
      ],
      world: [
        { shape:'box', size:[.13,.14,1.05], pos:[.58,1.08,-.95], color:'#232323' },
        { shape:'box', size:[.11,.16,.3],   pos:[.58,1.08,-.28], color:'#232323' },
        { shape:'box', size:[.1,.34,.14],   pos:[.58,.82,-.78],  color:'#232323' },
        { shape:'box', size:[.26,.26,.26],  pos:[.58,1.08,-1.5], color:'#ffe08a', flash:true },
      ],
    },
    sniper: {
      fp: [
        { shape:'box', size:[.07,.08,1.25], pos:[.27,-.13,-1.15], color:'#232323' },
        { shape:'box', size:[.1,.15,.45],   pos:[.27,-.17,-.5],   color:'#232323' },
        { shape:'box', size:[.09,.14,.3],   pos:[.27,-.19,-.15],  color:'#5a3d20' },
        { shape:'cyl', size:[.045,.045,.32], pos:[.27,-.04,-.55], rot:[90,0,0], color:'#232323' },
        { shape:'box', size:[.16,.16,.16],  pos:[.27,-.13,-1.82], color:'#ffe08a', flash:true },
      ],
      world: [
        { shape:'box', size:[.1,.12,1.4],  pos:[.58,1.08,-1.05], color:'#232323' },
        { shape:'cyl', size:[.05,.05,.3],  pos:[.58,1.22,-.7], rot:[90,0,0], color:'#232323' },
        { shape:'box', size:[.1,.15,.3],   pos:[.58,1.06,-.3],   color:'#5a3d20' },
        { shape:'box', size:[.22,.22,.22], pos:[.58,1.08,-1.85], color:'#ffe08a', flash:true },
      ],
    },
    mines: {
      fp: [
        { shape:'cyl', size:[.16,.18,.09],  pos:[.24,-.24,-.55], color:'#8a2f2f' },
        { shape:'sphere', size:[.03], pos:[.24,-.185,-.55], color:'#ff2a2a', glow:true },
      ],
      world: [
        { shape:'cyl', size:[.16,.18,.1], pos:[.58,1.02,-.7], color:'#8a2f2f' },
      ],
    },
  };

  /* Validate untrusted model data. Returns { ok, error?, clean? }. */
  function validateModels(data) {
    const fail = (error) => ({ ok: false, error });
    if (!data || typeof data !== 'object') return fail('models must be an object');
    const clean = {};
    for (const key of WEAPON_KEYS) {
      const w = data[key];
      if (!w || typeof w !== 'object') return fail('missing weapon: ' + key);
      clean[key] = {};
      for (const view of ['fp', 'world']) {
        const parts = w[view];
        if (!Array.isArray(parts) || parts.length < 1 || parts.length > LIMITS.parts) {
          return fail(`${key}.${view} must be 1-${LIMITS.parts} parts`);
        }
        const cleanParts = [];
        for (const p of parts) {
          if (!p || !SHAPES.includes(p.shape)) return fail(`${key}.${view}: bad shape`);
          const need = p.shape === 'box' || p.shape === 'cyl' ? 3 : p.shape === 'cone' ? 2 : 1;
          if (!Array.isArray(p.size) || p.size.length < need) return fail(`${key}.${view}: bad size`);
          const size = p.size.slice(0, 3).map(Number);
          if (!size.every(v => isFinite(v) && v > 0 && v <= 5)) return fail(`${key}.${view}: size values must be 0-5`);
          if (!Array.isArray(p.pos) || p.pos.length !== 3) return fail(`${key}.${view}: bad pos`);
          const pos = p.pos.map(Number);
          if (!pos.every(v => isFinite(v) && Math.abs(v) <= 5)) return fail(`${key}.${view}: pos values must be within ±5`);
          let rot = [0, 0, 0];
          if (p.rot) {
            if (!Array.isArray(p.rot) || p.rot.length !== 3) return fail(`${key}.${view}: bad rot`);
            rot = p.rot.map(Number);
            if (!rot.every(isFinite)) return fail(`${key}.${view}: rot must be numbers`);
          }
          const color = /^#[0-9a-fA-F]{3,8}$/.test(String(p.color)) ? String(p.color) : '#888888';
          const part = { shape: p.shape, size, pos, rot, color };
          if (p.glow) part.glow = true;
          if (p.flash) part.flash = true;
          cleanParts.push(part);
        }
        clean[key][view] = cleanParts;
      }
    }
    return { ok: true, clean };
  }

  /* Build a THREE.Group from a validated part list. */
  function buildParts(THREE, parts) {
    const g = new THREE.Group();
    for (const p of parts) {
      let geo;
      if (p.shape === 'box') geo = new THREE.BoxGeometry(p.size[0], p.size[1], p.size[2]);
      else if (p.shape === 'cyl') geo = new THREE.CylinderGeometry(p.size[0], p.size[1], p.size[2], 10);
      else if (p.shape === 'cone') geo = new THREE.ConeGeometry(p.size[0], p.size[1], 8);
      else geo = new THREE.SphereGeometry(p.size[0], 8, 8);
      const unlit = p.glow || p.flash;
      const mat = unlit
        ? new THREE.MeshBasicMaterial({ color: p.color })
        : new THREE.MeshLambertMaterial({ color: p.color });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(p.pos[0], p.pos[1], p.pos[2]);
      if (p.rot) mesh.rotation.set(p.rot[0] * Math.PI / 180, p.rot[1] * Math.PI / 180, p.rot[2] * Math.PI / 180);
      if (p.flash) { mesh.visible = false; g.userData.flash = mesh; }
      g.add(mesh);
    }
    return g;
  }

  /* Load custom models from localStorage, falling back to defaults. */
  function loadModels(storage) {
    try {
      const raw = (storage || localStorage).getItem(STORAGE_KEY);
      if (raw) {
        const v = validateModels(JSON.parse(raw));
        if (v.ok) return v.clean;
      }
    } catch (e) { /* fall through */ }
    return DEFAULT_MODELS;
  }

  const WEAPONRY = { WEAPON_KEYS, SHAPES, LIMITS, STORAGE_KEY, DEFAULT_MODELS, validateModels, buildParts, loadModels };
  if (typeof module !== 'undefined' && module.exports) module.exports = WEAPONRY;
  else root.WEAPONRY = WEAPONRY;
})(typeof self !== 'undefined' ? self : this);
