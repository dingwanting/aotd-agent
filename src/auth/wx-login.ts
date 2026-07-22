// 调微信 jscode2session 换 openid
// 失败时（如 secret 没配）返回 null，让调用方走 fallback

export interface WxLoginResult {
  openid: string;
  unionid?: string;
  sessionKey?: string;
}

interface WxSessionResponse {
  openid?: string;
  unionid?: string;
  session_key?: string;
  errcode?: number;
  errmsg?: string;
}

const WX_LOGIN_URL = "https://api.weixin.qq.com/sns/jscode2session";

export async function exchangeWxCodeForOpenId(
  appId: string,
  appSecret: string,
  code: string,
  timeoutMs = 6000,
): Promise<WxLoginResult | null> {
  if (!appId || !appSecret || !code) {
    return null;
  }

  const params = new URLSearchParams({
    appid: appId,
    secret: appSecret,
    js_code: code,
    grant_type: "authorization_code",
  });

  try {
    const response = await fetch(`${WX_LOGIN_URL}?${params.toString()}`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as WxSessionResponse;
    if (!payload.openid || payload.errcode) {
      return null;
    }

    return {
      openid: payload.openid,
      unionid: payload.unionid,
      sessionKey: payload.session_key,
    };
  } catch {
    return null;
  }
}
