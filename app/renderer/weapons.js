"use strict";
// Attack styles. What a viewer gifts decides how they shoot until the boost runs out:
// Rose -> homing petals, Donut -> rolling donut with splash, Ice Cream -> freezing cone,
// Lightning -> chain bolt, Laser -> piercing beam, Galaxy -> rainbow mega beam,
// Universe -> Gravity Falls (drags every enemy together, then one huge strike), and so on.
// Unknown gifts fall back to a ladder based on the diamond value of a single gift.

let beams = [];      // instant attacks (lightning / laser / galaxy), drawn for a split second
let blasts = [];     // expanding rings from splash hits
let wells = [];      // Gravity Falls vortexes
let zones = [];      // lingering poison mist from Perfume

const GRAVITY_PULL_TIME = 1.3;    // seconds spent dragging enemies in before the strike
const GRAVITY_DAMAGE_MULT = 6;    // times the caster's damage, to every enemy at once

// English names come from TikTok events; the Korean ones cover localised gift names.
const STYLE_RULES = [
  [/^rosa$|로사/, "rosa"],
  [/rose|장미/, "rose"],
  [/donut|doughnut|도넛/, "donut"],
  [/hand ?hearts?|손 ?하트/, "handheart"],
  [/finger ?heart|핑거 ?하트/, "heart"],
  [/^hearts?$|^하트$/, "heartstorm"],
  [/perfume|향수/, "perfume"],
  [/glove|boxing|punch|권투/, "glove"],        // before the generic heart rule: "gloves" contains "love"
  [/money ?gun|cash|머니건/, "money"],
  [/heart|\blove\b|kiss/, "heart"],
  [/ice ?cream|cone/, "icecream"],
  [/^tiktok$|music|note|guitar|piano|\bmic\b/, "note"],
  [/lightning|thunder|bolt|zeus|storm/, "lightning"],
  [/laser|beam|\bray\b/, "laser"],
  [/universe|black ?hole|gravity/, "gravity"],
  [/galaxy|nebula|cosmos|planet|은하/, "galaxy"],
  [/star/, "star"],
  [/crystal|diamond|gem/, "crystal"],
  [/rocket|missile|jet|plane|ufo/, "rocket"],
];

function styleForGift(name, unitDiamonds) {
  const n = String(name || "").trim().toLowerCase();
  for (const [re, style] of STYLE_RULES) if (re.test(n)) return style;
  if (unitDiamonds >= 10000) return "gravity";
  if (unitDiamonds >= 5000) return "galaxy";
  if (unitDiamonds >= 500) return "laser";
  if (unitDiamonds >= 100) return "lightning";
  if (unitDiamonds >= 20) return "rocket";
  if (unitDiamonds >= 5) return "crystal";
  return "star";
}

const BEAM_STYLES = new Set(["lightning", "laser", "galaxy"]);

// size / dmg / speed are multipliers; wobble = [amplitude rad, frequency]; turn = max turn rate (rad/s, 0 = perfect homing)
const MISSILE_CFG = {
  basic:    { size: 1.0, dmg: 1.0,  speed: 1.0 },
  star:     { size: 1.1, dmg: 1.0,  speed: 1.05 },
  rose:     { size: 1.2, dmg: 1.1,  speed: 0.9,  turn: 6, wobble: [0.45, 7] },
  donut:    { size: 1.5, dmg: 1.2,  speed: 0.75, splash: 55 },
  heart:    { size: 0.9, dmg: 0.55, speed: 0.95, turn: 4.5 },      // fired as a fan of three
  icecream: { size: 1.3, dmg: 1.0,  speed: 0.9,  freeze: 2.0 },
  note:     { size: 1.3, dmg: 0.9,  speed: 0.85, wobble: [0.9, 9] },
  crystal:  { size: 1.2, dmg: 1.0,  speed: 1.15, pierce: 3 },
  rocket:   { size: 1.4, dmg: 1.3,  speed: 1.0,  splash: 45 },
  rosa:       { size: 1.5, dmg: 1.3,  speed: 0.85, turn: 5, splash: 60 },       // big rose, petals burst on impact
  perfume:    { size: 1.3, dmg: 0.6,  speed: 0.9,  cloud: true },               // leaves a poison mist
  handheart:  { size: 2.4, dmg: 1.0,  speed: 0.6,  turn: 3, pierce: 6 },        // slow giant heart through the crowd
  heartstorm: { size: 0.85, dmg: 0.35, speed: 0.95, turn: 5 },                  // fired as a ring of six
  glove:      { size: 1.7, dmg: 2.2,  speed: 1.3,  knock: 150 },                // heavy punch, sends them flying
  money:      { size: 0.9, dmg: 0.5,  speed: 1.4 },                             // three bills per shot
};

