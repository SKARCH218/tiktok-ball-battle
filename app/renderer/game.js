"use strict";

// Phone portrait (9:16). All game coordinates are in these logical units; the
// canvas is scaled to fit the window.
const W = 540, H = 960;
// A gift powers a viewer up for a number of volleys ("turns"); a like/follow only for a few seconds.
const TURNS_PER_GIFT = 3, MAX_TURNS = 15, LIKE_SECONDS = 5;
const HUD_H = 190, FOOT_H = 0;           // TikTok LIVE covers the top of the screen, so the HUD sits lower
const R = Math.max(12, Math.min(W, H) / 30);

const T1 = "t1", T2 = "t2";                         // internal team ids; the chat keys/names come from the settings screen
const TEAM_IDS = [T1, T2];

// Everything below is filled in by applyConfig() from the settings screen.
let MAX_PER_TEAM, HP_MULT, SPLIT_H, BASE_HP, BASE_DMG, BURST_SIZE, BURST_GAP, FIRE_INTERVAL,
    MISSILE_SPEED, TIER_AT, BOOST, TEAMS, KEY_TO_TEAM;

function hexToRgba(hex, a) {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function applyConfig(cfg) {
  MAX_PER_TEAM = cfg.max_per_team;
  HP_MULT = 1;
  SPLIT_H = cfg.layout === "top-bottom";
  BASE_HP = cfg.base_hp; BASE_DMG = cfg.base_damage;
  BURST_SIZE = cfg.burst_size; BURST_GAP = cfg.burst_gap; FIRE_INTERVAL = cfg.fire_interval;
  MISSILE_SPEED = cfg.missile_speed;
  TIER_AT = cfg.boost.tier_diamonds;
  BOOST = cfg.boost;
  TEAMS = {}; KEY_TO_TEAM = {};
  TEAM_IDS.forEach((id, i) => {
    const t = cfg.teams[i];
    TEAMS[id] = { key: String(t.key).toUpperCase(), name: t.name, color: t.color, bg: hexToRgba(t.color, 0.10) };
    KEY_TO_TEAM[TEAMS[id].key] = id;
  });
}

const cv = document.getElementById("c");
const ctx = cv.getContext("2d");

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const k = Math.min(innerWidth / W, innerHeight / H);
  cv.style.width = W * k + "px";
  cv.style.height = H * k + "px";
  cv.width = Math.round(W * k * dpr);
  cv.height = Math.round(H * k * dpr);
  ctx.setTransform(k * dpr, 0, 0, k * dpr, 0, 0);
}
addEventListener("resize", resize);
resize();

// ---------------------------------------------------------------- state
const players = new Map();      // uid -> player
const socialDone = new Set();   // "like:uid" / "follow:uid": each viewer gets the Rose reward once per game
const pending = new Map();      // uid -> { d, gift, unit } gifted before joining a team (applied on join)
let projectiles = [], particles = [], floaters = [], rings = [];
let statusText = "", statusState = "idle";
let clock = 0;

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const short = (s, n = 10) => [...String(s)].slice(0, n).join("");

function teamRect(team) {
  const m = R * 1.6, top = HUD_H, bot = H - FOOT_H;
  if (SPLIT_H) {
    const mid = (top + bot) / 2;
    return team === T1 ? [m, top + m, W - m, mid - m] : [m, mid + m, W - m, bot - m];
  }
  return team === T1 ? [m, top + m, W / 2 - m, bot - m] : [W / 2 + m, top + m, W - m, bot - m];
}
function randomPos(team) {
  const [x0, y0, x1, y1] = teamRect(team);
  return [rand(x0, x1), rand(y0, y1)];
}
// Only living players count against the cap, so newcomers can keep joining as others fall.
function teamCount(team) {
  let n = 0;
  for (const p of players.values()) if (p.team === team && p.alive) n++;
  return n;
}

