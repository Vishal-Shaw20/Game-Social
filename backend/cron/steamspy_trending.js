// backend/cron/steamspy_trending.js
import cron from "node-cron";
import { randomUUID } from "crypto";
import { getPG } from "../config/db.js";
import tls from "tls";
import { URL, fileURLToPath } from "url";
import { readFileSync } from "fs";
import path from "path";
import { Agent as UndiciAgent } from "undici";
import logger from "../config/logger.js";

const STEAMSPY_URL = "https://steamspy.com/api.php?request=top100in2weeks";

// ----------------------
// OPTION A: Load local CA file only for SteamSpy requests
// ----------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CA_PATH = path.join(__dirname, "..", "certs", "steamspy-extra-ca.pem");

let steamspyAgent;
try {
  const ca = readFileSync(CA_PATH, "utf8");
  steamspyAgent = new UndiciAgent({ connect: { ca } });
  logger.info("Loaded extra CA for SteamSpy from %s", CA_PATH);
} catch (e) {
  logger.warn("No CA file at %s, using TLS-bypass agent for SteamSpy: %s", CA_PATH, e.message);
  steamspyAgent = new UndiciAgent({ connect: { rejectUnauthorized: false } });
}

// helpers
const toIntOrNull = v => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[^0-9\-]/g, ""));
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
const toFloatOrNull = v => {
  if (v === null || v === undefined || v === "") return null;
  const f = Number(String(v));
  return Number.isFinite(f) ? f : null;
};