const HIT_COLOR = {
  basic: "#ffffff", star: "#fde047", rose: "#f472b6", donut: "#f9a8d4", heart: "#fb7185",
  icecream: "#bae6fd", note: "#c4b5fd", crystal: "#7dd3fc", rocket: "#fb923c",
  rosa: "#dc2626", perfume: "#f9a8d4", handheart: "#f9a8d4", heartstorm: "#fb7185", glove: "#ef4444", money: "#4ade80",
};

// ---------------------------------------------------------------- helpers
function segDist2(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay, len2 = abx * abx + aby * aby;
  const t = len2 ? clamp(((px - ax) * abx + (py - ay) * aby) / len2, 0, 1) : 0;
  const cx = ax + abx * t - px, cy = ay + aby * t - py;
  return cx * cx + cy * cy;
}

function dealDamage(t, amount, owner, color = "#fff") {
  if (!t.alive) return;
  t.hp -= amount;
  t.flash = 0.12;
  if (floaters.length < 150) floaters.push({ x: t.x, y: t.y - t.r, text: String(Math.round(amount)), color, t: 0.6 });
  if (t.hp <= 0) kill(t, owner);
}

function enemiesNear(x, y, team, radius, except) {
  const out = [];
  for (const q of players.values()) {
    if (!q.alive || q.team === team || (except && except.has(q))) continue;
    if ((q.x - x) ** 2 + (q.y - y) ** 2 <= (radius + q.r) ** 2) out.push(q);
  }
  return out;
}

// ---------------------------------------------------------------- firing
function shoot(p) {
  if (!p.target || !p.target.alive) p.target = pickTarget(p);
  const t = p.target;
  if (!t) return;

  if (p.style === "gravity") {                       // one vortex per volley, not one per shot
    if (p.burstLeft === p.burst) fireGravity(p);
    return;
  }
  if (BEAM_STYLES.has(p.style)) { fireBeam(p, t, p.style); return; }

  const ang = Math.atan2(t.y - p.y, t.x - p.x);
  if (p.style === "heart") {
    for (const off of [-0.7, 0, 0.7]) fireMissile(p, t, ang + off);
  } else if (p.style === "heartstorm") {              // a ring of hearts that all curve in on the target
    for (let i = 0; i < 6; i++) fireMissile(p, t, ang + (i * Math.PI) / 3);
  } else if (p.style === "money") {
    for (const off of [-0.14, 0, 0.14]) fireMissile(p, t, ang + off);
  } else {
    fireMissile(p, t, ang);
  }
}

function fireMissile(p, target, ang) {
  const cfg = MISSILE_CFG[p.style] || MISSILE_CFG.basic;
  const speed = MISSILE_SPEED * cfg.speed;
  projectiles.push({
    style: p.style, x: p.x, y: p.y, heading: ang,
    vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, speed,
    r: (6 + p.tier * 2.5) * (R / 20) * cfg.size,
    dmg: p.dmg * cfg.dmg, team: p.team, owner: p, target,
    turn: cfg.turn || 0, wobble: cfg.wobble || null,
    splash: cfg.splash || 0, freeze: cfg.freeze || 0, pierce: cfg.pierce || 1,
    cloud: cfg.cloud || false, knock: cfg.knock || 0,
    hit: new Set(), life: 6, age: 0, spin: rand(0, 6.28),
  });
}