// ---------------------------------------------------------------- players
// Everything below `boost` is temporary: it lasts for `turns` volleys (gifts) or `boostT` seconds (likes).
function recalc(p) {
  const ratio = p.maxHp ? p.hp / p.maxHp : 1;
  const s = Math.sqrt(p.boost);
  p.tier = TIER_AT.filter(t => p.boost >= t).length;
  p.maxHp = BASE_HP * HP_MULT * (1 + 0.12 * s);
  p.hp = ratio * p.maxHp;
  p.dmg = BASE_DMG * (1 + 0.25 * s);
  p.burst = BURST_SIZE + Math.min(5, Math.floor(s / 3));
  p.interval = Math.max(FIRE_INTERVAL / 2, FIRE_INTERVAL / (1 + 0.05 * s));
  p.scale = 1 + Math.min(0.5, 0.03 * s);
}

function setAvatar(p, url) {
  if (!url || p.avatarUrl === url) return;
  p.avatarUrl = url;
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = c.height = 96;
    const g = c.getContext("2d");
    g.beginPath(); g.arc(48, 48, 48, 0, Math.PI * 2); g.clip();
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 96, 96);
    p.sprite = c;
  };
  img.referrerPolicy = "no-referrer";
  img.src = url;
}

function placePlayer(p) {
  [p.x, p.y] = randomPos(p.team);
  [p.tx, p.ty] = randomPos(p.team);
  p.cd = rand(0.2, p.interval);
  p.burstLeft = 0;
  p.target = null;
}

function onComment(ev) {
  const t = KEY_TO_TEAM[(ev.text || "").trim().toUpperCase()];
  if (!t) return;

  const existing = players.get(ev.uid);
  if (existing) { setAvatar(existing, ev.avatar); return; }   // one team per person, no revival
  if (teamCount(t) >= MAX_PER_TEAM) return;

  const p = {
    uid: ev.uid, name: ev.nick || ev.uid, team: t, alive: true, kills: 0,
    boost: 0, boostT: 0, turns: 0, style: "basic", slowT: 0, pullT: 0, maxHp: 0, hp: 0,
    hue: Math.floor(rand(0, 360)), sprite: null, avatarUrl: null, flash: 0,
    x: 0, y: 0, tx: 0, ty: 0, cd: 0, r: R, burstLeft: 0, shotCd: 0, target: null,
  };
  recalc(p);
  placePlayer(p);
  setAvatar(p, ev.avatar);
  players.set(ev.uid, p);

  const early = pending.get(ev.uid);
  if (early) { pending.delete(ev.uid); upgrade(p, early.d, early.gift, early.unit, early.grant); }
}

function boostActive(p) { return p.turns > 0 || p.boostT > 0; }

function endBoost(p) {
  p.boost = 0; p.boostT = 0; p.turns = 0; p.style = "basic";
  recalc(p);
  floaters.push({ x: p.x, y: p.y - p.r - 14, text: "Boost ended", color: "#9ca3af", t: 1.2 });
}

// grant = { turns, seconds }: what this gift/like pays for.
function upgrade(p, diamonds, gift, unit, grant) {
  p.boost += diamonds;
  if (grant.turns) p.turns = Math.min(MAX_TURNS, p.turns + grant.turns);
  if (grant.seconds) p.boostT = Math.max(p.boostT, grant.seconds);
  recalc(p);
  p.hp = p.maxHp;
  rings.push({ p, t: 0.7, max: 0.7 });
  p.style = styleForGift(gift, unit);          // the latest gift decides how they shoot
  p.cd = 0; p.burstLeft = 0; p.target = null;  // ...and they shoot it right now, not after the old cooldown
  floaters.push({ x: p.x, y: p.y - p.r - 14, text: `+${diamonds}💎 ${short(gift || "gift", 14)}`, color: "#fde047", t: 1.5, big: true });
}

