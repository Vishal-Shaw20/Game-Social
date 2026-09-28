import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ImagePlus, X } from "lucide-react";
import Avatar from "./Avatar";
import GamePicker from "./GamePicker";
import styles from "./Profile.module.css";

const API = import.meta.env.VITE_API_URL;
const MAX_BIO = 160;
const AVATAR_PX = 256;
const MAX_AVATAR_CHARS = 90_000;

// A picked image, cropped to a centred square and shrunk to 256 px, as a
// data URL small enough to store (WebP where the browser can make it).
async function toAvatar(file) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = AVATAR_PX;
  canvas
    .getContext("2d")
    .drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
  for (const q of [0.85, 0.7, 0.55]) {
    let url = canvas.toDataURL("image/webp", q);
    if (!url.startsWith("data:image/webp")) url = canvas.toDataURL("image/jpeg", q);
    if (url.length <= MAX_AVATAR_CHARS) return url;
  }
  throw new Error("too big");
}

/*
 * Edit your profile, over the page: your picture (Steam's, Google's, one you
 * upload, or just your initial), name, username, a short bio, a favourite
 * game and a banner (a game's art, or automatically your most played
 * games). Only what changed is saved. Escape or the dimmed page closes it.
 */
export default function EditProfile({ profile, accent, onClose, onSaved }) {
  const [form, setForm] = useState({
    displayName: profile.displayName ?? "",
    username: profile.username ?? "",
    bio: profile.bio ?? "",
  });
  const opts = profile.avatarOptions;
  const current =
    profile.avatarSource ??
    (profile.avatar
      ? profile.avatar === opts.steam ? "steam" : profile.avatar === opts.google ? "google" : profile.avatar === opts.upload ? "upload" : null
      : "none");
  const [source, setSource] = useState(current);
  const [upload, setUpload] = useState(null); // a new picture's data URL
  const [fav, setFav] = useState(profile.favoriteGame);
  const [banner, setBanner] = useState(profile.banner);
  const [bannerOn, setBannerOn] = useState(Boolean(profile.banner));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    const key = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);

  const pickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/^image\//.test(file.type)) return setError("Pick an image file.");
    if (file.size > 8 * 1024 * 1024) return setError("That image is over 8 MB. Pick a smaller one.");
    try {
      setUpload(await toAvatar(file));
      setSource("upload");
      setError(null);
    } catch {
      setError("That image couldn't be used. Try another.");
    }
  };

  const save = async () => {
    const patch = {};
    if (form.displayName.trim() !== (profile.displayName ?? "")) patch.displayName = form.displayName;
    if (form.username.trim() !== (profile.username ?? "")) patch.username = form.username;
    if (form.bio.trim() !== (profile.bio ?? "")) patch.bio = form.bio;
    if ((fav?.rawgId ?? null) !== (profile.favoriteGame?.rawgId ?? null)) {
      patch.favoriteGame = fav ? { rawgId: fav.rawgId, name: fav.name, cover: fav.cover || undefined } : null;
    }
    const nextBanner = bannerOn ? banner : null;
    if ((nextBanner?.rawgId ?? null) !== (profile.banner?.rawgId ?? null)) {
      patch.banner = nextBanner ? { rawgId: nextBanner.rawgId, name: nextBanner.name, cover: nextBanner.cover || undefined } : null;
    }
    if (source === "upload" && upload) patch.avatarUpload = upload;
    else if (source !== current && source) patch.avatarSource = source;
    if (!Object.keys(patch).length) return onClose();

    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`${API}/api/account`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(patch),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Couldn't save. Try again.");
      onSaved();
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  const pics = [
    opts.steam && ["steam", "Steam", opts.steam],
    opts.google && ["google", "Google", opts.google],
    (upload || opts.upload) && ["upload", "Uploaded", upload || opts.upload],
    ["none", "Initial", null],
  ].filter(Boolean);
  const bioLeft = MAX_BIO - form.bio.length;

  return createPortal(
    <>
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      <div className={styles.modal} style={accent ? { "--accent": accent } : undefined} role="dialog" aria-modal="true" aria-label="Edit profile">
        <div className={styles.modalHead}>
          <h2 className={styles.modalTitle}>Edit profile</h2>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close"><X size={15} /></button>
        </div>

        <div className={styles.modalBody}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Picture</span>
            <div className={styles.pics} role="radiogroup" aria-label="Picture">
              {pics.map(([key, label, src]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={source === key}
                  className={`${styles.pic} ${source === key ? styles.picOn : ""}`}
                  onClick={() => setSource(key)}
                >
                  <Avatar src={src} name={form.displayName} size={60} />
                  {label}
                </button>
              ))}
              <button type="button" className={styles.pic} onClick={() => fileRef.current?.click()}>
                <span className={styles.uploadTile}><ImagePlus size={20} /></span>
                Upload new
              </button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={pickFile} />
            </div>
          </div>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Name</span>
            <input className={styles.input} value={form.displayName} maxLength={50} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Username</span>
            <span className={styles.at}>
              <input className={styles.input} value={form.username} maxLength={20} pattern="[A-Za-z0-9_\-]{3,20}" onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} />
            </span>
            <span className={styles.hint}>3–20 characters: letters, numbers, _ and -. Your public profile's link changes with it.</span>
          </label>

          <label className={styles.field}>
            <span className={styles.fieldRow}>
              <span className={styles.fieldLabel}>Bio</span>
              <span className={`${styles.counter} ${bioLeft < 0 ? styles.counterOver : ""}`}>{bioLeft}</span>
            </span>
            <textarea className={styles.input} value={form.bio} placeholder="A line about you, or what you play." onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))} />
          </label>

          <div className={styles.field}>
            <span className={styles.fieldLabel}>Favourite game</span>
            <GamePicker value={fav} onChange={setFav} clearLabel="Remove favourite game" />
          </div>

          <div className={styles.field}>
            <span className={styles.fieldLabel}>Banner</span>
            <span className={styles.hint}>The art across the top of your profile.</span>
            <div className={styles.presets} role="radiogroup" aria-label="Banner">
              <button type="button" role="radio" aria-checked={!bannerOn} className={`${styles.preset} ${!bannerOn ? styles.presetOn : ""}`} onClick={() => { setBannerOn(false); setBanner(null); }}>
                Automatic: your most played games
              </button>
              <button type="button" role="radio" aria-checked={bannerOn} className={`${styles.preset} ${bannerOn ? styles.presetOn : ""}`} onClick={() => setBannerOn(true)}>
                A game I choose
              </button>
            </div>
            {bannerOn && <GamePicker value={banner} onChange={setBanner} placeholder="Search for a game's art" clearLabel="Pick another game" />}
          </div>
        </div>

        <div className={styles.modalFoot}>
          {error && <p className={styles.err} role="alert">{error}</p>}
          <button type="button" className={styles.btnGhost} onClick={onClose}>Cancel</button>
          <button type="button" className={styles.btnAccent} onClick={save} disabled={saving || bioLeft < 0}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
