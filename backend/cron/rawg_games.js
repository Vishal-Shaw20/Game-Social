import cron from "node-cron";
import logger from "../config/logger.js";

const GAMIQ_URL = process.env.GAMIQ_URL || "http://localhost:8000";
const PIPELINE_API_KEY = process.env.PIPELINE_API_KEY;

let started = false;

async function triggerPipeline() {
  const res = await fetch(`${GAMIQ_URL}/pipeline/run`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${PIPELINE_API_KEY}`
    }
  });
  const data = await res.json();
  return data.status;
}

export function startRawgCron({ runImmediately = false } = {}) {
  if (started) return;
  started = true;

  cron.schedule("0 3 * * *", async () => {
    logger.info("RAWG daily cron: triggering gamiq pipeline");
    try {
      const status = await triggerPipeline();
      logger.info("RAWG pipeline trigger: %s", status);
    } catch (err) {
      logger.error({ err }, "RAWG pipeline trigger failed");
    }
  });

  if (runImmediately) {
    (async () => {
      logger.info("RAWG startup: triggering gamiq pipeline");
      try {
        const status = await triggerPipeline();
        logger.info("RAWG startup pipeline trigger: %s", status);
      } catch (err) {
        logger.error({ err }, "RAWG startup pipeline trigger failed");
      }
    })();
  }
}
