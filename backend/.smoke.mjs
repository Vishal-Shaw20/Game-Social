delete process.env.REDIS_URL; process.env.DEV_MODE="true";
const t=Date.now();
try { const m = await import(process.cwd() + "/routes/gamePage.js");
console.log("routes:", m.default.stack.map(l => Object.keys(l.route.methods)[0] + " " + l.route.path).join(", "), (Date.now()-t)+"ms"); } catch(e) { console.log("ERR", e.stack) }
process.exit(0);
