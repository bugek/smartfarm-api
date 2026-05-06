import dotenv from "dotenv";
import { createApp } from "./app.js";
import { startJobRunner } from "./lib/jobs.js";

dotenv.config();

const port = Number(process.env.PORT ?? 3200);
const app = createApp();

const jobIntervalMs = Number(process.env.DOCUMENT_JOB_INTERVAL_MS ?? 5_000);
if (process.env.DOCUMENT_JOB_RUNNER_DISABLED !== "true") {
  startJobRunner(jobIntervalMs);
}

app.listen(port, () => {
  console.log(`smartfarm-api listening on http://localhost:${port}`);
});

