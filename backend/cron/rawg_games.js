import cron from "node-cron";

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
    console.log("[RAWG] Daily cron — triggering gamiq pipeline");
    try {
      const status = await triggerPipeline();
      console.log(`[RAWG] Pipeline trigger: ${status}`);
    } catch (err) {
      console.error("[RAWG] Pipeline trigger failed", err);
    }
  });

  if (runImmediately) {
    (async () => {
      console.log("[RAWG] Startup — triggering gamiq pipeline");
      try {
        const status = await triggerPipeline();
        console.log(`[RAWG] Startup pipeline trigger: ${status}`);
      } catch (err) {
        console.error("[RAWG] Startup pipeline trigger failed", err);
      }
    })();
  }
}
