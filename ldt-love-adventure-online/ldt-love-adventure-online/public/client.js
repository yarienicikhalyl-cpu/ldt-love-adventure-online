const socket = io();

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const menu = document.getElementById("menu");
const endScreen = document.getElementById("endScreen");
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const restartBtn = document.getElementById("restartBtn");
const backBtn = document.getElementById("backBtn");
const copyBtn = document.getElementById("copyBtn");
const nameInput = document.getElementById("nameInput");
const codeInput = document.getElementById("codeInput");
const errorText = document.getElementById("errorText");
const messageBox = document.getElementById("messageBox");

const roomText = document.getElementById("roomText");
const hpTxt = document.getElementById("hpTxt");
const loveTxt = document.getElementById("loveTxt");
const xpTxt = document.getElementById("xpTxt");
const levelTxt = document.getElementById("levelTxt");
const crystalTxt = document.getElementById("crystalTxt");
const playersTxt = document.getElementById("playersTxt");
const monsterTxt = document.getElementById("monsterTxt");
const hpFill = document.getElementById("hpFill");
const loveFill = document.getElementById("loveFill");
const xpFill = document.getElementById("xpFill");
const endIcon = document.getElementById("endIcon");
const endTitle = document.getElementById("endTitle");
const endText = document.getElementById("endText");

const stickZone = document.getElementById("stickZone");
const stick = document.getElementById("stick");
const attackBtn = document.getElementById("attackBtn");

const C = {
  bg:"#070711", grass:"#151a26", path:"#26233b", water:"#123345", lava:"#4c1515", rock:"#1f2937",
  enemy:"#a855f7", elite:"#fb923c", boss:"#7f1d1d", red:"#ef4444", crystal:"#67e8f9", portal:"#a78bfa", white:"#f8fafc"
};

let selfId = null;
let roomCode = "";
let state = null;
let prevState = null;
let keys = {};
let mouse = { x: 0, y: 0, down: false };
let input = { x: 0, y: 0, angle: 0, attack: false };
let camera = { x: 0, y: 0 };
let particles = [];
let shake = 0;
let last = performance.now();
let lastSent = 0;
let endShown = false;

