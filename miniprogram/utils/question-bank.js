function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function buildQuestion(type) {
  return {
    title: pickRandom(type.titles),
    hint: pickRandom(type.hints),
    footnote: pickRandom(type.footnotes),
    options: type.options.map((option, index) => ({
      ...option,
      mark: option.mark || String(index + 1).padStart(2, "0"),
    })),
  };
}

const pools = {
  consumptionSource: [
    {
      titles: ["如果今天的心情有一个颜色，你会选哪一种？", "不用解释原因，今天最像哪种颜色？"],
      hints: ["选最像现在的感觉，不需要想太久。", "先抓住体感就够了。"],
      footnotes: ["颜色会被翻译成真正的情绪消耗源。", "选你第一眼想到的那个。"],
      options: [
        { value: "情绪压力", label: "黑色", description: "心里一直压着什么。", mark: "⚫" },
        { value: "沟通交流", label: "红色", description: "人和信息都太多。", mark: "🔴" },
        { value: "思考决策", label: "蓝色", description: "脑子一直停不下来。", mark: "🔵" },
        { value: "重复工作", label: "灰色", description: "一整天像在机械重复。", mark: "🩶" },
        { value: "身体疲惫", label: "白色", description: "整个人已经被耗空。", mark: "⚪" }
      ]
    },
    {
      titles: ["如果今天是一种天气，它更像哪一种？", "如果把今天发成天气预报，你会报什么？"],
      hints: ["选最有画面感的一项就好。", "不要想对不对，只看像不像。"],
      footnotes: ["天气只是入口，后面会翻译成真正的情绪源。", "这一题只看体感。"],
      options: [
        { value: "情绪压力", label: "雷阵雨", description: "情绪忽高忽低，心里一直闷着。", mark: "⛈️" },
        { value: "思考决策", label: "阴天", description: "脑内一直灰蒙蒙地运转。", mark: "☁️" },
        { value: "沟通交流", label: "闷热", description: "人和信息太多，整个人都在发热。", mark: "🌡️" },
        { value: "重复工作", label: "雾天", description: "看起来在动，但体感很模糊。", mark: "🌫️" },
        { value: "身体疲惫", label: "大风后放空", description: "风停了，人也快没电了。", mark: "🌬️" }
      ]
    },
    {
      titles: ["如果今天只能用一个表情来表示，你会选哪一个？", "哪一个 emoji 最能代表你此刻的累？"],
      hints: ["选最顺手想点的那个，不需要分析。", "越像聊天时会发出的那个，越接近真实状态。"],
      footnotes: ["表情背后仍然会被翻成真实的消耗源。", "直觉答题就够了。"],
      options: [
        { value: "沟通交流", label: "😵‍💫", description: "人和信息太多，脑子被转晕了。", mark: "😵‍💫" },
        { value: "思考决策", label: "🤯", description: "想了太多，脑内一直没下班。", mark: "🤯" },
        { value: "情绪压力", label: "😶", description: "没有爆发，但整个人一直闷着。", mark: "😶" },
        { value: "重复工作", label: "😐", description: "一切都在继续，但心情没什么波澜。", mark: "😐" },
        { value: "身体疲惫", label: "🥱", description: "不是想太多，是身体真的累了。", mark: "🥱" }
      ]
    }
  ],
  emotionalNeed: [
    {
      titles: ["如果今晚只能领一个补给包，你最想拿哪一个？", "现在的你，如果能补一份能量，会先拿什么？"],
      hints: ["选最想立刻拥有的那一种感觉。", "这是歌单的主方向。"],
      footnotes: ["补给包只是隐喻，后面会翻成更准确的情绪需求。", "选最想立刻拿到的那个。"],
      options: [
        { value: "放松一下", label: "一条毯子", description: "先把紧绷放下。", mark: "🧣" },
        { value: "找回力量", label: "一块充电宝", description: "想慢慢把能量拉回来。", mark: "🔋" },
        { value: "有人陪伴", label: "一个并肩座位", description: "想感觉不是一个人。", mark: "🫂" },
        { value: "清空大脑", label: "一个关闭弹窗键", description: "先把脑子里的通知都关掉。", mark: "📴" },
        { value: "奖励自己", label: "一朵小小烟花", description: "给今天一个漂亮点的结尾。", mark: "🎆" }
      ]
    },
    {
      titles: ["如果今晚只能喝一杯，你最想选哪一杯？", "现在的你，最想被递上一杯什么？"],
      hints: ["饮品题更接近直觉。", "选最想立刻拿在手里的那一杯。"],
      footnotes: ["不用想健康不健康，只选最想喝的那杯。", "选想要，不选应该。"],
      options: [
        { value: "放松一下", label: "热水", description: "先把整个人慢慢放松下来。", mark: "🍵" },
        { value: "找回力量", label: "冰美式", description: "想重新提一点神。", mark: "☕" },
        { value: "有人陪伴", label: "热可可", description: "想被一份温温的存在感包住。", mark: "🍫" },
        { value: "清空大脑", label: "冰气泡水", description: "想让脑子先清一清。", mark: "🥤" },
        { value: "奖励自己", label: "微醺特调", description: "想让今晚有一点漂亮的偏爱。", mark: "🍸" }
      ]
    },
    {
      titles: ["如果今晚的情绪需求只能用一个 emoji 表示，你会选哪一个？", "哪一个 emoji 最像你现在最需要的东西？"],
      hints: ["用 emoji 选需求，通常比用语言更快。", "选最想被满足的那个感觉。"],
      footnotes: ["emoji 很轻，但足够说出你现在缺什么。", "今晚歌单会优先回应这份需要。"],
      options: [
        { value: "放松一下", label: "😮‍💨", description: "想先松一口气。", mark: "😮‍💨" },
        { value: "找回力量", label: "⚡", description: "想把能量一点点接回来。", mark: "⚡" },
        { value: "有人陪伴", label: "🤍", description: "想要一点温柔的陪着。", mark: "🤍" },
        { value: "清空大脑", label: "🫧", description: "想让脑内的杂音先飘走。", mark: "🫧" },
        { value: "奖励自己", label: "🎉", description: "想让今天最后有一点仪式感。", mark: "🎉" }
      ]
    }
  ],
  emotionalImagery: [
    {
      titles: ["如果今晚是一张照片，你更想停在哪个画面里？", "下面哪一张，更像你想停留的今晚？"],
      hints: ["选最想进去待一会儿的那个画面。", "画面会决定歌单的空气感。"],
      footnotes: ["这一题决定整张歌单的氛围底色。", "选最想被接住的那一幕夜色。"],
      options: [
        { value: "东京雨夜", label: "雨点挂在车窗上", description: "霓虹被拉长，世界安静又有点电影感。", mark: "🌧️" },
        { value: "夏日晚风", label: "风穿过树影", description: "夜里有点凉，心也慢慢松开。", mark: "🍃" },
        { value: "海边公路", label: "海和路一起往前", description: "视线被拉开，整个人也想重新流动。", mark: "🌊" },
        { value: "深夜便利店", label: "白光落在安静的小店里", description: "世界缩小了，反而比较安心。", mark: "🏪" },
        { value: "城市灯光", label: "高楼窗口一盏盏亮着", description: "城市还醒着，所以你也不算太孤单。", mark: "🌆" }
      ]
    },
    {
      titles: ["如果今晚有一种温度，你最想待在哪一种里面？", "哪一种温度最像你想要的今晚？"],
      hints: ["选最想待进去的体感，不用想现实天气。", "你想靠近的温度，就是今晚的氛围滤镜。"],
      footnotes: ["温度在说你想被什么样的夜晚包住。", "选最想让自己沉进去的那一档。"],
      options: [
        { value: "东京雨夜", label: "微凉带雨气", description: "冷一点、湿一点，像霓虹落在车窗上。", mark: "🌧️" },
        { value: "夏日晚风", label: "刚刚好的晚风温度", description: "轻轻吹着，很适合放松下来。", mark: "🍃" },
        { value: "海边公路", label: "有海风的清凉", description: "视线和呼吸都能被拉开。", mark: "🌊" },
        { value: "深夜便利店", label: "冰柜旁的冷白温度", description: "简单、稳定、让人暂时安心。", mark: "🧊" },
        { value: "城市灯光", label: "夜里街灯的余温", description: "有种城市还醒着的陪伴感。", mark: "🌆" }
      ]
    },
    {
      titles: ["如果今晚只能选一个座位待着，你会选哪一个？", "哪一个位置最适合现在的你？"],
      hints: ["选最想坐下去不被打扰的那个位置。", "这个位置会决定整张歌单的空间感。"],
      footnotes: ["选位置，就是在选今晚的落点。", "歌单会从这个座位的视角开始。"],
      options: [
        { value: "东京雨夜", label: "靠窗车座", description: "看雨和霓虹往后退，心也能慢下来。", mark: "🚕" },
        { value: "夏日晚风", label: "路边长椅", description: "有风、有树影，什么都不用急。", mark: "🪑" },
        { value: "海边公路", label: "副驾驶座", description: "可以一直看着路和远处往前走。", mark: "🚗" },
        { value: "深夜便利店", label: "便利店门口高脚凳", description: "灯是亮的，人是安静的。", mark: "🏪" },
        { value: "城市灯光", label: "高楼窗边的位置", description: "能看见很多灯，也没那么孤单。", mark: "🪟" }
      ]
    }
  ]
};

const QUESTION_META = {
  consumptionSource: {
    step: "01/03",
    progress: 34,
    progressLabel: "起点已记录",
    answerKey: "consumptionSource",
    nextStep: "emotionalNeed",
    autoAdvance: true
  },
  emotionalNeed: {
    step: "02/03",
    progress: 67,
    progressLabel: "节奏正在成形",
    answerKey: "emotionalNeed",
    nextStep: "emotionalImagery",
    prevStep: "consumptionSource",
    autoAdvance: true
  },
  emotionalImagery: {
    step: "03/03",
    progress: 100,
    progressLabel: "即将生成歌单",
    answerKey: "emotionalImagery",
    prevStep: "emotionalNeed",
    autoAdvance: false
  }
};

function createQuestionDeck() {
  return {
    consumptionSource: buildQuestion(pickRandom(pools.consumptionSource)),
    emotionalNeed: buildQuestion(pickRandom(pools.emotionalNeed)),
    emotionalImagery: buildQuestion(pickRandom(pools.emotionalImagery))
  };
}

module.exports = {
  QUESTION_META,
  createQuestionDeck
};
