// Imported first by worker/index.ts: same precedence as Next.js (.env.local overrides .env; real env wins).
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });
