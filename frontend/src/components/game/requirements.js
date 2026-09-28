// src/components/game/requirements.js
//
// System requirements into rows for a Minimum / Recommended table.
//
// Steam sends each level as a small HTML list ("<strong>Minimum:</strong>
// <ul><li><strong>OS:</strong> Windows 10</li>…"); games RAWG knows but
// Steam doesn't come as plain text ("Minimum: OS: Windows 7 CPU: … RAM: …").
// Both become { fields: [[label, value]], lines: [], notes: [[label, text]] }:
// labelled fields under one name per kind (CPU and Processor are one row),
// unlabelled lines ("Requires a 64-bit processor…"), and long notes (notices,
// Additional Notes) kept apart from the table.

// Canonical row names, in table order; synonyms map onto them.
const ORDER = ["OS", "Processor", "Memory", "Graphics", "Video memory", "DirectX", "Network", "Storage", "Sound card", "VR support", "Settings"];
const SYNONYMS = {
  os: "OS", "os *": "OS", "operating system": "OS",
  processor: "Processor", cpu: "Processor",
  memory: "Memory", ram: "Memory", "system memory": "Memory",
  graphics: "Graphics", gpu: "Graphics", "video card": "Graphics", "graphics card": "Graphics", video: "Graphics",
  vram: "Video memory", "video memory": "Video memory",
  directx: "DirectX", "direct x": "DirectX",
  network: "Network", internet: "Network",
  storage: "Storage", "storage space": "Storage", "available storage space": "Storage", "hard drive": "Storage", "hdd space": "Storage", "hard disk space": "Storage", "disk space": "Storage",
  "sound card": "Sound card", sound: "Sound card",
  "vr support": "VR support",
  "gfx setting game can be played on": "Settings", "graphics settings": "Settings", "graphics preset": "Settings",
};

// Plain text is split only at labels we know (longest first), so a value
// with capitals and colons in it ("Intel Core i5 or AMD FX") stays whole.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TEXT_LABEL_RE = new RegExp(
  `(?:^|\\s)(${[...Object.keys(SYNONYMS), "additional notes", "notes", "notice"]
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join("|")})\\s*:\\s*`,
  "gi"
);
const NOTE_LABELS = /^(additional notes?|notes?|notice|important notice)/i;

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").replace(/\s+([,.;])/g, "$1").trim();

function place(out, rawLabel, value) {
  const label = clean(rawLabel).replace(/:$/, "");
  const text = clean(value);
  if (!label) {
    if (text) out.lines.push(text);
    return;
  }
  const known = SYNONYMS[label.toLowerCase()];
  if (known) {
    if (text) out.fields.push([known, text]);
  } else if (NOTE_LABELS.test(label) || label.length > 32) {
    // a notice, or a "label" that is really a sentence
    out.notes.push([NOTE_LABELS.test(label) ? label.replace(/^./, (c) => c.toUpperCase()) : "", text ? `${label.length > 32 ? `${label} ` : ""}${text}` : label]);
  } else if (text) {
    out.fields.push([label.replace(/^./, (c) => c.toUpperCase()), text]);
  }
}

function fromHtml(html) {
  const out = { fields: [], lines: [], notes: [] };
  const doc = new DOMParser().parseFromString(html, "text/html");
  const items = doc.querySelectorAll("li");
  const blocks = items.length ? [...items] : [doc.body];
  for (const el of blocks) {
    const strong = el.querySelector("strong");
    const full = clean(el.textContent);
    if (!full || /^(minimum|recommended):?$/i.test(full)) continue;
    const label = strong ? clean(strong.textContent) : "";
    if (strong && /^(minimum|recommended):?$/i.test(label)) {
      const rest = clean(full.slice(full.indexOf(label) + label.length));
      if (rest) place(out, "", rest);
      continue;
    }
    place(out, label, strong ? full.slice(full.indexOf(label) + label.length) : full);
  }
  return out;
}

function fromText(text) {
  const out = { fields: [], lines: [], notes: [] };
  const t = clean(text).replace(/^(minimum|recommended):\s*/i, "");
  // "Label: value" runs, split at the labels we know.
  const marks = [];
  for (const m of t.matchAll(TEXT_LABEL_RE)) {
    marks.push({ label: m[1], at: m.index, end: m.index + m[0].length });
  }
  if (!marks.length) {
    if (t) out.lines.push(t);
    return out;
  }
  if (marks[0].at > 0) place(out, "", t.slice(0, marks[0].at));
  marks.forEach((mk, i) => place(out, mk.label, t.slice(mk.end, marks[i + 1]?.at ?? t.length)));
  return out;
}

export function parseRequirement(src) {
  if (!src) return null;
  const parsed = /<[a-z][\s\S]*>/i.test(src) ? fromHtml(src) : fromText(src);
  return parsed.fields.length || parsed.lines.length || parsed.notes.length ? parsed : null;
}

/**
 * One platform's requirements as table rows: [{ label, min, rec }] in a set
 * order, plus the unlabelled lines and the notes of both levels (each note
 * tagged with its level when there are two).
 */
export function requirementRows(req) {
  const min = parseRequirement(req?.minimum);
  const rec = parseRequirement(req?.recommended);
  const labels = [...new Set([...(min?.fields ?? []), ...(rec?.fields ?? [])].map(([l]) => l))];
  labels.sort((a, b) => {
    const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const get = (p, l) => p?.fields.filter(([x]) => x === l).map(([, v]) => v).join(" · ") || null;
  const tag = (p, level) => (p?.notes ?? []).map(([label, text]) => ({ level: min && rec ? level : null, label, text }));
  return {
    rows: labels.map((label) => ({ label, min: get(min, label), rec: get(rec, label) })),
    lines: [...new Set([...(min?.lines ?? []), ...(rec?.lines ?? [])])],
    notes: [...tag(min, "Minimum"), ...tag(rec, "Recommended")],
    hasMin: Boolean(min),
    hasRec: Boolean(rec),
  };
}
