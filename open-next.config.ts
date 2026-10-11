import { defineCloudflareConfig } from "@opennextjs/cloudflare";

const config = defineCloudflareConfig();
// The separate BullMQ worker is not deployed to Workers. Inline jobs handle the outbox instead.
config.buildCommand = "node scripts/generate-cloudflare-client.mjs && next build";

export default config;
