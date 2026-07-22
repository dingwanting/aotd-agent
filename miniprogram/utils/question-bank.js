function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffleArray(items) {
  const cloned = items.slice();
  for (let index = cloned.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = cloned[index];
    cloned[index] = cloned[swapIndex];
    cloned[swapIndex] = current;
  }
  return cloned;
}

function pickWeighted(items) {
  const totalWeight = items.reduce((sum, item) => sum + (item.weight || 1), 0);
  let cursor = Math.random() * totalWeight;
  for (let index = 0; index < items.length; index += 1) {
    cursor -= items[index].weight || 1;
    if (cursor <= 0) {
      return items[index];
    }
  }
  return items[items.length - 1];
}

function getQuestionPoolId(type) {
  return [type.tone, type.titles[0], type.options.map((option) => option.label).join("|")].join("::");
}

function pickAvoidRecent(items, recentIds) {
  const recentSet = new Set((recentIds || []).filter(Boolean));
  const filtered = items.filter((item) => !recentSet.has(getQuestionPoolId(item)));
  if (filtered.length) {
    return pickRandom(filtered);
  }

  return items
    .slice()
    .sort((left, right) => {
      const leftIndex = recentIds.indexOf(getQuestionPoolId(left));
      const rightIndex = recentIds.indexOf(getQuestionPoolId(right));
      return leftIndex - rightIndex;
    })[0];
}

function buildQuestion(type) {
  return {
    deckId: getQuestionPoolId(type),
    tone: type.tone,
    title: pickRandom(type.titles),
    hint: pickRandom(type.hints),
    footnote: pickRandom(type.footnotes),
    options: shuffleArray(type.options).map((option, index) => ({
      ...option,
      mark: option.mark || String(index + 1).padStart(2, "0"),
    })),
  };
}