function fit() {
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
  canvas.style.width = innerWidth + "px";
  canvas.style.height = innerHeight + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener("resize", fit);
fit();

function nameValue() {
  return (nameInput.value || localStorage.getItem("ldt_love_name") || "Joueur").trim().slice(0,18);
}
nameInput.value = localStorage.getItem("ldt_love_name") || "";

createBtn.onclick = () => {
  errorText.textContent = "";
  localStorage.setItem("ldt_love_name", nameValue());
  socket.emit("createRoom", { name: nameValue() }, res => {
    if (!res.ok) return errorText.textContent = res.error || "Erreur.";
    selfId = res.id;
    roomCode = res.code;
    roomText.textContent = "Salon " + roomCode;
    menu.classList.add("hidden");
  });
};

joinBtn.onclick = () => {
  errorText.textContent = "";
  const code = codeInput.value.trim().toUpperCase();
  if (code.length < 5) return errorText.textContent = "Mets le code complet.";
  localStorage.setItem("ldt_love_name", nameValue());
  socket.emit("joinRoom", { code, name: nameValue() }, res => {
    if (!res.ok) return errorText.textContent = res.error || "Erreur.";
    selfId = res.id;
    roomCode = res.code;
    roomText.textContent = "Salon " + roomCode;
    menu.classList.add("hidden");
  });
};

copyBtn.onclick = async () => {
  if (!roomCode) return;
  try {
    await navigator.clipboard.writeText(roomCode);
    showLocalMessage("Code copié : " + roomCode);
  } catch {
    showLocalMessage("Code du salon : " + roomCode);
  }
};

restartBtn.onclick = () => {
  socket.emit("restart");
  endScreen.classList.add("hidden");
  endShown = false;
};

backBtn.onclick = () => location.reload();

socket.on("connect", () => {
  if (selfId === null) selfId = socket.id;
});

socket.on("state", s => {
  prevState = state;
  state = s;
  roomCode = s.code;
  roomText.textContent = "Salon " + s.code;
  updateHud();

  if ((s.gameOver || s.victory) && !endShown) {
    endShown = true;
    endIcon.textContent = s.victory ? "👑" : "💀";
    endTitle.textContent = s.victory ? "Victoire" : "Défaite";
    endText.textContent = s.message || (s.victory ? "Vous avez fini l'aventure." : "Le couple est tombé.");
    endScreen.classList.remove("hidden");
  }

  if (!s.gameOver && !s.victory) {
    endShown = false;
    endScreen.classList.add("hidden");
  }
});

socket.on("hitFx", p => spawnParticles(p.x, p.y, C.white, 10, 1.0));
socket.on("crystalFx", p => spawnParticles(p.x, p.y, C.crystal, 26, 1.2));
socket.on("portalFx", p => spawnParticles(p.x, p.y, C.portal, 38, 1.3));

function updateHud() {
  if (!state) return;
  const me = state.players.find(p => p.id === selfId) || state.players[0] || { hp:0, maxHp:100 };
  hpTxt.textContent = Math.ceil(me.hp) + "/" + Math.ceil(me.maxHp);
  loveTxt.textContent = Math.ceil(state.love) + "/100";
  xpTxt.textContent = Math.floor(state.xp) + "/" + state.xpNeed;
  levelTxt.textContent = state.level;
  crystalTxt.textContent = state.crystals + "/" + state.crystalsNeed;
  playersTxt.textContent = state.players.length;
  monsterTxt.textContent = state.enemies.length;
  hpFill.style.width = clamp(me.hp / Math.max(1, me.maxHp) * 100, 0, 100) + "%";
  loveFill.style.width = clamp(state.love, 0, 100) + "%";
  xpFill.style.width = clamp(state.xp / Math.max(1, state.xpNeed) * 100, 0, 100) + "%";

  if (state.message) showLocalMessage(state.message);
}

let msgTimer = 0;
let lastMsg = "";
function showLocalMessage(t) {
  if (!t || t === lastMsg && msgTimer > 0.5) return;
  lastMsg = t;
  msgTimer = 3;
  messageBox.textContent = t;
  messageBox.classList.add("show");
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
  return a * .5 + b * .32 + c * .18;
}
function tileType(wx, wy, level, seed) {
  const tx = Math.floor(wx / 96);
  const ty = Math.floor(wy / 96);
  const n = noiseTile(tx, ty, seed);
  if (level >= 8 && n > .91) return "lava";
  if (n < .075) return "water";
  if (n > .84) return "rock";
  if (n > .55 && Math.abs(tx) % 11 === 0) return "path";
  if (n > .5 && Math.abs(ty) % 13 === 0) return "path";
  return "grass";
}

function clamp(v,min,max){return Math.max(min,Math.min(max,v))}
function lerp(a,b,t){return a+(b-a)*t}
function dist(ax,ay,bx,by){return Math.hypot(ax-bx,ay-by)}

function spawnParticles(x,y,color,count,power) {
  for (let i=0;i<count;i++) {
    const a = Math.random()*Math.PI*2;
    const s = (70+Math.random()*210)*(power||1);
    particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:.35+Math.random()*.45,max:.8,color,size:2+Math.random()*4});
  }
  shake = Math.max(shake, 5);
}

function getMe() {
  if (!state) return null;
  return state.players.find(p => p.id === selfId) || state.players[0] || null;
}

function computeInput() {
  let ix = 0, iy = 0;
  if (keys.KeyW || keys.ArrowUp || keys.KeyZ) iy -= 1;
  if (keys.KeyS || keys.ArrowDown) iy += 1;
  if (keys.KeyA || keys.ArrowLeft || keys.KeyQ) ix -= 1;
  if (keys.KeyD || keys.ArrowRight) ix += 1;

  ix += joy.x;
  iy += joy.y;

  const len = Math.hypot(ix, iy);
  if (len > 1) { ix /= len; iy /= len; }

  const me = getMe();
  if (me) {
    const rect = canvas.getBoundingClientRect();
    const mx = mouse.x - rect.width / 2;
    const my = mouse.y - rect.height / 2;
    let angle = me.facing || 0;
    if (Math.hypot(mx, my) > 18) angle = Math.atan2(my, mx);
    if (ix || iy) angle = Math.atan2(iy, ix);
    input.angle = angle;
  }

  input.x = ix;
  input.y = iy;
  input.attack = !!(mouse.down || keys.Space || attackPressed);
}

