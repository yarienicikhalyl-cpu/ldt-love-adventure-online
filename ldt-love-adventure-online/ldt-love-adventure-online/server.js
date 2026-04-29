const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingTimeout: 20000,
  pingInterval: 8000
});

const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();
const socketRoom = new Map();

const TICK_RATE = 30;
const DT = 1 / TICK_RATE;
const MAX_PLAYERS = 4;

const COLORS = ["#facc15", "#fb7185", "#60a5fa", "#34d399"];
const ROLES = ["Prince", "Princesse", "Chevalier", "Mage"];

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = "";
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function rnd(min, max) {
  return min + Math.random() * (max - min);
}

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
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

function tileType(room, wx, wy) {
  const tx = Math.floor(wx / 96);
  const ty = Math.floor(wy / 96);
  const n = noiseTile(tx, ty, room.seed);
  if (room.level >= 8 && n > 0.91) return "lava";
  if (n < 0.075) return "water";
  if (n > 0.84) return "rock";
  if (Math.abs(tx) % 11 === 0 && n > 0.55) return "path";
  if (Math.abs(ty) % 13 === 0 && n > 0.5) return "path";
  return "grass";
}

function blocked(room, x, y) {
  const t = tileType(room, x, y);
  return t === "water" || t === "rock";
}

function moveWithCollision(room, obj, dx, dy) {
  const r = obj.r || 16;
  const nx = obj.x + dx;
  if (
    !blocked(room, nx + Math.sign(dx || 1) * r, obj.y) &&
    !blocked(room, nx, obj.y + r * 0.75) &&
    !blocked(room, nx, obj.y - r * 0.75)
  ) obj.x = nx;

  const ny = obj.y + dy;
  if (
    !blocked(room, obj.x, ny + Math.sign(dy || 1) * r) &&
    !blocked(room, obj.x + r * 0.75, ny) &&
    !blocked(room, obj.x - r * 0.75, ny)
  ) obj.y = ny;
}

function findFreeAround(room, cx, cy, radius) {
  for (let i = 0; i < 90; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = radius * (0.35 + Math.random() * 0.8);
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d;
    if (!blocked(room, x, y)) return { x, y };
  }
  return { x: cx + radius, y: cy };
}

function safeName(name) {
  return String(name || "Joueur")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 18) || "Joueur";
}

function createRoom(hostSocket, name) {
  const code = makeCode();
  const room = {
    code,
    hostId: hostSocket.id,
    seed: Math.floor(Math.random() * 999999),
    level: 1,
    xp: 0,
    xpNeed: 8,
    love: 100,
    crystals: 0,
    crystalsNeed: 3,
    players: {},
    enemies: [],
    crystalsList: [],
    portal: null,
    bossAlive: false,
    spawnTimer: 2,
    message: "Salon créé. Partage le code à ton pote.",
    messageTimer: 4,
    gameOver: false,
    victory: false,
    lastActive: Date.now()
  };
  rooms.set(code, room);
  addPlayerToRoom(room, hostSocket, name);
  spawnLevel(room, true);
  return room;
}

function addPlayerToRoom(room, socket, name) {
  const ids = Object.keys(room.players);
  if (ids.length >= MAX_PLAYERS) return false;

  const index = ids.length;
  const p = findFreeAround(room, 0, 0, 40 + index * 35);
  room.players[socket.id] = {
    id: socket.id,
    name: safeName(name),
    role: ROLES[index] || "Héros",
    color: COLORS[index % COLORS.length],
    x: p.x,
    y: p.y,
    r: 16,
    hp: 100,
    maxHp: 100,
    speed: 245,
    damage: 25,
    facing: 0,
    attackCd: 0,
    invuln: 0,
    input: { x: 0, y: 0, angle: 0, attack: false },
    dead: false
  };
  socket.join(room.code);
  socketRoom.set(socket.id, room.code);
  room.lastActive = Date.now();
  room.message = `${room.players[socket.id].name} a rejoint le salon.`;
  room.messageTimer = 3;
  return true;
}

function spawnEnemy(room, x, y, boss = false) {
  const elite = !boss && Math.random() < Math.min(0.35, room.level * 0.035);
  const hp = boss ? 260 + room.level * 70 : elite ? 60 + room.level * 15 : 38 + room.level * 10;
  const speed = boss ? 75 + room.level * 2.2 : elite ? 98 + room.level * 4.2 : 82 + room.level * 3.2;
  const damage = boss ? 18 + room.level * 2.1 : elite ? 13 + room.level * 1.4 : 8 + room.level * 1.2;

  room.enemies.push({
    id: Math.random().toString(36).slice(2),
    x, y,
    r: boss ? 31 : elite ? 20 : 16,
    hp, maxHp: hp,
    speed, damage,
    boss, elite,
    hitCd: 0,
    wobble: Math.random() * 10
  });
}

