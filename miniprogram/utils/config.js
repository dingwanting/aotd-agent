const USE_LOCAL_API = false;
const USE_CLOUD_CONTAINER = !USE_LOCAL_API;

const LOCAL_API_BASE_URL = "http://127.0.0.1:4173";

// 体验版优先走微信云托管 callContainer，不依赖 request 合法域名。
// 这里的环境 ID 来自你当前云托管环境自动注入的 COS_BUCKET:
// 7072-prod-d3g7ry1890f0837e7-1456229499 -> envId = prod-d3g7ry1890f0837e7
const CLOUD_ENV_ID = "prod-d3g7ry1890f0837e7";

// 云托管服务名，通常和控制台服务列表中的名字一致。
// 从当前公网域名推断，服务名大概率是 express-qx4w。
const CLOUD_SERVICE_NAME = "express-qx4w";
const CLOUD_SERVICE_FALLBACKS = ["express-qx4w", "express"];

// 仍然保留公网域名，供本地排查或音频流等非 wx.cloud 调用场景使用。
const CLOUD_API_BASE_URL = "https://express-qx4w-284792-10-1456229499.sh.run.tcloudbase.com/";

function stripTrailingSlash(url) {
  return String(url || "").replace(/\/+$/, "");
}

const API_BASE_URL = stripTrailingSlash(USE_LOCAL_API ? LOCAL_API_BASE_URL : CLOUD_API_BASE_URL);

module.exports = {
  USE_LOCAL_API,
  USE_CLOUD_CONTAINER,
  LOCAL_API_BASE_URL,
  CLOUD_ENV_ID,
  CLOUD_SERVICE_NAME,
  CLOUD_SERVICE_FALLBACKS,
  CLOUD_API_BASE_URL,
  API_BASE_URL,
};
