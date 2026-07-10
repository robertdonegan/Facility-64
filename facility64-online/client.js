/* ================= CORE SETUP ================= */
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias:false });
renderer.setPixelRatio(1);
const PIXEL_SCALE = 0.45;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b120c);
scene.fog = new THREE.Fog(0x0b120c, 18, 55);
const camera = new THREE.PerspectiveCamera(72, innerWidth/innerHeight, 0.1, 100);
function fitRenderer(){
  renderer.setSize(Math.floor(innerWidth*PIXEL_SCALE), Math.floor(innerHeight*PIXEL_SCALE), false);
  canvas.style.width = '100%'; canvas.style.height = '100%';
  camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix();
}
addEventListener('resize', fitRenderer);
scene.add(new THREE.AmbientLight(0x8a9a7a, 0.65));
const sun = new THREE.DirectionalLight(0xfff2cc, 0.55);
sun.position.set(20, 40, 10); scene.add(sun);

/* ================= AUDIO ================= */
let AC = null;
function audio(){ if(!AC) AC = new (window.AudioContext||window.webkitAudioContext)(); return AC; }
function shotSound(loud=0.25, dur=0.09, freq=900){
  try{
    const ctx = audio(); const t = ctx.currentTime;
    const buf = ctx.createBuffer(1, ctx.sampleRate*dur, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i] = (Math.random()*2-1) * Math.pow(1-i/d.length, 2.2);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(loud, t); g.gain.exponentialRampToValueAtTime(0.001, t+dur);
    src.connect(bp).connect(g).connect(ctx.destination); src.start();
  }catch(e){}
}
function pickupSound(){
  try{
    const ctx = audio(); const t = ctx.currentTime;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type='square'; o.frequency.setValueAtTime(520,t); o.frequency.setValueAtTime(780,t+0.08);
    g.gain.setValueAtTime(0.12,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.2);
    o.connect(g).connect(ctx.destination); o.start(); o.stop(t+0.22);
  }catch(e){}
}

/* ================= LEVEL (geometry shared with server via level.js) ================= */
const makeTex = (draw, w=64, h=64) => {
  const c = document.createElement('canvas'); c.width=w; c.height=h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
};
const wallTex = makeTex((g,w,h)=>{
  g.fillStyle='#5c6b58'; g.fillRect(0,0,w,h);
  g.fillStyle='#4d5a4a';
  for(let y=0;y<h;y+=16) for(let x=0;x<w;x+=32){
    const off = (y/16)%2 ? 16 : 0;
    g.fillRect(x+off,y, 30, 14);
  }
  g.strokeStyle='#3a4538'; g.lineWidth=2;
  for(let y=0;y<=h;y+=16){ g.beginPath(); g.moveTo(0,y); g.lineTo(w,y); g.stroke(); }
});
const floorTex = makeTex((g,w,h)=>{
  g.fillStyle='#39423a'; g.fillRect(0,0,w,h);
  g.strokeStyle='#2b332c'; g.lineWidth=2;
  for(let i=0;i<=w;i+=16){ g.beginPath(); g.moveTo(i,0); g.lineTo(i,h); g.stroke(); g.beginPath(); g.moveTo(0,i); g.lineTo(w,i); g.stroke(); }
  g.fillStyle='#434f42'; g.fillRect(2,2,12,12); g.fillRect(34,34,12,12);
});
const crateTex = makeTex((g,w,h)=>{
  g.fillStyle='#7a6134'; g.fillRect(0,0,w,h);
  g.strokeStyle='#4f3d1d'; g.lineWidth=4; g.strokeRect(2,2,w-4,h-4);
  g.beginPath(); g.moveTo(2,2); g.lineTo(w-2,h-2); g.moveTo(w-2,2); g.lineTo(2,h-2); g.stroke();
});
floorTex.repeat.set(20,20);

/* ---- dynamic level: rebuilt from whatever level data the server sends ---- */
let LEVELINST = LEVEL.makeLevel(LEVEL.DEFAULT_LEVEL_DATA);
let levelGroup = null;
let PICKUPS = [];
let pickupMeshes = [];
let pickupActive = [];
function collides(x, z, r){ return LEVELINST.collides(x, z, r); }

