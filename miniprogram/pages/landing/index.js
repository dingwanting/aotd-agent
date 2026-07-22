const { clearAnswers, clearQuestionDeck, clearResult } = require("../../utils/storage");

Page({
  handleStart() {
    clearAnswers();
    clearQuestionDeck();
    clearResult();

    wx.redirectTo({
      url: "/pages/question/index?step=consumptionSource"
    });
  }
});
