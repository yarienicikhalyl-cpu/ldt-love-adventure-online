const socket = io();

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const menu = document.getElementById('menu');
const endScreen = document.getElementById('endScreen');
const endIcon = document.getElementById('endIcon');
const endTitle = document.getElementById('endTitle');
const endText = document.getElementById('endText');
const restartBtn = document.getElementById('restartBtn');
const backBtn = document.getElementById('backBtn');

const nameInput = document.getElementById('nameInput');
const codeInput = document.getElementById('codeInput');
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const errorText = document.getElementById('errorText');
const copyBtn = document.getElementById('copyBtn');
const messageBox = document.getElementById('messageBox');

const roomText = document.getElementById('roomText');
const hpFill = document.getElementById('hpFill');
const hpTxt = document.getElementById('hpTxt');
const bondFill = document.getElementById('bondFill');
const bondTxt = document.getElementById('bondTxt');
const xpFill = document.getElementById('xpFill');
const xpTxt = document.getElementById('xpTxt');
const levelTxt = document.getElementById('levelTxt');
const crystalTxt = document.getElementById('crystalTxt');
const playersTxt = document.getElementById('playersTxt');
const monsterTxt = document.getElementById('monsterTxt');

const stickZone = document.getElementById('stickZone');
const stick = document.getElementById('stick');
const attackBtn = document.getElementById('attackBtn');

let myId = null;
let myRoomCode = '';
let state = null;
let cam = { x: 0, y: 0, zoom: 1 };
let mouse = { x: 0, y: 0 };
const keys = new Set();
let mobileMove = { x: 0, y: 0 };
let attackPressed = false;
let showAttackPulse = 0;

const isMobile = () => matchMedia('(max-width: 980px)').matches;

function resize() {
  canvas.width = innerWidth * devicePixelRatio;
  canvas.height = innerHeight * devicePixelRatio;
  canvas.style.width = innerWidth + 'px';
  canvas.style.height = innerHeight + 'px';
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}
resize();
addEventListener('resize', resize);

function getMyPlayer() {
  return state?.players?.find(p => p.id === myId) || null;
}

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

