# AOTD Song Remote Provider

当前项目已默认对齐 `docs.sunoapi.org/cn` 这一套接口规范。

当环境变量 `AOTD_SONG_PROVIDER=remote` 且已配置 `AOTD_SONG_API_KEY` 时，`制作我的 AOTD` 会走 SunoAPI 真实音乐生成服务。

## 环境变量

```bash
AOTD_SONG_PROVIDER=remote
AOTD_SONG_API_KEY=your_api_key
AOTD_SONG_BASE_URL=https://api.sunoapi.org
AOTD_SONG_FILE_UPLOAD_BASE_URL=https://sunoapiorg.redpandaai.co
AOTD_SONG_MODEL=V4_5ALL
AOTD_SONG_CREATE_PATH=/api/v1/generate
AOTD_SONG_UPLOAD_CREATE_PATH=/api/v1/generate/upload-cover
AOTD_SONG_STATUS_PATH=/api/v1/generate/record-info?taskId={taskId}
AOTD_SONG_CALLBACK_URL=https://your-domain.com/api/aotd-song/callback
AOTD_PUBLIC_BASE_URL=https://your-domain.com
AOTD_SONG_VOICE_PERSONA_ID=
AOTD_SONG_VOICE_PERSONA_MODEL=
```

说明：

- `AOTD_SONG_FILE_UPLOAD_BASE_URL` 是 Suno 文件上传服务地址，默认走 `https://sunoapiorg.redpandaai.co`
- 现在用户录音会优先上传到 Suno 自己的临时文件服务，再把返回的 `downloadUrl` 喂给 `voice validate / voice generate / upload-cover`
- `AOTD_PUBLIC_BASE_URL` 仍可保留给项目自己的静态资源场景，但不再是 Suno Voice 的硬前置
- `AOTD_SONG_VOICE_PERSONA_ID` / `AOTD_SONG_VOICE_PERSONA_MODEL` 是可选能力位
  - 如果后续接通 Suno Voice 生成的 `voiceId`，可在这里填入
  - `voice_persona` 仅适用于 `V5 / V5_5`

## 创建任务请求

当前 provider 有两条路径：

### 1. 基础文本生成

- Method: `POST`
- URL: `${AOTD_SONG_BASE_URL}${AOTD_SONG_CREATE_PATH}`
- Headers:
  - `Authorization: Bearer ${AOTD_SONG_API_KEY}`
  - `Content-Type: application/json`
- Body:

```json
{
  "prompt": "请围绕“今天先听这个”创作一首属于用户的 AOTD 歌曲。整体气质参考今晚歌单……",
  "customMode": false,
  "instrumental": false,
  "model": "V4_5ALL"
}
```

### 2. 用户录音上传链路

当后端拿到用户录音后，provider 会先上传到 Suno 文件服务，并将返回的 `downloadUrl` 作为 `uploadUrl` 调用：

- Path: `AOTD_SONG_UPLOAD_CREATE_PATH`
- 默认值：`/api/v1/generate/upload-cover`

典型请求体：

```json
{
  "uploadUrl": "https://sunoapiorg.redpandaai.co/download/xxx",
  "customMode": true,
  "instrumental": false,
  "model": "V4_5ALL",
  "callBackUrl": "https://your-domain.com/api/aotd-song/callback",
  "prompt": "[Verse]\n今天先好好抱抱自己\n把今天慢慢放下\n[Chorus]\n今天先好好抱抱自己",
  "style": "Mandarin pop, late night, healing, intimate vocal",
  "title": "今天先好好抱抱自己"
}
```

补充说明：

- 这条链路的目标是让用户录音先真实进入 Suno 的上传音频处理流程
- 项目还会把最终生成出的远程音频下载回自己的 `/generated/aotd-song/remote-audio/...`，避免小程序直接播放第三方临时域名失败
- 如果 upload 链路失败，代码会自动 fallback 到基础文本生成，不会直接报废整个任务
- 如果后续拿到 `voiceId`，可以继续通过 `personaId + personaModel=voice_persona` 升级成更强的“按用户音色出歌”

## 支持两种返回模式

### 1. 直接返回成功结果

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "suno_task_abc123",
    "status": "SUCCESS",
    "response": {
      "data": [
        {
          "id": "audio_123",
          "audio_url": "https://example.com/generated-music.mp3",
          "title": "生成的歌曲",
          "tags": "民谣, 原声",
          "duration": 180.5
        }
      ]
    }
  }
}
```

### 2. 先返回任务 ID，再轮询状态

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "task_123"
  }
}
```

## 查询状态请求

- Method: `GET`
- URL: `${AOTD_SONG_BASE_URL}${AOTD_SONG_STATUS_PATH}`
- `AOTD_SONG_STATUS_PATH` 中必须包含 `{taskId}` 占位符，例如：
  - `/api/v1/generate/record-info?taskId={taskId}`

## 查询状态返回

### 处理中

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "task_123",
    "status": "PENDING"
  }
}
```

### 成功

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "task_123",
    "status": "SUCCESS",
    "response": {
      "data": [
        {
          "id": "audio_123",
          "audio_url": "https://example.com/generated-music.mp3",
          "title": "生成的歌曲",
          "tags": "民谣, 原声",
          "duration": 180.5
        }
      ]
    }
  }
}
```

### 失败

```json
{
  "code": 500,
  "msg": "generation failed"
}
```

## 当前 voice sample 状态

当前真实 provider 的状态已经升级为：

- 已接上真实歌曲生成
- 已按歌单和标题文本生成 prompt
- 已把用户录音落成后端静态文件，并在公网域名可用时生成 `uploadUrl`
- 已优先尝试走 `upload-cover` 上传音频链路，让用户语音真实参与生成
- 仍保留 `voice_persona` 能力位，后续拿到完整 Suno Voice 文档后可继续升级成真正的音色 persona 方案

## Suno Voice Persona 流程

现在项目已经接入 Suno Voice 的两段式流程：

### 1. 生成验证短句

- API: `POST /api/v1/voice/validate`
- 项目侧入口：`POST /api/aotd-song/voice-persona/prepare`
- 入参：
  - 第一段用户标题录音 `voiceBase64`
  - 录音格式 `voiceFormat`
  - 录音时长 `voiceDurationMs`
- 返回：
  - `taskId`
  - `validateInfo`

### 2. 生成专属音色

- API: `POST /api/v1/voice/generate`
- 项目侧入口：`POST /api/aotd-song/voice-persona/confirm`
- 入参：
  - 第一步返回的 `validateTaskId`
  - 用户跟读验证短句后的第二段录音 `verifyVoiceBase64`
- 返回：
  - `voiceId`
  - `isAvailable`

### 3. 出歌时自动带入 voice persona

当页面已经拿到 `voiceId` 时，`/api/aotd-song/generate` 会自动带上：

```json
{
  "personaId": "voice_xxx",
  "personaModel": "voice_persona",
  "model": "V5_5"
}
```

说明：

- `voiceId` 会通过 `voicePersonaId` 从前端传给后端任务
- 真实 provider 会优先把它当作 `personaId`
- 如果没有 `voiceId`，则回退到“上传音频链路 / 纯文本生成链路”
