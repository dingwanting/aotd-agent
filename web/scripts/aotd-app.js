import { createQuestionDeck } from "/scripts/question-bank.js";

export const STORAGE_KEYS = {
  answers: "aotd.answers",
  result: "aotd.result",
  questionDeck: "aotd.questionDeck",
};

const HTML_ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export const questionConfig = {
  consumptionSource: {
    step: "01/03",
    progress: "34%",
    progressLabel: "起点已记录",
    nextHref: "/pages/question-need.html",
    autoAdvance: true,
    answerKey: "consumptionSource",
    options: [
      { value: "沟通交流", label: "沟通交流", description: "今天说了太多话，耳边还在回响。", mark: "01" },
      { value: "思考决策", label: "思考决策", description: "脑内标签很多，需要慢慢降噪。", mark: "02" },
      { value: "重复工作", label: "重复工作", description: "节奏被拉平了，想找回一点流动感。", mark: "03" },
      { value: "情绪压力", label: "情绪压力", description: "需要更温柔的空间把心放下来。", mark: "04" },
      { value: "身体疲惫", label: "身体疲惫", description: "此刻更想被柔和节拍托住。", mark: "05" },
    ],
  },
  emotionalNeed: {
    step: "02/03",
    progress: "67%",
    progressLabel: "节奏正在成形",
    nextHref: "/pages/question-scene.html",
    prevHref: "/pages/question-drain.html",
    autoAdvance: true,
    answerKey: "emotionalNeed",
    options: [
      { value: "放松一下", label: "放松一下", description: "先把肩膀放下，让心跳慢一点。", mark: "01" },
      { value: "找回力量", label: "找回力量", description: "想重新聚拢一点精神和能量。", mark: "02" },
      { value: "有人陪伴", label: "有人陪伴", description: "不必聊天，只想感觉不是一个人。", mark: "03" },
      { value: "清空大脑", label: "清空大脑", description: "让今天的杂音先从脑海里退场。", mark: "04" },
      { value: "奖励自己", label: "奖励自己", description: "给这一天一个柔软又体面的结尾。", mark: "05" },
    ],
  },
  emotionalImagery: {
    step: "03/03",
    progress: "100%",
    progressLabel: "即将生成歌单",
    nextHref: "/pages/playlist-result.html",
    prevHref: "/pages/question-need.html",
    autoAdvance: false,
    answerKey: "emotionalImagery",
    options: [
      { value: "东京雨夜", label: "东京雨夜", description: "霓虹被雨线拉长，车窗上的倒影替你说完今天没说出口的话。", chips: ["Neon", "Rain"] },
      { value: "夏日晚风", label: "夏日晚风", description: "路边树影很轻，风穿过耳机，像把整天的燥热慢慢吹散。", chips: ["Breeze", "Soft"] },
      { value: "海边公路", label: "海边公路", description: "城市退到身后，节拍和海平线一起把视线拉开。", chips: ["Drive", "Wide"] },
      { value: "深夜便利店", label: "深夜便利店", description: "白光安静落下，世界缩成一小段只属于自己的停靠。", chips: ["Quiet", "Late"] },
      { value: "城市灯光", label: "城市灯光", description: "高楼窗口一盏盏亮着，像陌生人无声地陪你一起回家。", chips: ["Glow", "Urban"] },
    ],
  },
};

export function loadAnswers() {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEYS.answers) || "{}");
  } catch {
    return {};
  }
}

export function saveAnswers(answers) {
  sessionStorage.setItem(STORAGE_KEYS.answers, JSON.stringify(answers));
}

export function saveResult(result) {
  sessionStorage.setItem(STORAGE_KEYS.result, JSON.stringify(result));
}

export function loadResult() {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEYS.result) || "null");
  } catch {
    return null;
  }
}

function loadQuestionDeck() {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEYS.questionDeck) || "null");
  } catch {
    return null;
  }
}

function saveQuestionDeck(deck) {
  sessionStorage.setItem(STORAGE_KEYS.questionDeck, JSON.stringify(deck));
}

function ensureQuestionDeck(forceRefresh = false) {
  const currentDeck = loadQuestionDeck();
  if (
    !forceRefresh &&
    currentDeck?.consumptionSource &&
    currentDeck?.emotionalNeed &&
    currentDeck?.emotionalImagery
  ) {
    return currentDeck;
  }

  const nextDeck = createQuestionDeck();
  saveQuestionDeck(nextDeck);
  return nextDeck;
}

