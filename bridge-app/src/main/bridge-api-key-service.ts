/**
 * Fetch the bridge API key from the backend using JWT auth.
 * The server returns the shared BRIDGE_API_KEY to authenticated users.
 */
export async function fetchBridgeApiKey(
  apiUrl: string,
  token: string,
): Promise<string> {
  const response = await fetch(`${apiUrl}/api/bridge/apikey`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Session expired. Please log in again.');
    }
    if (response.status === 404) {
      throw new Error(
        'Bridge API key endpoint not found. Make sure the server is updated to the latest version.',
      );
    }
    if (response.status === 503) {
      throw new Error('Bridge API key not configured on server.');
    }
    const error = await response.json().catch(() => ({ detail: 'Failed to fetch bridge API key' }));
    throw new Error(error.detail || 'Failed to fetch bridge API key');
  }

  const data: { bridge_api_key: string } = await response.json();
  return data.bridge_api_key;
}