function makePickupMesh(kind){
  let mesh;
  if(kind === 'rifle'){
    mesh = new THREE.Mesh(new THREE.BoxGeometry(1.3,.22,.3), new THREE.MeshLambertMaterial({ color:0x2e2e2e }));
    const mag = new THREE.Mesh(new THREE.BoxGeometry(.22,.4,.22), new THREE.MeshLambertMaterial({ color:0x444444 }));
    mag.position.y = -.25; mesh.add(mag);
  } else if(kind === 'armor'){
    mesh = new THREE.Mesh(new THREE.BoxGeometry(.9,1,.35), new THREE.MeshLambertMaterial({ color:0x2f5fd0 }));
  } else {
    mesh = new THREE.Mesh(new THREE.BoxGeometry(.6,.4,.6), new THREE.MeshLambertMaterial({ color:0x777a3a }));
  }
  return mesh;
}

function buildLevel(data){
  LEVELINST = LEVEL.makeLevel(data);
  if(levelGroup) scene.remove(levelGroup);
  levelGroup = new THREE.Group();
  const A = LEVELINST.ARENA;

  floorTex.repeat.set(Math.max(6, Math.round(A/2.2)), Math.max(6, Math.round(A/2.2)));
  const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(A*2, A*2), new THREE.MeshLambertMaterial({ map:floorTex }));
  floorMesh.rotation.x = -Math.PI/2; levelGroup.add(floorMesh);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(A*2, A*2), new THREE.MeshLambertMaterial({ color:0x222a22 }));
  ceil.rotation.x = Math.PI/2; ceil.position.y = 5; levelGroup.add(ceil);

  for(const [cx, cz, sx, sz, sy, kind] of LEVELINST.BLOCKS){
    const tex = kind === 'crate' ? crateTex : wallTex;
    const mat = new THREE.MeshLambertMaterial({ map: tex.clone() });
    mat.map.needsUpdate = true;
    if(kind !== 'crate') mat.map.repeat.set(Math.max(1,Math.round(sx/3)), Math.max(1,Math.round(sy/3)));
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(cx, sy/2, cz);
    levelGroup.add(m);
  }
  const strips = Math.floor(A/12);
  for(let i=-strips;i<=strips;i++){
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(1.6, .25), new THREE.MeshBasicMaterial({ color:0x9fd05a }));
    strip.position.set(i*10, 4.2, -A+0.55); levelGroup.add(strip);
    const strip2 = strip.clone(); strip2.rotation.y = Math.PI; strip2.position.z = A-0.55; levelGroup.add(strip2);
  }

  PICKUPS = LEVELINST.PICKUPS;
  pickupMeshes = PICKUPS.map(p => {
    const mesh = makePickupMesh(p.kind);
    mesh.position.set(p.x, 1, p.z);
    mesh.userData.spin = Math.random()*6;
    levelGroup.add(mesh);
    return mesh;
  });
  pickupActive = PICKUPS.map(()=>true);
  scene.add(levelGroup);
}
buildLevel(LEVEL.DEFAULT_LEVEL_DATA);

/* ================= WEAPONS ================= */
const WEAPONS = {
  pistol: { name:'P9 SILENCED', rof:320, mag:7,  reserve:49, auto:false, spread:0.012, reload:1100, snd:[0.14,0.06,1400] },
  rifle:  { name:'K74 RIFLE',   rof:105, mag:30, reserve:90, auto:true,  spread:0.03,  reload:1500, snd:[0.3,0.1,700] },
};

/* ================= LOCAL PLAYER ================= */
const me = {
  id:null, name:'AGENT', x:0, z:0, yaw:0, pitch:0, hp:100, armor:0, score:0, alive:false,
  weapon:'pistol', mag:7, reserve:49, lastShot:0, reloading:false, bob:0,
};
let winScore = 10;