export function renderQuestionOptions(container, config, selectedValue) {
  container.innerHTML = "";

  const options = config.options || [];
  options.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `option-card${selectedValue === option.value ? " is-active" : ""}`;
    button.dataset.value = option.value;

    const rightMarkup = option.chips
      ? `<span class="chip-stack">${option.chips.map((chip) => `<span class="chip">${chip}</span>`).join("")}</span>`
      : `<span class="option-mark option-mark--circle">${option.mark || ""}</span>`;

    button.innerHTML = `
      <span class="option-copy">
        <strong>${option.label}</strong>
        <span>${option.description}</span>
      </span>
      ${rightMarkup}
    `;

    container.appendChild(button);
  });
}

export function initQuestionPage(pageKey) {
  const config = questionConfig[pageKey];
  const questionDeck = ensureQuestionDeck(pageKey === "consumptionSource");
  const promptCopy = questionDeck[pageKey];
  const resolvedConfig = {
    ...config,
    options: promptCopy?.options?.length ? promptCopy.options : config.options,
  };
  const answers = loadAnswers();
  const selectedValue = answers[config.answerKey];

  const optionsContainer = document.querySelector("[data-role='options']");
  const cta = document.querySelector("[data-role='next']");
  const progressFill = document.querySelector("[data-role='progress-fill']");
  const progressLabel = document.querySelector("[data-role='progress-label']");
  const stepNode = document.querySelector("[data-role='step']");
  const backLink = document.querySelector("[data-role='back']");
  const titleNode = document.querySelector("[data-role='question-title']");
  const hintNode = document.querySelector("[data-role='question-hint']");
  const footnoteNode = document.querySelector("[data-role='question-footnote']");

  if (!optionsContainer || !cta) {
    return;
  }

  if (pageKey === "consumptionSource") {
    sessionStorage.removeItem(STORAGE_KEYS.result);
  }

  renderQuestionOptions(optionsContainer, resolvedConfig, selectedValue);

  if (progressFill) {
    progressFill.style.width = resolvedConfig.progress;
  }
  if (progressLabel) {
    progressLabel.textContent = resolvedConfig.progressLabel;
  }
  if (titleNode && promptCopy?.title) {
    titleNode.textContent = promptCopy.title;
  }
  if (hintNode && promptCopy?.hint) {
    hintNode.textContent = promptCopy.hint;
  }
  if (footnoteNode && promptCopy?.footnote) {
    footnoteNode.textContent = promptCopy.footnote;
  }
  if (stepNode) {
    stepNode.textContent = resolvedConfig.step;
  }
  if (backLink && resolvedConfig.prevHref) {
    backLink.setAttribute("href", resolvedConfig.prevHref);
  }
  if (cta) {
    cta.hidden = Boolean(resolvedConfig.autoAdvance);
  }

  let currentValue = selectedValue || resolvedConfig.options[0].value;
  let isNavigating = false;
  answers[resolvedConfig.answerKey] = currentValue;
  saveAnswers(answers);
  renderQuestionOptions(optionsContainer, resolvedConfig, currentValue);

  optionsContainer.addEventListener("click", (event) => {
    const button = event.target instanceof HTMLElement ? event.target.closest(".option-card") : null;
    if (!button) return;
    currentValue = button.dataset.value || currentValue;
    answers[resolvedConfig.answerKey] = currentValue;
    saveAnswers(answers);
    renderQuestionOptions(optionsContainer, resolvedConfig, currentValue);

    if (resolvedConfig.autoAdvance && !isNavigating) {
      isNavigating = true;
      window.setTimeout(() => {
        window.location.href = resolvedConfig.nextHref;
      }, 140);
    }
  });

  cta.addEventListener("click", (event) => {
    event.preventDefault();
    answers[resolvedConfig.answerKey] = currentValue;
    saveAnswers(answers);
    window.location.href = resolvedConfig.nextHref;
  });
}

export async function requestRecommendation(answers) {
  const previousResult = loadResult();
  const excludeSongIds =
    previousResult?.playlist?.tracks?.map((track) => track.song?.id).filter(Boolean) || [];
  const excludeSongKeys =
    previousResult?.playlist?.tracks
      ?.map((track) => {
        const title = track.song?.title;
        const artist = track.song?.artist;
        return title && artist ? `${title}::${artist}` : null;
      })
      .filter(Boolean) || [];

  const response = await fetch("/api/aotd/recommendation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...answers,
      excludeSongIds,
      excludeSongKeys,
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "生成歌单失败");
  }

  saveResult(payload);
  return payload;
}

