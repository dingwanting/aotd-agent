// 调微信 jscode2session 换 openid
// 失败时（如 secret 没配）返回 null，让调用方走 fallback

export interface WxLoginResult {
  openid: string;
  unionid?: string;
  sessionKey?: string;
}

export interface WxLoginFailure {
  reason: "missing-credentials" | "missing-code" | "upstream-error" | "upstream-errcode" | "network";
  httpStatus?: number;
  errcode?: number;
  errmsg?: string;
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
): Promise<{ ok: true; data: WxLoginResult } | { ok: false; failure: WxLoginFailure }> {
  if (!appId || !appSecret) {
    return { ok: false, failure: { reason: "missing-credentials" } };
  }
  if (!code) {
    return { ok: false, failure: { reason: "missing-code" } };
  }

  const params = new URLSearchParams({
    appid: appId,
    secret: appSecret,
    js_code: code,
    grant_type: "authorization_code",
  });

  let response: Response;
  try {
    response = await fetch(`${WX_LOGIN_URL}?${params.toString()}`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return {
      ok: false,
      failure: {
        reason: "network",
        errmsg: error instanceof Error ? error.message : String(error),
      },
    };
  }

  if (!response.ok) {
    return { ok: false, failure: { reason: "upstream-error", httpStatus: response.status } };
  }

  let payload: WxSessionResponse;
  try {
    payload = (await response.json()) as WxSessionResponse;
  } catch {
    return { ok: false, failure: { reason: "upstream-error", httpStatus: response.status } };
  }

  if (!payload.openid) {
    return {
      ok: false,
      failure: {
        reason: "upstream-errcode",
        errcode: payload.errcode,
        errmsg: payload.errmsg,
      },
    };
  }

  return {
    ok: true,
    data: {
      openid: payload.openid,
      unionid: payload.unionid,
      sessionKey: payload.session_key,
    },
  };
}
