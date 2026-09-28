import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { gameArt } from "../utils/gameArt";
import styles from "./HeroCarousel.module.css";
import { useQuickLook } from "./quicklook/quickLookContext";

const API_URL = import.meta.env.VITE_API_URL;

/* The orthographic camera maps the hero's own height to this many world
   units, so every measurement below can be written as a percentage of the
   hero via vh(). */
const VIEW_HEIGHT = 8;

const vh = (percent) => VIEW_HEIGHT * (percent / 100);

const RECTANGLE_HEIGHT = vh(30);
const RECTANGLE_WIDTH = RECTANGLE_HEIGHT * (16 / 9);
const RECTANGLE_GAP = 0;

/* Cards per row. This must be enough that the strip is wider than the
   viewport, or the wrap seam shows as a gap. The hero is far wider than it is
   tall, so at 60vh a 16:9 window already needs ~11 — 20 covers aspect ratios
   up to ~5:1 with margin. Cards beyond the pool length reuse its games (and
   share their textures). */
const RECTANGLE_COUNT = 20;

/* Horizontal subdivisions per card. The warp is applied per vertex, so this
   is what decides how smoothly a card follows the curve. */
const SEGMENTS_X = 60;

/* Four guide curves, y = k*x^2, at relative strengths 5 : 3 : -3 : -5. Each
   row of cards is stretched between an adjacent pair, so a card's top edge
   rides one parabola and its bottom edge another. The pairs diverge away from
   x=0, so every card is thin at the centre of the screen and swells toward
   both ends — the stretched-sheet look.
   The 5:3 spacing is what makes the middle row swell three times faster than
   the outer two, which is what the reference shows. */
const CURVE_WEIGHTS = [5, 3, -3, -5];

const CENTER_OFFSET = RECTANGLE_HEIGHT * 1.5;

/* How much taller the middle row is at the screen edge than at the centre.
   This is the dial for how dramatic the whole effect reads. The curvature is
   solved from it at runtime rather than hard-coded, because the bend depends
   on how wide the view is in world units — the hero is ~3x wider in aspect
   than a full-screen canvas, so fixed coefficients that look right at 16:9
   flatten out completely here. */
const EDGE_SWELL = 2.4;

/* Per-row drift, in world units per second. Sign sets direction. */
const BASE_SPEEDS = [1.5, -1.08, 1.32];

/* Each row's speed wanders around its base value so the rows never settle
   into a repeating pattern. */
const MIN_SPEED_MULTIPLIER = 0.5;
const MAX_SPEED_MULTIPLIER = 2.0;
const MIN_RANDOM_INTERVAL = 1.0;
const MAX_RANDOM_INTERVAL = 3.0;

/* Texture width requested from RAWG's resize CDN. This must NOT match the width
   GameCard uses (640). The cards load art through plain <img> tags, and RAWG
   answers those without an Access-Control-Allow-Origin header but with a
   one-year Cache-Control. If the hero asked for the same URL, the browser would
   hand three.js that cached non-CORS copy and WebGL would refuse it. A distinct
   size is a distinct cache entry, fetched fresh in CORS mode. 1280 also keeps
   the swollen edge cards sharp. */
const TEXTURE_WIDTH = 1280;

const CAROUSEL_SPACING = RECTANGLE_WIDTH + RECTANGLE_GAP;
const CAROUSEL_PERIOD = RECTANGLE_COUNT * CAROUSEL_SPACING;

function wrap(x, period) {
  const half = period / 2;
  return (((x + half) % period) + period) % period - half;
}

