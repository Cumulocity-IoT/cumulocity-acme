import { Client } from '@c8y/client';
import { readFileSync } from 'fs';
import { EdgeCertRenewalResponse, CertRenewalConfig, EdgeCertDetails } from '../models/cert-renewal.model';
import { Logger } from 'winston';
import { getSingleTenantClient } from './cumulocity.service';

export async function replaceCertAndKeyOfEdge(config: CertRenewalConfig, logger: Logger): Promise<void> {
  logger.debug('retrieving management client');
  const managementClient = getClientToEdgeManagement(config);
  await executeWithoutCertCheck(async () => {
    logger.debug('creating Cert Renewal task');
    const requestId = await createCertRenewalRequest(managementClient);
    logger.debug('Cert Renewal task created');
    await uploadCertFile(
      managementClient,
      'certificate',
      requestId,
      config.files.certFullchain.path,
      config.files.certFullchain.uploadName
    );
    logger.debug('certificate uploaded');
    await uploadCertFile(
      managementClient,
      'certificate_key',
      requestId,
      config.files.key.path,
      config.files.key.uploadName
    );
    logger.debug('certificate_key uploaded');

    await makeSureCertRenewalTaskSucceeded(managementClient, requestId, logger);
    logger.info('Successfully renewed certificate of edge.');
  });
}

async function uploadCertFile(
  client: Client,
  endpoint: 'certificate_key' | 'certificate',
  requestId: string,
  filePath: string,
  fileName: string
) {
  const file = readFileSync(filePath);
  const response = await client.core.fetch(`/edge/upload/${requestId}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${fileName}"`
    },
    body: file
  });
  if (response.status !== 201) {
    throw new Error(`Unable to upload file: ${fileName}`);
  }
}

async function createCertRenewalRequest(client: Client): Promise<string> {
  const response = await client.core.fetch(`/edge/configuration/certificate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ renewal_type: 'upload' })
  });
  if (response.status !== 201) {
    throw new Error(`Unable to create cert renewal request. Received statuscode: ${response.status}`);
  }
  const body: EdgeCertRenewalResponse = await response.json();
  return body.id;
}

async function makeSureCertRenewalTaskSucceeded(client: Client, requestId: string, logger: Logger) {
  for (let i = 0; i < 10; i++) {
    logger.debug(`makeSureCertRenewalTaskSucceeded: Waiting 10 seconds before checking if cert renewal task completed`);
    await new Promise((resolve) => {
      setTimeout(resolve, 10000);
    });
    const response = await client.core.fetch(`/edge/tasks/${requestId}`);
    if (response.status === 200) {
      const body = await response.json();
      logger.info(`Cert renewal task in status: ${body.status}`);
      if (body.failure_reason) {
        logger.warn(body.failure_reason);
      }
      if (body.status !== 'executing') {
        return;
      }
    }
  }
  throw new Error('Renewal task did not succeed.');
}

export async function getCurrentCertDetails(config: CertRenewalConfig): Promise<EdgeCertDetails> {
  const managementClient = getClientToEdgeManagement(config);
  return await executeWithoutCertCheck(async () => {
    const response = await managementClient.core.fetch('/edge/configuration/certificate');
    if (response.status !== 200) {
      throw new Error(`Wrong response code: ${response.status}`);
    }
    const body = await response.json();
    return body;
  });
}

function getClientToEdgeManagement(config: CertRenewalConfig) {
  const managementClient = getSingleTenantClient();
  managementClient.core.baseUrl = config.edge_ip ? `https://${config.edge_ip}` : process.env.C8Y_BASEURL;
  return managementClient;
}

async function executeWithoutCertCheck<T>(func: () => Promise<T>): Promise<T> {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  try {
    return await func();
  } catch (e) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1';
    throw e;
  }
}