const pools = {
  consumptionSource: [
    {
      tone: "low",
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
      tone: "low",
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
      tone: "low",
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
    },
    {
      tone: "bright",
      titles: ["如果今天像一种能量模式，你更像哪一种？", "今天推动你往前走的，更像下面哪股劲？"],
      hints: ["不一定是累，也可以是今天最明显的状态。", "选最贴近整天节奏的那个。"],
      footnotes: ["这一题会抓你今天最主要的情绪驱动力。", "可以选亮一点、轻一点的状态。"],
      options: [
        { value: "忙碌充实", label: "满格运转", description: "事情很多，但做完会有成就感。", mark: "✅" },
        { value: "兴奋上头", label: "热血加速", description: "情绪是亮的，整个人有点停不下来。", mark: "🚀" },
        { value: "好奇探索", label: "想继续点开", description: "对新东西很有兴趣，脑子一直在追。", mark: "🧭" },
        { value: "思考决策", label: "脑内多线程", description: "一直在判断、安排、比较和切换。", mark: "🧠" },
        { value: "身体疲惫", label: "电量告急", description: "不是不想动，是身体先说要休息。", mark: "🔋" }
      ]
    },
    {
      tone: "explore",
      titles: ["如果今天是一首歌的前奏，它会先响起哪种节拍？", "今天的底鼓声，更像哪一种？"],
      hints: ["别想歌词，只看节奏和身体反应。", "哪一个一出现，你就觉得“对，就是这个”。"],
      footnotes: ["节拍背后会被翻译成今天的主导状态。", "不一定是消耗，也可能是今天的高光。"],
      options: [
        { value: "情绪压力", label: "低频闷拍", description: "表面平静，但心里一直压着点什么。", mark: "🥁" },
        { value: "忙碌充实", label: "密集鼓点", description: "事情一件接一件，但节奏很饱满。", mark: "🎵" },
        { value: "兴奋上头", label: "直接副歌", description: "情绪很亮，想立刻往前冲。", mark: "🎸" },
        { value: "好奇探索", label: "渐进铺陈", description: "总想再往后听一点，会不会更有意思。", mark: "✨" },
        { value: "重复工作", label: "循环节奏", description: "不是很差，但一直在同一段里打转。", mark: "🔁" }
      ]
    },
    {
      tone: "daily",
      titles: ["你今天因为什么事获得了瞬时多巴胺？", "今天哪一个瞬间，让你突然觉得“还不错”？"],
      hints: ["这一题可以不谈情绪，只谈今天发生的小事。", "选那个你最愿意讲给朋友听的瞬间。"],
      footnotes: ["小小的生活反馈，比大情绪更容易说出你今天的状态。", "选那个最像今天高光切片的瞬间。"],
      options: [
        { value: "外部反馈", label: "股票大涨", description: "数字一跳，整个人的电量也跟着涨了一格。", mark: "📈" },
        { value: "被看见认可", label: "被同事夸了穿搭", description: "今天有被认真看见，心情会亮一下。", mark: "👗" },
        { value: "成就推进", label: "老板认可了我的方案", description: "那一下的成就感，很适合被延长。", mark: "📋" },
        { value: "偶遇小确幸", label: "出门见到彩虹", description: "生活突然给了一个不需要解释的惊喜。", mark: "🌈" },
        { value: "关系连接", label: "朋友突然约我吃饭", description: "被想到、被邀请，本身就很加分。", mark: "🍜" }
      ]
    },
    {
      tone: "daily",
      titles: ["今天哪一件小事最像你的主线剧情？", "如果把今天剪成 15 秒短视频，主镜头会是什么？"],
      hints: ["不用想太抽象，选最有画面的那个日常切片。", "你今天被什么牵着走，就选什么。"],
      footnotes: ["这题会抓你今天最真实的生活重心。", "主镜头不一定最重要，但一定最像今天。"],
      options: [
        { value: "忙碌充实", label: "把待办一条条划掉", description: "今天很满，但会有一点踏实的爽感。", mark: "✅" },
        { value: "信息惊喜", label: "刷到一个很想点开的新东西", description: "注意力一直被新鲜感往前带。", mark: "📱" },
        { value: "沟通交流", label: "消息一个接一个地回", description: "今天像被人和信息一直拉着走。", mark: "💬" },
        { value: "身体疲惫", label: "一坐下就只想发呆", description: "今天不是想太多，是身体更先投降。", mark: "🛋️" },
        { value: "日常仪式", label: "顺路买了一束花或一杯喜欢的喝的", description: "哪怕很小，也想给自己留个好结尾。", mark: "💐" }
      ]
    },
    {
      tone: "bright",
      titles: ["如果今天像一个社交状态条，你觉得它更接近哪一格？", "今天的你，更像在切哪一种生活频道？"],
      hints: ["不一定是累，也可能是今天最鲜明的外部节奏。", "选最像今天整体气压的那一项。"],
      footnotes: ["这一题会抓住你今天是被什么拉着往前走。", "社交和生活节奏，往往比情绪更诚实。"],
      options: [
        { value: "沟通交流", label: "群聊和会议没停过", description: "今天像一直在人和信息之间切来切去。", mark: "📲" },
        { value: "被看见认可", label: "今天存在感有点高", description: "被看见、被回应、被点名，状态一直亮着。", mark: "💡" },
        { value: "成就推进", label: "推进感很强", description: "事情在往前走，会有一种“今天没白过”的踏实感。", mark: "📈" },
        { value: "好奇探索", label: "一直想刷新点新东西", description: "注意力被好奇心和新鲜感带着跑。", mark: "🛰️" },
        { value: "身体疲惫", label: "表面在线，电量其实不高", description: "该做的都做了，但身体已经先想下班。", mark: "🔋" }
      ]
    },
    {
      tone: "daily",
      titles: ["如果把今天总结成一句“生活播报”，你最想播哪一条？", "今天最适合你的生活字幕，会是哪一句？"],
      hints: ["像发朋友圈一样选一句就好。", "别分析，选最想按下去的那句字幕。"],
      footnotes: ["生活字幕比“你怎么了”更容易说出真实状态。", "你今天在经历什么，这题会直接抓出来。"],
      options: [
        { value: "成就推进", label: "今天有在稳稳推进", description: "不一定炸裂，但能感觉到事情在前进。", mark: "🛫" },
        { value: "关系连接", label: "今天被人轻轻接住了一下", description: "可能只是一句问候，但会让人想记住。", mark: "🤍" },
        { value: "信息惊喜", label: "今天被一个新发现勾住了", description: "有种想顺着再看下去的心情。", mark: "🔍" },
        { value: "重复工作", label: "今天像在同一页里翻了很多次", description: "不是很糟，只是体感有点重复。", mark: "📄" },
        { value: "情绪压力", label: "表面还行，心里其实有点闷", description: "外面没事，里面一直在消耗。", mark: "🫥" }
      ]
    }
  ],
  emotionalNeed: [
    {
      tone: "calm",
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
      tone: "calm",
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
      tone: "calm",
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
    },
    {
      tone: "bright",
      titles: ["如果今晚有一个隐藏奖励，你最想解锁哪一个？", "现在的你，更想把哪一种感觉延长一点？"],
      hints: ["不一定是补血，也可以是把好状态再续一会儿。", "选最想继续放大的那种感觉。"],
      footnotes: ["这一题决定歌单是在安抚你，还是继续推着你往前。", "选最有“对，就是这个”的一项。"],
      options: [
        { value: "把开心放大", label: "把快乐续上", description: "今天难得状态不错，想让它别太快结束。", mark: "🌈" },
        { value: "继续发光", label: "把热情续上", description: "还不想降速，想继续亮着往前。", mark: "✨" },
        { value: "去探索一下", label: "满足一点好奇", description: "想顺着兴趣再走远一点。", mark: "🗺️" },
        { value: "放松一下", label: "找个缓冲带", description: "再好的节奏，也想先松一口气。", mark: "🛋️" },
        { value: "有人分享", label: "想有人一起感受", description: "开心也好，复杂也好，都想有人能接住。", mark: "🥂" }
      ]
    },
    {
      tone: "explore",
      titles: ["如果今晚有一个按钮，你最想按下哪一个？", "现在最想给自己开哪一种模式？"],
      hints: ["把它想成今晚的情绪开关。", "选按下去之后最想进入的状态。"],
      footnotes: ["按钮题会把歌单导向更轻、更亮或更安静的方向。", "选你今晚最想进入的模式。"],
      options: [
        { value: "轻轻放松", label: "慢下来", description: "把节奏放缓一点，先舒服下来。", mark: "🌙" },
        { value: "找回力量", label: "继续充电", description: "想稳稳地把能量接回来。", mark: "🔋" },
        { value: "把开心放大", label: "继续开心", description: "不想太快收场，想把好心情再放大一点。", mark: "🎈" },
        { value: "去探索一下", label: "往外看看", description: "想听点新鲜的，顺着兴趣往前走。", mark: "🪁" },
        { value: "奖励自己", label: "给自己庆祝", description: "今天值得一个更明亮的结尾。", mark: "🏆" }
      ]
    },
    {
      tone: "daily",
      titles: ["如果今晚给自己续一个状态，你最想续哪一种？", "今天的你，更想把哪一种感觉再延长一点？"],
      hints: ["不一定是修复，也可以是把好状态延长。", "选今晚最想被放大的那一种体验。"],
      footnotes: ["这一题决定歌单是帮你慢下来，还是陪你继续上头。", "选那个你今晚最舍不得结束的状态。"],
      options: [
        { value: "把开心放大", label: "把好心情再续长一点", description: "今天难得顺，想让这股劲别掉太快。", mark: "😄" },
        { value: "继续发光", label: "把成就感再放大一点", description: "想让“我今天还挺行”的感觉继续亮着。", mark: "🏅" },
        { value: "去探索一下", label: "给自己一点新鲜感", description: "想听点没听过的、去一点没去过的地方。", mark: "🧭" },
        { value: "有人分享", label: "想把今天讲给谁听", description: "有些开心或复杂，分享出去会更完整。", mark: "📞" },
        { value: "轻轻放松", label: "想先把自己放下来", description: "今天够丰富了，晚上想松一点。", mark: "🫶" }
      ]
    },
    {
      tone: "daily",
      titles: ["如果今晚有一张生活通行证，你最想刷开哪扇门？", "下班后的你，更想进入哪一种生活模式？"],
      hints: ["把它想成今晚最想去的生活版本。", "选最让你有参与感的一扇门。"],
      footnotes: ["这一题不会直接问情绪，但会很准确地暴露你今晚想去哪。", "选那个最像你今晚理想状态的入口。"],
      options: [
        { value: "奖励自己", label: "小庆祝模式", description: "今天值得被认真奖励一下。", mark: "🥂" },
        { value: "有人分享", label: "找人聊天模式", description: "想把今天发生的事讲给别人听。", mark: "🗨️" },
        { value: "去探索一下", label: "探索新鲜模式", description: "想听新歌、看新东西、走点新路线。", mark: "🗺️" },
        { value: "找回力量", label: "回血补能模式", description: "想稳稳把状态接回来，不用太猛。", mark: "🔋" },
        { value: "轻轻放松", label: "低噪休息模式", description: "什么都不想证明，只想舒服一点。", mark: "🌙" }
      ]
    },
    {
      tone: "bright",
      titles: ["如果今晚的自己可以收到一句内部批示，你最希望写着什么？", "现在的你，更想给自己批哪一种状态？"],
      hints: ["像给今晚发一条内部通知。", "选最想被批准进入的那种状态。"],
      footnotes: ["这题抓的不是情绪名词，而是你今晚最想获得的许可。", "你允许自己进入什么状态，歌单就会往哪里走。"],
      options: [
        { value: "把开心放大", label: "批准继续开心", description: "今天状态不错，不想太快熄火。", mark: "🎠" },
        { value: "继续发光", label: "批准继续在线", description: "还想保留一点锋芒和高光。", mark: "💫" },
        { value: "找回力量", label: "批准先回血", description: "先把自己补稳，别再硬撑。", mark: "🔌" },
        { value: "有人分享", label: "批准去说给别人听", description: "好的坏的，都想让人知道一点。", mark: "📣" },
        { value: "轻轻放松", label: "批准今晚不那么用力", description: "先放过自己，今晚可以轻一点。", mark: "🫧" }
      ]
    },
    {
      tone: "daily",
      titles: ["如果今晚只能选一个“结束方式”，你最想怎么收尾？", "今天收尾时，你最想留住哪种感觉？"],
      hints: ["把它想成给今天盖的最后一个章。", "选那个你最愿意带进夜里的方式。"],
      footnotes: ["收尾方式，会暴露你是想修复、庆祝还是继续往前。", "歌单会沿着你的收尾方式展开。"],
      options: [
        { value: "轻轻放松", label: "安静地松下来", description: "今天已经够满了，想温柔收尾。", mark: "🪄" },
        { value: "找回力量", label: "把自己重新接回来", description: "不求马上满格，但想稳一点。", mark: "🔋" },
        { value: "奖励自己", label: "认真奖励一下今天", description: "不管大不大，今天值得被偏爱。", mark: "🎁" },
        { value: "去探索一下", label: "留一点新鲜给晚上", description: "还想看看、听听、走远一点。", mark: "🧭" },
        { value: "有人分享", label: "把今天讲给谁听", description: "有些感受说出口，才算真正落地。", mark: "☎️" }
      ]
    }
  ],
  emotionalImagery: [
    {
      tone: "calm",
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
      tone: "calm",
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
      tone: "calm",
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
    },
    {
      tone: "explore",
      titles: ["如果今晚是一种出门路线，你更想走进哪一条？", "下面哪条路，更像你今晚想去的地方？"],
      hints: ["这题可以选亮一点、热闹一点的画面。", "选最想让自己走进去的那条路。"],
      footnotes: ["路线决定歌单的空气感和速度。", "不只是疗愈，也可以是去庆祝、去探索。"],
      options: [
        { value: "天台晚霞", label: "晚霞还没完全退的天台", description: "风吹过来，整个人都亮了一点。", mark: "🌇" },
        { value: "公路兜风", label: "一路往前的城市公路", description: "灯在流动，情绪也跟着被带起来。", mark: "🚗" },
        { value: "海边晴空", label: "天还亮着的海边", description: "视线很开，心情也容易变轻。", mark: "🏖️" },
        { value: "周末市集", label: "有点热闹的小市集", description: "人声和灯串都刚刚好，不会太孤单。", mark: "🎪" },
        { value: "展览白墙", label: "安静的展览空间", description: "干净、留白、适合把好奇心慢慢打开。", mark: "🖼️" }
      ]
    },
    {
      tone: "bright",
      titles: ["如果今晚要选一种光线待着，你想被哪种光包住？", "哪一种光，更像你今晚的理想滤镜？"],
      hints: ["光线决定整张歌单的温度。", "选最想被照到的那束光。"],
      footnotes: ["这一题会把歌单导向更亮、更松或者更有探索感。", "选最想停留的那种光。"],
      options: [
        { value: "金色夕阳", label: "落日余光", description: "暖暖的，像今天还可以再好一点。", mark: "🌅" },
        { value: "游乐园夜场", label: "彩灯一盏盏亮起", description: "有点兴奋，也有点想庆祝。", mark: "🎡" },
        { value: "晴天草地", label: "明亮自然光", description: "空气感很干净，适合把心情摊开。", mark: "🌿" },
        { value: "城市霓虹", label: "夜里的流动灯光", description: "适合热闹一点、上头一点的心情。", mark: "🌃" },
        { value: "清晨阳台", label: "刚醒来的柔光", description: "轻轻的，像给自己一个新的开始。", mark: "☀️" }
      ]
    },
    {
      tone: "daily",
      titles: ["如果今晚是一个你愿意停 20 分钟的生活场景，你会选哪一个？", "下面哪一幕，更像你今晚想走进去的日常片段？"],
      hints: ["这题只问生活场景，不直接问情绪。", "选你最想待一会儿的那一幕。"],
      footnotes: ["场景比情绪更容易回答，但一样能决定歌单气质。", "今晚的歌单会从这个生活切片开始。"],
      options: [
        { value: "街角花店", label: "下班后绕去花店的街角", description: "有点香、有点暖，也有点像给自己留了余地。", mark: "💐" },
        { value: "商场天台", label: "商场顶楼看天色慢慢暗下来", description: "城市还亮着，人也会跟着轻一点。", mark: "🏙️" },
        { value: "夜跑河边", label: "河边或操场的晚风里", description: "身体在动，脑子也慢慢松开。", mark: "🏃" },
        { value: "周末早午餐", label: "像周末早午餐那种轻松感", description: "不赶时间，什么都可以慢一点。", mark: "🥯" },
        { value: "书店角落", label: "书店或展览的一角", description: "安静但不空，适合把注意力慢慢聚回来。", mark: "📚" }
      ]
    },
    {
      tone: "daily",
      titles: ["如果今晚像一个朋友圈封面，你想发哪一张？", "此刻最适合你今晚的封面图，会是什么？"],
      hints: ["这题更像在选今晚的氛围截图。", "选最想发、最想停留的那个画面。"],
      footnotes: ["封面图决定歌单的第一眼气质。", "可以热闹，也可以留白。"],
      options: [
        { value: "彩虹天光", label: "抬头正好看到晚霞或彩虹", description: "一天里忽然有一个不需要解释的漂亮瞬间。", mark: "🌈" },
        { value: "夜市灯串", label: "热闹街边的一排灯", description: "很生活，也很有烟火气。", mark: "🏮" },
        { value: "公路车窗", label: "车窗外的路灯一直往后退", description: "适合有点节奏、有点故事感的晚上。", mark: "🚘" },
        { value: "草地晴光", label: "明亮草地和晒到发暖的风", description: "很轻、很开阔，也有点重新开始的意思。", mark: "🌿" },
        { value: "咖啡店窗边", label: "一杯喝的和窗边的位置", description: "不需要很多人，也不会太孤单。", mark: "☕" }
      ]
    },
    {
      tone: "bright",
      titles: ["如果今晚是一种城市切面，你最想停在其中哪一格？", "你今晚更想把自己放进哪种城市片段里？"],
      hints: ["选最有代入感的那一个生活镜头。", "像挑一张城市 moodboard。"],
      footnotes: ["场景不只是背景，也会决定歌单的步伐。", "你想进入哪种城市片段，歌单就会往哪边靠。"],
      options: [
        { value: "夜市灯串", label: "热闹街边和一排灯串", description: "有烟火气，也有一点被生活托住的感觉。", mark: "🏮" },
        { value: "商场天台", label: "商场顶楼吹风看夜色", description: "城市很亮，但心情不一定要很满。", mark: "🏙️" },
        { value: "公路车窗", label: "车窗外一直向后退的路灯", description: "适合让情绪跟着节奏慢慢流动。", mark: "🚘" },
        { value: "咖啡店窗边", label: "灯光刚好的窗边位", description: "有一点独处，也有一点被陪着。", mark: "🪟" },
        { value: "彩虹天光", label: "抬头就能让心亮一下的天光", description: "像生活突然给你留了一点漂亮。", mark: "🌈" }
      ]
    },
    {
      tone: "explore",
      titles: ["如果今晚是一个你会故意绕路去看的地方，你想去哪？", "下面哪一个场景，会让你愿意多走 10 分钟？"],
      hints: ["别选最合理的，选最想多停一会儿的。", "这题更像在选你今晚的精神坐标。"],
      footnotes: ["你愿意绕路去哪里，往往说明你今晚想成为什么状态。", "歌单会跟着这个“绕路选择”去长出来。"],
      options: [
        { value: "街角花店", label: "下班路上绕去花店", description: "不是为了买什么，只是想让自己慢一点。", mark: "🌷" },
        { value: "书店角落", label: "书店或展览里的一角", description: "想让注意力被安静地收回来。", mark: "📚" },
        { value: "海边晴空", label: "能被风和空旷感接住的地方", description: "视线一打开，心也容易轻一点。", mark: "🌊" },
        { value: "夜跑河边", label: "有风的河边或操场", description: "适合边走边把脑子慢慢清空。", mark: "🏃" },
        { value: "天台晚霞", label: "还能看见一点天色变化的天台", description: "不是热闹，是那种城市里难得的松感。", mark: "🌆" }
      ]
    }
  ]
};