function computeBucketTimestamp(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const hour = date.getUTCHours();
  const bucketHour = Math.floor(hour / 6) * 6;
  const hh = String(bucketHour).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:00:00+00`;
}

// =======================
// TLS INSPECTION (Optional Debug)
// =======================
export async function logServerCertChain(hostUrl, timeoutMs = 5000) {
  try {
    if (process.env.LOG_CERTS === "0") return;

    const u = new URL(hostUrl);
    const host = u.hostname;
    const port = Number(u.port || 443);

    logger.info("Inspecting TLS cert chain for %s:%d", host, port);

    await new Promise((resolve, reject) => {
      const socket = tls.connect(
        { host, port, servername: host, rejectUnauthorized: false },
        () => {
          try {
            const cert = socket.getPeerCertificate(true);
            if (!cert) {
              logger.warn("No certificate info available");
              socket.end();
              return resolve();
            }

            const chain = [];
            let cur = cert;
            while (cur && Object.keys(cur).length) {
              chain.push(cur);
              if (!cur.issuerCertificate || cur === cur.issuerCertificate) break;
              cur = cur.issuerCertificate;
            }

            const fmt = o => Object.entries(o || {}).map(([k, v]) => `${k}=${v}`).join(", ");

            chain.forEach((c, i) => {
              logger.debug({ cert: i, subject: fmt(c.subject), issuer: fmt(c.issuer), valid_from: c.valid_from, valid_to: c.valid_to }, "TLS cert");
            });

            socket.end();
            resolve();
          } catch (ex) {
            socket.destroy();
            reject(ex);
          }
        }
      );

      socket.setTimeout(timeoutMs, () => {
        socket.destroy();
        reject(new Error("TLS cert fetch timeout"));
      });

      socket.on("error", reject);
    });

    logger.info("TLS cert inspection done");
  } catch (err) {
    logger.error({ err }, "logServerCertChain error");
  }
}

// =======================
// MAIN FETCH LOGIC
// =======================
export async function fetchAndStore({ enforceTimestampIdempotency = true } = {}) {
  const pool = getPG();
  const client = await pool.connect();

  try {
    const bucketTs = computeBucketTimestamp();
    logger.info("Starting SteamSpy fetch for bucket timestamp: %s", bucketTs);

    if (enforceTimestampIdempotency) {
      const checkSql = `
        SELECT 1 FROM steamspy_trending
        WHERE snapshot_time >= $1::timestamptz
          AND snapshot_time < ($1::timestamptz + interval '6 hours')
        LIMIT 1
      `;
      const chk = await client.query(checkSql, [bucketTs]);
      if (chk.rowCount > 0) {
        logger.info("Idempotency: Snapshot exists already. Skipping");
        return;
      }
    }

    await logServerCertChain(STEAMSPY_URL);

    // Attach our per-request CA-trusting agent
    const fetchOptions = { method: "GET", cache: "no-store" };
    if (steamspyAgent) fetchOptions.dispatcher = steamspyAgent;

    const r = await fetch(STEAMSPY_URL, fetchOptions);
    if (!r.ok) throw new Error(`SteamSpy fetch failed: ${r.status} ${r.statusText}`);

    const json = await r.json();
    const rows = Object.values(json);
    if (!rows.length) {
      logger.warn("SteamSpy returned empty data");
      return;
    }

    const bucketId = randomUUID();

    const cols = [
      "snapshot_time", "bucket_id", "steam_id", "name", "score_rank",
      "positive", "negative", "userscore", "owners",
      "average_forever", "average_2weeks", "median_forever",
      "median_2weeks", "ccu"
    ];

    const colTypes = {
      snapshot_time: "timestamptz",
      bucket_id: "uuid",
      steam_id: "bigint",
      name: "text",
      score_rank: "real",
      positive: "bigint",
      negative: "bigint",
      userscore: "real",
      owners: "text",
      average_forever: "bigint",
      average_2weeks: "bigint",
      median_forever: "bigint",
      median_2weeks: "bigint",
      ccu: "bigint"
    };

    const params = [];
    const valuesSQL = [];

    for (const e of rows) {
      const appid = toIntOrNull(e.appid);
      if (appid === null) continue;

      const rowParams = [
        new Date().toISOString(),
        bucketId,
        appid,
        e.name ?? null,
        toFloatOrNull(e.score_rank),
        toIntOrNull(e.positive),
        toIntOrNull(e.negative),
        toFloatOrNull(e.userscore),
        e.owners ?? null,
        toIntOrNull(e.average_forever),
        toIntOrNull(e.average_2weeks),
        toIntOrNull(e.median_forever),
        toIntOrNull(e.median_2weeks),
        toIntOrNull(e.ccu)
      ];

      const start = params.length + 1;
      params.push(...rowParams);

      const placeholders = cols.map((col, i) => {
        const pos = start + i;
        const type = colTypes[col];
        return `$${pos}::${type}`;
      }).join(", ");

      valuesSQL.push(`(${placeholders})`);
    }

    if (!valuesSQL.length) {
      logger.warn("No valid rows after parsing. Skipping insert");
      return;
    }

    const insertSQL = `
      INSERT INTO steamspy_trending (${cols.join(", ")})
      VALUES ${valuesSQL.join(", ")}
    `;

    await client.query("BEGIN");
    await client.query(insertSQL, params);
    await client.query("COMMIT");

    logger.info("Inserted %d rows under bucket_id %s", valuesSQL.length, bucketId);

    // Cleanup old snapshots
    const KEEP = Number(process.env.KEEP_SNAPSHOTS ?? 56);
    if (KEEP > 0) {
      const cleanupSQL = `
        WITH latest AS (
          SELECT DISTINCT bucket_id
          FROM steamspy_trending
          ORDER BY bucket_id DESC
          LIMIT $1
        ), cutoff AS (
          SELECT MIN(bucket_id) AS min_bucket FROM latest
        )
        DELETE FROM steamspy_trending
        WHERE bucket_id < (SELECT min_bucket FROM cutoff)
      `;
      const delRes = await client.query(cleanupSQL, [KEEP]);
      logger.info("Cleanup deleted: %d", delRes.rowCount);
    }

  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    logger.error({ err }, "fetchAndStore error");
    throw err;
  } finally {
    client.release();
  }
}

export function startCron({ runImmediately = true } = {}) {
  cron.schedule("0 */6 * * *", () => {
    logger.info("Cron triggered for SteamSpy trending");
    fetchAndStore().catch(e => logger.error({ err: e }, "Scheduled fetch failed"));
  }, {
    scheduled: true,
    timezone: "UTC"
  });

  if (runImmediately) {
    fetchAndStore().catch(e => logger.error({ err: e }, "Initial fetch failed"));
  }
}
