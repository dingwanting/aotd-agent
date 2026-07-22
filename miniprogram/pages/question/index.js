const { STORAGE_KEYS, getStorage, setStorage, clearResult, clearAnswers, clearQuestionDeck } = require("../../utils/storage");
const { QUESTION_META, createQuestionDeck } = require("../../utils/question-bank");

const QUESTION_HISTORY_LIMIT = 4;

const ANSWER_KEYS = ["consumptionSource", "emotionalNeed", "emotionalImagery"];

// 进度条按"已答题数 / 总题数"算，未答时停在已完成的进度
function computeProgress(answers) {
  const count = ANSWER_KEYS.reduce((acc, key) => acc + (answers && answers[key] ? 1 : 0), 0);
  return Math.round((count / ANSWER_KEYS.length) * 100);
}

function loadAnswers() {
  return getStorage(STORAGE_KEYS.answers, {});
}

function loadQuestionHistory() {
  return getStorage(STORAGE_KEYS.questionDeckHistory, {});
}

function updateQuestionHistory(deck) {
  const history = loadQuestionHistory();
  const nextHistory = Object.assign({}, history);

  ["consumptionSource", "emotionalNeed", "emotionalImagery"].forEach((key) => {
    const question = deck && deck[key] ? deck[key] : null;
    const deckId = question && question.deckId ? question.deckId : "";
    if (!deckId) {
      return;
    }
    const previous = Array.isArray(nextHistory[key]) ? nextHistory[key].filter(Boolean) : [];
    nextHistory[key] = [deckId].concat(previous.filter((item) => item !== deckId)).slice(0, QUESTION_HISTORY_LIMIT);
  });

  setStorage(STORAGE_KEYS.questionDeckHistory, nextHistory);
}

function ensureQuestionDeck(forceRefresh) {
  const currentDeck = getStorage(STORAGE_KEYS.questionDeck, null);
  if (
    !forceRefresh &&
    currentDeck &&
    currentDeck.consumptionSource &&
    currentDeck.emotionalNeed &&
    currentDeck.emotionalImagery
  ) {
    return currentDeck;
  }

  const nextDeck = createQuestionDeck(loadQuestionHistory());
  setStorage(STORAGE_KEYS.questionDeck, nextDeck);
  updateQuestionHistory(nextDeck);
  return nextDeck;
}

Page({
  data: {
    pageKey: "consumptionSource",
    step: "01/03",
    progress: 34,
    progressLabel: "起点已记录",
    title: "",
    hint: "",
    footnote: "",
    options: [],
    selectedValue: "",
    showGenerateButton: false,
    showBack: false,
    canGenerate: false
  },

  onLoad(query) {
    const pageKey = query.step || "consumptionSource";
    this.initialize(pageKey);
  },

  onShow() {
    if (this.data.pageKey) {
      this.initialize(this.data.pageKey);
    }
  },

  initialize(pageKey) {
    const meta = QUESTION_META[pageKey];
    const deck = ensureQuestionDeck(pageKey === "consumptionSource");
    const promptCopy = deck[pageKey];

    if (pageKey === "consumptionSource") {
      clearResult();
    }

    const answers = loadAnswers();
    // 恢复之前答过的题（避免用户来回切页面丢失选中）
    const restoredValue = answers[meta.answerKey] || "";

    this.setData({
      pageKey,
      step: meta.step,
      progress: computeProgress(answers),
      progressLabel: meta.progressLabel,
      title: promptCopy.title,
      hint: promptCopy.hint,
      footnote: promptCopy.footnote,
      options: promptCopy.options,
      selectedValue: restoredValue,
      showGenerateButton: !meta.autoAdvance,
      showBack: Boolean(meta.prevStep),
      canGenerate: Boolean(restoredValue)
    });
  },

  handleBack() {
    const currentMeta = QUESTION_META[this.data.pageKey];
    if (!currentMeta.prevStep) {
      clearAnswers();
      clearQuestionDeck();
      clearResult();
      wx.redirectTo({
        url: "/pages/landing/index"
      });
      return;
    }
    wx.redirectTo({
      url: `/pages/question/index?step=${currentMeta.prevStep}`
    });
  },

  handleSelect(event) {
    const { value } = event.currentTarget.dataset;
    const currentMeta = QUESTION_META[this.data.pageKey];
    const answers = loadAnswers();
    answers[currentMeta.answerKey] = value;
    setStorage(STORAGE_KEYS.answers, answers);
    this.setData({
      selectedValue: value,
      canGenerate: Boolean(value),
      progress: computeProgress(answers)
    });

    if (currentMeta.autoAdvance) {
      if (currentMeta.nextStep === "result") {
        wx.redirectTo({
          url: "/pages/result/index"
        });
        return;
      }

      if (currentMeta.nextStep) {
        wx.redirectTo({
          url: `/pages/question/index?step=${currentMeta.nextStep}`
        });
      }
    }
  },

  handleGenerate() {
    if (!this.data.selectedValue) {
      wx.showToast({
        title: "先选一个答案",
        icon: "none"
      });
      return;
    }
    const answers = loadAnswers();
    answers.emotionalImagery = this.data.selectedValue;
    setStorage(STORAGE_KEYS.answers, answers);
    wx.redirectTo({
      url: "/pages/result/index"
    });
  }
});
