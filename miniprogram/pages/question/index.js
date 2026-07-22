const { STORAGE_KEYS, getStorage, setStorage, clearResult, clearAnswers, clearQuestionDeck } = require("../../utils/storage");
const { QUESTION_META, createQuestionDeck } = require("../../utils/question-bank");

const QUESTION_HISTORY_LIMIT = 4;

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

    this.setData({
      pageKey,
      step: meta.step,
      progress: meta.progress,
      progressLabel: meta.progressLabel,
      title: promptCopy.title,
      hint: promptCopy.hint,
      footnote: promptCopy.footnote,
      options: promptCopy.options,
      selectedValue: "",
      showGenerateButton: !meta.autoAdvance,
      showBack: Boolean(meta.prevStep),
      canGenerate: false
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
      canGenerate: Boolean(value)
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