/* ================= REMOTE PLAYERS ================= */
function makeAgentMesh(color){
  const g = new THREE.Group();
  const suit = new THREE.MeshLambertMaterial({ color });
  const skin = new THREE.MeshLambertMaterial({ color:0xd8a878 });
  const dark = new THREE.MeshLambertMaterial({ color:0x1c1c1c });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(.9,1.1,.5), suit); torso.position.y = 1.25; g.add(torso);
  const head  = new THREE.Mesh(new THREE.BoxGeometry(.5,.5,.5), skin); head.position.y = 2.08; g.add(head);
  const hair  = new THREE.Mesh(new THREE.BoxGeometry(.54,.18,.54), dark); hair.position.y = 2.32; g.add(hair);
  const legL  = new THREE.Mesh(new THREE.BoxGeometry(.32,.75,.35), dark); legL.position.set(-.24,.37,0); g.add(legL);
  const legR  = legL.clone(); legR.position.x = .24; g.add(legR);
  const armL  = new THREE.Mesh(new THREE.BoxGeometry(.22,.9,.32), suit); armL.position.set(-.58,1.3,0); g.add(armL);
  const armR  = armL.clone(); armR.position.set(.58,1.25,-.28); armR.rotation.x = -1.2; g.add(armR);
  const gun   = new THREE.Mesh(new THREE.BoxGeometry(.14,.14,.8), dark); gun.position.set(.58,1.05,-.75); g.add(gun);
  const flash = new THREE.Mesh(new THREE.BoxGeometry(.3,.3,.3), new THREE.MeshBasicMaterial({ color:0xffe08a }));
  flash.position.set(.58,1.05,-1.2); flash.visible = false; g.add(flash);
  g.userData.flash = flash; g.userData.legs = [legL, legR];
  return g;
}
function makeNameSprite(name){
  const c = document.createElement('canvas'); c.width = 256; c.height = 48;
  const g = c.getContext('2d');
  g.font = 'bold 30px Arial Narrow, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(0,0,0,.55)';
  const w = g.measureText(name).width + 24;
  g.fillRect(128 - w/2, 4, w, 40);
  g.fillStyle = '#e8e3c0';
  g.fillText(name, 128, 26);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map:tex, depthTest:true }));
  spr.scale.set(2.6, 0.5, 1);
  spr.position.y = 2.85;
  return spr;
}
const remotes = new Map(); // id -> remote
function ensureRemote(p){
  let r = remotes.get(p.id);
  if(!r){
    const mesh = makeAgentMesh(p.color);
    mesh.add(makeNameSprite(p.name));
    scene.add(mesh);
    r = { id:p.id, name:p.name, mesh, x:p.x, z:p.z, yaw:p.yaw, tx:p.x, tz:p.z, tyaw:p.yaw, alive:p.alive, mv:0, walkT:Math.random()*10 };
    remotes.set(p.id, r);
  }
  return r;
}
function nameOf(id){
  if(id === me.id) return 'YOU';
  const r = remotes.get(id);
  return r ? r.name : 'AGENT';
}

/* ================= NETWORK ================= */
let ws = null, connected = false, joined = false;
let latestBoard = [];
let roomCode = 'LOBBY';
let levelName = 'FACILITY';
let pingMs = 0, lastPingSent = 0;
const connStatus = document.getElementById('connStatus');