function onGift(ev) {
  const d = ev.diamonds || 0;
  if (d <= 0) return;
  const unit = d / Math.max(ev.count || 1, 1);             // diamonds of a single gift
  const grant = ev.seconds ? { seconds: ev.seconds } : { turns: TURNS_PER_GIFT };
  const p = players.get(ev.uid);
  if (!p) {
    const prev = pending.get(ev.uid) || { d: 0, grant: { turns: 0, seconds: 0 } };
    pending.set(ev.uid, {                                  // applied when they join a team
      d: prev.d + d, gift: ev.gift, unit,
      grant: { turns: prev.grant.turns + (grant.turns || 0), seconds: Math.max(prev.grant.seconds, grant.seconds || 0) },
    });
    return;
  }
  if (!p.alive) return;                                    // eliminated players can't be boosted
  setAvatar(p, ev.avatar);
  upgrade(p, d, ev.gift, unit, grant);
}

// A first like or a follow counts as a single Rose (1 diamond) for a few seconds, once per viewer.
function onSocial(ev) {
  const key = `${ev.type}:${ev.uid}`;
  if (socialDone.has(key)) return;
  socialDone.add(key);
  onGift({ uid: ev.uid, nick: ev.nick, avatar: ev.avatar, gift: "Rose", count: 1, diamonds: 1, seconds: LIKE_SECONDS });
}

function handle(ev) {
  if (ev.type === "comment") onComment(ev);
  else if (ev.type === "gift") onGift(ev);
  else if (ev.type === "like" || ev.type === "follow") onSocial(ev);
  else if (ev.type === "status") { statusText = ev.text; statusState = ev.state; }
}

// ---------------------------------------------------------------- simulation
function nearestEnemy(x, y, team, except) {
  let best = null, bd = Infinity;
  for (const q of players.values()) {
    if (!q.alive || q.team === team || (except && except.has(q))) continue;
    const d = (q.x - x) ** 2 + (q.y - y) ** 2;
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}

// Like a LoL auto-attack: lock onto one of the nearest few enemies for the whole burst.
function pickTarget(p) {
  const list = [];
  for (const q of players.values()) if (q.alive && q.team !== p.team) list.push(q);
  if (!list.length) return null;
  const d2 = q => (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
  list.sort((a, b) => d2(a) - d2(b));
  return list[Math.floor(Math.random() * Math.min(4, list.length))];
}

function burst(x, y, color, n) {
  if (particles.length > 600) return;
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), s = rand(40, 220);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: rand(0.3, 0.7), color });
  }
}

function kill(victim, killer) {
  victim.alive = false;
  burst(victim.x, victim.y, TEAMS[victim.team].color, 28);
  if (killer) killer.kills++;
}

function updatePlayer(p, dt) {
  p.r = R * p.scale;
  const [x0, y0, x1, y1] = teamRect(p.team);

  const slow = p.slowT > 0 ? 0.35 : 1;
  if (p.slowT > 0) p.slowT -= dt;

  const dx = p.tx - p.x, dy = p.ty - p.y, dist = Math.hypot(dx, dy);
  if (dist < 6) [p.tx, p.ty] = randomPos(p.team);
  else {
    const speed = (40 + R * 2) * slow;
    p.x += (dx / dist) * speed * dt;
    p.y += (dy / dist) * speed * dt;
  }
  if (p.kvx || p.kvy) {                                 // knocked back by a Knockout Punch
    p.x += p.kvx * dt; p.y += p.kvy * dt;
    const decay = Math.exp(-4 * dt);
    p.kvx *= decay; p.kvy *= decay;
    if (Math.hypot(p.kvx, p.kvy) < 5) p.kvx = p.kvy = 0;
  }
  if (p.pullT > 0) p.pullT -= dt;                       // being dragged by Gravity Falls or punched away
  else {                                                // otherwise drift back inside our own side
    const ex = clamp(p.x, x0, x1) - p.x, ey = clamp(p.y, y0, y1) - p.y, d = Math.hypot(ex, ey);
    if (d > 0) { const step = Math.min(d, 260 * dt); p.x += (ex / d) * step; p.y += (ey / d) * step; }
  }
  p.flash = Math.max(0, p.flash - dt);

  if (p.boostT > 0) {
    p.boostT -= dt;
    if (p.boostT <= 0) { p.boostT = 0; if (p.turns <= 0) endBoost(p); }
  }

  if (p.burstLeft > 0) {
    p.shotCd -= dt * slow;
    if (p.shotCd <= 0) {
      shoot(p);
      p.burstLeft--;
      p.shotCd = BURST_GAP;
      if (p.burstLeft === 0) {                          // volley finished = one turn used
        p.cd = p.interval * rand(0.85, 1.15) * (p.style === "gravity" ? 3 : 1);
        if (p.turns > 0 && --p.turns === 0 && p.boostT <= 0) endBoost(p);
      }
    }
  } else {
    p.cd -= dt * slow;
    if (p.cd <= 0) { p.burstLeft = p.burst; p.shotCd = 0; p.target = null; }
  }
}