export default function HeroCarousel() {
  const quickLook = useQuickLook();
  const mountRef = useRef(null);
  const openRef = useRef(null);
  const [games, setGames] = useState([]);

  // A card opens the quick look (stepping through the wall's games). Kept in
  // a ref so the WebGL effect doesn't depend on it (which would tear down and
  // rebuild the whole scene whenever it changes).
  useEffect(() => {
    openRef.current = (game) => quickLook(game, { list: games });
  }, [quickLook, games]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/hero`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setGames(data);
      } catch (e) {
        console.error("hero load failed", e);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || games.length === 0) return;

    const scene = new THREE.Scene();

    let width = mount.clientWidth || 1;
    let height = mount.clientHeight || 1;

    const camera = new THREE.OrthographicCamera(0, 0, 0, 0, 0.1, 100);
    camera.position.z = 10;

    /* Curvature unit, resolved from the current view width so the effect
       reads the same at any aspect. The middle row spans weights 3 and -3, so
       its height at the edge is 6*u*halfW^2 + RECTANGLE_HEIGHT; setting that
       to EDGE_SWELL * RECTANGLE_HEIGHT gives u. */
    let curveU = 0;

    function applyCameraSize() {
      const halfW = (VIEW_HEIGHT * (width / height)) / 2;
      camera.left = -halfW;
      camera.right = halfW;
      camera.top = VIEW_HEIGHT / 2;
      camera.bottom = -VIEW_HEIGHT / 2;
      camera.updateProjectionMatrix();
      curveU = (RECTANGLE_HEIGHT * (EDGE_SWELL - 1)) / (6 * halfW * halfW);
    }
    applyCameraSize();

    const lines = CURVE_WEIGHTS.map(
      (weight, i) => (x) =>
        weight * curveU * x * x + CENTER_OFFSET - RECTANGLE_HEIGHT * i
    );

    // alpha so the page's aurora shows through instead of a flat backdrop.
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");

    const disposables = { geometries: [], materials: [], textures: [] };

    /* Build one card: a subdivided plane whose top and bottom vertex rows get
       pinned to the two guide curves every frame. */
    // A game's texture is uploaded once and shared by every card showing it.
    const materialByGame = new Map();

    function materialFor(game) {
      let material = materialByGame.get(game.id);
      if (material) return material;

      const texture = loader.load(gameArt(game.cover, TEXTURE_WIDTH));
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

      material = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.DoubleSide,
        transparent: true,
      });

      materialByGame.set(game.id, material);
      disposables.materials.push(material);
      disposables.textures.push(texture);
      return material;
    }

    function createCard(baseX, topFn, bottomFn, game) {
      const geometry = new THREE.PlaneGeometry(
        RECTANGLE_WIDTH, RECTANGLE_HEIGHT, SEGMENTS_X, 1
      );

      const mesh = new THREE.Mesh(geometry, materialFor(game));
      scene.add(mesh);

      disposables.geometries.push(geometry);

      const positions = geometry.attributes.position;
      const originalX = new Float32Array(positions.count);
      const isTop = new Uint8Array(positions.count);
      for (let i = 0; i < positions.count; i++) {
        originalX[i] = positions.getX(i);
        isTop[i] = positions.getY(i) > 0 ? 1 : 0;
      }

      return { mesh, positions, originalX, isTop, baseX, topFn, bottomFn, game };
    }

    // Deal the pool across rows so neighbouring rows show different games.
    const rows = [0, 1, 2].map((r) => {
      const pool = games.filter((_, i) => i % 3 === r);
      const cards = [];
      for (let c = 0; c < RECTANGLE_COUNT; c++) {
        const baseX = (c - (RECTANGLE_COUNT - 1) / 2) * CAROUSEL_SPACING;
        cards.push(
          createCard(baseX, lines[r], lines[r + 1], pool[c % pool.length])
        );
      }
      return {
        cards,
        offset: 0,
        speed: BASE_SPEEDS[r],
        targetSpeed: BASE_SPEEDS[r],
        base: BASE_SPEEDS[r],
        hovered: false,
      };
    });

    const allMeshes = rows.flatMap((row) => row.cards.map((c) => c.mesh));
    rows.forEach((row, r) => row.cards.forEach((c) => { c.mesh.userData.row = r; }));

    function updateCard(card, x) {
      card.mesh.position.x = x;

      const { positions, originalX, isTop, topFn, bottomFn } = card;
      for (let i = 0; i < positions.count; i++) {
        const worldX = x + originalX[i];
        positions.setY(i, isTop[i] ? topFn(worldX) : bottomFn(worldX));
      }
      positions.needsUpdate = true;
      card.mesh.geometry.computeBoundingSphere();
    }

    function layout() {
      for (const row of rows) {
        for (const card of row.cards) {
          updateCard(card, wrap(card.baseX + row.offset, CAROUSEL_PERIOD));
        }
      }
    }
    layout();

    /* ---------- pointer: hover pauses a row, click opens the game ---------- */
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerInside = false;

    function toNDC(event) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }

    function pick() {
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(allMeshes, false);
      return hits.length ? hits[0].object : null;
    }

    function onPointerMove(event) {
      toNDC(event);
      pointerInside = true;
    }

    function onPointerLeave() {
      pointerInside = false;
      rows.forEach((row) => { row.hovered = false; });
      renderer.domElement.style.cursor = "";
    }

    function onClick(event) {
      toNDC(event);
      const hit = pick();
      if (!hit) return;
      const card = rows[hit.userData.row].cards.find((c) => c.mesh === hit);
      if (card?.game?.id) openRef.current?.(card.game);
    }

    const canvas = renderer.domElement;
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("click", onClick);

    /* ---------- resize follows the container, not the window ---------- */
    const observer = new ResizeObserver(() => {
      width = mount.clientWidth || 1;
      height = mount.clientHeight || 1;
      applyCameraSize();
      renderer.setSize(width, height, false);
      layout();
    });
    observer.observe(mount);

    /* ---------- loop ---------- */
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    let frame;
    let last = performance.now();
    let randomTimer = 0;
    let nextRandomChange =
      MIN_RANDOM_INTERVAL + Math.random() * (MAX_RANDOM_INTERVAL - MIN_RANDOM_INTERVAL);

    function randomizeSpeeds() {
      for (const row of rows) {
        const m =
          MIN_SPEED_MULTIPLIER +
          Math.random() * (MAX_SPEED_MULTIPLIER - MIN_SPEED_MULTIPLIER);
        row.targetSpeed = row.base * m;
      }
      nextRandomChange =
        MIN_RANDOM_INTERVAL + Math.random() * (MAX_RANDOM_INTERVAL - MIN_RANDOM_INTERVAL);
      randomTimer = 0;
    }

    function tick(now) {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      if (pointerInside) {
        const hit = pick();
        rows.forEach((row, r) => { row.hovered = !!hit && hit.userData.row === r; });
        canvas.style.cursor = hit ? "pointer" : "";
      }

      randomTimer += dt;
      if (randomTimer >= nextRandomChange) randomizeSpeeds();

      for (const row of rows) {
        // ease toward the target so speed changes are never abrupt
        row.speed += (row.targetSpeed - row.speed) * Math.min(dt * 1.2, 1);
        if (!row.hovered && !reduced) row.offset += row.speed * dt;
      }

      layout();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("click", onClick);
      disposables.geometries.forEach((g) => g.dispose());
      disposables.materials.forEach((m) => m.dispose());
      disposables.textures.forEach((t) => t.dispose());
      renderer.dispose();
      if (canvas.parentNode === mount) mount.removeChild(canvas);
    };
  }, [games]);

  return (
    <section className={styles.hero} aria-label="Featured games">
      <div className={styles.stage} ref={mountRef} />
      <div className={styles.glow} aria-hidden="true" />
    </section>
  );
}