function fireBeam(p, t, style) {
  const scale = R / 20;
  if (style === "lightning") {
    const pts = [[p.x, p.y]], hit = new Set();
    let cur = t, dmg = p.dmg * 0.9;
    for (let i = 0; i < 4 && cur; i++) {
      dealDamage(cur, dmg, p, "#fde047");
      hit.add(cur);
      pts.push([cur.x, cur.y]);
      dmg *= 0.72;
      cur = enemiesNear(cur.x, cur.y, p.team, 170, hit).sort(
        (a, b) => (a.x - cur.x) ** 2 + (a.y - cur.y) ** 2 - ((b.x - cur.x) ** 2 + (b.y - cur.y) ** 2))[0];
    }
    beams.push({ kind: "lightning", pts, t: 0.22, max: 0.22, width: (3 + p.tier * 0.6) * scale });
    return;
  }

  // laser / galaxy: a straight beam through the target, hurting every enemy on the line
  const ang = Math.atan2(t.y - p.y, t.x - p.x);
  const ex = p.x + Math.cos(ang) * 2000, ey = p.y + Math.sin(ang) * 2000;
  const galaxy = style === "galaxy";
  const width = (galaxy ? 24 + p.tier * 2 : 7 + p.tier * 1.5) * scale;
  const dmg = p.dmg * (galaxy ? 1.2 : 0.7);
  for (const q of players.values()) {
    if (!q.alive || q.team === p.team) continue;
    if (segDist2(q.x, q.y, p.x, p.y, ex, ey) <= (q.r + width / 2) ** 2) dealDamage(q, dmg, p, galaxy ? "#f0abfc" : "#67e8f9");
  }
  const life = galaxy ? 0.4 : 0.2;
  beams.push({ kind: style, pts: [[p.x, p.y], [ex, ey]], t: life, max: life, width, team: p.team });
  if (galaxy) for (let i = 0; i < 14; i++) {
    const k = rand(0, Math.min(700, Math.hypot(ex - p.x, ey - p.y)));
    particles.push({ x: p.x + Math.cos(ang) * k, y: p.y + Math.sin(ang) * k, vx: rand(-40, 40), vy: rand(-40, 40),
      t: rand(0.4, 0.9), color: `hsl(${Math.floor(rand(0, 360))} 90% 70%)` });
  }
}

function fireGravity(p) {
  const [x0, y0, x1, y1] = teamRect(p.team === T1 ? T2 : T1);        // the middle of the enemy side
  wells.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, team: p.team, owner: p, dmg: p.dmg * GRAVITY_DAMAGE_MULT, t: 0, struck: false });
  floaters.push({ x: W / 2, y: H / 2 - 40, text: "GRAVITY FALLS", color: "#e879f9", t: 1.8, big: true, size: 34 });
}

function updateWells(dt) {
  for (const w of wells) {
    w.t += dt;
    if (w.struck) continue;
    for (const q of players.values()) {          // drag everyone toward the vortex; suspends their own movement
      if (!q.alive || q.team === w.team) continue;
      q.pullT = 0.15;
      const k = Math.min(1, dt * 3.5);
      q.x += (w.x - q.x) * k;
      q.y += (w.y - q.y) * k;
    }
    if (w.t >= GRAVITY_PULL_TIME) {              // the strike
      w.struck = true;
      for (const q of players.values()) {
        if (!q.alive || q.team === w.team) continue;
        dealDamage(q, w.dmg, w.owner, "#f0abfc");
        burst(q.x, q.y, "#f0abfc", 8);
      }
      blasts.push({ x: w.x, y: w.y, r: 520, t: 0.7, max: 0.7, color: "#e879f9" });
    }
  }
  wells = wells.filter(w => w.t < GRAVITY_PULL_TIME + 0.6);
}

// ---------------------------------------------------------------- flight
function onMissileHit(pr, t) {
  dealDamage(t, pr.dmg, pr.owner, HIT_COLOR[pr.style]);
  burst(pr.x, pr.y, HIT_COLOR[pr.style] || "#fff", 4);
  if (pr.freeze) t.slowT = pr.freeze;
  if (pr.cloud) zones.push({ x: t.x, y: t.y, r: 78, t: 3, max: 3, tick: 0, team: pr.team, owner: pr.owner, dmg: pr.owner.dmg * 0.25 });
  if (pr.knock) {                                    // punch them away from the shooter, then they drift back
    const a = Math.atan2(t.y - pr.owner.y, t.x - pr.owner.x);
    t.kvx = Math.cos(a) * pr.knock * 4; t.kvy = Math.sin(a) * pr.knock * 4;
    t.pullT = 0.6; t.slowT = Math.max(t.slowT || 0, 0.8);
  }
  if (pr.splash) {
    blasts.push({ x: t.x, y: t.y, r: pr.splash, t: 0.35, max: 0.35, color: HIT_COLOR[pr.style] });
    for (const q of enemiesNear(t.x, t.y, pr.team, pr.splash, new Set([t]))) dealDamage(q, pr.dmg * 0.5, pr.owner, HIT_COLOR[pr.style]);
  }
}

