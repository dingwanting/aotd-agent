const USE_LOCAL_API = false;

const LOCAL_API_BASE_URL = "http://127.0.0.1:4173";

// 替换成微信云托管分配给服务的正式 HTTPS 域名
// 例如：https://aotd-1234567890.ap-shanghai.run.tcloudbase.com
const CLOUD_API_BASE_URL = "https://express-qx4w-284792-10-1456229499.sh.run.tcloudbase.com/";

function stripTrailingSlash(url) {
  return String(url || "").replace(/\/+$/, "");
}

const API_BASE_URL = stripTrailingSlash(USE_LOCAL_API ? LOCAL_API_BASE_URL : CLOUD_API_BASE_URL);

module.exports = {
  USE_LOCAL_API,
  LOCAL_API_BASE_URL,
  CLOUD_API_BASE_URL,
  API_BASE_URL,
};
