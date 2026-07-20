# AOTD 微信小程序

这是基于当前 AOTD 原型拆出的原生微信小程序版本，入口目录是 `miniprogram/`。

## 当前已包含

- 三题问答
- 随机题型题库
- 调用现有 AOTD 推荐接口生成歌单
- 结果页展示
- 复制歌曲关键词，便于去网易云音乐继续搜索播放

## 你现在需要做的账号注册

1. 打开微信公众平台，注册一个小程序账号
2. 完成主体认证
3. 拿到小程序 `AppID`
4. 下载并安装微信开发者工具

## 本地接入

1. 把 `miniprogram/project.config.json` 里的 `touristappid` 替换成你的真实 `AppID`
2. 打开微信开发者工具
3. 导入项目根目录 `aotd-agent`
4. 确认 `miniprogramRoot` 指向 `miniprogram/`

## 本地体验链路

1. 在项目根目录启动本地 API：

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
PORT=4173 npm run dev:web
```

2. 确认小程序本地 API 地址是：

`miniprogram/utils/config.js`

```js
const USE_LOCAL_API = true;
const LOCAL_API_BASE_URL = "http://127.0.0.1:4173";
const CLOUD_API_BASE_URL = "https://your-wxcloudrun-domain.com";
```

3. 打开微信开发者工具并导入当前项目
4. 在开发者工具里勾选或确认：
   - 使用当前 `AppID`
   - 本地调试时不校验合法域名
5. 编译后直接进入问答页
6. 连续完成三题，即可在结果页看到歌单

说明：

- 这一套链路适合“开发者工具本地体验”
- 目前 API 地址是本地 `127.0.0.1`
- 真机预览或正式上线前，必须替换成公网 `HTTPS` 域名

## API 配置

默认接口地址在：

`miniprogram/utils/config.js`

当前默认值：

```js
const USE_LOCAL_API = false;
const LOCAL_API_BASE_URL = "http://127.0.0.1:4173";
const CLOUD_API_BASE_URL = "https://your-wxcloudrun-domain.com";
```

说明：

- 本地开发：将 `USE_LOCAL_API` 改成 `true`
- 云托管正式版：保持 `USE_LOCAL_API = false`
- 正式上线前，只需要把 `CLOUD_API_BASE_URL` 替换成微信云托管正式 HTTPS 域名

## 上线前必须补齐

- 小程序 `AppID`
- 公网 HTTPS API 域名
- 微信后台合法请求域名配置
- 后端线上部署

## 当前限制

- 当前小程序版先完成推荐闭环
- “去网易云听”暂时采用复制搜索词的方式
- 如果后续要做更丝滑的网易云跳转，需要再接平台侧可用能力
