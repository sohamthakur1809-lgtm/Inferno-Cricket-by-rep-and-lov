import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import healthRouter from "./routes/health.js";
import { logger } from "./lib/logger.js";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check must respond even before the bot / DB come up so Render's
// probe succeeds while env vars are still being wired.
app.use(healthRouter);
app.use("/api", router);

// Lazy-start the Telegram bot so a missing BOT_TOKEN or DATABASE_URL doesn't
// prevent the web service from booting (and failing Render's health check).
async function startBot() {
  if (!process.env.BOT_TOKEN) {
    logger.warn("BOT_TOKEN is not set — Telegram bot is disabled.");
    return;
  }
  if (!process.env.DATABASE_URL) {
    logger.warn("DATABASE_URL is not set — Telegram bot is disabled.");
    return;
  }

  try {
    const { createBot, registerBotCommands } = await import("./bot/index.js");
    const bot = createBot();
    bot
      .start({
        onStart: (info) => {
          logger.info({ username: info.username }, "🏏 CRIC INFERNO bot started");
          registerBotCommands(bot).catch((err) => {
            logger.error({ err }, "Failed to register commands");
          });
        },
      })
      .catch((err) => {
        logger.error({ err }, "Bot start error");
      });
  } catch (err) {
    logger.error({ err }, "Failed to create bot");
  }
}

void startBot();

export default app;