function connect(name, room, level){
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  connStatus.textContent = 'CONTACTING HQ...';
  ws.onopen = () => {
    connected = true;
    ws.send(JSON.stringify({ t:'join', name, room, level }));
  };
  ws.onclose = () => {
    connected = false; joined = false;
    if(started){
      started = false; paused = true;
      document.exitPointerLock();
      document.getElementById('hud').style.display = 'none';
      document.getElementById('endMenu').style.display = 'none';
      document.getElementById('pauseMenu').style.display = 'none';
      document.getElementById('mainMenu').style.display = 'flex';
    }
    connStatus.textContent = 'CONNECTION LOST — SERVER OFFLINE?';
    for(const r of remotes.values()) scene.remove(r.mesh);
    remotes.clear();
  };
  ws.onerror = () => { connStatus.textContent = 'COULD NOT REACH SERVER'; };
  ws.onmessage = (ev) => {
    let m; try{ m = JSON.parse(ev.data); }catch{ return; }
    handleMsg(m);
  };
}
function send(obj){ if(connected && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function handleMsg(m){
  switch(m.t){
    case 'welcome':
      me.id = m.id; winScore = m.winScore || 10;
      roomCode = m.room || 'LOBBY';
      levelName = m.levelName || 'FACILITY';
      if(m.level) buildLevel(m.level);
      try { history.replaceState(null, '', '#' + roomCode); } catch(e) {}
      document.getElementById('waitNotice').textContent =
        `NO OTHER AGENTS IN ROOM ${roomCode} — SHARE THIS PAGE'S LINK (#${roomCode}) TO START THE FIGHT`;
      pickupActive = m.pickups.slice();
      pickupActive.forEach((a,i)=> pickupMeshes[i].visible = a);
      joined = true;
      enterArena();
      break;
    case 'snap': {
      const seen = new Set();
      for(const p of m.players){
        if(p.id === me.id){
          me.hp = p.hp; me.armor = p.armor; me.score = p.score;
          continue;
        }
        seen.add(p.id);
        const r = ensureRemote(p);
        r.tx = p.x; r.tz = p.z; r.tyaw = p.yaw;
        r.alive = p.alive; r.mv = p.mv;
        r.score = p.score;
        r.mesh.visible = p.alive;
      }
      for(const [id, r] of remotes){
        if(!seen.has(id)){ scene.remove(r.mesh); remotes.delete(id); }
      }
      latestBoard = m.players.map(p => ({ id:p.id, name:p.id===me.id?'YOU':p.name, score:p.score }));
      updateHUD();
      break;
    }
    case 'respawn':
      if(m.id === me.id){
        me.x = m.x; me.z = m.z; me.yaw = m.yaw; me.pitch = 0;
        me.hp = 100; me.armor = 0; me.alive = true;
        me.weapon = 'pistol'; me.mag = WEAPONS.pistol.mag; me.reserve = WEAPONS.pistol.reserve; me.reloading = false;
        document.getElementById('deadNotice').style.display = 'none';
        updateHUD();
      } else {
        const r = remotes.get(m.id);
        if(r){ r.x = r.tx = m.x; r.z = r.tz = m.z; r.alive = true; r.mesh.visible = true; }
      }
      break;
    case 'shot': {
      const r = remotes.get(m.id);
      if(r){
        const f = r.mesh.userData.flash; f.visible = true; setTimeout(()=>f.visible=false, 50);
        const d = Math.hypot(r.x - me.x, r.z - me.z);
        shotSound(Math.max(.03, .2 - d*0.004), 0.07, 1000);
      }
      break;
    }
    case 'damage':
      if(m.id === me.id){
        me.hp = m.hp; me.armor = m.armor;
        const df = document.getElementById('damageFlash');
        df.style.transition='none'; df.style.opacity = .9;
        requestAnimationFrame(()=>{ df.style.transition='opacity .5s'; df.style.opacity = 0; });
        updateHUD();
      }
      if(m.from === me.id){
        const hm = document.getElementById('hitmarker');
        hm.style.opacity = 1; hm.style.transition='none';
        requestAnimationFrame(()=>{ hm.style.transition='opacity .3s'; hm.style.opacity = 0; });
      }
      break;
    case 'death':
      killFeed(nameOf(m.killer), nameOf(m.victim));
      if(m.victim === me.id){
        me.alive = false;
        const dn = document.getElementById('deadNotice');
        dn.innerHTML = `ELIMINATED BY ${nameOf(m.killer)}<br><span style="font-size:16px;color:#c9c27f;">RESPAWNING...</span>`;
        dn.style.display = 'block';
      } else {
        const r = remotes.get(m.victim);
        if(r){ r.alive = false; r.mesh.visible = false; }
      }
      break;
    case 'pickup':
      pickupActive[m.idx] = m.active;
      pickupMeshes[m.idx].visible = m.active;
      if(!m.active && m.by === me.id){
        const kind = m.kind;
        if(kind === 'rifle'){
          if(me.weapon === 'rifle'){ me.reserve = Math.min(150, me.reserve + 30); }
          else { me.weapon = 'rifle'; me.mag = WEAPONS.rifle.mag; me.reserve = WEAPONS.rifle.reserve; me.reloading = false; }
        } else if(kind === 'ammo'){
          me.reserve = Math.min(150, me.reserve + (me.weapon === 'rifle' ? 30 : 14));
        }
        pickupSound(); updateHUD();
      }
      break;
    case 'joined': feedSys(`${m.name} ENTERED THE ARENA`); break;
    case 'left':   feedSys(`${m.name} LEFT THE ARENA`); break;
    case 'gameOver': {
      paused = true;
      document.exitPointerLock();
      const title = document.getElementById('endTitle');
      const won = m.winner === me.id;
      title.textContent = won ? 'MISSION COMPLETE' : 'ROUND OVER';
      title.style.color = won ? '#9fd05a' : '#ff6a5c';
      document.getElementById('endBoard').innerHTML =
        m.board.map((e,i)=>`${i+1}. ${e.name}${e.name===me.name?' (YOU)':''} — ${e.score}`).join('<br>') +
        `<br><br><span class="blink">${won ? 'FOR ENGLAND, JAMES?' : m.winnerName + ' TAKES THE ROUND'}</span>`;
      document.getElementById('endMenu').style.display = 'flex';
      document.getElementById('hud').style.display = 'none';
      updateClickHint();
      let remain = Math.round((m.resetIn||8000)/1000);
      const cd = document.getElementById('resetCountdown');
      cd.textContent = `NEXT ROUND IN ${remain}`;
      const iv = setInterval(()=>{
        remain--; cd.textContent = `NEXT ROUND IN ${Math.max(0,remain)}`;
        if(remain <= 0) clearInterval(iv);
      }, 1000);
      break;
    }
    case 'reset':
      pickupActive = m.pickups.slice();
      pickupActive.forEach((a,i)=> pickupMeshes[i].visible = a);
      document.getElementById('endMenu').style.display = 'none';
      document.getElementById('hud').style.display = 'block';
      document.getElementById('killfeed').innerHTML = '';
      paused = false;
      updateClickHint();
      break;
    case 'announce': {
      const banner = document.getElementById('announceBanner');
      banner.textContent = m.text;
      banner.classList.remove('announce-pop');
      void banner.offsetWidth; // restart the animation
      banner.classList.add('announce-pop');
      try{
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(m.say || m.text);
        u.rate = 0.85; u.pitch = 0.45; u.volume = 0.9;
        speechSynthesis.speak(u);
      }catch(e){}
      break;
    }
    case 'pong':
      pingMs = Math.round(performance.now() - m.c);
      document.getElementById('ping').textContent = `PING ${pingMs} MS · ROOM ${roomCode} · MAP ${levelName} · AGENTS ${remotes.size + 1}`;
      break;
  }
}

/* ================= FEED / HUD ================= */
const feed = document.getElementById('killfeed');
function killFeed(killer, victim){
  const div = document.createElement('div');
  div.className='feed-line';
  div.innerHTML = `<span class="killer">${killer}</span> ✕ <span class="victim">${victim}</span>`;
  feed.prepend(div);
  while(feed.children.length > 5) feed.removeChild(feed.lastChild);
  setTimeout(()=>div.remove(), 4200);
}
function feedSys(text){
  const div = document.createElement('div');
  div.className='feed-line';
  div.innerHTML = `<span class="sys">${text}</span>`;
  feed.prepend(div);
  setTimeout(()=>div.remove(), 4200);
}
function updateHUD(){
  document.getElementById('healthFill').style.width = Math.max(0,me.hp) + '%';
  document.getElementById('armorFill').style.width = Math.max(0,me.armor) + '%';
  const w = WEAPONS[me.weapon];
  document.getElementById('weaponName').textContent = w.name;
  document.getElementById('ammoCount').textContent = `${me.mag} | ${me.reserve}`;
  const rh = document.getElementById('reloadHint');
  if(me.reloading){ rh.textContent='RELOADING...'; rh.style.visibility='visible'; }
  else if(me.mag <= 2 && me.reserve > 0){ rh.textContent='PRESS R TO RELOAD'; rh.style.visibility='visible'; }
  else rh.style.visibility='hidden';
  let strip = `FIRST TO ${winScore}`;
  const others = latestBoard.filter(e => e.id !== me.id);
  if(others.length){
    const leader = others.reduce((a,b)=> b.score > a.score ? b : a);
    strip = `YOU ${me.score} — ${leader.name} ${leader.score}  |  ` + strip;
  } else {
    strip = `YOU ${me.score}  |  ` + strip;
  }
  document.getElementById('scoreStrip').textContent = strip;
  document.getElementById('waitNotice').style.display = others.length ? 'none' : 'block';
}

/* ================= INPUT ================= */
const keys = {};
let mouseDown = false;
let paused = true, started = false;
addEventListener('keydown', e => {
  keys[e.code] = true;
  if(e.code === 'KeyR') startReload();
});
addEventListener('keyup', e => keys[e.code] = false);
addEventListener('mousedown', e => { if(document.pointerLockElement === canvas && e.button === 0){ mouseDown = true; fire(); } });
addEventListener('mouseup', () => mouseDown = false);
addEventListener('mousemove', e => {
  if(document.pointerLockElement !== canvas) return;
  me.yaw   -= e.movementX * 0.0022;
  me.pitch -= e.movementY * 0.0022;
  me.pitch = Math.max(-1.35, Math.min(1.35, me.pitch));
});
function tryLock(){
  try{
    const p = canvas.requestPointerLock();
    if(p && p.catch) p.catch(()=>{});
  }catch(e){}
}
const clickHint = document.getElementById('clickHint');
function updateClickHint(){
  const needsLock = started && document.pointerLockElement !== canvas
    && document.getElementById('endMenu').style.display !== 'flex'
    && document.getElementById('pauseMenu').style.display !== 'flex';
  clickHint.style.display = needsLock ? 'block' : 'none';
}
// clicking the game view (re)captures the mouse — this IS a user gesture, so it works
canvas.addEventListener('click', () => {
  if(started && document.pointerLockElement !== canvas) tryLock();
});
document.addEventListener('pointerlockchange', () => {
  if(document.pointerLockElement === canvas){
    paused = false;
    document.getElementById('pauseMenu').style.display = 'none';
  } else if(started && !paused){
    paused = true;
    document.getElementById('pauseMenu').style.display = 'flex';
  }
  updateClickHint();
});

/* ================= SHOOTING (hit detection is server-side) ================= */
const gunGroup = new THREE.Group();
{
  const dark = new THREE.MeshLambertMaterial({ color:0x232323 });
  const grip = new THREE.Mesh(new THREE.BoxGeometry(.09,.22,.14), dark); grip.position.set(.25,-.28,-.55);
  const slide = new THREE.Mesh(new THREE.BoxGeometry(.1,.1,.5), dark); slide.position.set(.25,-.16,-.75);
  gunGroup.add(grip, slide);
  const mflash = new THREE.Mesh(new THREE.BoxGeometry(.16,.16,.16), new THREE.MeshBasicMaterial({ color:0xffe08a }));
  mflash.position.set(.25,-.16,-1.05); mflash.visible = false; gunGroup.add(mflash);
  gunGroup.userData.flash = mflash;
}
camera.add(gunGroup); scene.add(camera);
let gunKick = 0;

function startReload(){
  const w = WEAPONS[me.weapon];
  if(me.reloading || me.mag >= w.mag || me.reserve <= 0 || !me.alive) return;
  me.reloading = true;
  updateHUD();
  setTimeout(() => {
    const take = Math.min(w.mag - me.mag, me.reserve);
    me.mag += take; me.reserve -= take; me.reloading = false;
    updateHUD();
  }, w.reload);
}
function fire(){
  if(paused || !started || !me.alive || me.reloading) return;
  const w = WEAPONS[me.weapon];
  if(now - me.lastShot < w.rof) return;
  if(me.mag <= 0){ startReload(); return; }
  me.lastShot = now; me.mag--; gunKick = 1;
  shotSound(...w.snd);
  const f = gunGroup.userData.flash; f.visible = true; setTimeout(()=>f.visible=false, 45);

  // spread is applied client-side, then the exact direction is sent —
  // the server raycasts this ray against players + level geometry
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  dir.x += (Math.random()-.5)*w.spread*2;
  dir.y += (Math.random()-.5)*w.spread*2;
  dir.z += (Math.random()-.5)*w.spread*2;
  dir.normalize();
  send({ t:'shoot', d:[+dir.x.toFixed(4), +dir.y.toFixed(4), +dir.z.toFixed(4)] });

  updateHUD();
  if(me.mag === 0) startReload();
}

/* ================= PICKUP CHECK ================= */
function tryPickup(){
  for(let i=0;i<PICKUPS.length;i++){
    if(!pickupActive[i]) continue;
    const p = PICKUPS[i];
    if((me.x-p.x)**2 + (me.z-p.z)**2 < 1.7){
      if(p.kind === 'armor' && me.armor >= 100) continue;
      send({ t:'pickup', idx:i });
    }
  }
}

/* ================= MENUS ================= */
const nameInput = document.getElementById('nameInput');
const roomInput = document.getElementById('roomInput');
if(location.hash.length > 1) roomInput.value = location.hash.slice(1).toUpperCase();
const levelSelect = document.getElementById('levelSelect');
fetch('/api/levels').then(r => r.json()).then(j => {
  levelSelect.innerHTML = '';
  for(const lv of j.levels){
    const o = document.createElement('option');
    o.value = lv; o.textContent = 'MAP: ' + lv;
    levelSelect.appendChild(o);
  }
}).catch(()=>{});
document.getElementById('startBtn').onclick = () => {
  const name = (nameInput.value || 'AGENT ' + Math.floor(Math.random()*90+10)).trim();
  const room = (roomInput.value || 'LOBBY').trim();
  const level = levelSelect.value || 'FACILITY';
  document.getElementById('startBtn').disabled = true;
  connect(name, room, level);
};
function enterArena(){
  document.getElementById('startBtn').disabled = false;
  connStatus.textContent = '';
  started = true;
  paused = false;
  document.getElementById('mainMenu').style.display = 'none';
  document.getElementById('hud').style.display = 'block';
  tryLock();
  updateClickHint();
  updateHUD();
}
document.getElementById('resumeBtn').onclick = () => {
  document.getElementById('pauseMenu').style.display = 'none';
  tryLock();           // button click is a user gesture, so this succeeds
  updateClickHint();   // fallback hint if the browser still refused
};

/* ================= MAIN LOOP ================= */
let now = performance.now();
let last = now, lastNetSend = 0;
function lerpAngle(a, b, t){
  let d = b - a;
  while(d > Math.PI) d -= Math.PI*2;
  while(d < -Math.PI) d += Math.PI*2;
  return a + d * t;
}
function loop(){
  requestAnimationFrame(loop);
  now = performance.now();
  const dt = Math.min(0.05, (now - last)/1000);
  last = now;

  if(started){
    // local movement (client predicts; server range-clamps)
    let moving = false;
    if(!paused && me.alive){
      const SPEED = keys['ShiftLeft']||keys['ShiftRight'] ? 8.2 : 5.4;
      let ix = 0, iz = 0;
      if(keys['KeyW']) iz -= 1;
      if(keys['KeyS']) iz += 1;
      if(keys['KeyA']) ix -= 1;
      if(keys['KeyD']) ix += 1;
      const il = Math.hypot(ix, iz);
      if(il > 0){
        ix/=il; iz/=il;
        const sin = Math.sin(me.yaw), cos = Math.cos(me.yaw);
        const dx = (ix*cos + iz*sin) * SPEED * dt;
        const dz = (-ix*sin + iz*cos) * SPEED * dt;
        if(!collides(me.x+dx, me.z, .55)) me.x += dx;
        if(!collides(me.x, me.z+dz, .55)) me.z += dz;
        me.bob += dt * (SPEED>6 ? 13 : 9);
        moving = true;
      }
      if(mouseDown && WEAPONS[me.weapon].auto) fire();
      tryPickup();
    }
    // net send 20 Hz
    if(connected && now - lastNetSend > 50){
      lastNetSend = now;
      send({ t:'state', x:+me.x.toFixed(2), z:+me.z.toFixed(2), yaw:+me.yaw.toFixed(3), mv: moving?1:0 });
      if(now - lastPingSent > 2000){ lastPingSent = now; send({ t:'ping', c: now }); }
    }
    // remotes interpolation
    for(const r of remotes.values()){
      const k = Math.min(1, dt*12);
      r.x += (r.tx - r.x)*k;
      r.z += (r.tz - r.z)*k;
      r.yaw = lerpAngle(r.yaw, r.tyaw, k);
      r.mesh.position.set(r.x, 0, r.z);
      r.mesh.rotation.y = r.yaw;
      if(r.mv){ r.walkT += dt*10; }
      const legs = r.mesh.userData.legs;
      legs[0].rotation.x = r.mv ? Math.sin(r.walkT)*.7 : 0;
      legs[1].rotation.x = r.mv ? -Math.sin(r.walkT)*.7 : 0;
    }
    // pickups spin
    pickupMeshes.forEach(m => {
      m.userData.spin += dt*2;
      m.rotation.y = m.userData.spin;
      m.position.y = 1 + Math.sin(m.userData.spin*1.5)*.12;
    });
    gunKick = Math.max(0, gunKick - dt*8);
  }
  camera.position.set(me.x, 1.6 + Math.sin(me.bob)*.045, me.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = me.yaw;
  camera.rotation.x = me.pitch + gunKick*0.03;
  gunGroup.position.z = gunKick * 0.06;
  gunGroup.position.y = -gunKick * 0.02;
  renderer.render(scene, camera);
}
fitRenderer();
updateHUD();
loop();