function spawnLevel(room, first = false) {
  room.enemies = [];
  room.crystalsList = [];
  room.portal = null;
  room.bossAlive = false;
  room.crystals = 0;
  room.crystalsNeed = Math.min(9, 2 + Math.ceil(room.level / 2));
  room.love = Math.min(100, room.love + 18);

  const alivePlayers = Object.values(room.players).filter(p => !p.dead);
  const center = alivePlayers[0] || { x: 0, y: 0 };

  for (const p of Object.values(room.players)) {
    p.hp = Math.min(p.maxHp, p.hp + 30);
    p.dead = false;
  }

  for (let i = 0; i < room.crystalsNeed; i++) {
    const pos = findFreeAround(room, center.x, center.y, 500 + i * 170 + room.level * 40);
    room.crystalsList.push({ id: "c" + i + "-" + Date.now(), x: pos.x, y: pos.y, taken: false });
  }

  const count = 4 + room.level * 2;
  for (let i = 0; i < count; i++) {
    const pos = findFreeAround(room, center.x, center.y, 450 + Math.random() * (700 + room.level * 85));
    spawnEnemy(room, pos.x, pos.y, false);
  }

  if (room.level % 5 === 0) {
    const pos = findFreeAround(room, center.x, center.y, 950);
    spawnEnemy(room, pos.x, pos.y, true);
    room.bossAlive = true;
    room.message = "Boss royal détecté ! Restez ensemble.";
    room.messageTimer = 4;
  } else if (!first) {
    room.message = `Niveau ${room.level} : les monstres deviennent plus violents.`;
    room.messageTimer = 3.5;
  }
}

function doAttack(room, p) {
  if (p.attackCd > 0 || p.dead) return;
  p.attackCd = 0.35;

  let hit = false;
  for (let i = room.enemies.length - 1; i >= 0; i--) {
    const e = room.enemies[i];
    const d = dist(p.x, p.y, e.x, e.y);
    const angle = Math.atan2(e.y - p.y, e.x - p.x);
    const diff = Math.abs(Math.atan2(Math.sin(angle - p.facing), Math.cos(angle - p.facing)));

    if (d < 82 + e.r && diff < 1.25) {
      const dmg = p.damage + room.level * 2 + (room.love > 70 ? 7 : 0);
      e.hp -= dmg;
      e.x += Math.cos(angle) * 18;
      e.y += Math.sin(angle) * 18;
      hit = true;

      if (e.hp <= 0) {
        room.xp += e.boss ? 10 + room.level * 2 : e.elite ? 3 : 1;
        if (e.boss) {
          room.bossAlive = false;
          room.message = "Boss vaincu ! Le portail peut s'ouvrir.";
          room.messageTimer = 3.5;
        }
        room.enemies.splice(i, 1);
      }
    }
  }

  if (hit) {
    io.to(room.code).emit("hitFx", { x: p.x + Math.cos(p.facing) * 48, y: p.y + Math.sin(p.facing) * 48 });
  }
}