export function ensureAnswersCompleted() {
  const answers = loadAnswers();
  if (!answers.consumptionSource || !answers.emotionalNeed || !answers.emotionalImagery) {
    window.location.href = "/pages/question-drain.html";
    return null;
  }
  return answers;
}

export function energyLabel(energy) {
  const map = {
    low: "低压舒缓",
    medium: "平稳推进",
    high: "轻度提振",
  };
  return map[energy] || "今晚陪伴";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char]);
}

function setText(selector, value, root = document) {
  const node = root.querySelector(selector);
  if (node) {
    node.textContent = value;
  }
}

function setHref(selector, value, root = document) {
  const node = root.querySelector(selector);
  if (node) {
    node.setAttribute("href", value);
  }
}

function renderStateMessage(container, message, variant = "loading") {
  if (!container) {
    return;
  }

  container.innerHTML = `<div class="${variant === "error" ? "error-message" : "loading"}">${escapeHtml(message)}</div>`;
}

function isSameAnswers(left, right) {
  return (
    left?.consumptionSource === right?.consumptionSource &&
    left?.emotionalNeed === right?.emotionalNeed &&
    left?.emotionalImagery === right?.emotionalImagery
  );
}

function buildJourneySteps(result) {
  return [
    {
      title: "识别消耗",
      detail: `今晚最先被看见的，是来自“${result.answers.consumptionSource}”的疲惫。`,
    },
    {
      title: "确认需求",
      detail: `歌单主线会优先回应你此刻想要的“${result.answers.emotionalNeed}”。`,
    },
    {
      title: "进入场景",
      detail: `整体氛围被收拢进“${result.answers.emotionalImagery}”这幕夜色里。`,
    },
    {
      title: "慢慢收束",
      detail: result.analysis.recommendationLogic || "让情绪从紧绷转向更平稳的呼吸节奏。",
    },
  ];
}

function estimateDurationMinutes(trackCount) {
  return Math.max(18, trackCount * 4);
}

function stripPlaylistPrefix(title) {
  return String(title || "").replace(/^AOTD\s*\|\s*/i, "").trim() || "今晚歌单";
}

function getTrackKeyword(track) {
  return track.song?.cliKeyword || `${track.song?.title || ""} ${track.song?.artist || ""}`.trim();
}

function buildNeteasePlayUrl(track) {
  const params = new URLSearchParams();
  const keyword = getTrackKeyword(track);
  const title = track?.song?.title || "";
  const artist = track?.song?.artist || "";

  if (keyword) {
    params.set("keyword", keyword);
  }
  if (title) {
    params.set("title", title);
  }
  if (artist) {
    params.set("artist", artist);
  }
  if (track?.song?.originalId) {
    params.set("originalId", track.song.originalId);
  }

  return `/api/netease/play?${params.toString()}`;
}

function buildTrackPlayMeta(track) {
  if (!track?.song) {
    return {
      href: "#",
      label: "暂不可播",
      note: "缺少歌曲信息",
      exact: false,
    };
  }

  if (track.song.originalId) {
    return {
      href: `https://music.163.com/#/song?id=${encodeURIComponent(track.song.originalId)}`,
      label: "立即播放",
      note: "单曲直达",
      exact: true,
    };
  }

  return {
    href: buildNeteasePlayUrl(track),
    label: "立即播放",
    note: "搜索解析",
    exact: false,
  };
}

function buildPlayUrl(result) {
  const firstTrack = result.playlist?.tracks?.[0];
  if (!firstTrack) {
    return "#";
  }

  return buildTrackPlayMeta(firstTrack).href;
}

