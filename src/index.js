import { startServer } from './server.js';
import { startBot } from './bot.js';

// stderr is not always captured where this runs, so a fatal error is logged on stdout before the process goes
for (const event of ['uncaughtException', 'unhandledRejection']) {
  process.on(event, (err) => {
    console.log(`${event}:`, err?.stack || err);
    process.exit(1);
  });
}

startServer();
startBot().catch((err) => {
  console.error('could not start:', err.shortMessage || err.message);
  process.exit(1);
});