function levelUp(room) {
  while (room.xp >= room.xpNeed) {
    room.xp -= room.xpNeed;
    room.xpNeed = Math.floor(room.xpNeed * 1.45 + 4);
    room.love = Math.min(100, room.love + 15);
    for (const p of Object.values(room.players)) {
      p.maxHp += 8;
      p.hp = Math.min(p.maxHp, p.hp + 35);
      p.damage += 3;
      p.speed += 3;
    }
    room.message = "Votre groupe devient plus fort : PV, dégâts et vitesse augmentés.";
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

function tickRoom(room) {
  if (room.gameOver || room.victory) return;

  room.lastActive = Date.now();
  room.spawnTimer -= DT;
  room.messageTimer = Math.max(0, room.messageTimer - DT);

  const players = Object.values(room.players);
  const alive = players.filter(p => !p.dead);

  if (players.length === 0) return;

  for (const p of players) {
    p.attackCd = Math.max(0, p.attackCd - DT);
    p.invuln = Math.max(0, p.invuln - DT);

    if (p.dead) continue;

    const input = p.input || { x: 0, y: 0, angle: 0, attack: false };
    let ix = Math.max(-1, Math.min(1, input.x || 0));
    let iy = Math.max(-1, Math.min(1, input.y || 0));
    const len = Math.hypot(ix, iy) || 1;
    ix /= len; iy /= len;

    if (typeof input.angle === "number") p.facing = input.angle;
    if (ix || iy) p.facing = Math.atan2(iy, ix);

    moveWithCollision(room, p, ix * p.speed * DT, iy * p.speed * DT);

    if (input.attack) doAttack(room, p);

    const currentTile = tileType(room, p.x, p.y);
    if (currentTile === "lava" && p.invuln <= 0) {
      p.invuln = 0.7;
      p.hp -= 8 + room.level * 0.75;
    }

    if (p.hp <= 0) {
      p.dead = true;
      room.love -= 18;
      room.message = `${p.name} est tombé. Protégez le couple !`;
      room.messageTimer = 3;
    }
  }

  if (alive.length >= 2) {
    let maxPair = 0;
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        maxPair = Math.max(maxPair, dist(alive[i].x, alive[i].y, alive[j].x, alive[j].y));
      }
    }
    if (maxPair > 760) {
      room.love = Math.max(0, room.love - DT * 2.2);
    } else if (maxPair < 170) {
      room.love = Math.min(100, room.love + DT * 1.1);
      for (const p of alive) {
        if (p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + DT * 2.2);
      }
    }
  }

  for (const c of room.crystalsList) {
    if (c.taken) continue;
    for (const p of Object.values(room.players)) {
      if (!p.dead && dist(p.x, p.y, c.x, c.y) < 38) {
        c.taken = true;
        room.crystals++;
        room.xp += 2;
        room.love = Math.min(100, room.love + 6);
        room.message = `Cristal récupéré : ${room.crystals}/${room.crystalsNeed}`;
        room.messageTimer = 2.5;
        io.to(room.code).emit("crystalFx", { x: c.x, y: c.y });
        break;
      }
    }
  }

  if (!room.portal && room.crystals >= room.crystalsNeed && !room.bossAlive) {
    const p = alive[0] || players[0];
    const pos = findFreeAround(room, p.x, p.y, 460);
    room.portal = { x: pos.x, y: pos.y, r: 45 };
    room.message = "Portail ouvert ! Entrez dedans ensemble.";
    room.messageTimer = 3.5;
    io.to(room.code).emit("portalFx", { x: pos.x, y: pos.y });
  }

  if (room.portal) {
    let inside = alive.length > 0 && alive.every(p => dist(p.x, p.y, room.portal.x, room.portal.y) < 70);
    if (inside) {
      room.level++;
      if (room.level > 15) {
        room.victory = true;
        room.message = "Victoire : le prince et la princesse ont survécu au monde infini.";
        room.messageTimer = 999;
      } else {
        for (const p of players) {
          p.x = room.portal.x + rnd(-45, 45);
          p.y = room.portal.y + rnd(-45, 45);
          p.dead = false;
          p.hp = Math.max(30, p.hp);
        }
        spawnLevel(room, false);
      }
    }
  }

  if (room.spawnTimer <= 0) {
    room.spawnTimer = Math.max(2.4, 6.5 - room.level * 0.25);
    if (room.enemies.length < 10 + room.level * 2 && alive[0]) {
      const pos = findFreeAround(room, alive[0].x, alive[0].y, 620 + Math.random() * 420);
      spawnEnemy(room, pos.x, pos.y, false);
    }
  }

  for (const e of room.enemies) {
    e.hitCd = Math.max(0, e.hitCd - DT);
    e.wobble += DT * 5;

    const target = nearestAlivePlayer(room, e.x, e.y);
    if (!target) continue;

    const d = dist(e.x, e.y, target.x, target.y);
    if (d < 900 || e.boss) {
      const a = Math.atan2(target.y - e.y, target.x - e.x);
      const side = Math.sin(e.wobble) * 0.35;
      moveWithCollision(room, e, Math.cos(a + side) * e.speed * DT, Math.sin(a + side) * e.speed * DT);
    }

    for (const p of Object.values(room.players)) {
      if (p.dead) continue;
      if (e.hitCd <= 0 && dist(e.x, e.y, p.x, p.y) < e.r + p.r + 8) {
        e.hitCd = e.boss ? 0.72 : 0.95;
        if (p.invuln <= 0) {
          p.invuln = 0.5;
          p.hp -= e.damage;
          room.love = Math.max(0, room.love - 0.8);
        }
      }
    }
  }

  levelUp(room);

  if (room.love <= 0 || Object.values(room.players).every(p => p.dead)) {
    room.gameOver = true;
    room.message = "Défaite : le lien du couple a été brisé.";
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
    love: room.love,
    crystals: room.crystals,
    crystalsNeed: room.crystalsNeed,
    players: Object.values(room.players).map(p => ({
      id: p.id, name: p.name, role: p.role, color: p.color,
      x: p.x, y: p.y, r: p.r,
      hp: p.hp, maxHp: p.maxHp,
      facing: p.facing, dead: p.dead, invuln: p.invuln
    })),
    enemies: room.enemies.map(e => ({
      id: e.id, x: e.x, y: e.y, r: e.r,
      hp: e.hp, maxHp: e.maxHp, boss: e.boss, elite: e.elite
    })),
    crystalsList: room.crystalsList,
    portal: room.portal,
    bossAlive: room.bossAlive,
    message: room.messageTimer > 0 ? room.message : "",
    gameOver: room.gameOver,
    victory: room.victory
  };
}