// Returns false when the projectile is used up.
function updateMissile(pr, dt) {
  pr.life -= dt; pr.age += dt;
  if (pr.life <= 0) return false;
  if (!pr.target || !pr.target.alive || pr.hit.has(pr.target)) {
    pr.target = nearestEnemy(pr.x, pr.y, pr.team, pr.hit);
    if (!pr.target) return false;
  }
  const t = pr.target;
  const dx = t.x - pr.x, dy = t.y - pr.y, dist = Math.hypot(dx, dy) || 1;

  let want = Math.atan2(dy, dx);
  if (pr.wobble) want += Math.sin(pr.age * pr.wobble[1]) * pr.wobble[0] * Math.min(1, dist / 140);
  if (pr.turn) {
    let d = want - pr.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const m = pr.turn * dt;
    pr.heading += clamp(d, -m, m);
  } else pr.heading = want;

  pr.vx = Math.cos(pr.heading) * pr.speed;
  pr.vy = Math.sin(pr.heading) * pr.speed;
  const nx = pr.x + pr.vx * dt, ny = pr.y + pr.vy * dt;
  pr.spin += dt * 8;

  // segment test so fast missiles can't skip over a target on a slow frame
  if (segDist2(t.x, t.y, pr.x, pr.y, nx, ny) <= (t.r + pr.r * 0.5) ** 2) {
    pr.x = nx; pr.y = ny;
    onMissileHit(pr, t);
    pr.hit.add(t);
    pr.pierce--;
    return pr.pierce > 0;
  }
  pr.x = nx; pr.y = ny;

  // style trails
  if (particles.length < 500) {
    if (pr.style === "rose" && Math.random() < 0.35)
      particles.push({ x: pr.x, y: pr.y, vx: rand(-25, 25), vy: rand(-10, 40), t: 0.7, color: Math.random() < 0.5 ? "#f472b6" : "#dc2626" });
    else if (pr.style === "icecream" && Math.random() < 0.4)
      particles.push({ x: pr.x, y: pr.y, vx: rand(-20, 20), vy: rand(-20, 20), t: 0.5, color: "#e0f2fe" });
    else if (pr.style === "note" && Math.random() < 0.25)
      particles.push({ x: pr.x, y: pr.y, vx: rand(-15, 15), vy: rand(-30, -5), t: 0.6, color: `hsl(${(clock * 300) % 360} 90% 70%)` });
  }
  return true;
}

function updateZones(dt) {
  for (const z of zones) {
    z.t -= dt; z.tick += dt;
    if (z.tick >= 0.5) {
      z.tick -= 0.5;
      for (const q of enemiesNear(z.x, z.y, z.team, z.r)) {
        dealDamage(q, z.dmg, z.owner, "#f9a8d4");
        q.slowT = Math.max(q.slowT || 0, 0.4);
      }
    }
  }
  zones = zones.filter(z => z.t > 0);
}

function updateEffects(dt) {
  updateWells(dt);
  updateZones(dt);
  beams = beams.filter(b => (b.t -= dt) > 0);
  blasts = blasts.filter(b => (b.t -= dt) > 0);
}

// ---------------------------------------------------------------- shapes (unit size ~1)
const STAR = new Path2D();
for (let i = 0; i < 10; i++) {
  const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 0.45 : 1.15;
  STAR[i ? "lineTo" : "moveTo"](Math.cos(a) * rr, Math.sin(a) * rr);
}
STAR.closePath();

const HEART = new Path2D();
HEART.moveTo(0, 0.95);
HEART.bezierCurveTo(-1.4, 0.0, -0.95, -1.05, 0, -0.35);
HEART.bezierCurveTo(0.95, -1.05, 1.4, 0.0, 0, 0.95);
HEART.closePath();

