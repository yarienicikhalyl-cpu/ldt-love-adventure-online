const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 20000,
  pingInterval: 8000
});

const PORT = process.env.PORT || 3000;
const TICK = 30;
const DT = 1 / TICK;
const MAX_PLAYERS = 4;

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
const socketToRoom = new Map();

const ROLE_PRESETS = [
  { role: 'Prince', color: '#facc15', outfit: '#1d4ed8', hair: '#7c4a1d' },
  { role: 'Princesse', color: '#fb7185', outfit: '#be185d', hair: '#f4c48b' },
  { role: 'Chevalier', color: '#cbd5e1', outfit: '#475569', hair: '#5b4430' },
  { role: 'Mage', color: '#a78bfa', outfit: '#5b21b6', hair: '#d4b48a' }
];

const ENEMY_TYPES = [
  { type: 'gobelin', hp: 44, speed: 92, damage: 9, color: '#65a30d' },
  { type: 'bandit', hp: 56, speed: 86, damage: 11, color: '#92400e' },
  { type: 'squelette', hp: 48, speed: 96, damage: 10, color: '#d6d3d1' },
  { type: 'orc', hp: 72, speed: 78, damage: 13, color: '#15803d' }
];

function rand(min, max) { return min + Math.random() * (max - min); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
function angDiff(a, b) { return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))); }
function roomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}
function safeName(v) {
  return String(v || 'Joueur').replace(/[<>]/g, '').trim().slice(0, 18) || 'Joueur';
}
function hash2(x, y, seed) {
  let n = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  n = ((n ^ (n >> 13)) * 1274126177) | 0;
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}
function noiseTile(tx, ty, seed) {
  const a = hash2(tx, ty, seed);
  const b = hash2(Math.floor(tx / 2), Math.floor(ty / 2), seed);
  const c = hash2(Math.floor(tx / 5), Math.floor(ty / 5), seed);
  return a * 0.5 + b * 0.32 + c * 0.18;
}
function tileType(room, x, y) {
  const tx = Math.floor(x / 96);
  const ty = Math.floor(y / 96);
  const n = noiseTile(tx, ty, room.seed);
  if (room.level >= 7 && n > 0.93) return 'lava';
  if (n < 0.06) return 'water';
  if (n > 0.875) return 'rock';
  if (Math.abs(tx) % 10 === 0 && n > 0.5) return 'path';
  if (Math.abs(ty) % 12 === 0 && n > 0.48) return 'path';
  return 'grass';
}
function blocked(room, x, y) {
  const t = tileType(room, x, y);
  return t === 'water' || t === 'rock';
}
function moveWithCollision(room, ent, dx, dy) {
  const r = ent.r || 16;
  const nx = ent.x + dx;
  if (
    !blocked(room, nx + Math.sign(dx || 1) * r, ent.y) &&
    !blocked(room, nx, ent.y + r * 0.75) &&
    !blocked(room, nx, ent.y - r * 0.75)
  ) ent.x = nx;

  const ny = ent.y + dy;
  if (
    !blocked(room, ent.x, ny + Math.sign(dy || 1) * r) &&
    !blocked(room, ent.x + r * 0.75, ny) &&
    !blocked(room, ent.x - r * 0.75, ny)
  ) ent.y = ny;
}
function findFree(room, cx, cy, radius) {
  for (let i = 0; i < 120; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = radius * (0.25 + Math.random() * 0.95);
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d;
    if (!blocked(room, x, y)) return { x, y };
  }
  return { x: cx + radius, y: cy };
}

function createRoom(socket, name) {
  const code = roomCode();
  const room = {
    code,
    hostId: socket.id,
    seed: Math.floor(Math.random() * 999999),
    level: 1,
    xp: 0,
    xpNeed: 10,
    bond: 100,
    crystals: 0,
    crystalsNeed: 3,
    players: {},
    enemies: [],
    crystalsList: [],
    effects: [],
    portal: null,
    bossAlive: false,
    waveTimer: 2.5,
    message: 'Salon créé. Envoie le code à ton pote.',
    messageTimer: 5,
    gameOver: false,
    victory: false,
    lastActive: Date.now(),
    nextEnemyId: 1,
    nextEffectId: 1
  };
  rooms.set(code, room);
  addPlayer(room, socket, name);
  spawnLevel(room, true);
  return room;
}