addEventListener("keydown", e => {
  keys[e.code] = true;
  if (["Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.code)) e.preventDefault();
  if (e.code === "KeyR") socket.emit("restart");
});
addEventListener("keyup", e => keys[e.code] = false);
addEventListener("mousemove", e => { mouse.x = e.clientX; mouse.y = e.clientY; });
addEventListener("mousedown", e => { mouse.down = true; mouse.x = e.clientX; mouse.y = e.clientY; });
addEventListener("mouseup", () => mouse.down = false);

let joy = { x:0, y:0 };
let joyTouch = null;
function updateStick(clientX, clientY) {
  const r = stickZone.getBoundingClientRect();
  const cx = r.left + r.width/2;
  const cy = r.top + r.height/2;
  let dx = clientX - cx;
  let dy = clientY - cy;
  const max = 43;
  const len = Math.hypot(dx,dy);
  if (len > max) { dx = dx/len*max; dy = dy/len*max; }
  joy.x = dx / max;
  joy.y = dy / max;
  stick.style.left = (41 + dx) + "px";
  stick.style.top = (41 + dy) + "px";
}
function resetStick() {
  joy.x = 0; joy.y = 0; joyTouch = null;
  stick.style.left = "41px";
  stick.style.top = "41px";
}
stickZone.addEventListener("touchstart", e => {
  const t = e.changedTouches[0];
  joyTouch = t.identifier;
  updateStick(t.clientX, t.clientY);
  e.preventDefault();
}, {passive:false});
stickZone.addEventListener("touchmove", e => {
  for (const t of e.changedTouches) {
    if (t.identifier === joyTouch) updateStick(t.clientX, t.clientY);
  }
  e.preventDefault();
}, {passive:false});
stickZone.addEventListener("touchend", e => {
  for (const t of e.changedTouches) if (t.identifier === joyTouch) resetStick();
  e.preventDefault();
}, {passive:false});

let attackPressed = false;
attackBtn.addEventListener("touchstart", e => { attackPressed = true; e.preventDefault(); }, {passive:false});
attackBtn.addEventListener("touchend", e => { attackPressed = false; e.preventDefault(); }, {passive:false});
attackBtn.addEventListener("mousedown", () => attackPressed = true);
attackBtn.addEventListener("mouseup", () => attackPressed = false);

function drawRoundRect(x,y,w,h,r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}

function drawMap(s, w, h) {
  const tile = 96;
  const minTx = Math.floor((camera.x - w/2 - 120) / tile);
  const maxTx = Math.ceil((camera.x + w/2 + 120) / tile);
  const minTy = Math.floor((camera.y - h/2 - 120) / tile);
  const maxTy = Math.ceil((camera.y + h/2 + 120) / tile);

  for (let ty=minTy; ty<=maxTy; ty++) {
    for (let tx=minTx; tx<=maxTx; tx++) {
      const x = tx*tile;
      const y = ty*tile;
      const t = tileType(x+8,y+8,s.level,s.seed);
      let fill = C.grass;
      if (t==="path") fill=C.path;
      if (t==="water") fill=C.water;
      if (t==="rock") fill=C.rock;
      if (t==="lava") fill=C.lava;
      ctx.fillStyle = fill;
      ctx.fillRect(x,y,tile+1,tile+1);
      const grain = hash2(tx,ty,s.seed);
      ctx.fillStyle = grain>.5 ? "rgba(255,255,255,.025)" : "rgba(0,0,0,.035)";
      ctx.fillRect(x+8,y+8,tile-16,tile-16);
      if (t==="rock") {
        ctx.fillStyle="rgba(255,255,255,.08)";
        ctx.beginPath();
        ctx.arc(x+tile*.35,y+tile*.38,9+grain*16,0,Math.PI*2);
        ctx.arc(x+tile*.65,y+tile*.62,8+grain*12,0,Math.PI*2);
        ctx.fill();
      }
    }
  }
}

function drawPlayer(p) {
  ctx.save();
  ctx.translate(p.x,p.y);
  if (p.dead) ctx.globalAlpha = .35;
  else if (p.invuln > 0) ctx.globalAlpha = .62 + Math.sin(performance.now()/45)*.25;

  ctx.fillStyle = "rgba(0,0,0,.34)";
  ctx.beginPath();
  ctx.ellipse(0,p.r*.9,p.r*1.1,p.r*.35,0,0,Math.PI*2);
  ctx.fill();

  ctx.shadowColor = p.color;
  ctx.shadowBlur = 16;
  ctx.fillStyle = p.color;
  ctx.beginPath();
  ctx.arc(0,0,p.r,0,Math.PI*2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = "rgba(0,0,0,.55)";
  ctx.beginPath();
  ctx.arc(Math.cos(p.facing)*p.r*.42, Math.sin(p.facing)*p.r*.42, p.r*.35, 0, Math.PI*2);
  ctx.fill();

  ctx.fillStyle = "#fbbf24";
  ctx.beginPath();
  ctx.moveTo(-p.r*.7,-p.r*.9);
  ctx.lineTo(-p.r*.35,-p.r*1.45);
  ctx.lineTo(0,-p.r*.9);
  ctx.lineTo(p.r*.35,-p.r*1.45);
  ctx.lineTo(p.r*.7,-p.r*.9);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,.75)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(Math.cos(p.facing)*p.r*.8, Math.sin(p.facing)*p.r*.8);
  ctx.lineTo(Math.cos(p.facing)*p.r*1.55, Math.sin(p.facing)*p.r*1.55);
  ctx.stroke();

  ctx.font = "bold 13px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "#fff";
  ctx.shadowColor = "#000";
  ctx.shadowBlur = 5;
  ctx.fillText(p.role + " " + p.name, 0, -p.r-18);
  ctx.shadowBlur = 0;

  ctx.fillStyle = "rgba(0,0,0,.55)";
  drawRoundRect(-23,-p.r-12,46,5,3);
  ctx.fill();
  ctx.fillStyle = p.hp > p.maxHp*.35 ? "#22c55e" : "#ef4444";
  drawRoundRect(-23,-p.r-12,46*clamp(p.hp/p.maxHp,0,1),5,3);
  ctx.fill();

  ctx.restore();
}

function drawEnemy(e) {
  ctx.save();
  ctx.translate(e.x,e.y);
  ctx.fillStyle = "rgba(0,0,0,.34)";
  ctx.beginPath();
  ctx.ellipse(0,e.r*.9,e.r*1.1,e.r*.34,0,0,Math.PI*2);
  ctx.fill();

  ctx.shadowColor = e.boss ? C.red : e.elite ? C.elite : C.enemy;
  ctx.shadowBlur = e.boss ? 25 : 14;
  ctx.fillStyle = e.boss ? C.boss : e.elite ? "#c2410c" : C.enemy;
  ctx.beginPath();
  for (let i=0;i<10;i++) {
    const a = Math.PI*2*i/10 + performance.now()/900;
    const rr = e.r * (i%2 ? .82 : 1.15);
    ctx.lineTo(Math.cos(a)*rr, Math.sin(a)*rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(-e.r*.32,-e.r*.18,Math.max(2,e.r*.13),0,Math.PI*2);
  ctx.arc(e.r*.32,-e.r*.18,Math.max(2,e.r*.13),0,Math.PI*2);
  ctx.fill();

  ctx.fillStyle = "rgba(0,0,0,.55)";
  drawRoundRect(-e.r,-e.r-13,e.r*2,5,3);
  ctx.fill();
  ctx.fillStyle = e.boss ? "#f87171" : "#c4b5fd";
  drawRoundRect(-e.r,-e.r-13,e.r*2*clamp(e.hp/e.maxHp,0,1),5,3);
  ctx.fill();

  ctx.restore();
}

function drawCrystal(c) {
  if (c.taken) return;
  const pulse = 1 + Math.sin(performance.now()/230 + c.x)*.18;
  ctx.save();
  ctx.translate(c.x,c.y);
  ctx.shadowColor = C.crystal;
  ctx.shadowBlur = 22;
  ctx.fillStyle = C.crystal;
  ctx.beginPath();
  ctx.moveTo(0,-20*pulse);
  ctx.lineTo(14*pulse,0);
  ctx.lineTo(0,20*pulse);
  ctx.lineTo(-14*pulse,0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawPortal(p) {
  const pulse = performance.now()/350;
  const r = p.r + Math.sin(pulse)*8;
  ctx.save();
  ctx.translate(p.x,p.y);
  ctx.rotate(pulse*.3);
  ctx.shadowColor = C.portal;
  ctx.shadowBlur = 30;
  ctx.strokeStyle = C.portal;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(0,0,r,0,Math.PI*2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,.65)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0,0,r*.62,0,Math.PI*2);
  ctx.stroke();
  ctx.restore();
}

function update(dt, now) {
  if (msgTimer > 0) {
    msgTimer -= dt;
    if (msgTimer <= 0) messageBox.classList.remove("show");
  }

  computeInput();
  if (state && now - lastSent > 33) {
    socket.emit("input", input);
    lastSent = now;
  }

  for (let i=particles.length-1;i>=0;i--) {
    const p = particles[i];
    p.life -= dt;
    p.x += p.vx*dt;
    p.y += p.vy*dt;
    p.vx *= Math.pow(.06, dt);
    p.vy *= Math.pow(.06, dt);
    if (p.life <= 0) particles.splice(i,1);
  }
  shake = Math.max(0, shake - dt*18);

  const me = getMe();
  if (me) {
    const s = 1 - Math.pow(.0002, dt);
    camera.x += (me.x - camera.x)*s;
    camera.y += (me.y - camera.y)*s;
  }
}

function draw() {
  const w = innerWidth;
  const h = innerHeight;
  ctx.setTransform(window.devicePixelRatio || 1,0,0,window.devicePixelRatio || 1,0,0);
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0,0,w,h);

  if (!state) {
    ctx.fillStyle = "rgba(255,255,255,.08)";
    for (let i=0;i<80;i++) {
      const x = (hash2(i,1,123)*w + performance.now()*.01*(i%5))%w;
      const y = hash2(i,2,123)*h;
      ctx.beginPath();
      ctx.arc(x,y,hash2(i,3,123)*2+.4,0,Math.PI*2);
      ctx.fill();
    }
    return;
  }

  ctx.save();
  ctx.translate(w/2-camera.x+(Math.random()-.5)*shake, h/2-camera.y+(Math.random()-.5)*shake);

  drawMap(state,w,h);

  for (const c of state.crystalsList) drawCrystal(c);
  if (state.portal) drawPortal(state.portal);

  const enemies = [...state.enemies].sort((a,b)=>a.y-b.y);
  for (const e of enemies) drawEnemy(e);

  const players = [...state.players].sort((a,b)=>a.y-b.y);
  for (const p of players) drawPlayer(p);

  for (const p of particles) {
    ctx.globalAlpha = clamp(p.life/p.max,0,1);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x,p.y,p.size,0,Math.PI*2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.restore();

  const grad = ctx.createRadialGradient(w/2,h/2,Math.min(w,h)*.18,w/2,h/2,Math.max(w,h)*.72);
  grad.addColorStop(0,"rgba(0,0,0,0)");
  grad.addColorStop(1,"rgba(0,0,0,.54)");
  ctx.fillStyle = grad;
  ctx.fillRect(0,0,w,h);
}

function loop(now) {
  const dt = Math.min(.035, Math.max(.001, (now-last)/1000));
  last = now;
  update(dt, now);
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