const DECK_TONE_PLANS = [
  {
    weight: 36,
    tones: {
      consumptionSource: ["daily", "bright"],
      emotionalNeed: ["daily", "bright"],
      emotionalImagery: ["daily", "bright"]
    }
  },
  {
    weight: 28,
    tones: {
      consumptionSource: ["daily", "explore"],
      emotionalNeed: ["daily", "calm"],
      emotionalImagery: ["daily", "explore"]
    }
  },
  {
    weight: 20,
    tones: {
      consumptionSource: ["bright", "calm"],
      emotionalNeed: ["daily", "bright"],
      emotionalImagery: ["bright", "daily"]
    }
  },
  {
    weight: 10,
    tones: {
      consumptionSource: ["explore", "calm"],
      emotionalNeed: ["explore", "daily"],
      emotionalImagery: ["explore", "calm"]
    }
  },
  {
    weight: 4,
    tones: {
      consumptionSource: ["low", "calm"],
      emotionalNeed: ["calm", "daily"],
      emotionalImagery: ["calm", "daily"]
    }
  },
  {
    weight: 2,
    tones: {
      consumptionSource: ["low"],
      emotionalNeed: ["calm"],
      emotionalImagery: ["calm"]
    }
  }
];

function pickQuestionByTone(pool, preferredTones, recentIds) {
  const normalizedTones = Array.isArray(preferredTones) ? preferredTones : [preferredTones];
  const exactMatches = pool.filter((item) => normalizedTones.includes(item.tone));
  if (exactMatches.length) {
    return pickAvoidRecent(exactMatches, recentIds);
  }

  const secondaryMatches = pool.filter((item) => item.tone !== "low");
  if (secondaryMatches.length) {
    return pickAvoidRecent(secondaryMatches, recentIds);
  }

  return pickAvoidRecent(pool, recentIds);
}

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
    nextStep: "result",
    autoAdvance: true
  }
};

function createQuestionDeck(history) {
  const recentHistory = history || {};
  const tonePlan = pickWeighted(DECK_TONE_PLANS);
  return {
    consumptionSource: buildQuestion(
      pickQuestionByTone(pools.consumptionSource, tonePlan.tones.consumptionSource, recentHistory.consumptionSource || []),
    ),
    emotionalNeed: buildQuestion(
      pickQuestionByTone(pools.emotionalNeed, tonePlan.tones.emotionalNeed, recentHistory.emotionalNeed || []),
    ),
    emotionalImagery: buildQuestion(
      pickQuestionByTone(pools.emotionalImagery, tonePlan.tones.emotionalImagery, recentHistory.emotionalImagery || []),
    )
  };
}

module.exports = {
  QUESTION_META,
  createQuestionDeck
};