function worldToScreen(x, y) {
  return {
    x: (x - cam.x) * cam.zoom + innerWidth / 2,
    y: (y - cam.y) * cam.zoom + innerHeight / 2
  };
}
function screenToWorld(x, y) {
  return {
    x: (x - innerWidth / 2) / cam.zoom + cam.x,
    y: (y - innerHeight / 2) / cam.zoom + cam.y
  };
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
function getTile(seed, x, y, level = 1) {
  const tx = Math.floor(x / 96);
  const ty = Math.floor(y / 96);
  const n = noiseTile(tx, ty, seed);
  if (level >= 7 && n > 0.93) return 'lava';
  if (n < 0.06) return 'water';
  if (n > 0.875) return 'rock';
  if (Math.abs(tx) % 10 === 0 && n > 0.5) return 'path';
  if (Math.abs(ty) % 12 === 0 && n > 0.48) return 'path';
  return 'grass';
}

function tileColor(type) {
  switch (type) {
    case 'water': return '#113255';
    case 'rock': return '#3a4048';
    case 'path': return '#6b5a43';
    case 'lava': return '#6b1f1f';
    default: return '#16311c';
  }
}

function uiError(text) { errorText.textContent = text || ''; }

createBtn.onclick = () => {
  const name = (nameInput.value || '').trim() || 'Joueur';
  socket.emit('createRoom', { name }, res => {
    if (!res?.ok) return uiError(res?.error || 'Erreur.');
    myId = res.id;
    myRoomCode = res.code;
    menu.classList.add('hidden');
    uiError('');
  });
};

joinBtn.onclick = () => {
  const name = (nameInput.value || '').trim() || 'Joueur';
  const code = (codeInput.value || '').trim().toUpperCase();
  if (!code) return uiError('Mets un code de salon.');
  socket.emit('joinRoom', { name, code }, res => {
    if (!res?.ok) return uiError(res?.error || 'Impossible de rejoindre.');
    myId = res.id;
    myRoomCode = res.code;
    menu.classList.add('hidden');
    uiError('');
  });
};

copyBtn.onclick = async () => {
  if (!myRoomCode) return;
  try {
    await navigator.clipboard.writeText(myRoomCode);
    flashMessage(`Code copié : ${myRoomCode}`);
  } catch {
    flashMessage(myRoomCode);
  }
};

restartBtn.onclick = () => socket.emit('restart');
backBtn.onclick = () => location.reload();

socket.on('state', s => {
  state = s;
  myRoomCode = s.code || myRoomCode;
  updateHud();

  if (s.message) flashMessage(s.message, true);

  if (s.gameOver || s.victory) {
    endScreen.classList.remove('hidden');
    endTitle.textContent = s.victory ? 'Victoire' : 'Défaite';
    endText.textContent = s.victory
      ? 'Vous avez terminé l’aventure et protégé le couple royal.'
      : 'Le groupe a été vaincu ou le lien du couple est tombé à zéro.';
    endIcon.textContent = s.victory ? '🏆' : '💀';
  } else {
    endScreen.classList.add('hidden');
  }
});

let messageTimeout = 0;
function flashMessage(text, soft = false) {
  clearTimeout(messageTimeout);
  messageBox.textContent = text;
  messageBox.classList.add('show');
  messageTimeout = setTimeout(() => {
    if (!soft) messageBox.classList.remove('show');
  }, 1800);
}

function updateHud() {
  const me = getMyPlayer();
  roomText.textContent = myRoomCode ? `Salon : ${myRoomCode}` : 'Pas connecté';
  levelTxt.textContent = state?.level ?? 1;
  crystalTxt.textContent = `${state?.crystals ?? 0}/${state?.crystalsNeed ?? 0}`;
  playersTxt.textContent = state?.players?.length ?? 0;
  monsterTxt.textContent = state?.enemies?.length ?? 0;

  const hp = me ? Math.max(0, me.hp) : 0;
  const maxHp = me?.maxHp || 100;
  hpFill.style.width = `${(hp / maxHp) * 100}%`;
  hpTxt.textContent = `${Math.ceil(hp)}/${Math.ceil(maxHp)}`;

  const bond = state?.bond ?? 0;
  bondFill.style.width = `${bond}%`;
  bondTxt.textContent = `${Math.floor(bond)}/100`;

  const xp = state?.xp ?? 0;
  const xpNeed = state?.xpNeed ?? 1;
  xpFill.style.width = `${(xp / xpNeed) * 100}%`;
  xpTxt.textContent = `${Math.floor(xp)}/${Math.floor(xpNeed)}`;
}

addEventListener('keydown', e => {
  keys.add(e.key.toLowerCase());
  if (e.key === ' ') {
    e.preventDefault();
    attackPressed = true;
    showAttackPulse = .18;
  }
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
canvas.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
canvas.addEventListener('mousedown', () => {
  attackPressed = true;
  showAttackPulse = .18;
});

// mobile joystick
let stickActive = false;
let stickPointerId = null;
const stickCenter = { x: 66, y: 66 };
let stickPos = { x: 0, y: 0 };

function setStickVisual(x, y) {
  stick.style.transform = `translate(${x}px, ${y}px)`;
}
setStickVisual(0, 0);

function handleStick(clientX, clientY) {
  const rect = stickZone.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let dx = clientX - cx;
  let dy = clientY - cy;
  const max = rect.width / 2 - 25;
  const len = Math.hypot(dx, dy);
  if (len > max) {
    dx = dx / len * max;
    dy = dy / len * max;
  }
  stickPos = { x: dx, y: dy };
  mobileMove.x = clamp(dx / max, -1, 1);
  mobileMove.y = clamp(dy / max, -1, 1);
  setStickVisual(dx, dy);
}

stickZone.addEventListener('pointerdown', e => {
  stickActive = true;
  stickPointerId = e.pointerId;
  stickZone.setPointerCapture(e.pointerId);
  handleStick(e.clientX, e.clientY);
});
stickZone.addEventListener('pointermove', e => {
  if (!stickActive || e.pointerId !== stickPointerId) return;
  handleStick(e.clientX, e.clientY);
});
function releaseStick(e) {
  if (e.pointerId !== stickPointerId) return;
  stickActive = false;
  stickPointerId = null;
  mobileMove.x = 0;
  mobileMove.y = 0;
  setStickVisual(0, 0);
}
stickZone.addEventListener('pointerup', releaseStick);
stickZone.addEventListener('pointercancel', releaseStick);

attackBtn.addEventListener('pointerdown', e => {
  e.preventDefault();
  attackPressed = true;
  showAttackPulse = .18;
});

function getInputVector() {
  let x = 0;
  let y = 0;
  if (keys.has('z') || keys.has('arrowup') || keys.has('w')) y -= 1;
  if (keys.has('s') || keys.has('arrowdown')) y += 1;
  if (keys.has('q') || keys.has('arrowleft') || keys.has('a')) x -= 1;
  if (keys.has('d') || keys.has('arrowright')) x += 1;
  if (isMobile()) {
    x = mobileMove.x;
    y = mobileMove.y;
  }
  const len = Math.hypot(x, y);
  if (len > 1) { x /= len; y /= len; }
  return { x, y };
}

setInterval(() => {
  const me = getMyPlayer();
  if (!myId || !state || !me) return;
  const move = getInputVector();
  const target = screenToWorld(mouse.x || innerWidth / 2, mouse.y || innerHeight / 2);
  let angle = Math.atan2(target.y - me.y, target.x - me.x);
  if (isMobile()) {
    if (Math.hypot(move.x, move.y) > 0.1) angle = Math.atan2(move.y, move.x);
  }
  socket.emit('input', { x: move.x, y: move.y, angle, attack: attackPressed });
  attackPressed = false;
}, 1000 / 30);

function drawRoundedRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawShadow(x, y, rx, ry, alpha = .25) {
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawHumanoid(p, isMe) {
  const s = worldToScreen(p.x, p.y);
  const scale = cam.zoom;
  const bob = Math.sin(performance.now() / 140 + p.x * .01) * 2;
  const dead = p.dead;

  ctx.save();
  ctx.translate(s.x, s.y);
  if (dead) ctx.rotate(Math.PI / 2);

  drawShadow(0, 18 * scale, 17 * scale, 8 * scale, .28);

  if (isMe) {
    ctx.strokeStyle = 'rgba(255,255,255,.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 22 * scale, 0, Math.PI * 2);
    ctx.stroke();
  }

  // body
  ctx.fillStyle = p.outfit;
  drawRoundedRect(-11 * scale, -3 * scale + bob * .05, 22 * scale, 25 * scale, 8 * scale);
  ctx.fill();

  // cape / torso trim
  ctx.fillStyle = p.color;
  drawRoundedRect(-4 * scale, -1 * scale + bob * .05, 8 * scale, 25 * scale, 4 * scale);
  ctx.fill();

  // head
  ctx.fillStyle = '#f2c9a2';
  ctx.beginPath();
  ctx.arc(0, -14 * scale + bob * .06, 10 * scale, 0, Math.PI * 2);
  ctx.fill();

  // hair / crown
  ctx.fillStyle = p.role === 'Prince' ? '#d4a017' : p.hair;
  ctx.beginPath();
  ctx.arc(0, -17 * scale + bob * .06, 10 * scale, Math.PI, 0);
  ctx.lineTo(10 * scale, -14 * scale + bob * .06);
  ctx.fill();
  if (p.role === 'Prince') {
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.moveTo(-8 * scale, -24 * scale);
    ctx.lineTo(-4 * scale, -30 * scale);
    ctx.lineTo(0, -24 * scale);
    ctx.lineTo(4 * scale, -30 * scale);
    ctx.lineTo(8 * scale, -24 * scale);
    ctx.closePath();
    ctx.fill();
  }
  if (p.role === 'Princesse') {
    ctx.fillStyle = '#f472b6';
    ctx.beginPath();
    ctx.moveTo(-9 * scale, -24 * scale);
    ctx.lineTo(-5 * scale, -28 * scale);
    ctx.lineTo(0, -24 * scale);
    ctx.lineTo(5 * scale, -28 * scale);
    ctx.lineTo(9 * scale, -24 * scale);
    ctx.closePath();
    ctx.fill();
  }

  // arms + legs
  ctx.strokeStyle = '#f2c9a2';
  ctx.lineWidth = 4 * scale;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-10 * scale, 2 * scale);
  ctx.lineTo(-16 * scale, 12 * scale);
  ctx.moveTo(10 * scale, 2 * scale);
  ctx.lineTo(14 * scale, 8 * scale);
  ctx.stroke();
  ctx.strokeStyle = '#1f2937';
  ctx.beginPath();
  ctx.moveTo(-5 * scale, 22 * scale);
  ctx.lineTo(-7 * scale, 33 * scale);
  ctx.moveTo(5 * scale, 22 * scale);
  ctx.lineTo(7 * scale, 33 * scale);
  ctx.stroke();

  // sword
  const swordAng = p.facing;
  ctx.save();
  ctx.rotate(swordAng + (p.attackCd > 0.28 ? -.85 : .35));
  ctx.translate(11 * scale, 0);
  ctx.fillStyle = '#6b7280';
  ctx.fillRect(-1 * scale, -2 * scale, 24 * scale, 4 * scale);
  ctx.fillStyle = '#dbeafe';
  ctx.fillRect(7 * scale, -1.5 * scale, 16 * scale, 3 * scale);
  ctx.fillStyle = '#6b3f1e';
  ctx.fillRect(-4 * scale, -3 * scale, 6 * scale, 6 * scale);
  ctx.restore();

  // dead overlay / invuln glow
  if (p.invuln > 0 && !dead) {
    ctx.strokeStyle = 'rgba(255,255,255,.65)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 18 * scale, 0, Math.PI * 2);
    ctx.stroke();
  }

  // hp bar + label
  ctx.translate(0, -42 * scale);
  drawRoundedRect(-26 * scale, 0, 52 * scale, 8 * scale, 6 * scale);
  ctx.fillStyle = 'rgba(0,0,0,.6)';
  ctx.fill();
  drawRoundedRect(-26 * scale, 0, 52 * scale * (Math.max(0, p.hp) / p.maxHp), 8 * scale, 6 * scale);
  ctx.fillStyle = dead ? '#7f1d1d' : '#ef4444';
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.max(12, 11 * scale)}px Arial`;
  ctx.textAlign = 'center';
  ctx.fillText(`${p.name} • ${p.role}`, 0, -8 * scale);

  ctx.restore();
}

function drawEnemy(e) {
  const s = worldToScreen(e.x, e.y);
  const scale = cam.zoom;
  ctx.save();
  ctx.translate(s.x, s.y);
  drawShadow(0, 16 * scale, 17 * scale, 8 * scale, .28);

  const base = e.color;
  const flash = e.attackFlash > 0;
  ctx.fillStyle = flash ? '#fee2e2' : base;
  ctx.beginPath();
  ctx.arc(0, -10 * scale, e.boss ? 15 * scale : 10 * scale, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = flash ? '#fecaca' : (e.boss ? '#991b1b' : '#3f6212');
  drawRoundedRect(-(e.boss ? 16 : 11) * scale, -2 * scale, (e.boss ? 32 : 22) * scale, (e.boss ? 28 : 24) * scale, 8 * scale);
  ctx.fill();

  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 4 * scale;
  ctx.beginPath();
  ctx.moveTo(-(e.boss ? 8 : 5) * scale, 22 * scale);
  ctx.lineTo(-(e.boss ? 10 : 7) * scale, 34 * scale);
  ctx.moveTo((e.boss ? 8 : 5) * scale, 22 * scale);
  ctx.lineTo((e.boss ? 10 : 7) * scale, 34 * scale);
  ctx.stroke();

  // weapon/claw
  ctx.save();
  ctx.rotate(e.facing + .4);
  ctx.translate((e.boss ? 15 : 11) * scale, 0);
  ctx.fillStyle = e.boss ? '#f59e0b' : '#d1d5db';
  ctx.fillRect(0, -2 * scale, (e.boss ? 18 : 12) * scale, 4 * scale);
  ctx.restore();

  // eyes
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(-4 * scale, -12 * scale, 1.6 * scale, 0, Math.PI * 2);
  ctx.arc(4 * scale, -12 * scale, 1.6 * scale, 0, Math.PI * 2);
  ctx.fill();

  // hp bar
  ctx.translate(0, -(e.boss ? 46 : 38) * scale);
  drawRoundedRect(-(e.boss ? 30 : 22) * scale, 0, (e.boss ? 60 : 44) * scale, 7 * scale, 5 * scale);
  ctx.fillStyle = 'rgba(0,0,0,.5)';
  ctx.fill();
  drawRoundedRect(-(e.boss ? 30 : 22) * scale, 0, (e.boss ? 60 : 44) * scale * (e.hp / e.maxHp), 7 * scale, 5 * scale);
  ctx.fillStyle = e.boss ? '#f59e0b' : '#84cc16';
  ctx.fill();

  if (e.boss) {
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.max(12, 11 * scale)}px Arial`;
    ctx.textAlign = 'center';
    ctx.fillText(e.type, 0, -8 * scale);
  }

  ctx.restore();
}

function drawCrystal(c, t) {
  if (c.taken) return;
  const s = worldToScreen(c.x, c.y);
  const scale = cam.zoom;
  const bob = Math.sin(t / 220 + c.x * .02) * 6;
  drawShadow(s.x, s.y + 18 * scale, 14 * scale, 6 * scale, .22);
  ctx.save();
  ctx.translate(s.x, s.y + bob);
  ctx.rotate(t / 900);
  ctx.fillStyle = '#67e8f9';
  ctx.beginPath();
  ctx.moveTo(0, -14 * scale);
  ctx.lineTo(10 * scale, 0);
  ctx.lineTo(0, 14 * scale);
  ctx.lineTo(-10 * scale, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#cffafe';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawPortal(portal, t) {
  const s = worldToScreen(portal.x, portal.y);
  const scale = cam.zoom;
  const pulse = 1 + Math.sin(t / 240) * .08;
  ctx.save();
  ctx.translate(s.x, s.y);
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.strokeStyle = `rgba(167,139,250,${0.25 - i * 0.04})`;
    ctx.lineWidth = 7 - i;
    ctx.arc(0, 0, (portal.r - i * 5) * scale * pulse, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(124,58,237,.2)';
  ctx.beginPath();
  ctx.arc(0, 0, portal.r * scale * .85, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawEffects() {
  if (!state?.effects) return;
  for (const ef of state.effects) {
    const s = worldToScreen(ef.x, ef.y);
    const a = clamp(ef.ttl / 0.3, 0, 1);
    ctx.save();
    ctx.translate(s.x, s.y);
    if (ef.kind === 'slash') {
      ctx.rotate(ef.angle - .7);
      ctx.strokeStyle = hexToRgba(ef.color, .75 * a);
      ctx.lineWidth = 6 * cam.zoom;
      ctx.beginPath();
      ctx.arc(0, 0, ef.radius * cam.zoom, -.15, 1.2);
      ctx.stroke();
    } else if (ef.kind === 'hit' || ef.kind === 'crystal' || ef.kind === 'burst') {
      ctx.strokeStyle = hexToRgba(ef.color, .7 * a);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, ef.radius * cam.zoom * (1 + (1 - a) * .7), 0, Math.PI * 2);
      ctx.stroke();
    } else if (ef.kind === 'portal') {
      ctx.strokeStyle = hexToRgba(ef.color, .65 * a);
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(0, 0, ef.radius * cam.zoom * (1 + (1 - a)), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function drawWorld() {
  if (!state) return;
  const t = performance.now();
  const tileSize = 96;
  const visibleW = innerWidth / cam.zoom;
  const visibleH = innerHeight / cam.zoom;
  const startX = Math.floor((cam.x - visibleW / 2 - tileSize * 2) / tileSize);
  const endX = Math.ceil((cam.x + visibleW / 2 + tileSize * 2) / tileSize);
  const startY = Math.floor((cam.y - visibleH / 2 - tileSize * 2) / tileSize);
  const endY = Math.ceil((cam.y + visibleH / 2 + tileSize * 2) / tileSize);

  // background gradient sky tint
  const bg = ctx.createLinearGradient(0, 0, 0, innerHeight);
  bg.addColorStop(0, '#081018');
  bg.addColorStop(1, '#12202a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, innerWidth, innerHeight);

  // floor tiles
  for (let tx = startX; tx <= endX; tx++) {
    for (let ty = startY; ty <= endY; ty++) {
      const wx = tx * tileSize;
      const wy = ty * tileSize;
      const s = worldToScreen(wx, wy);
      const type = getTile(state.seed, wx, wy, state.level);
      ctx.fillStyle = tileColor(type);
      ctx.fillRect(s.x, s.y, tileSize * cam.zoom + 1, tileSize * cam.zoom + 1);

      const n = noiseTile(tx, ty, state.seed);
      if (type === 'grass') {
        ctx.fillStyle = n > 0.55 ? 'rgba(72,126,66,.35)' : 'rgba(46,94,46,.2)';
        for (let i = 0; i < 7; i++) {
          const px = s.x + ((i * 13 + tx * 19) % tileSize) * cam.zoom;
          const py = s.y + ((i * 21 + ty * 17) % tileSize) * cam.zoom;
          ctx.fillRect(px, py, 2, 5);
        }
        if (n > 0.72) drawTree(wx + 48, wy + 48, n);
        else if (n > 0.64) drawBush(wx + 48, wy + 44, n);
      } else if (type === 'rock') {
        drawRock(wx + 48, wy + 48, n);
      } else if (type === 'water') {
        ctx.fillStyle = 'rgba(255,255,255,.06)';
        ctx.fillRect(s.x, s.y + Math.sin(t / 500 + tx + ty) * 2, tileSize * cam.zoom, 6);
      } else if (type === 'path') {
        ctx.strokeStyle = 'rgba(255,255,255,.05)';
        ctx.beginPath();
        ctx.moveTo(s.x + 12, s.y + 20);
        ctx.lineTo(s.x + tileSize * cam.zoom - 14, s.y + tileSize * cam.zoom - 18);
        ctx.stroke();
      } else if (type === 'lava') {
        ctx.fillStyle = 'rgba(251,146,60,.12)';
        ctx.fillRect(s.x, s.y, tileSize * cam.zoom, tileSize * cam.zoom);
      }
    }
  }

  // objectives
  state.crystalsList?.forEach(c => drawCrystal(c, t));
  if (state.portal) drawPortal(state.portal, t);

  state.enemies?.forEach(drawEnemy);
  state.players?.forEach(p => drawHumanoid(p, p.id === myId));
  drawEffects();

  if (showAttackPulse > 0 && isMobile()) {
    showAttackPulse -= 1 / 60;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(innerWidth - 80, innerHeight - 80, 48 + (1 - showAttackPulse / .18) * 20, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawTree(x, y, n) {
  const s = worldToScreen(x, y);
  const scale = cam.zoom;
  drawShadow(s.x, s.y + 20 * scale, 18 * scale, 8 * scale, .18);
  ctx.fillStyle = '#4b2a12';
  ctx.fillRect(s.x - 4 * scale, s.y - 2 * scale, 8 * scale, 20 * scale);
  ctx.fillStyle = n > 0.82 ? '#2f7d32' : '#235126';
  ctx.beginPath();
  ctx.arc(s.x, s.y - 8 * scale, 18 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(s.x - 10 * scale, s.y + 2 * scale, 12 * scale, 0, Math.PI * 2);
  ctx.arc(s.x + 11 * scale, s.y + 2 * scale, 12 * scale, 0, Math.PI * 2);
  ctx.fill();
}
function drawBush(x, y, n) {
  const s = worldToScreen(x, y);
  const scale = cam.zoom;
  drawShadow(s.x, s.y + 10 * scale, 14 * scale, 5 * scale, .14);
  ctx.fillStyle = n > 0.67 ? '#3b873e' : '#29572a';
  ctx.beginPath();
  ctx.arc(s.x - 9 * scale, s.y, 10 * scale, 0, Math.PI * 2);
  ctx.arc(s.x, s.y - 3 * scale, 12 * scale, 0, Math.PI * 2);
  ctx.arc(s.x + 10 * scale, s.y, 10 * scale, 0, Math.PI * 2);
  ctx.fill();
}
function drawRock(x, y, n) {
  const s = worldToScreen(x, y);
  const scale = cam.zoom;
  drawShadow(s.x, s.y + 11 * scale, 15 * scale, 6 * scale, .15);
  ctx.fillStyle = n > 0.93 ? '#575d66' : '#444b54';
  ctx.beginPath();
  ctx.moveTo(s.x - 15 * scale, s.y + 8 * scale);
  ctx.lineTo(s.x - 10 * scale, s.y - 8 * scale);
  ctx.lineTo(s.x + 10 * scale, s.y - 10 * scale);
  ctx.lineTo(s.x + 16 * scale, s.y + 6 * scale);
  ctx.closePath();
  ctx.fill();
}

function render() {
  requestAnimationFrame(render);
  if (!state) {
    ctx.fillStyle = '#081018';
    ctx.fillRect(0, 0, innerWidth, innerHeight);
    return;
  }

  const me = getMyPlayer();
  if (me) {
    cam.x = lerp(cam.x, me.x, .08);
    cam.y = lerp(cam.y, me.y, .08);
    cam.zoom = lerp(cam.zoom, isMobile() ? .95 : 1.15, .04);
  }

  drawWorld();
}
render();
