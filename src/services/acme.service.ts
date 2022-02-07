import { Client } from '@c8y/client';
import { exec } from 'child_process';
import { CertRenewalConfig } from '../models/cert-renewal.model';
import { Logger } from 'winston';
import { getSingleTenantClient, listTenantOptionsOfCategory } from './cumulocity.service';
import { getCurrentCertDetails, replaceCertAndKeyOfEdge } from './edge-cert-replacement.service';
import { createAndUploadACMEArchive } from './acme-archive.service';

export enum SpecialTenantOptions {
  PROVIDER = 'dns_provider',
  WILDCARD_SUB = 'add_wildcard_sub',
  WILDCARD_MAIN = 'add_wildcard_main',
  SERVER = 'server',
  DEBUG = 'debug',
  DNS_SLEEP = 'dnssleep',
  DOMAIN = 'domain',
  EDGE_IP = 'edge_ip',
  SKIP_CERT_REPLACEMENT = 'skip_cert_replacement',
  INSECURE = 'insecure',
  RENEW_DAYS_BEFORE_EXPIRY = 'renew_days_before_expiry',
  MAIL = 'mail',
  CHALLENGE_ALIAS = 'challenge_alias',
  ARCHIVE_ENCRYPTION_KEY = 'archive_encryption_key'
}

const nonEnvTenantOptionsKeys: string[] = [
  SpecialTenantOptions.PROVIDER,
  SpecialTenantOptions.WILDCARD_SUB,
  SpecialTenantOptions.WILDCARD_MAIN,
  SpecialTenantOptions.SERVER,
  SpecialTenantOptions.DEBUG,
  SpecialTenantOptions.DNS_SLEEP,
  SpecialTenantOptions.DOMAIN,
  SpecialTenantOptions.EDGE_IP,
  SpecialTenantOptions.SKIP_CERT_REPLACEMENT,
  SpecialTenantOptions.INSECURE,
  SpecialTenantOptions.RENEW_DAYS_BEFORE_EXPIRY,
  SpecialTenantOptions.MAIL,
  SpecialTenantOptions.CHALLENGE_ALIAS,
  SpecialTenantOptions.ARCHIVE_ENCRYPTION_KEY
];

export const basePath = '/root';
export const acmeDirName = '.acme.sh';
export const acmeArchiveFileName = `acme.sh.tar.gz.enc`;
export const acmePath = `${basePath}/${acmeDirName}`;

export async function performCommand(
  command: string,
  logger: Logger,
  options = { timeout: 200_000, printOutput: true }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = exec(command, { timeout: options.timeout }, (error, stdout, stderr) => {
      if (child.exitCode === 0) {
        return resolve();
      }
      if (error) {
        return reject(error);
      }
      if (stderr) {
        return reject(stderr);
      }
      return resolve();
    });
    if (options.printOutput) {
      child.stdout.pipe(process.stdout);
      child.stderr.pipe(process.stderr);
    }
  });
}

async function getConfiguration(client: Client, logger: Logger): Promise<CertRenewalConfig> {
  const options = await listTenantOptionsOfCategory(process.env.APPLICATION_NAME, client);
  logger.info(`Found ${Object.keys(options).length} available options.`);
  const env = createEnvVarString(options, logger);
  let domain = options[SpecialTenantOptions.DOMAIN];
  if (!domain) {
    const { data: tenant } = await client.tenant.detail('edge');
    domain = tenant.domain;
  }
  const domains = [domain];
  if (options[SpecialTenantOptions.WILDCARD_SUB] === 'true') {
    domains.push(`*.${domains[0]}`);
  }
  if (options[SpecialTenantOptions.WILDCARD_MAIN] === 'true') {
    domains[0] = domains[0].replace(/[^.]*\./, '*.');
  }

  const configuration = {
    dns: options[SpecialTenantOptions.PROVIDER],
    server: options[SpecialTenantOptions.SERVER] || 'letsencrypt_test',
    domains,
    debug: options[SpecialTenantOptions.DEBUG] === 'true',
    dnssleep: Number.parseInt(options[SpecialTenantOptions.DNS_SLEEP]) || 0,
    env,
    files: {
      cert: { path: `${acmePath}/${domains[0]}/${domains[0]}.cer`, uploadName: `${domains[0]}.crt` },
      certFullchain: { path: `${acmePath}/${domains[0]}/fullchain.cer`, uploadName: `${domains[0]}-fullchain.crt` },
      key: { path: `${acmePath}/${domains[0]}/${domains[0]}.key`, uploadName: `${domains[0]}.key` }
    },
    edge_ip: options[SpecialTenantOptions.EDGE_IP],
    mail: options[SpecialTenantOptions.MAIL] || '',
    skip_cert_replacement: options[SpecialTenantOptions.SKIP_CERT_REPLACEMENT] === 'true',
    insecure: options[SpecialTenantOptions.INSECURE] === 'true',
    renewDays: options[SpecialTenantOptions.RENEW_DAYS_BEFORE_EXPIRY]
      ? Number.parseInt(options[SpecialTenantOptions.RENEW_DAYS_BEFORE_EXPIRY])
      : 20,
    challengeAlias: options[SpecialTenantOptions.CHALLENGE_ALIAS]
  };
  return configuration;
}