const CRYSTAL = new Path2D();
CRYSTAL.moveTo(1.5, 0); CRYSTAL.lineTo(0, 0.75); CRYSTAL.lineTo(-1.2, 0); CRYSTAL.lineTo(0, -0.75);
CRYSTAL.closePath();

const ROCKET = new Path2D();
ROCKET.moveTo(1.6, 0);
ROCKET.quadraticCurveTo(0.6, -0.6, -0.8, -0.5);
ROCKET.lineTo(-1.3, -1.0); ROCKET.lineTo(-1.0, 0);
ROCKET.lineTo(-1.3, 1.0); ROCKET.lineTo(-0.8, 0.5);
ROCKET.quadraticCurveTo(0.6, 0.6, 1.6, 0);
ROCKET.closePath();

const DONUT_DOUGH = new Path2D();
DONUT_DOUGH.arc(0, 0, 1.15, 0, Math.PI * 2); DONUT_DOUGH.arc(0, 0, 0.4, 0, Math.PI * 2);
const DONUT_ICING = new Path2D();
DONUT_ICING.arc(0, 0, 1.0, 0, Math.PI * 2); DONUT_ICING.arc(0, 0, 0.48, 0, Math.PI * 2);
const SPRINKLES = ["#fde047", "#4ade80", "#60a5fa", "#ffffff", "#fb923c", "#a78bfa", "#fde047", "#4ade80"];

