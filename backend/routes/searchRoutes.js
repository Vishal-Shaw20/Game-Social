import express from "express";
import { getPG } from "../config/db.js";

const router = express.Router();

router.get("/games", async (req, res) => {
  try {
    const {
      q,
      genres = "",
      platforms = ""
    } = req.query;

    // if (!q || q.length < 3) return res.json([]);
    if (!q && !genres && !platforms) return res.json([]);


    const pg = getPG();

    const where = [];
    const values = [];
    let idx = 1;

    where.push(`name ILIKE $${idx}`);
    values.push(`%${q}%`);
    idx++;

    where.push(`suggestions_count IS NOT NULL`);

    if (genres) {
     where.push(`
    EXISTS (
      SELECT 1
      FROM unnest(genres) g
      WHERE lower(g) = ANY($${idx})
    )
  `);
     values.push(genres.split(",").map(g => g.toLowerCase()));
      idx++;
    }

    if (platforms) {
      where.push(`
    EXISTS (
      SELECT 1
      FROM unnest(platforms) p
      WHERE lower(p) = ANY($${idx})
    )
  `);
      values.push(platforms.split(",").map(p => p.toLowerCase()));
      idx++;
    }

    const orderBy = `
      similarity(name, $${idx}) DESC,
      suggestions_count DESC
    `;
    values.push(q);

    const sql = `
      SELECT id, name, suggestions_count
      FROM games
      WHERE ${where.join(" AND ")}
      ORDER BY ${orderBy}
      LIMIT 15
    `;

    const { rows } = await pg.query(sql, values);
    res.json(rows);
  } catch (e) {
    console.error("[SEARCH ERROR]", e);
    res.status(500).json([]);
  }
});

export default router;