async function validateConfig(config: CertRenewalConfig, logger: Logger) {
  let hasErrors = 0;
  if (!config.dns) {
    hasErrors++;
    logger.error(`No DNS provider set.`);
  }
  if (hasErrors) {
    logger.info(JSON.stringify(config));
    throw new Error('Current configuration is invalid/incomplete.');
  }
}

export async function refreshCert(logger: Logger, forced = false): Promise<boolean> {
  const client: Client = getSingleTenantClient();
  const config = await getConfiguration(client, logger);

  await validateConfig(config, logger);

  if (!forced) {
    const currentCertDetails = await getCurrentCertDetails(config);
    logger.info(`currentCertDetails: ${JSON.stringify(currentCertDetails)}`);
    if (config.domains[0] !== currentCertDetails.subject) {
      logger.info('Scheduled renewal not performed since current certificate subject does not match current config.');
      return false;
    }
    logger.info(`Subject: ${currentCertDetails.subject} matches with current configuration, proceeding.`);
    const expiryDate = new Date(currentCertDetails.expiry).getTime();
    const currentDate = new Date().getTime();
    const renewalIsDue = expiryDate - currentDate < config.renewDays * 24 * 60 * 60 * 1000;
    if (currentCertDetails.expiry && !renewalIsDue) {
      logger.info(
        `Scheduled renewal not performed since certificate renewal is not yet due. Cert expires: ${expiryDate}`
      );
      return false;
    }
  }

  try {
    await issueCertForDomains(config, logger);
  } catch (e) {
    logger.error(e);
    throw e;
  }
  try {
    await checkCert(config, logger, true);
    logger.info('Certificate is present.');
  } catch (e) {
    logger.error('Failed to verify that the certificate is actually present.');
    logger.error(e);
    throw e;
  }

  if (config.mail) {
    await updateMailOfAccount(config, logger).catch(() => {
      logger.warn('Failed to update mail of account.');
    });
  }

  await createAndUploadACMEArchive(client, logger).catch();

  if (!config.skip_cert_replacement) {
    logger.info('Starting replacement of certificate and key of edge.');
    await replaceCertAndKeyOfEdge(config, logger);
  } else {
    logger.debug('SKIPPING: replaceCertAndKeyOfEdge');
  }

  logger.info('Finished processing of refreshCert.');
  return true;
}

export async function removePrivateData(logger: Logger): Promise<void> {
  return performCommand(`rm -rf ${acmePath}`, logger);
}

async function updateMailOfAccount(config: CertRenewalConfig, logger: Logger): Promise<void> {
  const command = `acme.sh --update-account -m ${config.mail} --server ${config.server}`;
  return performCommand(command, logger);
}

async function checkCert(config: CertRenewalConfig, logger: Logger, printOutput = false): Promise<void> {
  const command = `openssl x509 -in ${config.files.certFullchain.path} -text`;
  return performCommand(command, logger, { printOutput, timeout: 200_000 });
}

async function issueCertForDomains(config: CertRenewalConfig, logger: Logger): Promise<void> {
  const { domains, dns, server, debug, dnssleep, env, insecure, challengeAlias } = config;

  let certAlreadyPresent = false;
  try {
    await checkCert(config, logger);
    logger.info(`Certificate already present attempting to renew it.`);
    certAlreadyPresent = true;
  } catch (e) {
    certAlreadyPresent = false;
    logger.info(`Issuing a new Certificate.`);
  }

  const domainsString = domains.map((domain) => ` -d ${domain}`).join('');
  const command = `${env}acme.sh${insecure ? ' --insecure' : ''} --force ${
    certAlreadyPresent ? '--renew' : '--issue'
  } --server ${server}${challengeAlias ? ` --challenge-alias ${challengeAlias}` : ''} --dns ${dns}${domainsString}${
    dnssleep > 0 ? ` --dnssleep ${dnssleep}` : ''
  }${debug ? ' --debug' : ''}`;
  logger.debug(`issueCertForDomains via: ${command}`);
  logger.info(`Issueing cert for specified domain(s): ${JSON.stringify(domains)}`);
  const timeout = Math.max(300_000 + dnssleep * 1_000, 1200_000);
  return performCommand(command, logger, { timeout, printOutput: true });
}

// async function convertCertToPKCS(client: Client, domains: string[], logger: Logger) {
//   const command = `openssl pkcs12 -export -keypbe NONE -certpbe NONE -nomaciter -passout pass: -out ~/.acme.sh/${domains[0]}/${domains[0]}.pfx -inkey ~/.acme.sh/${domains[0]}/${domains[0]}.key -in ~/.acme.sh/${domains[0]}/${domains[0]}.cer -certfile ~/.acme.sh/${domains[0]}/ca.cer`;
//   return performCommand(command, logger);
// }

function createEnvVarString(optionsToSet: { [key: string]: string }, logger: Logger) {
  let envVarsString = '';

  for (const key of Object.keys(optionsToSet)) {
    if (nonEnvTenantOptionsKeys.includes(key)) {
      logger.debug(`Skipping option: ${key}`);
      continue;
    }
    logger.debug(`Set option ${key}`);
    envVarsString += `${key}="${optionsToSet[key]}" `;
  }
  return envVarsString;
}