function renderResultPage(result) {
  const primaryTrack = result.playlist?.tracks?.[0];
  setText("[data-role='intro-title']", result.analysis.hitLine || result.analysis.todayState || result.plan.todayStateSummary);
  setText("[data-role='intro-support']", result.analysis.todayState || result.playlist.description);
  setText("[data-role='cover-title']", stripPlaylistPrefix(result.playlist.title));
  setText("[data-role='cover-subtitle']", result.playlist.subtitle);
  setText("[data-role='cover-duration']", `约 ${estimateDurationMinutes(result.playlist.tracks.length)} 分钟`);
  setText("[data-role='cover-count']", `${result.playlist.tracks.length} 首曲目`);
  setText("[data-role='cover-energy']", energyLabel(primaryTrack?.song?.energy));

  const trackList = document.querySelector("[data-role='track-list']");
  if (trackList) {
    trackList.innerHTML = result.playlist.tracks
      .map((track) => {
        const playMeta = buildTrackPlayMeta(track);
        return `
          <div class="track">
            <div class="track-main">
              <div class="track-copy">
                <strong>${escapeHtml(track.song.title)}</strong>
                <span>${escapeHtml(track.song.artist)}</span>
              </div>
              <span class="track-rank">#${track.rank}</span>
            </div>
            <div class="track-actions">
              <span class="track-note">${escapeHtml(playMeta.note)}</span>
              <a class="track-play" href="${escapeHtml(playMeta.href)}">
                ${escapeHtml(playMeta.label)}
              </a>
            </div>
          </div>
        `;
      })
      .join("");
  }

  const playLink = document.querySelector("[data-role='play']");
  if (playLink) {
    const href = buildPlayUrl(result);
    playLink.setAttribute("href", href);
    playLink.removeAttribute("target");
    playLink.removeAttribute("rel");
  }

  const content = document.querySelector("[data-role='result-content']");
  if (content) {
    content.hidden = false;
  }
}

export async function initResultPage() {
  const answers = ensureAnswersCompleted();
  if (!answers) {
    return;
  }

  setHref("[data-role='back']", "/pages/question-scene.html");
  setHref("[data-role='share']", "/pages/share-card.html");

  const stateNode = document.querySelector("[data-role='status']");
  const cachedResult = loadResult();

  if (cachedResult && isSameAnswers(cachedResult.answers, answers)) {
    renderResultPage(cachedResult);
    if (stateNode) {
      stateNode.innerHTML = "";
    }
    return;
  }

  renderStateMessage(stateNode, "正在根据你的三题答案生成今晚歌单...");

  try {
    const result = await requestRecommendation(answers);
    if (stateNode) {
      stateNode.innerHTML = "";
    }
    renderResultPage(result);
  } catch (error) {
    renderStateMessage(stateNode, error instanceof Error ? error.message : "生成歌单失败，请稍后再试。", "error");
  }
}

function renderShareCardPage(result) {
  setText("[data-role='share-title']", stripPlaylistPrefix(result.shareCard.title));
  setText("[data-role='share-subtitle']", result.shareCard.subtitle);
  setText("[data-role='share-caption']", result.shareCard.caption);
  setText("[data-role='share-scan-title']", "查看今晚歌单");
  setText("[data-role='share-scan-copy']", "返回结果页查看完整曲目与推荐逻辑。");

  const tagContainer = document.querySelector("[data-role='share-tags']");
  if (tagContainer) {
    tagContainer.innerHTML = result.shareCard.tags
      .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
      .join("");
  }

  const content = document.querySelector("[data-role='share-content']");
  if (content) {
    content.hidden = false;
  }

  const saveButton = document.querySelector("[data-role='save-share']");
  if (saveButton) {
    const saveLabel = saveButton.querySelector("span");
    saveButton.addEventListener("click", async () => {
      const shareText = [result.shareCard.title, result.shareCard.subtitle, result.shareCard.caption]
        .filter(Boolean)
        .join("\n");

      if (navigator.share) {
        try {
          await navigator.share({
            title: result.shareCard.title,
            text: shareText,
          });
          return;
        } catch {
          // Fall back to clipboard copy if native share is canceled or unavailable.
        }
      }

      try {
        await navigator.clipboard.writeText(shareText);
        if (saveLabel) {
          saveLabel.textContent = "文案已复制";
        }
      } catch {
        if (saveLabel) {
          saveLabel.textContent = "请手动截图";
        }
      }
    });
  }
}

export function initShareCardPage() {
  const answers = ensureAnswersCompleted();
  if (!answers) {
    return;
  }

  setHref("[data-role='back']", "/pages/playlist-result.html");
  const result = loadResult();

  if (!result || !isSameAnswers(result.answers, answers)) {
    window.location.href = "/pages/playlist-result.html";
    return;
  }

  renderShareCardPage(result);
}
