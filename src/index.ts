import dotenv from 'dotenv';
import express from 'express';
import { register } from './routes';
import winston from 'winston';

dotenv.config();

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.simple(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()]
});

async function start() {
  const port = process.env.SERVER_PORT || 80; // default port to listen
  const app = express();

  logger.debug(JSON.stringify(process.env));

  app.use(express.json());

  // Configure routes
  register(app, logger);

  // start the Express server
  app.listen(port, () => {
    logger.info(`server started at http://localhost:${port}`);
  });
}

start();
