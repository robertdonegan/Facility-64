/* Shared texture painters.
   Loaded by the game client (window.TEXTURES) and the texture studio (/textures.html).

   Every paintable surface has a key and a painter that draws the default look onto a
   2D canvas context: `<theme>.wall` / `<theme>.floor` for the five themes, plus `crate`
   (the wooden crate faces) and `city` (rooftop skyline building windows).

   Custom paint-jobs are cosmetic and client-side: the game reads a
   { key: dataURL } map from localStorage `f64-textures` (written by the studio)
   and stamps each image over the default canvas before play. */
(function (root) {

  const SIZE = 128;                       // all square surfaces are SIZE x SIZE
  const CITY_W = 64, CITY_H = 128;        // skyline strip is tall
  const STORAGE_KEY = 'f64-textures';

  const shade = (g, w, h, n, alpha) => {  // scattered translucent speckle, cheap grime
    for (let i = 0; i < n; i++) {
      g.fillStyle = `rgba(0,0,0,${(Math.random() * alpha).toFixed(3)})`;
      g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3);
    }
  };

  const painters = {
    'facility.wall': (g, w, h) => {
      // concrete panels with seams, rivets, a hazard stripe course, and a vent grille
      g.fillStyle = '#5c6b58'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 32) {
        g.fillStyle = Math.random() < .5 ? '#576553' : '#61705d';
        g.fillRect(x, y, 32, 32);
      }
      g.strokeStyle = '#3a4538'; g.lineWidth = 2;
      for (let y = 0; y <= h; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      for (let x = 0; x <= w; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      g.fillStyle = '#2e372c';
      for (let y = 16; y < h; y += 32) for (let x = 4; x < w; x += 16) g.fillRect(x, y - 1, 2, 2);
      g.save(); g.beginPath(); g.rect(0, 58, w, 12); g.clip();
      for (let x = -12; x < w + 12; x += 12) {
        g.fillStyle = (x / 12) % 2 ? '#b8a43a' : '#23291f';
        g.beginPath(); g.moveTo(x, 70); g.lineTo(x + 6, 58); g.lineTo(x + 12, 58); g.lineTo(x + 6, 70); g.fill();
      }
      g.restore();
      g.fillStyle = '#39443a'; g.fillRect(88, 12, 28, 18);
      g.strokeStyle = '#232b21'; g.lineWidth = 1;
      for (let y = 15; y < 30; y += 3) { g.beginPath(); g.moveTo(90, y); g.lineTo(114, y); g.stroke(); }
      shade(g, w, h, 90, .14);
    },
    'facility.floor': (g, w, h) => {
      // metal deck plates with tread dots and a drain grate
      g.fillStyle = '#39423a'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 32) {
        g.fillStyle = Math.random() < .5 ? '#37403a' : '#3c463d';
        g.fillRect(x, y, 32, 32);
      }
      g.strokeStyle = '#2b332c'; g.lineWidth = 2;
      for (let i = 0; i <= w; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); }
      g.fillStyle = '#434f42';
      for (let y = 6; y < h; y += 13) for (let x = 6; x < w; x += 13) g.fillRect(x, y, 3, 3);
      g.fillStyle = '#1d241c'; g.fillRect(96, 96, 26, 26);
      g.strokeStyle = '#39423a'; g.lineWidth = 2;
      for (let i = 99; i < 122; i += 5) { g.beginPath(); g.moveTo(i, 97); g.lineTo(i, 121); g.stroke(); }
      shade(g, w, h, 70, .12);
    },
    'jungle.wall': (g, w, h) => {
      // mossy stone blocks strangled by vines
      g.fillStyle = '#55503f'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 21) { const off = (y / 21 | 0) % 2 ? 16 : 0;
        for (let x = -16; x < w; x += 32) {
          g.fillStyle = ['#5a5142', '#514936', '#5f5747'][Math.floor(Math.random() * 3)];
          g.fillRect(x + off + 1, y + 1, 30, 19);
        }
      }
      g.strokeStyle = '#2f2a1d'; g.lineWidth = 2;
      for (let y = 0; y <= h; y += 21) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      g.fillStyle = 'rgba(63,92,46,.85)';
      for (let i = 0; i < 34; i++) { const y = Math.round(Math.random() * 6) * 21 + (Math.random() < .5 ? 2 : 17);
        g.beginPath(); g.arc(Math.random() * w, y, 3 + Math.random() * 5, 0, 7); g.fill(); }
      for (let v = 0; v < 5; v++) {
        const x0 = 10 + v * 26 + Math.random() * 10;
        g.strokeStyle = '#3a5527'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(x0, 0);
        for (let y = 0; y <= h; y += 8) g.lineTo(x0 + Math.sin(y * .22 + v) * 4, y);
        g.stroke();
        g.fillStyle = '#4c7033';
        for (let y = 6; y < h; y += 14) g.fillRect(x0 + Math.sin(y * .22 + v) * 4 - 2, y, 5, 3);
      }
      shade(g, w, h, 60, .18);
    },
    'jungle.floor': (g, w, h) => {
      // packed earth, grass tufts, roots, fallen leaves
      g.fillStyle = '#3b4a2c'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 50; i++) { g.fillStyle = Math.random() < .5 ? '#425534' : '#354426';
        g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 4 + Math.random() * 8, 0, 7); g.fill(); }
      g.fillStyle = '#4f4030';
      for (let i = 0; i < 8; i++) { g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 5 + Math.random() * 7, 0, 7); g.fill(); }
      g.strokeStyle = '#57432c'; g.lineWidth = 2;
      for (let i = 0; i < 4; i++) { const x = Math.random() * w, y = Math.random() * h;
        g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 14, y + 6, x + 26 + Math.random() * 10, y - 4); g.stroke(); }
      g.fillStyle = '#6a8f3f';
      for (let i = 0; i < 26; i++) { const x = Math.random() * w, y = Math.random() * h;
        g.fillRect(x, y, 1, 4); g.fillRect(x + 2, y + 1, 1, 3); g.fillRect(x - 2, y + 1, 1, 3); }
      g.fillStyle = '#7d6b35';
      for (let i = 0; i < 14; i++) g.fillRect(Math.random() * w, Math.random() * h, 3, 2);
      shade(g, w, h, 40, .15);
    },
    'office.wall': (g, w, h) => {
      // drywall with wainscot rail, a window with blinds, power outlet
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#cecdc3'); grad.addColorStop(1, '#c2c0b5');
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
      g.fillStyle = '#a89f8c'; g.fillRect(0, 92, w, 6);
      g.fillStyle = '#b6ac97'; g.fillRect(0, 98, w, 30);
      g.strokeStyle = '#9a9077'; g.lineWidth = 1;
      for (let x = 0; x <= w; x += 16) { g.beginPath(); g.moveTo(x, 98); g.lineTo(x, 128); g.stroke(); }
      const wx = 26, wy = 18, ww = 52, wh = 42;
      const sky = g.createLinearGradient(0, wy, 0, wy + wh);
      sky.addColorStop(0, '#9cc4e0'); sky.addColorStop(1, '#c6dcea');
      g.fillStyle = sky; g.fillRect(wx, wy, ww, wh);
      g.strokeStyle = '#8a8578'; g.lineWidth = 3; g.strokeRect(wx, wy, ww, wh);
      g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1;
      for (let y = wy + 4; y < wy + wh; y += 5) { g.beginPath(); g.moveTo(wx + 2, y); g.lineTo(wx + ww - 2, y); g.stroke(); }
      g.strokeStyle = '#8a8578'; g.beginPath(); g.moveTo(wx + ww / 2, wy); g.lineTo(wx + ww / 2, wy + wh); g.stroke();
      g.fillStyle = '#e8e6df'; g.fillRect(100, 104, 10, 14);
      g.fillStyle = '#7c7a72'; g.fillRect(103, 107, 4, 2); g.fillRect(103, 112, 4, 2);
      shade(g, w, h, 30, .06);
    },
    'office.floor': (g, w, h) => {
      // carpet tiles, alternating weave direction, coffee stain
      for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 32) {
        const alt = ((x + y) / 32) % 2;
        g.fillStyle = alt ? '#6f7a86' : '#75808c';
        g.fillRect(x, y, 32, 32);
        g.strokeStyle = 'rgba(0,0,0,.12)';
        for (let i = 2; i < 32; i += 4) {
          g.beginPath();
          if (alt) { g.moveTo(x + i, y + 1); g.lineTo(x + i, y + 31); } else { g.moveTo(x + 1, y + i); g.lineTo(x + 31, y + i); }
          g.stroke();
        }
      }
      g.strokeStyle = '#59636e'; g.lineWidth = 1;
      for (let i = 0; i <= w; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); }
      g.fillStyle = 'rgba(74,58,38,.25)';
      g.beginPath(); g.arc(97, 34, 7, 0, 7); g.fill();
      shade(g, w, h, 50, .05);
    },
    'church.wall': (g, w, h) => {
      // great stone blocks, candle soot, and a pointed stained-glass window
      g.fillStyle = '#6e6152'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 16) { const off = (y / 16 | 0) % 2 ? 16 : 0;
        for (let x = -16; x < w; x += 32) {
          g.fillStyle = ['#6e6152', '#685b4c', '#746757', '#6a5e50'][Math.floor(Math.random() * 4)];
          g.fillRect(x + off + 1, y + 1, 30, 14);
        }
      }
      g.strokeStyle = '#443a2c'; g.lineWidth = 2;
      for (let y = 0; y <= h; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      for (let y = 0; y < h; y += 16) { const off = (y / 16 | 0) % 2 ? 16 : 0;
        for (let x = off; x <= w; x += 32) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 16); g.stroke(); } }
      const cx2 = 64, top = 10, bw = 22, bh = 54;
      g.beginPath();
      g.moveTo(cx2 - bw / 2, top + bh);
      g.lineTo(cx2 - bw / 2, top + 14);
      g.quadraticCurveTo(cx2, top - 6, cx2 + bw / 2, top + 14);
      g.lineTo(cx2 + bw / 2, top + bh);
      g.closePath();
      g.save(); g.clip();
      const panes = ['#8a3b3b', '#3b5a8a', '#8a7a3b', '#3b8a58', '#6a3b8a'];
      for (let y = top - 6; y < top + bh; y += 8) for (let x = cx2 - bw / 2; x < cx2 + bw / 2; x += 7) {
        g.fillStyle = panes[Math.floor(Math.random() * panes.length)];
        g.fillRect(x, y, 7, 8);
      }
      g.restore();
      g.strokeStyle = '#241d14'; g.lineWidth = 3;
      g.beginPath();
      g.moveTo(cx2 - bw / 2, top + bh);
      g.lineTo(cx2 - bw / 2, top + 14);
      g.quadraticCurveTo(cx2, top - 6, cx2 + bw / 2, top + 14);
      g.lineTo(cx2 + bw / 2, top + bh);
      g.stroke();
      g.fillStyle = 'rgba(20,14,8,.25)';
      for (let i = 0; i < 6; i++) { const x = Math.random() * w; g.fillRect(x, h - 26 - Math.random() * 14, 3 + Math.random() * 4, 30); }
      shade(g, w, h, 70, .16);
    },
    'church.floor': (g, w, h) => {
      // chequered marble with veins
      for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 32) {
        const dark = ((x + y) / 32) % 2;
        g.fillStyle = dark ? '#3b3225' : '#8c7f68';
        g.fillRect(x, y, 32, 32);
        g.strokeStyle = dark ? 'rgba(140,127,104,.3)' : 'rgba(59,50,37,.3)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x + Math.random() * 10, y);
        g.quadraticCurveTo(x + 16 + Math.random() * 8 - 4, y + 16, x + 22 + Math.random() * 10, y + 32);
        g.stroke();
      }
      g.strokeStyle = '#241d12'; g.lineWidth = 2;
      for (let i = 0; i <= w; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); }
      shade(g, w, h, 40, .12);
    },
    'rooftop.wall': (g, w, h) => {
      // weathered brick with grime streaks and a concrete cap course
      g.fillStyle = '#7a3327'; g.fillRect(0, 0, w, h);
      for (let y = 12; y < h; y += 10) { const off = (y / 10 | 0) % 2 ? 10 : 0;
        for (let x = -10; x < w; x += 20) {
          g.fillStyle = ['#6a2b20', '#75342a', '#5f261c', '#7d382c'][Math.floor(Math.random() * 4)];
          g.fillRect(x + off + 1, y + 1, 18, 8);
        }
      }
      g.strokeStyle = '#4e2018'; g.lineWidth = 1;
      for (let y = 12; y <= h; y += 10) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      g.fillStyle = '#9a9a94'; g.fillRect(0, 0, w, 12);
      g.strokeStyle = '#7c7c76'; g.beginPath(); g.moveTo(0, 11); g.lineTo(w, 11); g.stroke();
      g.fillStyle = 'rgba(30,25,20,.22)';
      for (let i = 0; i < 8; i++) { const x = Math.random() * w; g.fillRect(x, 12, 2 + Math.random() * 3, 24 + Math.random() * 60); }
      shade(g, w, h, 60, .15);
    },
    'rooftop.floor': (g, w, h) => {
      // concrete slabs, expansion joints, cracks, tar patches
      g.fillStyle = '#8a8f93'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 64) for (let x = 0; x < w; x += 64) {
        g.fillStyle = Math.random() < .5 ? '#878c90' : '#8e9397';
        g.fillRect(x, y, 64, 64);
      }
      g.strokeStyle = '#6f7478'; g.lineWidth = 3;
      for (let i = 0; i <= w; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); }
      g.strokeStyle = 'rgba(60,62,64,.7)'; g.lineWidth = 1;
      for (let i = 0; i < 5; i++) { let x = Math.random() * w, y = Math.random() * h;
        g.beginPath(); g.moveTo(x, y);
        for (let s = 0; s < 5; s++) { x += Math.random() * 14 - 7; y += Math.random() * 14 - 7; g.lineTo(x, y); }
        g.stroke(); }
      g.fillStyle = 'rgba(28,28,30,.5)';
      for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 6 + Math.random() * 8, 0, 7); g.fill(); }
      shade(g, w, h, 60, .1);
    },
    'crate': (g, w, h) => {
      // wooden crate face with cross-bracing
      g.fillStyle = '#7a6134'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#4f3d1d'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
      g.beginPath(); g.moveTo(4, 4); g.lineTo(w - 4, h - 4); g.moveTo(w - 4, 4); g.lineTo(4, h - 4); g.stroke();
      g.strokeStyle = 'rgba(60,45,20,.35)'; g.lineWidth = 2;
      for (let y = 12; y < h; y += 14) { g.beginPath(); g.moveTo(6, y); g.lineTo(w - 6, y + Math.random() * 4 - 2); g.stroke(); }
    },
    'city': (g, w, h) => {
      // rooftop skyline building face — lit and dark windows
      g.fillStyle = '#232a33'; g.fillRect(0, 0, w, h);
      for (let y = 4; y < h - 4; y += 9) for (let x = 4; x < w - 4; x += 8) {
        g.fillStyle = Math.random() < .4 ? '#d8c87a' : '#151a20';
        g.fillRect(x, y, 4, 5);
      }
    },
  };

  const SURFACES = Object.keys(painters);
  const sizeOf = (key) => key === 'city' ? [CITY_W, CITY_H] : [SIZE, SIZE];

  /* Read the { key: dataURL } override map from localStorage; invalid entries dropped. */
  function loadOverrides(storage) {
    try {
      const raw = (storage || localStorage).getItem(STORAGE_KEY);
      if (!raw) return {};
      const data = JSON.parse(raw);
      const clean = {};
      for (const key of SURFACES) {
        if (typeof data[key] === 'string' && data[key].startsWith('data:image/')) clean[key] = data[key];
      }
      return clean;
    } catch (e) { return {}; }
  }

  const TEXTURES = { SIZE, STORAGE_KEY, SURFACES, painters, sizeOf, loadOverrides };
  if (typeof module !== 'undefined' && module.exports) module.exports = TEXTURES;
  else root.TEXTURES = TEXTURES;
})(typeof self !== 'undefined' ? self : this);
