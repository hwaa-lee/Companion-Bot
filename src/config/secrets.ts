import keytar from "keytar";

const SERVICE_NAME = "companionbot";

export type SecretKey = "telegram-token" | "anthropic-api-key";

export async function getSecret(key: SecretKey): Promise<string | null> {
  return keytar.getPassword(SERVICE_NAME, key);
}

export async function setSecret(key: SecretKey, value: string): Promise<void> {
  await keytar.setPassword(SERVICE_NAME, key, value);
}

export async function deleteSecret(key: SecretKey): Promise<boolean> {
  return keytar.deletePassword(SERVICE_NAME, key);
}

export async function listSecrets(): Promise<SecretKey[]> {
  const credentials = await keytar.findCredentials(SERVICE_NAME);
  return credentials.map((c) => c.account as SecretKey);
}