io.on("connection", socket => {
  socket.on("createRoom", ({ name } = {}, cb) => {
    const room = createRoom(socket, name);
    cb?.({ ok: true, code: room.code, id: socket.id });
  });

  socket.on("joinRoom", ({ code, name } = {}, cb) => {
    code = String(code || "").toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return cb?.({ ok: false, error: "Salon introuvable." });
    if (Object.keys(room.players).length >= MAX_PLAYERS) return cb?.({ ok: false, error: "Salon complet." });

    const oldCode = socketRoom.get(socket.id);
    if (oldCode && rooms.has(oldCode)) {
      delete rooms.get(oldCode).players[socket.id];
      socket.leave(oldCode);
    }

    const ok = addPlayerToRoom(room, socket, name);
    if (!ok) return cb?.({ ok: false, error: "Impossible de rejoindre." });

    cb?.({ ok: true, code: room.code, id: socket.id });
  });

  socket.on("input", input => {
    const code = socketRoom.get(socket.id);
    const room = code && rooms.get(code);
    const p = room && room.players[socket.id];
    if (!p) return;

    p.input = {
      x: Number(input?.x || 0),
      y: Number(input?.y || 0),
      angle: Number(input?.angle || 0),
      attack: !!input?.attack
    };
  });

  socket.on("restart", () => {
    const code = socketRoom.get(socket.id);
    const old = code && rooms.get(code);
    if (!old) return;
    if (old.hostId !== socket.id) return;

    const savedPlayers = Object.values(old.players).map(p => ({ socketId: p.id, name: p.name }));
    const newRoom = {
      code: old.code,
      hostId: old.hostId,
      seed: Math.floor(Math.random() * 999999),
      level: 1,
      xp: 0,
      xpNeed: 8,
      love: 100,
      crystals: 0,
      crystalsNeed: 3,
      players: {},
      enemies: [],
      crystalsList: [],
      portal: null,
      bossAlive: false,
      spawnTimer: 2,
      message: "Partie relancée.",
      messageTimer: 4,
      gameOver: false,
      victory: false,
      lastActive: Date.now()
    };
    rooms.set(old.code, newRoom);
    for (const sp of savedPlayers) {
      const s = io.sockets.sockets.get(sp.socketId);
      if (s) addPlayerToRoom(newRoom, s, sp.name);
    }
    spawnLevel(newRoom, true);
  });

  socket.on("disconnect", () => {
    const code = socketRoom.get(socket.id);
    socketRoom.delete(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    const p = room.players[socket.id];
    delete room.players[socket.id];
    if (p) {
      room.message = `${p.name} a quitté le salon.`;
      room.messageTimer = 4;
    }

    if (Object.keys(room.players).length === 0) {
      room.lastActive = Date.now() - 1000 * 60 * 20;
    } else if (room.hostId === socket.id) {
      room.hostId = Object.keys(room.players)[0];
    }
  });
});

setInterval(() => {
  for (const [code, room] of rooms) {
    if (Object.keys(room.players).length === 0 && Date.now() - room.lastActive > 1000 * 60 * 10) {
      rooms.delete(code);
      continue;
    }
    tickRoom(room);
    io.to(code).emit("state", publicState(room));
  }
}, 1000 / TICK_RATE);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`LDT Love Adventure Online lancé sur http://localhost:${PORT}`);
});
