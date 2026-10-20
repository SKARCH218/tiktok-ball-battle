"use strict";
// Bottom-right list, one row per gift: [gift icon] SKILL NAME
// (keep the skills in sync with STYLE_RULES in weapons.js).
// In test (demo) mode every row gets a ▶ button that fires that skill on the spot.

const LEGEND = [
  ["rose", "Petal Storm", "Rose", 1],
  ["finger-heart", "Heart Fan", "Finger Heart", 5],
  ["rosa", "Crimson Bloom", "Rosa", 10],
  ["perfume", "Poison Mist", "Perfume", 20],
  ["doughnut", "Donut Blast", "Doughnut", 30],
  ["hand-hearts", "Love Wave", "Hand Heart", 100],
  ["heart", "Heart Storm", "Hearts", 199],
  ["boxing-gloves", "Knockout Punch", "Boxing Gloves", 299],
  ["money-gun", "Cash Storm", "Money Gun", 500],
  ["galaxy", "Galaxy Beam", "Galaxy", 1000],
  ["universe", "Gravity Falls", "TikTok Universe", 44999],
].map(([file, label, gift, price]) => {
  const icon = new Image();
  icon.src = `gifts/${file}.webp`;
  return { icon, label: label.toUpperCase(), gift, price };
});

const LEGEND_SIZE = 26, LEGEND_GAP = 4;
let demoMode = false;          // set by startGame
let testRects = [];            // clickable test buttons, rebuilt every frame
let testHover = null;

function drawLegend() {
  const margin = 10, labelGap = 8;

  ctx.save();
  ctx.font = `800 12px ${FONT}`;
  const textWidth = Math.max(...LEGEND.map(l => ctx.measureText(l.label).width));
  const x = W - margin - (LEGEND_SIZE + labelGap + textWidth);   // the block hugs the right edge, rows stay left-aligned
  let y = H - 12 - LEGEND.length * (LEGEND_SIZE + LEGEND_GAP);

  ctx.globalAlpha = 0.95;
  for (const { icon, label } of LEGEND) {
    if (icon.complete && icon.naturalWidth) ctx.drawImage(icon, x, y, LEGEND_SIZE, LEGEND_SIZE);
    text(label, x + LEGEND_SIZE + labelGap, y + LEGEND_SIZE / 2 + 4, 12, "#ffffff", "left", "800");
    y += LEGEND_SIZE + LEGEND_GAP;
  }
  ctx.restore();

  legendX = x;
}
let legendX = 0;

// ---------------------------------------------------------------- test mode buttons (drawn above the fighters)
function button(x, y, w, h, label, action) {
  const rect = { x, y, w, h, action };
  testRects.push(rect);
  const hot = testHover === rect.action;
  ctx.save();
  ctx.fillStyle = hot ? "rgba(253,224,71,0.9)" : "rgba(0,0,0,0.6)";
  ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.fill(); ctx.stroke();
  ctx.restore();
  text(label, x + w / 2, y + h / 2 + 4, 11, hot ? "#111" : "#fff", "center", "800");
}

function drawTestButtons() {
  testRects = [];
  if (!demoMode) return;

  const top = H - 12 - LEGEND.length * (LEGEND_SIZE + LEGEND_GAP);
  const bx = legendX - LEGEND_SIZE - 8;
  LEGEND.forEach((row, i) => {
    button(bx, top + i * (LEGEND_SIZE + LEGEND_GAP), LEGEND_SIZE, LEGEND_SIZE, "▶", () => testSkill(row));
  });
  button(bx - 44, top - 34, 68, 24, "♥ LIKE", () => testSocial("like"));
  button(bx + 30, top - 34, 82, 24, "＋ FOLLOW", () => testSocial("follow"));
}

function testHitAt(lx, ly) {
  return (testRects.find(r => lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h) || {}).action || null;
}

// ---------------------------------------------------------------- test mode actions
let testSeq = 0;

function spawnTester(team, nick) {
  const uid = `test_${++testSeq}`;
  onComment({ uid, nick, text: TEAMS[team].key, avatar: null });
  const p = players.get(uid);
  if (p) p.test = true;
  return p;
}

function aliveTester(team) {
  for (const p of players.values()) if (p.test && p.alive && p.team === team) return p;
  return null;
}

// Fires one skill from a test player on team 1, with a few dummies standing on team 2.
function testSkill(row) {
  const shooter = aliveTester(T1) || spawnTester(T1, "TESTER");
  let dummies = 0;
  for (const p of players.values()) if (p.alive && p.team === T2) dummies++;
  for (; dummies < 5; dummies++) spawnTester(T2, "DUMMY");
  if (!shooter) return;

  shooter.boost = 0; shooter.boostT = 0; shooter.turns = 0;          // every test starts from the same power
  handle({ type: "gift", uid: shooter.uid, nick: shooter.name, gift: row.gift, count: 1, diamonds: row.price });
  shooter.cd = 0; shooter.burstLeft = 0; shooter.target = null;   // fire right away
}

function testSocial(kind) {
  const viewer = spawnTester(Math.random() < 0.5 ? T1 : T2, kind === "like" ? "LIKER" : "FOLLOWER");
  if (viewer) handle({ type: kind, uid: viewer.uid, nick: viewer.name, avatar: null });
}