function addPlayer(room, socket, name) {
  const ids = Object.keys(room.players);
  if (ids.length >= MAX_PLAYERS) return false;
  const preset = ROLE_PRESETS[ids.length] || ROLE_PRESETS[ROLE_PRESETS.length - 1];
  const pos = findFree(room, 0, 0, 60 + ids.length * 40);
  room.players[socket.id] = {
    id: socket.id,
    name: safeName(name),
    role: preset.role,
    color: preset.color,
    outfit: preset.outfit,
    hair: preset.hair,
    x: pos.x,
    y: pos.y,
    r: 14,
    hp: 100,
    maxHp: 100,
    speed: 220,
    damage: 20,
    facing: 0,
    attackCd: 0,
    hurtCd: 0,
    invuln: 0,
    dead: false,
    input: { x: 0, y: 0, angle: 0, attack: false }
  };
  socket.join(room.code);
  socketToRoom.set(socket.id, room.code);
  room.message = `${room.players[socket.id].name} a rejoint le salon.`;
  room.messageTimer = 3;
  room.lastActive = Date.now();
  return true;
}

function spawnEnemy(room, x, y, boss = false) {
  const base = ENEMY_TYPES[Math.floor(Math.random() * ENEMY_TYPES.length)];
  const hp = boss ? 260 + room.level * 80 : base.hp + room.level * 12;
  const speed = boss ? 72 + room.level * 1.8 : base.speed + room.level * 2.4;
  const damage = boss ? 18 + room.level * 1.8 : base.damage + room.level * 1.25;
  room.enemies.push({
    id: room.nextEnemyId++,
    type: boss ? 'roi démon' : base.type,
    color: boss ? '#7f1d1d' : base.color,
    x, y,
    r: boss ? 26 : 16,
    hp,
    maxHp: hp,
    speed,
    damage,
    boss,
    hitCd: 0,
    facing: 0,
    attackFlash: 0
  });
}

function pushEffect(room, kind, x, y, data = {}) {
  room.effects.push({
    id: room.nextEffectId++, kind, x, y,
    ttl: data.ttl ?? 0.25,
    angle: data.angle ?? 0,
    radius: data.radius ?? 34,
    color: data.color ?? '#ffffff'
  });
}

function spawnLevel(room, first = false) {
  room.enemies.length = 0;
  room.crystalsList.length = 0;
  room.portal = null;
  room.bossAlive = false;
  room.crystals = 0;
  room.crystalsNeed = Math.min(7, 2 + Math.ceil(room.level / 2));
  room.bond = Math.min(100, room.bond + 14);

  const players = Object.values(room.players);
  const center = players[0] || { x: 0, y: 0 };

  for (const p of players) {
    p.dead = false;
    p.hp = Math.min(p.maxHp, p.hp + 30);
    const pos = findFree(room, center.x, center.y, 50 + Math.random() * 40);
    p.x = pos.x;
    p.y = pos.y;
  }

  for (let i = 0; i < room.crystalsNeed; i++) {
    const pos = findFree(room, center.x, center.y, 420 + i * 170 + room.level * 45);
    room.crystalsList.push({ id: `c${Date.now()}-${i}`, x: pos.x, y: pos.y, taken: false });
  }

  const count = 4 + room.level * 2;
  for (let i = 0; i < count; i++) {
    const pos = findFree(room, center.x, center.y, 450 + Math.random() * 520 + room.level * 60);
    spawnEnemy(room, pos.x, pos.y, false);
  }

  if (room.level % 5 === 0) {
    const pos = findFree(room, center.x, center.y, 850);
    spawnEnemy(room, pos.x, pos.y, true);
    room.bossAlive = true;
    room.message = 'Boss : le roi démon approche.';
    room.messageTimer = 4;
  } else if (!first) {
    room.message = `Niveau ${room.level} : nouveaux ennemis.`;
    room.messageTimer = 3;
  }
}

