# AOTD Agent

面向 AOTD（Audio of the Day）的 `Node + TypeScript` Agent 框架。

这套骨架采用“Claude code 风格”的组织方式，但模型接入层改为 `OpenAI Compatible API`，方便接各类兼容 OpenAI 协议的模型服务。

- `runtime` 负责消息编排与执行
- `prompts` 负责 system prompt 与 few-shot 模板
- `domain/aotd` 负责 AOTD 业务输入、计划结构与样例
- `providers` 负责调用 OpenAI 兼容协议接口

## 目录

```text
aotd-agent/
├── package.json
├── tsconfig.json
├── .nvmrc
├── .env.example
└── src
    ├── index.ts
    ├── agents/
    ├── config/
    ├── core/
    ├── domain/
    ├── prompts/
    └── providers/
```

## 快速开始

1. 安装 Node 22+
2. 复制环境变量

```bash
cp .env.example .env
```

推荐配置：

```env
OPENAI_BASE_URL=https://你的服务商域名/v1
OPENAI_API_KEY=你的key
OPENAI_MODEL=你的模型名
```

3. 安装依赖

```bash
npm install
```

4. 本地运行

```bash
npm run dev
```

5. 批量回写网易云 `OriginalID`

```bash
npm run fill:original-ids
```

常用参数：

```bash
# 先做 20 首 dry run，不改 Excel
npm run fill:original-ids -- --limit 20 --dry-run

# 正式回写全部待补歌曲
npm run fill:original-ids

# 指定其他歌库路径
npm run fill:original-ids -- --workbook "/path/to/AOTD_500_Song_Library_Enhanced.xlsx"
```

脚本行为：

- 默认读取 `AOTD_WORKBOOK_PATH`
- 默认只处理 `OriginalID` 为空且 `IDStatus` 仍为 `Pending/To Review` 的歌曲
- 命中后回写 `OriginalID / IsPlayable=Y / IDStatus=Done`
- 正式执行前会自动创建原 Excel 备份文件
- 会在歌库同目录输出一份 `*.original-id-report.json` 命中报告

## 当前能力

- 支持把用户自然语言请求转成 AOTD 选歌计划
- 支持 few-shot 样例拼装
- 支持 OpenAI 兼容协议调用
- 支持读取真实 Excel 歌库并输出候选结果
- 未配置 API key 时自动回退到本地 mock 结果，便于先开发主流程

## 环境变量

- `OPENAI_BASE_URL`: OpenAI 兼容服务地址，默认 `https://api.openai.com/v1`
- `OPENAI_API_KEY`: OpenAI 兼容协议的 API Key
- `OPENAI_MODEL`: 模型名，例如 `gpt-4o-mini`、`glm-4.5`、`zai-org/GLM-5.2`
- `AOTD_WORKBOOK_PATH`: 500 首标签歌曲 Excel 路径
- `NETEASE_AUDIO_API_BASE`: 网易云音频解析服务地址，默认 `https://api.91videos.vip`

兼容迁移：

- 旧变量 `ANTHROPIC_API_KEY` 会被当作 `OPENAI_API_KEY` 兜底读取
- 旧变量 `ANTHROPIC_MODEL` 会被当作 `OPENAI_MODEL` 兜底读取

## 微信云托管部署

项目已经按微信云托管 `wxcloudrun` 的源码部署方式补齐了关键文件：

- `Dockerfile`
- `.dockerignore`
- `container.config.json`

推荐部署方式：

1. 以项目根目录 `aotd-agent/` 作为服务根目录上传
2. 使用源码构建
3. 容器启动命令使用仓库内默认 `npm start`
4. 容器端口使用 `80`

部署前必须确认两件事：

1. 将歌库文件放到仓库内 `data/AOTD_500_Song_Library_Enhanced.xlsx`
2. 在云托管环境变量里至少配置：

```env
OPENAI_BASE_URL=https://你的服务商域名/v1
OPENAI_API_KEY=你的key
OPENAI_MODEL=你的模型名
AOTD_WORKBOOK_PATH=data/AOTD_500_Song_Library_Enhanced.xlsx
NETEASE_AUDIO_API_BASE=https://api.91videos.vip
```

部署成功后可先访问健康检查接口确认服务与歌库都已就绪：

```text
GET /api/health
```

返回中的 `workbookExists` 应为 `true`。

## 下一步建议

- 接入歌曲库 schema
- 把本地 demo 检索器升级为真实歌曲库检索与 rerank
- 接 `ncm-cli` 播放执行器
- 增加“需求识别 -> 候选召回 -> 播放清单生成”的完整链路
