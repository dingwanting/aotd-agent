import { request } from "node:https";
import { lookup } from "node:dns";

// 调微信 jscode2session 换 openid。
// 这里不用 fetch，而是改用 https.request + IPv4，规避部分云容器里 undici/fetch
// 对微信域名的 DNS/IPv6 兼容问题。

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
  errorCode?: string;
}

interface WxSessionResponse {
  openid?: string;
  unionid?: string;
  session_key?: string;
  errcode?: number;
  errmsg?: string;
}

const WX_LOGIN_URL = "https://api.weixin.qq.com/sns/jscode2session";
const SELF_SIGNED_CERT_ERROR = "DEPTH_ZERO_SELF_SIGNED_CERT";

function requestJson(
  url: URL,
  timeoutMs: number,
  allowInsecureTls = false,
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        timeout: timeoutMs,
        family: 4,
        lookup,
        rejectUnauthorized: !allowInsecureTls,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode || 0,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
      },
    );

    req.on("timeout", () => {
      req.destroy(new Error("wx-login request timeout"));
    });
    req.on("error", (error) => {
      reject(error);
    });
    req.end();
  });
}

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
  const requestUrl = new URL(`${WX_LOGIN_URL}?${params.toString()}`);

  let response: { statusCode: number; body: string };
  try {
    response = await requestJson(requestUrl, timeoutMs);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err && err.code === SELF_SIGNED_CERT_ERROR) {
      try {
        response = await requestJson(requestUrl, timeoutMs, true);
      } catch (retryError) {
        const retryErr = retryError as NodeJS.ErrnoException;
        return {
          ok: false,
          failure: {
            reason: "network",
            errmsg: retryError instanceof Error ? retryError.message : String(retryError),
            errorCode: retryErr && typeof retryErr.code === "string" ? retryErr.code : undefined,
          },
        };
      }
    } else {
      return {
        ok: false,
        failure: {
          reason: "network",
          errmsg: error instanceof Error ? error.message : String(error),
          errorCode: err && typeof err.code === "string" ? err.code : undefined,
        },
      };
    }
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    return { ok: false, failure: { reason: "upstream-error", httpStatus: response.statusCode } };
  }

  let payload: WxSessionResponse;
  try {
    payload = JSON.parse(response.body) as WxSessionResponse;
  } catch {
    return { ok: false, failure: { reason: "upstream-error", httpStatus: response.statusCode } };
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
