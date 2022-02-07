import { Application } from 'express';
import { Logger } from 'winston';
import { refreshCert } from './services/acme.service';
import { createClient, publishStatusUpdateEvent } from './services/cumulocity.service';
import { schedule } from 'node-cron';
import { generateRandomDailyCronTimer } from './services/random-cron.service';
import { Client, IUser } from '@c8y/client';
import {
  MISSING_PERMISSIONS,
  ONGOING_CERT_RENEWAL_REQUEST,
  ONGOING_CERT_RENEWAL_SCHEDULE,
  RENEWAL_SCHEDULE
} from './texts/logger';
import { restoreFromACMEArchiveIfPossible } from './services/acme-archive.service';

let certRequestInProgress = false;

export function register(app: Application, logger: Logger): void {
  // make sure to perform the renewal at a random point in time
  const cronTimer = generateRandomDailyCronTimer();
  logger.info(`${RENEWAL_SCHEDULE} ${cronTimer}`);

  restoreFromACMEArchiveIfPossible(logger).catch();

  schedule(cronTimer, () => {
    if (certRequestInProgress) {
      logger.info(ONGOING_CERT_RENEWAL_SCHEDULE);
      return;
    }
    publishStatusUpdateEvent('Scheduled cert renewal triggered').catch();
    certRequestInProgress = true;
    refreshCert(logger, false)
      .then(
        (res) => {
          publishStatusUpdateEvent(res ? 'Successfully renewed cert.' : 'Did not attempt to renew cert.').catch();
        },
        () => {
          publishStatusUpdateEvent('Failed to renew cert.').catch();
        }
      )
      .finally(() => (certRequestInProgress = false));
  });

  // get user/tenant Details
  app.use(async (req, res, next) => {
    // no need to log requests to health endpoint since this is constantly called by c8y
    if (req.url === '/health') {
      next();
      return;
    }

    try {
      const headers = req.headers;
      const client = createClient(headers);
      res.locals.client = client;
      const userPromise = client.user.current().then((user) => {
        res.locals.user = user.data;
      });

      const tenantPromise = client.tenant.current().then((tenant) => {
        res.locals.tenant = tenant.data;
      });

      await Promise.all([userPromise, tenantPromise]);

      if (!client.core.tenant && res.locals.tenant) {
        client.core.tenant = res.locals.tenant.name;
      }

      logger.info(
        `${req.method} Request received by tenant/user: ${res.locals.tenant.name}/${res.locals.user.id}, on endpoint: ${req.url}`
      );
      next();
    } catch (e) {
      logger.warn(`${req.method} Request received by tenant/user: unknown, on endpoint: ${req.url}`);
      next();
    }
  });

  // Health check
  app.route('/health').get((req, res) => {
    res.json({ status: 'UP' });
  });

  app.post('/forceRenew', async (req, res) => {
    const user: IUser = res.locals.user;
    const client: Client = res.locals.client;
    if (!user || !client || !client.user.hasAllRoles(user, ['ROLE_ACME_ADMIN'])) {
      logger.warn(MISSING_PERMISSIONS);
      res.status(403).send();
      return;
    }
    if (certRequestInProgress) {
      logger.info(ONGOING_CERT_RENEWAL_REQUEST);
      res.status(409).send();
      return;
    }
    try {
      publishStatusUpdateEvent('Forced cert renewal triggered').catch();
      certRequestInProgress = true;
      await refreshCert(logger, true)
        .then(
          (res) => {
            publishStatusUpdateEvent(res ? 'Successfully renewed cert.' : 'Did not attempt to renew cert.').catch();
          },
          (e) => {
            publishStatusUpdateEvent('Failed to renew cert.').catch();
            throw e;
          }
        )
        .finally(() => (certRequestInProgress = false));
      res.sendStatus(200);
      return;
    } catch (e) {
      logger.error(e);
    }

    res.status(500).send();
  });
}
