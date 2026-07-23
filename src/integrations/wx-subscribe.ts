const ACCESS_TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/token";
const SUBSCRIBE_SEND_URL = "https://api.weixin.qq.com/cgi-bin/message/subscribe/send";

let accessTokenCache: { token: string; expiresAt: number } | null = null;

interface AccessTokenResponse {
  access_token?: string;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
}

interface SubscribeSendResponse {
  errcode?: number;
  errmsg?: string;
}

export interface SubscribeMessageDataValue {
  value: string;
}

export interface SendSubscribeMessageParams {
  appId: string;
  secret: string;
  openid: string;
  templateId: string;
  page: string;
  data: Record<string, SubscribeMessageDataValue>;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(`WeChat API request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function getMiniProgramAccessToken(appId: string, secret: string): Promise<string> {
  if (!appId || !secret) {
    throw new Error("Missing mini program app credentials");
  }

  const now = Date.now();
  if (accessTokenCache && accessTokenCache.expiresAt > now) {
    return accessTokenCache.token;
  }

  const params = new URLSearchParams({
    grant_type: "client_credential",
    appid: appId,
    secret,
  });

  const payload = await fetchJson<AccessTokenResponse>(`${ACCESS_TOKEN_URL}?${params.toString()}`, {
    method: "GET",
  });

  if (!payload.access_token) {
    throw new Error(payload.errmsg || "Unable to fetch mini program access token");
  }

  const ttlMs = Math.max(60, Number(payload.expires_in || 7200) - 300) * 1000;
  accessTokenCache = {
    token: payload.access_token,
    expiresAt: now + ttlMs,
  };
  return payload.access_token;
}

export async function sendMiniProgramSubscribeMessage(params: SendSubscribeMessageParams): Promise<void> {
  const accessToken = await getMiniProgramAccessToken(params.appId, params.secret);
  const payload = await fetchJson<SubscribeSendResponse>(`${SUBSCRIBE_SEND_URL}?access_token=${encodeURIComponent(accessToken)}`, {
    method: "POST",
    body: JSON.stringify({
      touser: params.openid,
      template_id: params.templateId,
      page: params.page,
      data: params.data,
    }),
  });

  if ((payload.errcode || 0) !== 0) {
    throw new Error(payload.errmsg || `subscribeMessage.send failed with code ${payload.errcode}`);
  }
}