function countTeams() {
  const alive = { [T1]: 0, [T2]: 0 }, total = { [T1]: 0, [T2]: 0 };
  for (const p of players.values()) {
    total[p.team]++;
    if (p.alive) alive[p.team]++;
  }
  return { alive, total };
}

function update(dt) {
  clock += dt;
  for (const p of players.values()) if (p.alive) updatePlayer(p, dt);
  projectiles = projectiles.filter(pr => updateMissile(pr, dt));
  updateEffects(dt);

  particles = particles.filter(p => {
    p.t -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy *= 0.94;
    return p.t > 0;
  });
  floaters = floaters.filter(f => { f.t -= dt; f.y -= 30 * dt; return f.t > 0; });
  rings = rings.filter(r => (r.t -= dt) > 0);
}

// ---------------------------------------------------------------- rendering
const FONT = `"Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif`;

function text(str, x, y, size, color, align = "center", weight = "700") {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.lineWidth = Math.max(2, size / 6);
  ctx.strokeStyle = "rgba(0,0,0,0.75)";
  ctx.lineJoin = "round";
  ctx.strokeText(str, x, y);
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

function drawPlayer(p, showName) {
  const r = p.r;
  ctx.save();
  if (boostActive(p)) {
    const pulse = 0.6 + 0.4 * Math.sin(clock * 6);
    ctx.strokeStyle = `rgba(253,224,71,${pulse})`;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2); ctx.stroke();
  }
  if (p.sprite) ctx.drawImage(p.sprite, p.x - r, p.y - r, r * 2, r * 2);
  else {
    ctx.fillStyle = `hsl(${p.hue} 55% 45%)`;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    text([...p.name][0] || "?", p.x, p.y + r * 0.35, r * 1.0, "#fff");
  }
  if (p.slowT > 0) {
    ctx.fillStyle = "rgba(147,197,253,0.45)";
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#bae6fd"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2); ctx.stroke();
  }
  if (p.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${p.flash / 0.12 * 0.7})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.lineWidth = 3;
  ctx.strokeStyle = TEAMS[p.team].color;
  ctx.beginPath(); ctx.arc(p.x, p.y, r + 1, 0, Math.PI * 2); ctx.stroke();

  const ratio = clamp(p.hp / p.maxHp, 0, 1);
  const bw = r * 2, bx = p.x - r, by = p.y - r - 9;
  ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(bx - 1, by - 1, bw + 2, 6);
  ctx.fillStyle = ratio > 0.5 ? "#4ade80" : ratio > 0.25 ? "#facc15" : "#f87171";
  ctx.fillRect(bx, by, bw * ratio, 4);

  if (boostActive(p)) {
    const label = p.turns > 0 ? `×${p.turns}` : `${Math.ceil(p.boostT)}s`;
    ctx.font = `700 10px ${FONT}`;
    const w = ctx.measureText(label).width + 8;
    const px = p.x + r * 0.9, py = p.y + r * 0.9;
    ctx.fillStyle = "#fde047";
    ctx.beginPath(); ctx.roundRect(px - w / 2, py - 7, w, 14, 7); ctx.fill();
    ctx.fillStyle = "#111"; ctx.textAlign = "center"; ctx.fillText(label, px, py + 4);
  }
  ctx.restore();
  if (showName) text(short(p.name, 8), p.x, p.y + r + 13, 10, "#fff");
}

