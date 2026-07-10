/* Integration test v2: server-side raycasting, rooms, announcer.
   Run with: node test.js */
process.env.PORT = 8099;
process.env.WIN_SCORE = 5; // short match for the test
require('./server.js');

const WebSocket = require('ws');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function client(name, room) {
  const ws = new WebSocket('ws://localhost:8099');
  const c = { ws, name, id: null, msgs: [], pos: {} };
  ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name, room })));
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    c.msgs.push(m);
    if (m.t === 'welcome') { c.id = m.id; c.room = m.room; }
    if (m.t === 'respawn' && m.id === c.id) { c.pos = { x: m.x, z: m.z }; }
    if (m.t === 'snap') c.snap = m;
  });
  return c;
}
const got = (c, t, pred = () => true) => c.msgs.some(m => m.t === t && pred(m));
const count = (c, t, pred = () => true) => c.msgs.filter(m => m.t === t && pred(m)).length;
let pass = 0, fail = 0;
function check(label, ok) {
  console.log((ok ? '  ✓ ' : '  ✗ ') + label);
  ok ? pass++ : fail++;
}
function teleport(c, x, z) {
  c.pos = { x, z };
  c.ws.send(JSON.stringify({ t: 'state', x, z, yaw: 0, mv: 0 }));
}
function shootAt(c, tx, tz) {
  // aim from eye (1.6) to target chest (1.3)
  c.ws.send(JSON.stringify({ t: 'shoot', d: [tx - c.pos.x, -0.3, tz - c.pos.z] }));
}