function nearestAlivePlayer(room, x, y) {
  let best = null;
  let bestD = Infinity;
  for (const p of Object.values(room.players)) {
    if (p.dead) continue;
    const d = dist(x, y, p.x, p.y);
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

function doPlayerAttack(room, p) {
  if (p.attackCd > 0 || p.dead) return;
  p.attackCd = 0.42;
  pushEffect(room, 'slash', p.x, p.y, { ttl: 0.18, angle: p.facing, radius: 44, color: p.color });

  for (let i = room.enemies.length - 1; i >= 0; i--) {
    const e = room.enemies[i];
    const d = dist(p.x, p.y, e.x, e.y);
    const a = Math.atan2(e.y - p.y, e.x - p.x);
    if (d < 72 + e.r && angDiff(a, p.facing) < 1.0) {
      const damage = p.damage + room.level * 2 + (room.bond > 70 ? 6 : 0);
      e.hp -= damage;
      e.attackFlash = 0.18;
      e.x += Math.cos(a) * 16;
      e.y += Math.sin(a) * 16;
      pushEffect(room, 'hit', e.x, e.y, { ttl: 0.2, radius: 18, color: '#f8fafc' });
      if (e.hp <= 0) {
        room.xp += e.boss ? 12 + room.level * 2 : 2;
        if (e.boss) {
          room.bossAlive = false;
          room.message = 'Boss vaincu. Le portail peut s’ouvrir.';
          room.messageTimer = 4;
        }
        room.enemies.splice(i, 1);
      }
    }
  }
}

function levelUp(room) {
  while (room.xp >= room.xpNeed) {
    room.xp -= room.xpNeed;
    room.xpNeed = Math.floor(room.xpNeed * 1.4 + 5);
    room.bond = Math.min(100, room.bond + 12);
    for (const p of Object.values(room.players)) {
      p.maxHp += 8;
      p.hp = Math.min(p.maxHp, p.hp + 20);
      p.damage += 3;
      p.speed += 2;
    }
    room.message = 'Le groupe gagne en puissance.';
    room.messageTimer = 3;
  }
}

function tickRoom(room) {
  if (room.gameOver || room.victory) return;
  room.lastActive = Date.now();
  room.waveTimer -= DT;
  room.messageTimer = Math.max(0, room.messageTimer - DT);

  for (let i = room.effects.length - 1; i >= 0; i--) {
    room.effects[i].ttl -= DT;
    if (room.effects[i].ttl <= 0) room.effects.splice(i, 1);
  }

  const players = Object.values(room.players);
  const alive = players.filter(p => !p.dead);
  if (!players.length) return;

  for (const p of players) {
    p.attackCd = Math.max(0, p.attackCd - DT);
    p.hurtCd = Math.max(0, p.hurtCd - DT);
    p.invuln = Math.max(0, p.invuln - DT);
    if (p.dead) continue;
    const inp = p.input || { x: 0, y: 0, angle: 0, attack: false };
    let ix = clamp(inp.x || 0, -1, 1);
    let iy = clamp(inp.y || 0, -1, 1);
    const len = Math.hypot(ix, iy);
    if (len > 1) { ix /= len; iy /= len; }

    if (typeof inp.angle === 'number') p.facing = inp.angle;
    if (ix || iy) p.facing = Math.atan2(iy, ix);

    moveWithCollision(room, p, ix * p.speed * DT, iy * p.speed * DT);
    if (inp.attack) doPlayerAttack(room, p);

    const tile = tileType(room, p.x, p.y);
    if (tile === 'lava' && p.invuln <= 0) {
      p.invuln = 0.6;
      p.hp -= 6 + room.level * 0.75;
      pushEffect(room, 'hit', p.x, p.y, { ttl: 0.2, radius: 14, color: '#fb923c' });
    }

    if (p.hp <= 0 && !p.dead) {
      p.dead = true;
      room.bond = Math.max(0, room.bond - 20);
      room.message = `${p.name} est tombé.`;
      room.messageTimer = 3;
      pushEffect(room, 'burst', p.x, p.y, { ttl: 0.35, radius: 26, color: '#ef4444' });
    }
  }

  // prince-princesse bond
  const prince = players.find(p => p.role === 'Prince');
  const princesse = players.find(p => p.role === 'Princesse');
  if (prince && princesse && !prince.dead && !princesse.dead) {
    const d = dist(prince.x, prince.y, princesse.x, princesse.y);
    if (d > 740) room.bond = Math.max(0, room.bond - DT * 2.3);
    else if (d < 180) {
      room.bond = Math.min(100, room.bond + DT * 1.4);
      prince.hp = Math.min(prince.maxHp, prince.hp + DT * 1.2);
      princesse.hp = Math.min(princesse.maxHp, princesse.hp + DT * 1.2);
    }
  }

  for (const c of room.crystalsList) {
    if (c.taken) continue;
    for (const p of players) {
      if (!p.dead && dist(p.x, p.y, c.x, c.y) < 30) {
        c.taken = true;
        room.crystals++;
        room.xp += 2;
        room.bond = Math.min(100, room.bond + 4);
        pushEffect(room, 'crystal', c.x, c.y, { ttl: 0.3, radius: 24, color: '#67e8f9' });
        room.message = `Cristaux ${room.crystals}/${room.crystalsNeed}`;
        room.messageTimer = 2.2;
        break;
      }
    }
  }

  if (!room.portal && room.crystals >= room.crystalsNeed && !room.bossAlive) {
    const anchor = alive[0] || players[0];
    const pos = findFree(room, anchor.x, anchor.y, 420);
    room.portal = { x: pos.x, y: pos.y, r: 42 };
    room.message = 'Portail ouvert. Entrez tous dedans.';
    room.messageTimer = 3.5;
    pushEffect(room, 'portal', pos.x, pos.y, { ttl: 0.6, radius: 48, color: '#a78bfa' });
  }

  if (room.portal && alive.length) {
    const allInside = alive.every(p => dist(p.x, p.y, room.portal.x, room.portal.y) < 64);
    if (allInside) {
      room.level++;
      if (room.level > 12) {
        room.victory = true;
        room.message = 'Victoire : le couple a survécu à l’aventure.';
        room.messageTimer = 999;
      } else {
        spawnLevel(room, false);
      }
    }
  }

  if (room.waveTimer <= 0) {
    room.waveTimer = Math.max(2.8, 6.2 - room.level * 0.22);
    if (room.enemies.length < 12 + room.level * 2 && alive[0]) {
      const pos = findFree(room, alive[0].x, alive[0].y, 600 + Math.random() * 260);
      spawnEnemy(room, pos.x, pos.y, false);
    }
  }

  for (const e of room.enemies) {
    e.hitCd = Math.max(0, e.hitCd - DT);
    e.attackFlash = Math.max(0, e.attackFlash - DT);
    const target = nearestAlivePlayer(room, e.x, e.y);
    if (!target) continue;
    const a = Math.atan2(target.y - e.y, target.x - e.x);
    e.facing = a;
    const d = dist(e.x, e.y, target.x, target.y);
    if (d < 900) moveWithCollision(room, e, Math.cos(a) * e.speed * DT, Math.sin(a) * e.speed * DT);

    if (e.hitCd <= 0 && d < e.r + target.r + 10) {
      e.hitCd = e.boss ? 0.7 : 0.95;
      if (target.invuln <= 0) {
        target.invuln = 0.55;
        target.hp -= e.damage;
        room.bond = Math.max(0, room.bond - 0.6);
        pushEffect(room, 'hit', target.x, target.y, { ttl: 0.16, radius: 14, color: '#ef4444' });
      }
    }
  }

  levelUp(room);

  if (room.bond <= 0 || players.every(p => p.dead)) {
    room.gameOver = true;
    room.message = 'Défaite : le lien du couple s’est brisé.';
    room.messageTimer = 999;
  }
}

function publicState(room) {
  return {
    code: room.code,
    seed: room.seed,
    level: room.level,
    xp: room.xp,
    xpNeed: room.xpNeed,
    bond: room.bond,
    crystals: room.crystals,
    crystalsNeed: room.crystalsNeed,
    players: Object.values(room.players).map(p => ({
      id: p.id, name: p.name, role: p.role,
      color: p.color, outfit: p.outfit, hair: p.hair,
      x: p.x, y: p.y, r: p.r,
      hp: p.hp, maxHp: p.maxHp,
      facing: p.facing, invuln: p.invuln, attackCd: p.attackCd,
      dead: p.dead
    })),
    enemies: room.enemies.map(e => ({
      id: e.id, type: e.type, color: e.color,
      x: e.x, y: e.y, r: e.r,
      hp: e.hp, maxHp: e.maxHp,
      facing: e.facing, boss: e.boss, attackFlash: e.attackFlash
    })),
    crystalsList: room.crystalsList,
    effects: room.effects,
    portal: room.portal,
    bossAlive: room.bossAlive,
    message: room.messageTimer > 0 ? room.message : '',
    gameOver: room.gameOver,
    victory: room.victory
  };
}

io.on('connection', socket => {
  socket.on('createRoom', ({ name } = {}, cb) => {
    const room = createRoom(socket, name);
    cb?.({ ok: true, code: room.code, id: socket.id });
  });

  socket.on('joinRoom', ({ code, name } = {}, cb) => {
    const room = rooms.get(String(code || '').toUpperCase().trim());
    if (!room) return cb?.({ ok: false, error: 'Salon introuvable.' });
    if (Object.keys(room.players).length >= MAX_PLAYERS) return cb?.({ ok: false, error: 'Salon complet.' });
    const ok = addPlayer(room, socket, name);
    if (!ok) return cb?.({ ok: false, error: 'Impossible de rejoindre.' });
    cb?.({ ok: true, code: room.code, id: socket.id });
  });

  socket.on('input', inp => {
    const code = socketToRoom.get(socket.id);
    const room = code && rooms.get(code);
    const p = room && room.players[socket.id];
    if (!p) return;
    p.input = {
      x: Number(inp?.x || 0),
      y: Number(inp?.y || 0),
      angle: Number(inp?.angle || 0),
      attack: !!inp?.attack
    };
  });

  socket.on('restart', () => {
    const code = socketToRoom.get(socket.id);
    const room = code && rooms.get(code);
    if (!room || room.hostId !== socket.id) return;

    const saved = Object.values(room.players).map(p => ({ id: p.id, name: p.name }));
    const fresh = {
      code: room.code,
      hostId: room.hostId,
      seed: Math.floor(Math.random() * 999999),
      level: 1,
      xp: 0,
      xpNeed: 10,
      bond: 100,
      crystals: 0,
      crystalsNeed: 3,
      players: {},
      enemies: [],
      crystalsList: [],
      effects: [],
      portal: null,
      bossAlive: false,
      waveTimer: 2.5,
      message: 'Partie relancée.',
      messageTimer: 3,
      gameOver: false,
      victory: false,
      lastActive: Date.now(),
      nextEnemyId: 1,
      nextEffectId: 1
    };
    rooms.set(room.code, fresh);
    for (const sp of saved) {
      const s = io.sockets.sockets.get(sp.id);
      if (s) addPlayer(fresh, s, sp.name);
    }
    spawnLevel(fresh, true);
  });

  socket.on('disconnect', () => {
    const code = socketToRoom.get(socket.id);
    socketToRoom.delete(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    const p = room.players[socket.id];
    delete room.players[socket.id];
    if (p) {
      room.message = `${p.name} a quitté le salon.`;
      room.messageTimer = 3;
    }
    if (!Object.keys(room.players).length) room.lastActive = Date.now() - 1000 * 60 * 30;
    else if (room.hostId === socket.id) room.hostId = Object.keys(room.players)[0];
  });
});

setInterval(() => {
  for (const [code, room] of rooms) {
    if (!Object.keys(room.players).length && Date.now() - room.lastActive > 1000 * 60 * 10) {
      rooms.delete(code);
      continue;
    }
    tickRoom(room);
    io.to(code).emit('state', publicState(room));
  }
}, 1000 / TICK);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`LDT Love Adventure RPG lancé sur http://localhost:${PORT}`);
});
