// ICE servers for voice chat (WebRTC), shared by the Node and Cloudflare hosts.
// STUN alone connects most players directly. Some networks (strict NATs, many mobile carriers) need a
// TURN relay; with a Cloudflare TURN key configured (TURN_KEY_ID + TURN_KEY_API_TOKEN), each request
// gets short-lived relay credentials. Without one, voice still works wherever a direct path exists.
const STUN = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
const TURN_TTL_S = 4 * 3600;

export async function iceServers(keyId, apiToken) {
  if (!keyId || !apiToken) return STUN;
  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl: TURN_TTL_S }),
    });
    if (!res.ok) return STUN;
    const { iceServers } = await res.json();
    const list = [].concat(iceServers ?? []);
    return list.length ? list : STUN;
  } catch {
    return STUN;
  }
}
