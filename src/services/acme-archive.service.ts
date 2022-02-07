import { Client } from '@c8y/client';
import { readFileSync, writeFileSync } from 'fs';
import { generate } from 'generate-password';
import { Logger } from 'winston';
import { acmeArchiveFileName, acmeDirName, basePath, performCommand, SpecialTenantOptions } from './acme.service';
import { getSingleTenantClient, listTenantOptionsOfCategory } from './cumulocity.service';

export async function restoreFromACMEArchiveIfPossible(logger: Logger): Promise<void> {
  try {
    const client = getSingleTenantClient();
    const newestArchiveId = await findNewestACMEArchiveId(client);
    if (!newestArchiveId) {
      logger.info(`No Archive found to restore.`);
      return;
    }
    logger.debug(`newestArchiveId: ${newestArchiveId}`);
    const response = await client.inventoryBinary.download(newestArchiveId);
    if (response.status !== 200) {
      throw new Error(`Wrong status code: ${response.status}`);
    }
    logger.debug(`response.status: ${response.status}`);
    const file = await response.arrayBuffer();
    writeFileSync(`${basePath}/${acmeArchiveFileName}`, Buffer.from(file));
    logger.debug(`Archive stored on filesystem.`);
    const password = await getEncryptionPassword(client);
    await extractEncryptedACMEArchive(password, logger);
    logger.info(`Archive extracted.`);
  } catch (e) {
    logger.warn(`Failed to restore previous ACME stuff: ${JSON.stringify(e)}`);
  }
}

async function getEncryptionPassword(client: Client): Promise<string> {
  const category = process.env.APPLICATION_NAME;
  let encryptionKey = '';
  try {
    const options = await listTenantOptionsOfCategory(category, client);
    if (options[SpecialTenantOptions.ARCHIVE_ENCRYPTION_KEY]) {
      encryptionKey = options[SpecialTenantOptions.ARCHIVE_ENCRYPTION_KEY];
    }
  } catch (e) {}
  if (!encryptionKey) {
    encryptionKey = generate({ length: 32, numbers: true });
    await client.options.tenant
      .create({
        category,
        key: `credentials.${SpecialTenantOptions.ARCHIVE_ENCRYPTION_KEY}`,
        value: encryptionKey
      })
      .catch();
  }

  return encryptionKey;
}

async function findNewestACMEArchiveId(client: Client): Promise<string> {
  const { data: files } = await client.inventory.list({
    query: `$filter=(name eq '${acmeArchiveFileName}' and owner eq '${process.env.C8Y_USER}' and has(c8y_IsBinary)) $orderby=creationTime.date desc,creationTime desc`,
    pageSize: 1
  });
  if (!files.length) {
    return '';
  }
  return files[0].id;
}

async function extractEncryptedACMEArchive(password: string, logger: Logger): Promise<void> {
  const command = `openssl enc -d -aes256 -base64 -pbkdf2 -iter 100000 -in ${basePath}/${acmeArchiveFileName} -pass pass:${password} | tar -v -xz -C ${basePath}`;
  return performCommand(command, logger);
}

export async function createAndUploadACMEArchive(client: Client, logger: Logger): Promise<void> {
  const previousArchive = await findNewestACMEArchiveId(client);
  const password = await getEncryptionPassword(client);
  await createEncryptedACMEArchive(password, logger);
  await uploadArchive(client);
  if (previousArchive) {
    await client.inventoryBinary.delete(previousArchive);
  }
}

async function uploadArchive(client: Client): Promise<void> {
  await client.inventoryBinary.create(readFileSync(`${basePath}/${acmeArchiveFileName}`), {
    name: acmeArchiveFileName
  });
}

function createEncryptedACMEArchive(password: string, logger: Logger): Promise<void> {
  const command = `tar -v -czf - -C ${basePath} ${acmeDirName} | openssl enc -e -aes256 -base64 -pbkdf2 -iter 100000 -out ${basePath}/${acmeArchiveFileName} -pass pass:${password}`;
  return performCommand(command, logger);
}
