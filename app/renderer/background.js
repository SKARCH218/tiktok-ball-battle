"use strict";
// Backdrops for the battlefield. Each preset is painted once into an offscreen canvas.

const BG_OPTIONS = [
  ["night", "밤하늘 (기본)"],
  ["space", "우주"],
  ["cyber", "사이버 그리드"],
  ["sunset", "노을"],
  ["forest", "숲"],
  ["ocean", "바다"],
  ["custom", "내 이미지..."],
];

let bgCanvas = null;

function seededRandom(seed) {          // deterministic, so a preset always looks the same
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function linearFill(g, stops) {
  const grad = g.createLinearGradient(0, 0, 0, H);
  stops.forEach(([at, color]) => grad.addColorStop(at, color));
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
}

function glow(g, x, y, radius, color) {
  const grad = g.createRadialGradient(x, y, 0, x, y, radius);
  grad.addColorStop(0, color);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

const PAINTERS = {
  night(g) {
    linearFill(g, [[0, "#0b0e17"], [1, "#101b31"]]);
  },

  space(g) {
    const rnd = seededRandom(7);
    linearFill(g, [[0, "#04030c"], [1, "#0b0921"]]);
    glow(g, 90, 240, 280, "rgba(124,58,237,0.30)");
    glow(g, 450, 600, 320, "rgba(37,99,235,0.24)");
    glow(g, 260, 880, 300, "rgba(219,39,119,0.18)");
    for (let i = 0; i < 260; i++) {
      g.globalAlpha = 0.35 + rnd() * 0.65;
      g.fillStyle = rnd() < 0.2 ? "#bfdbfe" : "#ffffff";
      g.beginPath(); g.arc(rnd() * W, rnd() * H, 0.3 + rnd() * 1.2, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  },

  cyber(g) {
    linearFill(g, [[0, "#0a0616"], [1, "#1c0b36"]]);
    glow(g, W / 2, H, 420, "rgba(217,70,239,0.35)");
    g.lineWidth = 1;
    for (let x = 0; x <= W; x += 45) {
      g.strokeStyle = x % 135 === 0 ? "rgba(217,70,239,0.34)" : "rgba(217,70,239,0.18)";
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
    }
    for (let y = 0; y <= H; y += 45) {
      g.strokeStyle = y % 135 === 0 ? "rgba(34,211,238,0.30)" : "rgba(34,211,238,0.14)";
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    }
  },

  sunset(g) {
    linearFill(g, [[0, "#1e1040"], [0.45, "#7c2d6b"], [1, "#c2410c"]]);
    glow(g, W / 2, 640, 240, "rgba(251,146,60,0.55)");
    g.fillStyle = "rgba(254,215,170,0.5)";
    g.beginPath(); g.arc(W / 2, 640, 110, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(0,0,0,0.28)";     // keep the players readable
    g.fillRect(0, 0, W, H);
  },

  forest(g) {
    const rnd = seededRandom(21);
    linearFill(g, [[0, "#04140c"], [1, "#0d3b26"]]);
    for (let i = 0; i < 8; i++) glow(g, rnd() * W, rnd() * H, 120 + rnd() * 120, "rgba(34,197,94,0.10)");
    for (let row = 0; row < 3; row++) {                        // pine silhouettes, farthest first
      g.fillStyle = `rgba(2,20,12,${0.35 + row * 0.2})`;
      const base = H - row * 40, size = 90 - row * 18;
      for (let x = -20; x < W + 40; x += size * 0.7) {
        const h = size * (1 + rnd() * 0.6);
        g.beginPath(); g.moveTo(x, base); g.lineTo(x + size / 2, base - h); g.lineTo(x + size, base); g.fill();
      }
    }
  },

  ocean(g) {
    linearFill(g, [[0, "#031a33"], [1, "#0a5c8f"]]);
    g.fillStyle = "rgba(186,230,253,0.05)";                    // light rays from the surface
    for (let i = 0; i < 5; i++) {
      const x = 40 + i * 120;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 70, 0); g.lineTo(x + 20, H); g.lineTo(x - 90, H); g.fill();
    }
    for (let i = 0; i < 32; i++) {
      const y = 60 + i * 30;
      g.strokeStyle = `rgba(125,211,252,${0.06 + (i % 4) * 0.03})`;
      g.lineWidth = 1.5;
      g.beginPath();
      for (let x = 0; x <= W; x += 10) {
        const yy = y + Math.sin(x / 38 + i * 1.3) * 6;
        x ? g.lineTo(x, yy) : g.moveTo(x, yy);
      }
      g.stroke();
    }
  },
};

// `custom` is a data URL. onReady(canvas) fires once everything is painted (custom images load asynchronously).
function makeBackground(name, customDataUrl, onReady) {
  const scale = 2;
  const c = document.createElement("canvas");
  c.width = W * scale; c.height = H * scale;
  const g = c.getContext("2d");
  g.scale(scale, scale);

  if (name === "custom" && customDataUrl) {
    PAINTERS.night(g);
    const img = new Image();
    img.onload = () => {
      const k = Math.max(W / img.naturalWidth, H / img.naturalHeight);           // cover fit
      const w = img.naturalWidth * k, h = img.naturalHeight * k;
      g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
      g.fillStyle = "rgba(0,0,0,0.35)";                                          // keep the players readable
      g.fillRect(0, 0, W, H);
      if (onReady) onReady(c);
    };
    img.src = customDataUrl;
  } else {
    (PAINTERS[name] || PAINTERS.night)(g);
    if (onReady) onReady(c);
  }
  return c;
}