// ---------------------------------------------------------------- drawing
function drawMissile(pr) {
  const teamColor = TEAMS[pr.team].color, r = pr.r, style = pr.style;
  const cos = Math.cos(pr.heading), sin = Math.sin(pr.heading);

  ctx.save();
  // trail + halo
  ctx.lineCap = "round";
  ctx.globalAlpha = 0.32;
  ctx.strokeStyle = HIT_COLOR[style] && style !== "basic" ? HIT_COLOR[style] : teamColor;
  ctx.lineWidth = r * 0.9;
  ctx.beginPath();
  ctx.moveTo(pr.x - cos * r * 3, pr.y - sin * r * 3);
  ctx.lineTo(pr.x, pr.y);
  ctx.stroke();
  ctx.globalAlpha = 0.25; ctx.fillStyle = teamColor;
  ctx.beginPath(); ctx.arc(pr.x, pr.y, r * 1.7, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;

  ctx.translate(pr.x, pr.y);
  ctx.strokeStyle = teamColor;
  ctx.lineWidth = 2;

  switch (style) {
    case "star":
      ctx.rotate(pr.spin); ctx.scale(r, r);
      ctx.lineWidth = 2 / r; ctx.fillStyle = "#fde047";
      ctx.fill(STAR); ctx.stroke(STAR);
      break;

    case "rose": {
      ctx.rotate(pr.heading);
      // stem and leaf trailing behind the bloom
      ctx.strokeStyle = "#16a34a"; ctx.lineWidth = r * 0.25;
      ctx.beginPath(); ctx.moveTo(-r * 0.6, 0); ctx.lineTo(-r * 2.2, 0); ctx.stroke();
      ctx.fillStyle = "#22c55e";
      ctx.beginPath(); ctx.ellipse(-r * 1.5, -r * 0.45, r * 0.5, r * 0.22, -0.5, 0, Math.PI * 2); ctx.fill();
      ctx.rotate(-pr.heading + pr.spin * 0.4);
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3;
        ctx.fillStyle = i % 2 ? "#dc2626" : "#ef4444";
        ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, r * 0.6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = "#7f1d1d";
      ctx.beginPath(); ctx.arc(0, 0, r * 0.42, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#fecaca"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.24, 0.3, 4.2); ctx.stroke();
      break;
    }

    case "donut":
      ctx.rotate(pr.spin * 0.6); ctx.scale(r, r);
      ctx.fillStyle = "#d9a066"; ctx.fill(DONUT_DOUGH, "evenodd");
      ctx.fillStyle = "#f472b6"; ctx.fill(DONUT_ICING, "evenodd");
      SPRINKLES.forEach((c, i) => {
        const a = i * Math.PI / 4 + 0.3, d = 0.74;
        ctx.save(); ctx.translate(Math.cos(a) * d, Math.sin(a) * d); ctx.rotate(a * 3);
        ctx.fillStyle = c; ctx.fillRect(-0.16, -0.05, 0.32, 0.1); ctx.restore();
      });
      break;

    case "heart": case "heartstorm": {
      const pulse = 1 + Math.sin(pr.spin * 2) * 0.1;
      ctx.scale(r * pulse, r * pulse);
      ctx.lineWidth = 2 / r; ctx.fillStyle = "#fb7185";
      ctx.fill(HEART); ctx.stroke(HEART);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.beginPath(); ctx.ellipse(-0.45, -0.3, 0.22, 0.12, -0.6, 0, Math.PI * 2); ctx.fill();
      break;
    }

    case "rosa": {
      ctx.rotate(pr.heading);
      ctx.strokeStyle = "#166534"; ctx.lineWidth = r * 0.3;
      ctx.beginPath(); ctx.moveTo(-r * 0.7, 0); ctx.lineTo(-r * 2.4, 0); ctx.stroke();
      ctx.fillStyle = "#16a34a";
      ctx.beginPath(); ctx.ellipse(-r * 1.4, -r * 0.5, r * 0.55, r * 0.22, -0.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-r * 1.9, r * 0.5, r * 0.55, r * 0.22, 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.rotate(-pr.heading + pr.spin * 0.3);
      for (let ring = 0; ring < 2; ring++) for (let i = 0; i < 7; i++) {
        const a = (i * 2 * Math.PI) / 7 + ring * 0.45, d = r * (0.78 - ring * 0.32);
        ctx.fillStyle = ring ? "#b91c1c" : "#dc2626";
        ctx.beginPath(); ctx.arc(Math.cos(a) * d, Math.sin(a) * d, r * (0.62 - ring * 0.14), 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = "#7f1d1d"; ctx.beginPath(); ctx.arc(0, 0, r * 0.34, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#fecaca"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.2, 0.3, 4.4); ctx.stroke();
      break;
    }

    case "perfume":
      ctx.rotate(pr.heading + pr.spin * 0.5); ctx.scale(r, r);
      ctx.fillStyle = "#f472b6"; ctx.strokeStyle = "#fbcfe8"; ctx.lineWidth = 0.08;
      ctx.beginPath(); ctx.roundRect(-0.8, -0.6, 1.6, 1.3, 0.25); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#fde68a"; ctx.fillRect(-0.25, -1.0, 0.5, 0.42); ctx.fillRect(-0.4, -1.25, 0.8, 0.28);
      ctx.fillStyle = "rgba(255,255,255,0.75)"; ctx.fillRect(-0.55, -0.25, 1.1, 0.5);
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.beginPath(); ctx.ellipse(-0.5, -0.3, 0.1, 0.3, 0.2, 0, Math.PI * 2); ctx.fill();
      break;

    case "handheart": {
      const pulse = 1 + Math.sin(pr.spin * 1.5) * 0.06;
      ctx.scale(r * pulse, r * pulse);
      const g = ctx.createLinearGradient(-1, -1, 1, 1);
      g.addColorStop(0, "#bfdbfe"); g.addColorStop(1, "#f9a8d4");
      ctx.lineWidth = 0.06; ctx.fillStyle = g; ctx.strokeStyle = "#ffffff";
      ctx.fill(HEART); ctx.stroke(HEART);
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      ctx.beginPath(); ctx.ellipse(-0.5, -0.35, 0.24, 0.13, -0.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fdba74";                                   // two hands cupping it
      ctx.beginPath(); ctx.ellipse(-0.6, 1.05, 0.55, 0.26, -0.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(0.6, 1.05, 0.55, 0.26, 0.4, 0, Math.PI * 2); ctx.fill();
      break;
    }

    case "glove":
      ctx.rotate(pr.heading); ctx.scale(r, r);
      ctx.fillStyle = "#ef4444"; ctx.strokeStyle = "#7f1d1d"; ctx.lineWidth = 0.08;
      ctx.beginPath(); ctx.arc(0.25, 0, 0.95, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(0.35, -0.85, 0.42, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#f9fafb"; ctx.fillRect(-1.25, -0.6, 0.65, 1.2); ctx.strokeRect(-1.25, -0.6, 0.65, 1.2);
      ctx.strokeStyle = "#3b82f6"; ctx.lineWidth = 0.12;
      ctx.beginPath(); ctx.moveTo(-0.95, -0.6); ctx.lineTo(-0.95, 0.6); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.beginPath(); ctx.ellipse(0.5, -0.3, 0.3, 0.16, -0.5, 0, Math.PI * 2); ctx.fill();
      break;

    case "money":
      ctx.rotate(pr.heading + Math.sin(pr.spin * 2) * 0.3); ctx.scale(r, r);
      ctx.fillStyle = "#4ade80"; ctx.strokeStyle = "#166534"; ctx.lineWidth = 0.1;
      ctx.beginPath(); ctx.roundRect(-1.1, -0.6, 2.2, 1.2, 0.12); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#16a34a"; ctx.beginPath(); ctx.arc(0, 0, 0.38, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#f0fdf4"; ctx.font = `700 0.6px ${FONT}`; ctx.textAlign = "center"; ctx.fillText("$", 0, 0.2);
      break;

    case "icecream":
      ctx.rotate(pr.heading); ctx.scale(r, r);
      ctx.fillStyle = "#d4a05a";
      ctx.beginPath(); ctx.moveTo(-1.5, 0); ctx.lineTo(0, -0.6); ctx.lineTo(0, 0.6); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(120,70,20,0.6)"; ctx.lineWidth = 0.06;
      ctx.beginPath(); ctx.moveTo(-0.9, -0.2); ctx.lineTo(-0.1, 0.4); ctx.moveTo(-0.9, 0.2); ctx.lineTo(-0.1, -0.4); ctx.stroke();
      ctx.fillStyle = "#f9a8d4"; ctx.beginPath(); ctx.arc(0.25, 0, 0.7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#99f6e4"; ctx.beginPath(); ctx.arc(0.85, 0, 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#dc2626"; ctx.beginPath(); ctx.arc(1.25, -0.05, 0.16, 0, Math.PI * 2); ctx.fill();
      break;

    case "note":
      ctx.font = `700 ${r * 3.2}px ${FONT}`; ctx.textAlign = "center";
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.strokeText("♪", 0, r * 1.0);
      ctx.fillStyle = `hsl(${(clock * 300 + pr.spin * 40) % 360} 90% 68%)`;
      ctx.fillText("♪", 0, r * 1.0);
      break;

    case "crystal":
      ctx.rotate(pr.heading); ctx.scale(r, r);
      ctx.lineWidth = 2 / r; ctx.fillStyle = "#7dd3fc";
      ctx.fill(CRYSTAL); ctx.stroke(CRYSTAL);
      ctx.strokeStyle = "#fff"; ctx.beginPath();
      ctx.moveTo(-1.2, 0); ctx.lineTo(1.5, 0); ctx.moveTo(0, -0.75); ctx.lineTo(0, 0.75); ctx.stroke();
      break;

    case "rocket":
      ctx.rotate(pr.heading); ctx.scale(r, r);
      ctx.fillStyle = "#fb923c";
      ctx.beginPath(); ctx.moveTo(-1.1, 0); ctx.lineTo(-2.4 - Math.random() * 0.6, 0.35); ctx.lineTo(-2.4 - Math.random() * 0.6, -0.35); ctx.closePath(); ctx.fill();
      ctx.lineWidth = 2 / r; ctx.fillStyle = "#e5e7eb";
      ctx.fill(ROCKET); ctx.stroke(ROCKET);
      break;

    default: // basic
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

function jagged(pts, amount) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const n = Math.max(3, Math.floor(Math.hypot(bx - ax, by - ay) / 24));
    const nx = -(by - ay), ny = bx - ax, nl = Math.hypot(nx, ny) || 1;
    for (let k = 1; k < n; k++) {
      const f = k / n, o = rand(-amount, amount);
      out.push([ax + (bx - ax) * f + (nx / nl) * o, ay + (by - ay) * f + (ny / nl) * o]);
    }
    out.push(pts[i]);
  }
  return out;
}

function strokePath(pts, width, style, alpha) {
  ctx.globalAlpha = alpha; ctx.strokeStyle = style; ctx.lineWidth = width;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
}

function drawEffects() {
  ctx.save();
  ctx.lineCap = "round"; ctx.lineJoin = "round";

  for (const w of wells) {
    if (!w.struck) {
      for (let i = 0; i < 5; i++) {              // rings collapsing into the core
        const ph = (w.t * 1.4 + i / 5) % 1;
        ctx.globalAlpha = 0.15 + ph * 0.6; ctx.strokeStyle = i % 2 ? "#c084fc" : "#7c3aed"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(w.x, w.y, (1 - ph) * 190, 0, Math.PI * 2); ctx.stroke();
      }
      const core = 46 + (w.t / GRAVITY_PULL_TIME) * 30;
      const g = ctx.createRadialGradient(w.x, w.y, 0, w.x, w.y, core * 1.8);
      g.addColorStop(0, "#000000"); g.addColorStop(0.55, "#000000"); g.addColorStop(0.75, "rgba(168,85,247,0.85)"); g.addColorStop(1, "rgba(168,85,247,0)");
      ctx.globalAlpha = 1; ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(w.x, w.y, core * 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#f5d0fe";
      for (let j = 0; j < 26; j++) {             // debris spiralling in
        const ph = (j / 26 + w.t * 0.8) % 1, a = j * 0.9 + w.t * 7 + ph * 5, rad = (1 - ph) * 175;
        ctx.globalAlpha = 0.9 * ph + 0.1;
        ctx.beginPath(); ctx.arc(w.x + Math.cos(a) * rad, w.y + Math.sin(a) * rad, 2.2, 0, Math.PI * 2); ctx.fill();
      }
    } else {
      const fade = 1 - (w.t - GRAVITY_PULL_TIME) / 0.6;   // screen-wide flash when it lands
      ctx.globalAlpha = Math.max(0, fade) * 0.75; ctx.fillStyle = "#f5d0fe";
      ctx.fillRect(0, 0, W, H);
    }
  }
  ctx.globalAlpha = 1;

  for (const z of zones) {                                        // poison mist
    const k = z.t / z.max;
    const g = ctx.createRadialGradient(z.x, z.y, 0, z.x, z.y, z.r);
    g.addColorStop(0, `rgba(244,114,182,${0.15 + 0.3 * k})`); g.addColorStop(1, "rgba(244,114,182,0)");
    ctx.globalAlpha = 1; ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fbcfe8";
    for (let j = 0; j < 9; j++) {
      const a = j * 0.7 + clock * 1.1, rr = z.r * (((j % 4) + 1) / 5);
      ctx.globalAlpha = 0.65 * k;
      ctx.beginPath(); ctx.arc(z.x + Math.cos(a) * rr, z.y + Math.sin(a) * rr - ((clock * 24 + j * 13) % 18), 2.6, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  for (const b of blasts) {
    const k = 1 - b.t / b.max;
    ctx.globalAlpha = 1 - k; ctx.strokeStyle = b.color; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * (0.3 + 0.7 * k), 0, Math.PI * 2); ctx.stroke();
  }

  for (const b of beams) {
    const fade = b.t / b.max;
    if (b.kind === "lightning") {
      const pts = jagged(b.pts, 14);
      strokePath(pts, b.width * 3, "#fde047", 0.3 * fade);
      strokePath(pts, b.width, "#ffffff", fade);
    } else if (b.kind === "laser") {
      const c = TEAMS[b.team].color;
      strokePath(b.pts, b.width * 2.6, c, 0.3 * fade);
      strokePath(b.pts, b.width * 1.2, "#67e8f9", 0.8 * fade);
      strokePath(b.pts, b.width * 0.45, "#ffffff", fade);
    } else { // galaxy: rainbow mega beam
      const [[ax, ay], [bx, by]] = b.pts;
      const g = ctx.createLinearGradient(ax, ay, bx, by);
      for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${(clock * 240 + i * 60) % 360} 95% 62%)`);
      strokePath(b.pts, b.width * 2, g, 0.28 * fade);
      strokePath(b.pts, b.width, g, 0.9 * fade);
      strokePath(b.pts, b.width * 0.35, "#ffffff", fade);
    }
  }
  ctx.restore();
}
