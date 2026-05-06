import dotenv from "dotenv";
import { createApp } from "./app.js";

dotenv.config();

const port = Number(process.env.PORT ?? 3200);
const app = createApp();

app.listen(port, () => {
  console.log(`smartfarm-api listening on http://localhost:${port}`);
});