function drawHud() {
  for (const t of TEAM_IDS) {
    const team = TEAMS[t], left = t === T1;
    text(team.name, left ? 14 : W - 14, 152, 26, team.color, left ? "left" : "right");
  }
  text("VS", W / 2, 168, 60, "#fff");
  // Stay silent while connected; only surface problems so the streamer notices them.
  if (statusState === "error" || statusState === "offline") text(short(statusText, 46), W / 2, 188, 11, "#f87171", "center", "500");
}

function render() {
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(bgCanvas, 0, 0, W, H);
  if (SPLIT_H) {
    const mid = (HUD_H + H - FOOT_H) / 2;
    ctx.fillStyle = TEAMS[T1].bg; ctx.fillRect(0, 0, W, mid);
    ctx.fillStyle = TEAMS[T2].bg; ctx.fillRect(0, mid, W, H - mid);
  } else {
    ctx.fillStyle = TEAMS[T1].bg; ctx.fillRect(0, 0, W / 2, H);
    ctx.fillStyle = TEAMS[T2].bg; ctx.fillRect(W / 2, 0, W / 2, H);
  }
  ctx.setLineDash([10, 10]); ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 2;
  ctx.beginPath();
  if (SPLIT_H) { const mid = (HUD_H + H - FOOT_H) / 2; ctx.moveTo(0, mid); ctx.lineTo(W, mid); }
  else { ctx.moveTo(W / 2, HUD_H - 6); ctx.lineTo(W / 2, H - FOOT_H); }
  ctx.stroke();
  ctx.setLineDash([]);

  const { alive, total } = countTeams();
  drawLegend();                                  // under the fighters so it never hides them

  for (const r of rings) {
    const k = 1 - r.t / r.max;
    ctx.strokeStyle = `rgba(253,224,71,${1 - k})`; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(r.p.x, r.p.y, r.p.r + k * R * 3, 0, Math.PI * 2); ctx.stroke();
  }

  const showNames = alive[T1] + alive[T2] <= 80;
  for (const p of players.values()) if (p.alive) drawPlayer(p, showNames);
  drawEffects();
  for (const pr of projectiles) drawMissile(pr);

  for (const p of particles) {
    ctx.globalAlpha = clamp(p.t * 2, 0, 1); ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
  }
  ctx.globalAlpha = 1;

  for (const f of floaters) {
    ctx.globalAlpha = clamp(f.t * 2, 0, 1);
    const size = f.size || (f.big ? 15 : 11), half = String(f.text).length * size * 0.34;
    text(f.text, clamp(f.x, half + 4, W - half - 4), f.y, size, f.color);   // keep it on screen near the edges
  }
  ctx.globalAlpha = 1;

  drawHud();
  drawTestButtons();
}

