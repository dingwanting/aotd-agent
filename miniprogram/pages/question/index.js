const { STORAGE_KEYS, getStorage, setStorage, clearResult, clearAnswers, clearQuestionDeck } = require("../../utils/storage");
const { QUESTION_META, createQuestionDeck } = require("../../utils/question-bank");

function loadAnswers() {
  return getStorage(STORAGE_KEYS.answers, {});
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

  const nextDeck = createQuestionDeck();
  setStorage(STORAGE_KEYS.questionDeck, nextDeck);
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
    const answers = loadAnswers();
    const selectedValue = answers[meta.answerKey] || "";

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
      selectedValue,
      showGenerateButton: !meta.autoAdvance,
      showBack: Boolean(meta.prevStep),
      canGenerate: Boolean(selectedValue)
    });
  },

  handleBack() {
    const currentMeta = QUESTION_META[this.data.pageKey];
    if (!currentMeta.prevStep) {
      clearAnswers();
      clearQuestionDeck();
      clearResult();
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

    if (currentMeta.autoAdvance && currentMeta.nextStep) {
      wx.redirectTo({
        url: `/pages/question/index?step=${currentMeta.nextStep}`
      });
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
