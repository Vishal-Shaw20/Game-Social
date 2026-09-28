// Small formatting helpers shared by the game page sections.

export const API = import.meta.env.VITE_API_URL;

export function compact(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function full(n) {
  if (n == null) return null;
  return new Intl.NumberFormat().format(n);
}

// Minutes (Steam/SteamSpy) -> "42.5 h"
export function hoursFromMinutes(min) {
  if (!min) return null;
  const h = min / 60;
  return `${h >= 100 ? Math.round(h) : Math.round(h * 10) / 10} h`;
}

export function hours(h) {
  if (h == null) return null;
  return `${h >= 100 ? Math.round(h) : Math.round(h * 10) / 10} h`;
}

export function date(d, opts = { day: "numeric", month: "short", year: "numeric" }) {
  if (!d) return null;
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? null : x.toLocaleDateString(undefined, opts);
}

export function timeAgo(d) {
  if (!d) return null;
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "just now";
  const units = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [u, sec] of units) {
    const v = Math.floor(s / sec);
    if (v >= 1) return `${v} ${u}${v > 1 ? "s" : ""} ago`;
  }
  return "just now";
}

// Steam's review_score 1..9 -> colour of its label
export function steamReviewColor(score) {
  if (score >= 7) return "#66c0f4";
  if (score >= 5) return "#b9a074";
  return "#c35c2c";
}

export const VERDICT_META = {
  perfection: { label: "Instant classic", color: "#a371f7" },
  almost_good: { label: "Almost there", color: "#2ea043" },
  subpar: { label: "Subpar slop", color: "#d29922" },
  awful_fun: { label: "Hot mess", color: "#f85149" },
};

export const AGE_BOARDS = {
  esrb: "ESRB", pegi: "PEGI", usk: "USK", cero: "CERO", dejus: "ClassInd",
  oflc: "ACB", nzoflc: "OFLC NZ", kgrb: "GRAC", csrr: "CSRR", fpb: "FPB", crl: "CRL",
};

/** The signed-in user's published review in a list, if any (one per game). */
export function findMyReview(reviews, userId) {
  if (!userId) return null;
  return reviews.find((r) => String(r.userId?._id ?? r.userId) === String(userId)) ?? null;
}