let last = performance.now();
let running = false;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (running) { update(dt); render(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------- settings screen
const $ = id => document.getElementById(id);
const STORE_KEY = "ball-battle-settings-v2";
const BG_KEY = "ball-battle-custom-bg-v1";     // the uploaded image lives apart from the small settings JSON

const DEFAULT_SETTINGS = {
  username: "",
  demo: false,
  layout: "left-right",
  background: "night",
  max_per_team: 120,
  base_hp: 3000,
  base_damage: 8,
  burst_size: 3,
  fire_interval: 1.8,
  missile_speed: 650,
  teams: [
    { key: "A", name: "Team A", color: "#3b82f6" },
    { key: "B", name: "Team B", color: "#ef4444" },
  ],
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (saved) return { ...DEFAULT_SETTINGS, ...saved, teams: saved.teams || DEFAULT_SETTINGS.teams };
  } catch (e) { /* fall through to defaults */ }
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

let customBgData = null;
try { customBgData = localStorage.getItem(BG_KEY); } catch (e) { /* storage unavailable: start without a saved image */ }

function updateBgPreview() {
  const name = $("background").value;
  $("bgfile-row").classList.toggle("hidden", name !== "custom");
  const pv = $("bgpreview"), g = pv.getContext("2d");
  const draw = bg => { g.clearRect(0, 0, pv.width, pv.height); g.drawImage(bg, 0, 0, pv.width, pv.height); };
  makeBackground(name, customBgData, draw);
}

function fillForm(s) {
  $("background").value = s.background;
  $("username").value = s.username;
  $("demo").checked = s.demo;
  $("layout").value = s.layout;
  $("max_per_team").value = s.max_per_team;
  $("base_hp").value = s.base_hp;
  $("base_damage").value = s.base_damage;
  $("burst_size").value = s.burst_size;
  $("fire_interval").value = s.fire_interval;
  $("missile_speed").value = s.missile_speed;
  [1, 2].forEach((n, i) => {
    $(`key${n}`).value = s.teams[i].key;
    $(`name${n}`).value = s.teams[i].name;
    $(`color${n}`).value = s.teams[i].color;
  });
}

function num(id, fallback, min, max) {
  const v = parseFloat($(id).value);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

// Reads the form; returns { settings } or { error }.
function readForm() {
  const teams = [1, 2].map(n => ({
    key: $(`key${n}`).value.trim().toUpperCase().slice(0, 3),
    name: $(`name${n}`).value.trim() || `Team ${n}`,
    color: $(`color${n}`).value,
  }));
  if (!teams[0].key || !teams[1].key) return { error: "팀 키를 입력해 주세요." };
  if (teams[0].key === teams[1].key) return { error: "두 팀의 키는 서로 달라야 해요." };

  const demo = $("demo").checked;
  const username = $("username").value.trim();
  if (!demo && !username) return { error: "TikTok 아이디를 입력하거나 데모 모드를 켜 주세요." };
  const background = $("background").value;
  if (background === "custom" && !customBgData) return { error: "배경으로 쓸 이미지를 선택해 주세요." };

  return {
    settings: {
      username, demo, teams, background,
      layout: $("layout").value,
      max_per_team: num("max_per_team", 120, 2, 300),
      base_hp: num("base_hp", 3000, 100, 1000000),
      base_damage: num("base_damage", 8, 1, 10000),
      burst_size: Math.round(num("burst_size", 3, 1, 10)),
      fire_interval: num("fire_interval", 1.8, 0.3, 10),
      missile_speed: num("missile_speed", 650, 100, 3000),
    },
  };
}

function toGameConfig(s) {
  return {
    max_per_team: s.max_per_team, layout: s.layout,
    base_hp: s.base_hp, base_damage: s.base_damage,
    burst_size: s.burst_size, burst_gap: 0.11, fire_interval: s.fire_interval, missile_speed: s.missile_speed,
    boost: {
      base_seconds: 15, seconds_per_doubling: 12, max_seconds_per_gift: 120, max_total_seconds: 180,
      tier_diamonds: [1, 10, 50, 200, 1000],
    },
    teams: s.teams,
  };
}

// ---------------------------------------------------------------- run / stop
let demoTimer = null;
const DEMO_GIFTS = [["Rose", 1], ["Finger Heart", 5], ["Rosa", 10], ["Perfume", 20], ["Doughnut", 30], ["Hand Heart", 100],
                    ["Hearts", 199], ["Boxing Gloves", 299], ["Money Gun", 500], ["Galaxy", 1000], ["TikTok Universe", 44999]];

function resetGame() {
  players.clear(); pending.clear();
  projectiles = []; particles = []; floaters = []; rings = []; beams = []; blasts = []; wells = []; zones = [];
  socialDone.clear();
  clock = 0;
  statusText = ""; statusState = "idle";
}

function startDemo() {
  const keys = TEAM_IDS.map(id => TEAMS[id].key);
  const chatter = ["lol", "go go go", "hello", "gg"];
  demoTimer = setInterval(() => {
    const uid = "demo" + Math.floor(rand(0, 60));
    if (Math.random() < 0.06) {
      const [gift, price] = DEMO_GIFTS[Math.floor(rand(0, DEMO_GIFTS.length))];
      handle({ type: "gift", uid, nick: uid, avatar: null, gift, count: 1, diamonds: price });
    } else {
      const text = Math.random() < 0.7 ? keys[Math.floor(rand(0, 2))] : chatter[Math.floor(rand(0, chatter.length))];
      handle({ type: "comment", uid, nick: uid, avatar: null, text });
    }
  }, 350);
}

function startGame(settings) {
  applyConfig(toGameConfig(settings));
  resetGame();
  bgCanvas = makeBackground(settings.background, customBgData);
  $("setup").classList.add("hidden");
  resize();
  running = true;
  demoMode = settings.demo;

  if (settings.demo) {
    statusText = "Demo mode"; statusState = "connected";
    startDemo();
  } else {
    statusText = `Connecting to ${settings.username}...`; statusState = "idle";
    window.battle.connect(settings.username);
  }
}

function stopGame() {
  running = false;
  demoMode = false;
  cv.style.cursor = "default";
  if (demoTimer) { clearInterval(demoTimer); demoTimer = null; }
  window.battle.disconnect();
  $("setup").classList.remove("hidden");
}

$("start").addEventListener("click", () => {
  const r = readForm();
  if (r.error) { $("error").textContent = r.error; return; }
  $("error").textContent = "";
  localStorage.setItem(STORE_KEY, JSON.stringify(r.settings));
  startGame(r.settings);
});
$("reset").addEventListener("click", () => { fillForm(DEFAULT_SETTINGS); updateBgPreview(); $("error").textContent = ""; });

BG_OPTIONS.forEach(([value, label]) => $("background").add(new Option(label, value)));
$("background").addEventListener("change", updateBgPreview);
$("bgfile").addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    // shrink big photos so the saved copy stays small
    const k = Math.min(1, 1080 / img.naturalWidth, 1920 / img.naturalHeight);
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    customBgData = c.toDataURL("image/jpeg", 0.82);
    try { localStorage.setItem(BG_KEY, customBgData); } catch (err) { /* too big to keep: usable until the app closes */ }
    URL.revokeObjectURL(url);
    $("bgname").textContent = file.name;
    updateBgPreview();
  };
  img.onerror = () => { $("error").textContent = "이미지를 불러오지 못했어요."; URL.revokeObjectURL(url); };
  img.src = url;
});
addEventListener("keydown", e => { if (e.key === "Escape" && running) stopGame(); });

// Test-mode buttons on the canvas (see legend.js).
function toLogical(e) {
  const r = cv.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
}
cv.addEventListener("mousemove", e => {
  if (!demoMode) return;
  testHover = testHitAt(...toLogical(e));
  cv.style.cursor = testHover ? "pointer" : "default";
});
cv.addEventListener("click", e => {
  if (!demoMode) return;
  const action = testHitAt(...toLogical(e));
  if (action) action();
});

// ---------------------------------------------------------------- events from the TikTok connection
window.battle.onEvent(handle);

fillForm(loadSettings());
updateBgPreview();
