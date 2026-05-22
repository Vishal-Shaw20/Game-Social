import cron from "node-cron";
import logger from "../config/logger.js";

const GAMIQ_URL = process.env.GAMIQ_URL || "http://localhost:8000";
const PIPELINE_API_KEY = process.env.PIPELINE_API_KEY;

let started = false;

async function triggerPipeline() {
  try {
    const res = await fetch(`${GAMIQ_URL}/pipeline/run`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PIPELINE_API_KEY}`,
        "Content-Type": "application/json"
      }
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "No details");
      logger.error(`Gamiq pipeline HTTP ${res.status}: ${errorText}`);
      return "FAILED_HTTP";
    }

    const data = await res.json();
    return data?.status ?? "SUCCESS";
  } catch (err) {
    logger.error({ err }, "Network/DNS/parsing failure in triggerPipeline");
    return "FAILED_NETWORK";
  }
}

export function startRawgCron({ runImmediately = false } = {}) {
  if (started) return;
  started = true;

  cron.schedule("0 3 * * *", async () => {
    logger.info("RAWG daily cron: triggering gamiq pipeline");
    try {
      const status = await triggerPipeline();
      logger.info("RAWG pipeline trigger completed with status: %s", status);
    } catch (err) {
      logger.error({ err }, "RAWG pipeline trigger failed");
    }
  }, {
    scheduled: true,
    timezone: "Asia/Kolkata"
  });

  if (runImmediately) {
    (async () => {
      try {
        const status = await triggerPipeline();
        logger.info("RAWG startup pipeline trigger completed with status: %s", status);
      } catch (err) {
        logger.error({ err }, "RAWG startup pipeline trigger failed");
      }
    })();
  }
}