(async () => {
  await sleep(300);
  const A = client('ALPHA', 'TEST');
  const B = client('BRAVO', 'TEST');
  const C = client('CHARLIE', 'OTHER');
  await sleep(500);

  check('welcome carries room code', A.room === 'TEST' && C.room === 'OTHER');
  check('A saw B join', got(A, 'joined', m => m.name === 'BRAVO'));
  check('room isolation: C never saw TEST players join', !got(C, 'joined'));
  check('room isolation: C snapshots contain only C', C.snap && C.snap.players.length === 1);

  /* ---- server-side raycast: legit hit ---- */
  const bAlivePos = () => A.snap.players.find(p => p.id === B.id);
  async function killB() {
    // wait for B to be alive in the snapshot
    for (let i = 0; i < 40 && !(bAlivePos() && bAlivePos().alive); i++) await sleep(150);
    const b = bAlivePos();
    teleport(A, b.x + 3, b.z);
    await sleep(120);
    const deathsBefore = count(A, 'death', m => m.victim === B.id);
    for (let i = 0; i < 6; i++) {
      shootAt(A, b.x, b.z);
      await sleep(320); // respect pistol rof
      if (count(A, 'death', m => m.victim === B.id) > deathsBefore) break;
    }
  }

  await killB();
  check('aimed shots produce server-validated damage', got(B, 'damage', m => m.id === B.id));
  check('death broadcast (A killed B)', got(A, 'death', m => m.killer === A.id && m.victim === B.id));
  check('exactly 3 pistol hits to kill (34 dmg)', count(B, 'damage', m => m.id === B.id) === 3);

  /* ---- fake aim rejected ---- */
  await sleep(2800); // B respawns
  const b1 = bAlivePos();
  teleport(A, b1.x + 3, b1.z);
  await sleep(120);
  const dmg0 = count(B, 'damage', m => m.id === B.id);
  A.ws.send(JSON.stringify({ t: 'shoot', d: [0, 0, 1] })); // firing away from B... unless B happens to be at +z
  A.ws.send(JSON.stringify({ t: 'shoot', d: [-(b1.x + 3 - A.pos.x) || -1, 0.9, 0] })); // aimed at the sky/backwards
  await sleep(400);
  const dmgMiss = count(B, 'damage', m => m.id === B.id);
  check('shots aimed away from target do no damage', dmgMiss === dmg0);

  /* ---- wall occlusion (wall block at x=-6, z=-12..0) ---- */
  teleport(A, -2, -6);
  A.ws.send(JSON.stringify({ t: 'state', x: -2, z: -6, yaw: 0 }));
  await sleep(400);
  // move B behind the wall by killing... instead simulate: B streams its own position
  B.ws.send(JSON.stringify({ t: 'state', x: -10, z: -6, yaw: 0 }));
  await sleep(150);
  const dmg1 = count(B, 'damage', m => m.id === B.id);
  shootAt(A, -10, -6); // perfect aim, but a wall is in the way
  await sleep(400);
  check('perfect aim through a wall is blocked by server raycast', count(B, 'damage', m => m.id === B.id) === dmg1);

  /* ---- fire-rate limiting ---- */
  B.ws.send(JSON.stringify({ t: 'state', x: 14, z: 10, yaw: 0 }));
  teleport(A, 10, 10);
  await sleep(150);
  const dmg2 = count(B, 'damage', m => m.id === B.id);
  shootAt(A, 14, 10); shootAt(A, 14, 10); shootAt(A, 14, 10); // burst in one tick
  await sleep(400);
  check('fire-rate limit: burst lands exactly one hit', count(B, 'damage', m => m.id === B.id) === dmg2 + 1);

  /* ---- announcer: double kill (2 kills inside 4.5 s) ---- */
  // finish the current kill fast, then immediately kill again after respawn
  const b2 = bAlivePos();
  teleport(A, b2.x + 3, b2.z);
  for (let i = 0; i < 4; i++) { shootAt(A, b2.x, b2.z); await sleep(320); }   // kill #2
  await killB();                                                              // kill #3, ~3.5s later
  check('DOUBLE KILL announced', got(A, 'announce', m => /DOUBLE KILL/.test(m.text)));

  /* ---- announcer: killing spree at 3-streak outside the multi window ---- */
  await sleep(5000); // let the multi-kill window lapse
  await killB();     // kill #4 → streak 4... spree fires at exactly 3
  // streak by now: kills 1,2,3 made streak 3 → spree may have fired during double kill sequence
  check('KILLING SPREE announced', got(A, 'announce', m => /KILLING SPREE/.test(m.text)));

  /* ---- win + reset ---- */
  await killB();     // kill #5 → WIN_SCORE reached
  await sleep(400);
  check('gameOver broadcast with winner A', got(B, 'gameOver', m => m.winner === A.id));
  check('room OTHER unaffected by TEST gameOver', !got(C, 'gameOver'));
  await sleep(8500);
  check('match reset broadcast', got(A, 'reset'));
  await sleep(300);
  check('scores back to 0 after reset', A.snap.players.every(p => p.score === 0));

  /* ---- custom levels: API + per-room geometry ---- */
  const badResp = await fetch('http://localhost:8099/api/levels', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'BROKEN', arena: 500, blocks: [], spawns: [[0,0]], pickups: [] }),
  });
  check('levels API rejects invalid level', badResp.status === 400);

  // a tiny arena with one wall straight down the middle (x = 0)
  const saveResp = await fetch('http://localhost:8099/api/levels', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'TESTMAP', arena: 20,
      blocks: [[0, 0, 1.2, 38, 5, 'wall']],
      spawns: [[-15, 0], [15, 0]],
      pickups: [{ kind: 'rifle', x: -15, z: 5 }],
    }),
  });
  check('levels API accepts a valid level', (await saveResp.json()).ok === true);
  const list = await (await fetch('http://localhost:8099/api/levels')).json();
  check('saved level appears in the list', list.levels.includes('TESTMAP'));

  const D = client('DELTA', 'CUSTOM'); // first joiner picks the map
  D.ws.send = D.ws.send.bind(D.ws);
  await sleep(200);
  // re-join with level choice (client sends it in join; our helper doesn't, so do it manually)
  const D2 = (() => {
    const ws = new WebSocket('ws://localhost:8099');
    const c = { ws, id: null, msgs: [], pos: {} };
    ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name: 'DELTA2', room: 'CUSTOM2', level: 'TESTMAP' })));
    ws.on('message', raw => {
      const m = JSON.parse(raw);
      c.msgs.push(m);
      if (m.t === 'welcome') { c.id = m.id; c.level = m.level; c.levelName = m.levelName; }
      if (m.t === 'respawn' && m.id === c.id) c.pos = { x: m.x, z: m.z };
      if (m.t === 'snap') c.snap = m;
    });
    return c;
  })();
  const E = (() => {
    const ws = new WebSocket('ws://localhost:8099');
    const c = { ws, id: null, msgs: [], pos: {} };
    ws.on('open', () => setTimeout(() => ws.send(JSON.stringify({ t: 'join', name: 'ECHO', room: 'CUSTOM2' })), 150));
    ws.on('message', raw => {
      const m = JSON.parse(raw);
      c.msgs.push(m);
      if (m.t === 'welcome') c.id = m.id;
      if (m.t === 'respawn' && m.id === c.id) c.pos = { x: m.x, z: m.z };
    });
    return c;
  })();
  await sleep(600);
  check('welcome carries the custom level', D2.levelName === 'TESTMAP' && D2.level && D2.level.arena === 20);

  // both stand at perfect aim across the centre wall — server must block it
  D2.ws.send(JSON.stringify({ t: 'state', x: -5, z: 3, yaw: 0 }));
  E.ws.send(JSON.stringify({ t: 'state', x: 5, z: 3, yaw: 0 }));
  await sleep(200);
  const eDmg = count(E, 'damage', m => m.id === E.id);
  D2.ws.send(JSON.stringify({ t: 'shoot', d: [10, -0.3, 0] }));
  await sleep(350);
  check('custom wall blocks shots on the server', count(E, 'damage', m => m.id === E.id) === eDmg);

  // step around the wall (same side, clear line) — must hit
  D2.ws.send(JSON.stringify({ t: 'state', x: 2, z: 3, yaw: 0 }));
  await sleep(200);
  D2.ws.send(JSON.stringify({ t: 'shoot', d: [3, -0.3, 0] }));
  await sleep(350);
  check('clear line in the custom level hits', count(E, 'damage', m => m.id === E.id) === eDmg + 1);

  D.ws.close(); D2.ws.close(); E.ws.close();

  A.ws.close(); B.ws.close(); C.ws.close();
  await sleep(300);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
