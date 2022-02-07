import {
  BasicAuth,
  Client,
  IAuthentication,
  IMicroserviceClientRequestHeaders,
  MicroserviceClientRequestAuth
} from '@c8y/client';

export function createClient(headers: IMicroserviceClientRequestHeaders): Client {
  const auth: IAuthentication = new MicroserviceClientRequestAuth(headers);

  return createClientWithDefaultHeaders(auth);
}

export function getSingleTenantClient(): Client {
  return createClientWithDefaultHeaders(
    new BasicAuth({
      tenant: process.env.C8Y_TENANT,
      user: process.env.C8Y_USER,
      password: process.env.C8Y_PASSWORD
    }),
    process.env.C8Y_TENANT
  );
}

function createClientWithDefaultHeaders(auth: IAuthentication, tenant?: string): Client {
  const fixedBaseURL = process.env.C8Y_BASEURL;
  const client = new Client(auth, fixedBaseURL);

  if (tenant) {
    client.core.tenant = tenant;
  }

  const header = { 'X-Cumulocity-Application-Key': process.env.APPLICATION_KEY };
  client.core.defaultHeaders = Object.assign(header, client.core.defaultHeaders);
  return client;
}

export async function listTenantOptionsOfCategory(
  category: string,
  client: Client
): Promise<{ [key: string]: string }> {
  const response = await client.core.fetch(`/tenant/options/${category}`);
  if (response.status !== 200) {
    throw new Error(`Failed to list key of category ${category}`);
  }
  const json: { [key: string]: string } = await response.json();
  return json;
}

export async function publishStatusUpdateEvent(text: string, type?: string): Promise<void> {
  try {
    const client = getSingleTenantClient();
    const deviceId = await findMSDevice(client);
    await client.event.create({
      source: { id: deviceId },
      type: type || 'statusUpdate',
      text,
      time: new Date().toISOString()
    });
  } catch (e) {
    // nothing to do
  }
}

async function findMSDevice(client: Client): Promise<string> {
  const { data } = await client.inventory.list({
    query: `type eq 'c8y_Application_*' and name eq '${process.env.APPLICATION_NAME}'`,
    pageSize: 1
  });
  if (!data.length) {
    throw Error('Device not found');
  }
  return data[0].id;
}
