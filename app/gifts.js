// Turns raw TikTok chat/gift messages into the small events the game understands.

const STREAK_TTL_MS = 30000;

// TikTok sometimes sends a gift without its price. Known gifts get their price from this table
// (coins = diamonds in the gift data); anything still unknown counts as 1 so a gift is never dropped.
const KNOWN_PRICES = {
  rose: 1, "finger heart": 5, rosa: 10, perfume: 20, doughnut: 30, donut: 30, "hand heart": 100, "hand hearts": 100,
  heart: 199, hearts: 199, "boxing gloves": 299, "money gun": 500, galaxy: 1000, "tiktok universe": 44999, universe: 44999,
  장미: 1, "핑거 하트": 5, 로사: 10, 향수: 20, 도넛: 30, "손 하트": 100, 하트: 199, "권투 글러브": 299, 머니건: 500, 은하수: 1000,
};

function unitPrice(details, data) {
  const given = Number(details.diamondCount) || 0;
  if (given > 0) return given;
  const name = String(details.giftName || "").trim().toLowerCase();
  return KNOWN_PRICES[name] || 1;
}

function userInfo(user) {
  const id = String((user && (user.id || user.displayId)) || "");
  return {
    uid: id,
    nick: (user && (user.nickname || user.displayId)) || id,
    avatar: (user && user.avatarThumb && user.avatarThumb.urlList && user.avatarThumb.urlList[0]) || null,
  };
}

function chatEvent(data) {
  const { uid, nick, avatar } = userInfo(data.user);
  return uid ? { type: "comment", uid, nick, avatar, text: data.content || "" } : null;
}

function socialEvent(kind, data) {
  const { uid, nick, avatar } = userInfo(data.user);
  return uid ? { type: kind, uid, nick, avatar } : null;
}

// While a streakable (combo) gift is streaking, TikTok resends it with a growing repeatCount,
// so we only forward the increment and every diamond is counted exactly once.
function createGiftHandler(now = Date.now) {
  const streaks = new Map();

  return {
    clear: () => streaks.clear(),

    handle(data) {
      const { uid, nick, avatar } = userInfo(data.user);
      if (!uid) return null;

      const details = data.giftDetails || {};
      const key = `${uid}:${data.giftId}`;
      const repeat = Math.max(Number(data.repeatCount) || 1, 1);
      const t = now();

      let [last, ts] = streaks.get(key) || [0, 0];
      if (t - ts > STREAK_TTL_MS || repeat < last) last = 0;
      const delta = repeat - last;

      const streaking = Boolean(details.combo) && !data.repeatEnd;
      if (streaking) streaks.set(key, [repeat, t]);
      else streaks.delete(key);

      if (delta <= 0) return null;
      return {
        type: "gift", uid, nick, avatar,
        gift: details.giftName || "gift", count: delta,
        diamonds: delta * unitPrice(details, data),
      };
    },
  };
}

module.exports = { userInfo, chatEvent, socialEvent, createGiftHandler };
