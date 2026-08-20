import { createApp } from "./app.js";
import { prisma } from "./prisma.js";

const app = await createApp({ prisma, logger: true });
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  await prisma.$disconnect();
  process.exit(1);
}

const shutdown = async () => { await app.close(); await prisma.$disconnect(); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
