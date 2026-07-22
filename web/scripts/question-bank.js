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

function getQuestionPoolId(type) {
  return [type.titles[0], type.options.map((option) => option.label).join("|")].join("::");
}

function pickAvoidRecent(items, recentIds = []) {
  const recentSet = new Set(recentIds.filter(Boolean));
  const filtered = items.filter((item) => !recentSet.has(getQuestionPoolId(item)));
  if (filtered.length > 0) {
    return pickRandom(filtered);
  }

  return items
    .slice()
    .sort((left, right) => recentIds.indexOf(getQuestionPoolId(left)) - recentIds.indexOf(getQuestionPoolId(right)))[0];
}

function buildQuestion(type) {
  return {
    deckId: getQuestionPoolId(type),
    title: pickRandom(type.titles),
    hint: pickRandom(type.hints),
    footnote: pickRandom(type.footnotes),
    options: shuffleArray(type.options).map((option, index) => ({
      ...option,
      mark: option.mark || String(index + 1).padStart(2, "0"),
    })),
  };
}

const consumptionSourceTypes = [
  {
    titles: [
      "如果今天的心情有一个颜色，你会选哪一种？",
      "回看这一天，你的情绪底色更像哪一种颜色？",
      "不用解释原因，今天最像哪种颜色？",
      "如果把今天涂成一种颜色，你会先选哪一个？",
      "现在这一刻，你的心情更靠近哪种颜色？",
      "如果让颜色替你说话，今天会是什么色号？",
    ],
    hints: [
      "颜色只是入口，AOTD 会把它翻译成真正的情绪消耗源。",
      "选最像现在的感觉，不需要想太久。",
      "不用追求准确，先抓住最有体感的颜色就够了。",
    ],
    footnotes: [
      "颜色选项看起来抽象，但会被转换成更具体的情绪来源。",
      "选你最先想到的那个颜色。",
      "这一题的目标，是先找到今天最先压住你的那股力量。",
    ],
    options: [
      { value: "情绪压力", label: "黑色", description: "闷住了，像有块情绪一直压着没散。", mark: "⚫" },
      { value: "沟通交流", label: "红色", description: "热闹过头，脑海里还在回放很多对话。", mark: "🔴" },
      { value: "思考决策", label: "蓝色", description: "冷静又紧绷，像脑子一直停不下来。", mark: "🔵" },
      { value: "重复工作", label: "灰色", description: "一整天像在重复复制，没什么起伏。", mark: "🩶" },
      { value: "身体疲惫", label: "白色", description: "不是难过，只是整个人已经被耗空。", mark: "⚪" },
    ],
  },
  {
    titles: [
      "如果今天是一种天气，它更像哪一种？",
      "你的今天，更接近哪种天气状态？",
      "不用总结整天，只选一个最像今天的天气。",
      "如果把今天发成天气预报，你会报什么？",
      "此刻心里的天气，更像下面哪一种？",
      "今天这份情绪，如果落成天气，会是哪一格？",
    ],
    hints: [
      "天气只是感受的外壳，后面会继续翻译成更具体的情绪源。",
      "选最有画面感的一项就好。",
      "不要想对不对，只要想像不像。",
    ],
    footnotes: [
      "先抓天气，再抓真正让你累的来源。",
      "这一题不考逻辑，只看体感。",
      "天气会帮助 AOTD 判断今天是哪种消耗在主导你。",
    ],
    options: [
      { value: "情绪压力", label: "雷阵雨", description: "情绪忽高忽低，心里一直闷着。", mark: "⛈️" },
      { value: "思考决策", label: "阴天", description: "没有爆炸，但脑内一直灰蒙蒙地运转。", mark: "☁️" },
      { value: "沟通交流", label: "闷热", description: "人和信息太多，整个人都在发热。", mark: "🌡️" },
      { value: "重复工作", label: "雾天", description: "看起来什么都在动，但体感很模糊。", mark: "🌫️" },
      { value: "身体疲惫", label: "大风后放空", description: "风停了，人也快没电了。", mark: "🌬️" },
    ],
  },
  {
    titles: [
      "如果现在的你有一个电量提示，会是哪一种？",
      "看一眼今天的剩余电量，你更像哪格？",
      "你的今天，如果显示成手机电量，会是哪种状态？",
      "此刻的你，更像哪一种电量提示？",
      "如果把今天变成一格电池图标，你会选哪个？",
      "今天的续航感，更接近下面哪一种？",
    ],
    hints: [
      "电量低不一定只是累，也可能是被人和信息拖住了。",
      "选最贴近你现在状态的提示词。",
      "这一题会帮我们区分：你是被消耗，还是被榨干。",
    ],
    footnotes: [
      "电量只是表象，背后会映射到真正的情绪来源。",
      "选你最熟悉的一种低电量感受。",
      "不用多想，凭直觉选。",
    ],
    options: [
      { value: "身体疲惫", label: "1% 红电", description: "身体已经先罢工了，只想停下来。", mark: "🪫" },
      { value: "思考决策", label: "后台过载", description: "不是没电，是太多进程同时在跑。", mark: "🧠" },
      { value: "沟通交流", label: "消息轰炸", description: "通知太多，耳朵和脑子都还没静下来。", mark: "📳" },
      { value: "重复工作", label: "低耗电模式", description: "还能动，但只剩机械执行。", mark: "🔋" },
      { value: "情绪压力", label: "发烫警告", description: "外面看着还行，里面已经烧起来了。", mark: "🔥" },
    ],
  },
  {
    titles: [
      "如果今天的累先落在身体一个地方，它最像哪里？",
      "这一整天的疲惫，现在最先压在哪儿？",
      "不用说原因，你觉得今天最累的是哪一块？",
      "如果情绪先变成身体感受，它更像哪一种？",
      "你现在最有感觉的那种累，更接近下面哪个位置？",
      "这一刻最真实的体感，是哪一种？",
    ],
    hints: [
      "身体感受很诚实，常常比语言更快说出情绪源。",
      "选你最先有反应的一项。",
      "这一题会用体感反推今天的主要消耗。",
    ],
    footnotes: [
      "体感是入口，不是结论。",
      "先信身体，不用先分析。",
      "越本能的答案，越接近现在的你。",
    ],
    options: [
      { value: "思考决策", label: "太阳穴绷着", description: "像一直在想、一直在判断。", mark: "💭" },
      { value: "沟通交流", label: "喉咙还热着", description: "说了太多，安静下来还在回响。", mark: "🗣️" },
      { value: "情绪压力", label: "心口发沉", description: "不是一句话能说清，但就是压着。", mark: "🫀" },
      { value: "身体疲惫", label: "肩膀塌下去", description: "整个人都想先松掉。", mark: "🫠" },
      { value: "重复工作", label: "手在做，心没跟上", description: "像自动驾驶了一整天。", mark: "🤖" },
    ],
  },
  {
    titles: [
      "如果今天是一种按钮状态，你觉得更像哪一个？",
      "回看今天，你最像哪种系统按钮？",
      "把今天翻译成一个按钮，你会选哪种模式？",
      "如果心情是个界面状态，现在更像哪个按钮？",
      "此刻的你，更像下面哪种按钮反应？",
      "今天的状态栏里，哪一个按钮最亮？",
    ],
    hints: [
      "按钮状态很简单，但能快速分出你到底是被什么拖住了。",
      "选最像今天运行方式的那一个。",
      "这题不用解释，只看像不像。",
    ],
    footnotes: [
      "按钮只是隐喻，后面会翻译成真实的情绪来源。",
      "先判断模式，再进入歌单。",
      "你只要选今天最像的系统状态。",
    ],
    options: [
      { value: "重复工作", label: "循环播放", description: "一整天都在重复差不多的事。", mark: "🔁" },
      { value: "身体疲惫", label: "睡眠模式", description: "没别的需求，只想先休息。", mark: "🌙" },
      { value: "沟通交流", label: "外放", description: "接触太多声音和人，已经有点过载。", mark: "🔊" },
      { value: "思考决策", label: "加载中", description: "脑子一直转，还没有真的停下来。", mark: "⏳" },
      { value: "情绪压力", label: "静音失败", description: "想压住，但心里还是在响。", mark: "🔕" },
    ],
  },
  {
    titles: [
      "如果今天是一张桌面，你觉得最像哪一种？",
      "你的今天，更像下面哪种桌面状态？",
      "不用讲故事，今天的桌面感更像哪个画面？",
      "如果把今天摊开成一张桌面，会是哪一格？",
      "现在回头看，你的今天更像哪种桌面现场？",
      "今天的心情被摆在桌上，会是哪种样子？",
    ],
    hints: [
      "桌面状态很容易让人一下子想起今天到底卡在哪里。",
      "选最有代入感的一格。",
      "越直观的画面，越适合拿来做歌单起点。",
    ],
    footnotes: [
      "这一题会帮助 AOTD 看见今天最核心的消耗方式。",
      "选你最不需要解释的一项。",
      "画面越简单，答案越准。",
    ],
    options: [
      { value: "重复工作", label: "整齐但空空的", description: "做了很多事，却没留下什么起伏。", mark: "🗂️" },
      { value: "思考决策", label: "贴满便签", description: "每一张都在提醒你还要继续想。", mark: "📝" },
      { value: "沟通交流", label: "消息纸条堆满", description: "来自别人的信息占满了桌面。", mark: "💬" },
      { value: "情绪压力", label: "杯子倒了却没收", description: "知道有事压着，但还来不及处理。", mark: "🫗" },
      { value: "身体疲惫", label: "灯还亮着，人已经不行了", description: "身体已经先退出工作台。", mark: "💡" },
    ],
  },
  {
    titles: [
      "如果今天只能用一个表情来表示，你会选哪一个？",
      "下面哪个 emoji 最像你今天的状态？",
      "不解释原因，你今天最像哪个表情？",
      "如果现在把今天缩成一个表情，会是哪一个？",
      "今天这一整天，最像下面哪个脸？",
      "哪一个 emoji 最能代表你此刻的累？",
    ],
    hints: [
      "表情题很轻，但很适合快速抓到今天到底被什么消耗了。",
      "选最顺手想点的那个，不需要分析。",
      "越像聊天时会发出的那个表情，越接近真实状态。",
    ],
    footnotes: [
      "这题会把表情背后的消耗源翻译出来。",
      "先选表情，再看今晚歌单怎么接住你。",
      "直觉答题就够了。",
    ],
    options: [
      { value: "沟通交流", label: "😵‍💫", description: "人和信息太多，脑子被转晕了。", mark: "😵‍💫" },
      { value: "思考决策", label: "🤯", description: "想了太多，脑内一直没下班。", mark: "🤯" },
      { value: "情绪压力", label: "😶", description: "没有爆发，但整个人一直闷着。", mark: "😶" },
      { value: "重复工作", label: "😐", description: "一切都在继续，但心情没什么波澜。", mark: "😐" },
      { value: "身体疲惫", label: "🥱", description: "不是想太多，是身体真的累了。", mark: "🥱" },
    ],
  },
  {
    titles: [
      "如果今天的世界音量有一格刻度，你会选哪一档？",
      "回看今天，你更像待在哪一种音量里？",
      "今天这一整天，对你来说更像哪种声音大小？",
      "如果把今天调成一个音量键，会停在哪一格？",
      "哪一种音量最像你今天的体感？",
      "此刻回头看，今天更像哪种声音环境？",
    ],
    hints: [
      "音量会暴露你今天是被吵到、想太多，还是已经没电了。",
      "不要追求准确，选体感最像的一项。",
      "把今天想成一个声场，会更容易回答。",
    ],
    footnotes: [
      "音量只是表象，AOTD 会继续翻译成真正的情绪源。",
      "选你最想调走的那档声音。",
      "这题只问体感，不问逻辑。",
    ],
    options: [
      { value: "沟通交流", label: "外放太大声", description: "今天一直被人声和消息推着走。", mark: "🔊" },
      { value: "思考决策", label: "脑内嗡嗡响", description: "外面不一定吵，但脑子一直在响。", mark: "🧠" },
      { value: "情绪压力", label: "低频闷响", description: "说不清哪里不对，但一直压在心里。", mark: "🎚️" },
      { value: "重复工作", label: "单曲循环", description: "今天像一段反复播放的旋律。", mark: "🔁" },
      { value: "身体疲惫", label: "快要没声了", description: "整个人只想慢慢静下来。", mark: "🔉" },
    ],
  },
];

const emotionalNeedTypes = [
  {
    titles: [
      "如果今晚只能领一个补给包，你最想拿哪一个？",
      "现在的你，如果能补一份能量，会先拿什么？",
      "回家路上，最想被塞到手里的是什么？",
      "如果今晚只能领取一种情绪补给，你会选哪份？",
      "你现在最想被递过来的，是哪一种补给？",
      "如果耳机是一台补给机，你会按哪个按钮？",
    ],
    hints: [
      "这一题不是问你应该要什么，而是问你现在最想被补哪一块。",
      "选最想立刻拥有的那一种感觉。",
      "这是歌单的主方向，会决定它是更安静还是更提神。",
    ],
    footnotes: [
      "补给包只是隐喻，后面会翻成更准确的情绪需求。",
      "选最想立刻拿到的那个。",
      "今晚的歌单会围着这个需求展开。",
    ],
    options: [
      { value: "放松一下", label: "一条毯子", description: "先把紧绷放下，让人松一点。", mark: "🧣" },
      { value: "找回力量", label: "一块充电宝", description: "想慢慢把能量拉回来。", mark: "🔋" },
      { value: "有人陪伴", label: "一个并肩座位", description: "不一定说话，但想感觉不是一个人。", mark: "🫂" },
      { value: "清空大脑", label: "一个关闭弹窗键", description: "先把脑子里的通知都关掉。", mark: "📴" },
      { value: "奖励自己", label: "一朵小小烟花", description: "想给今天一个漂亮点的结尾。", mark: "🎆" },
    ],
  },
  {
    titles: [
      "如果今晚可以按一个按钮，你最想按哪一个？",
      "回家的这段路，你最想启动哪个模式？",
      "如果音乐面板上只能留一个按钮，你会选哪个？",
      "这一刻你最想打开的，是哪种模式？",
      "如果今晚只允许一种操作，你会按哪里？",
      "你的情绪现在最需要哪个按钮生效？",
    ],
    hints: [
      "按钮是最简单的说法，但很适合判断你此刻真正需要什么。",
      "选你最想马上按下去的那一个。",
      "这一步决定歌单是安抚、提振、陪伴还是放空。",
    ],
    footnotes: [
      "不要选理性上的最优解，只选最想按的那一颗。",
      "按键背后就是今晚歌单的主情绪。",
      "你只需要凭直觉做这个选择。",
    ],
    options: [
      { value: "放松一下", label: "暂停", description: "先停一下，让呼吸慢下来。", mark: "⏸️" },
      { value: "找回力量", label: "重新启动", description: "想把自己一点点点亮回来。", mark: "🔁" },
      { value: "有人陪伴", label: "连线", description: "想有个温柔的人声陪着自己。", mark: "📡" },
      { value: "清空大脑", label: "静音", description: "最好脑内先安静一会儿。", mark: "🔇" },
      { value: "奖励自己", label: "亮灯", description: "想让今晚有一点值得庆祝的光。", mark: "💡" },
    ],
  },
  {
    titles: [
      "如果耳机今晚会说一句话，你最想听到哪一种？",
      "今天结束之前，你最想被怎样对待？",
      "如果音乐能先做一件事，你最希望它做什么？",
      "现在的你，最想从耳机里收到什么？",
      "如果今晚的歌只能先照顾你一件事，会是哪件？",
      "这一刻最想被接住的方式，是哪一种？",
    ],
    hints: [
      "你不需要解释为什么，只需要选最想被满足的那种感受。",
      "AOTD 会把这份需要变成歌单的推进逻辑。",
      "想象音乐不是在表演，而是在照顾你。",
    ],
    footnotes: [
      "需求比原因更重要，先说你想靠近什么。",
      "今晚的歌单会沿着这条需求慢慢展开。",
      "选最像“现在就需要”的那个。",
    ],
    options: [
      { value: "放松一下", label: "先歇一下吧", description: "不用努力，也不用现在就变好。", mark: "😮‍💨" },
      { value: "找回力量", label: "你还能再亮一点", description: "想慢慢把精神找回来。", mark: "✨" },
      { value: "有人陪伴", label: "我在", description: "哪怕不聊天，也想被陪着。", mark: "🤍" },
      { value: "清空大脑", label: "先别想了", description: "让脑子暂时不用继续工作。", mark: "🫧" },
      { value: "奖励自己", label: "今天辛苦了，值得被哄一下", description: "想有点柔软又体面的偏爱。", mark: "🎁" },
    ],
  },
  {
    titles: [
      "如果现在的你需要一个房间，它应该是什么功能？",
      "今晚最想把自己放进哪种房间里？",
      "如果耳机替你开一扇门，你最想进哪一间？",
      "你现在最需要的那个房间，会是哪种感觉？",
      "如果心情今晚有个落脚点，它更像哪一间屋子？",
      "回家之后，你最想进入哪种空间状态？",
    ],
    hints: [
      "房间感会很好地反映你此刻真正缺少的东西。",
      "选最想进去待着的一间。",
      "这是在问：你想被安放到什么状态里。",
    ],
    footnotes: [
      "先选空间感，再进入歌单。",
      "你不需要描述自己，只要选想进去的房间。",
      "歌单会把这个房间感继续放大。",
    ],
    options: [
      { value: "放松一下", label: "柔软的休息室", description: "进去就可以先把身体放下来。", mark: "🛋️" },
      { value: "找回力量", label: "有风的练习室", description: "想重新把自己调回来一点。", mark: "🪁" },
      { value: "有人陪伴", label: "有人等你的客厅", description: "不热闹，但知道自己不是一个人。", mark: "🛖" },
      { value: "清空大脑", label: "安静的白房间", description: "最好什么都别再来打扰。", mark: "⬜" },
      { value: "奖励自己", label: "小小庆祝包厢", description: "今天值得被好好收尾一下。", mark: "🥂" },
    ],
  },
  {
    titles: [
      "如果今晚的你是一种状态条，你最想补哪一格？",
      "看一眼内在状态栏，你最想先拉满哪一项？",
      "如果只能修复一条状态条，你会先补哪个？",
      "此刻最缺的那一格感受，是什么？",
      "如果把自己当作一个角色面板，你最想回哪项数值？",
      "今晚最需要先恢复的，是哪条状态？",
    ],
    hints: [
      "状态条很直接，适合判断你是需要恢复、陪伴、放空，还是一点奖励。",
      "选你最想先救回来的那一格。",
      "歌单会围绕这一格状态慢慢加回去。",
    ],
    footnotes: [
      "选最先想补满的一格。",
      "这一题决定歌单的主情绪功能。",
      "不用分析，只选最缺的那个。",
    ],
    options: [
      { value: "放松一下", label: "松弛值", description: "想先让自己别那么紧。", mark: "🌙" },
      { value: "找回力量", label: "能量值", description: "想重新聚一点力气。", mark: "⚡" },
      { value: "有人陪伴", label: "陪伴值", description: "想感觉到有人和自己在同一个频道。", mark: "🫂" },
      { value: "清空大脑", label: "清爽值", description: "想让脑内杂音先消退。", mark: "🫧" },
      { value: "奖励自己", label: "愉悦值", description: "想有一点漂亮、轻盈、值得。", mark: "💫" },
    ],
  },
  {
    titles: [
      "如果今晚只允许你拥有一种小特权，你会选什么？",
      "现在最想给自己开的特权，是哪一项？",
      "如果今晚你可以理直气壮地满足自己一次，会选哪个？",
      "你现在最想被允许的事情，是哪一种？",
      "如果给今天最后一段路一个特权按钮，你想开哪个？",
      "这一刻最想给自己的偏爱，会是什么？",
    ],
    hints: [
      "特权感很适合暴露“现在真正缺的那个东西”。",
      "选你最舍不得放弃的一项。",
      "别想应该，直接选想要。",
    ],
    footnotes: [
      "这是在问：如果今晚可以偏爱自己一次，你最想偏爱哪种感受。",
      "特权答案就是歌单的主方向。",
      "选最想立刻拥有的那个。",
    ],
    options: [
      { value: "放松一下", label: "什么都先慢一点", description: "想给自己一个暂时不赶的权利。", mark: "🐢" },
      { value: "找回力量", label: "重新发光一次", description: "想让自己重新有一点往前的力。", mark: "🌟" },
      { value: "有人陪伴", label: "不用一个人扛", description: "想要一点被懂、被接住的感觉。", mark: "🤝" },
      { value: "清空大脑", label: "脑内全部下线", description: "想把今天先静音处理。", mark: "🛑" },
      { value: "奖励自己", label: "今晚对自己好一点", description: "想让今天有个体面的结尾。", mark: "🍰" },
    ],
  },
  {
    titles: [
      "如果今晚只能喝一杯，你最想选哪一杯？",
      "现在的你，最想被递上一杯什么？",
      "回家路上只能选一杯情绪饮品，你会拿哪杯？",
      "如果今晚的补给变成一杯喝的，你最想要什么？",
      "耳机店今天只送一杯，你会选哪种？",
      "哪一杯最像你现在真正想要的感觉？",
    ],
    hints: [
      "饮品题会比“你需要什么”更容易答，也更接近直觉。",
      "选最想立刻拿在手里的那一杯。",
      "这题会决定歌单要先安抚、提神、陪伴还是犒赏。",
    ],
    footnotes: [
      "不用想健康不健康，只选最想喝的那杯。",
      "那一口想喝下去的感觉，就是今晚的需求方向。",
      "选想要，不选应该。",
    ],
    options: [
      { value: "放松一下", label: "热水", description: "先把整个人慢慢放松下来。", mark: "🍵" },
      { value: "找回力量", label: "冰美式", description: "想重新提一点神，找回一点推进感。", mark: "☕" },
      { value: "有人陪伴", label: "热可可", description: "想被一份温温的存在感包住。", mark: "🍫" },
      { value: "清空大脑", label: "冰气泡水", description: "想让脑子先清一清、空一空。", mark: "🥤" },
      { value: "奖励自己", label: "微醺特调", description: "想让今晚有一点漂亮的偏爱。", mark: "🍸" },
    ],
  },
  {
    titles: [
      "如果今晚的情绪需求只能用一个 emoji 表示，你会选哪一个？",
      "下面哪个 emoji 最像你现在最需要的东西？",
      "这一刻你最想点开的，是哪种感受按钮？",
      "如果现在只能发一个 emoji 求助，你会发哪个？",
      "耳机如果看得懂 emoji，你最想发给它哪一个？",
      "哪一个 emoji 最像你此刻真正想靠近的状态？",
    ],
    hints: [
      "用 emoji 选需求，通常比用语言更快。",
      "选最想被满足的那个感觉，不用解释。",
      "这题会给今晚歌单定下主功能。",
    ],
    footnotes: [
      "emoji 很轻，但足够说出你现在缺什么。",
      "选第一眼想点的那个就对了。",
      "今晚歌单会优先回应这份需要。",
    ],
    options: [
      { value: "放松一下", label: "😮‍💨", description: "想先松一口气，不用再绷着。", mark: "😮‍💨" },
      { value: "找回力量", label: "⚡", description: "想把能量一点点接回来。", mark: "⚡" },
      { value: "有人陪伴", label: "🤍", description: "想要一点温柔的陪着。", mark: "🤍" },
      { value: "清空大脑", label: "🫧", description: "想让脑内的杂音先飘走。", mark: "🫧" },
      { value: "奖励自己", label: "🎉", description: "想让今天最后有一点开心的仪式感。", mark: "🎉" },
    ],
  },
];

const emotionalImageryTypes = [
  {
    titles: [
      "如果今晚是一张照片，你更想停在哪个画面里？",
      "如果现在能把自己放进一张夜晚照片里，你选哪张？",
      "今晚更想把情绪停在哪一个画面里？",
      "如果耳机替你拍一张封面，你最想要哪种画面？",
      "如果今天最后留下一个镜头，你想让它长什么样？",
      "下面哪一张，更像你想停留的今晚？",
    ],
    hints: [
      "这一步不在问原因，而是在问你想把自己安放到哪里。",
      "选最想进去待一会儿的那个画面。",
      "画面会决定歌单的空气感与推进方式。",
    ],
    footnotes: [
      "把自己交给一个画面，歌单会更像今晚的专属封面。",
      "这一题不是装饰，它决定整张歌单的氛围底色。",
      "选最想被接住的那一幕夜色。",
    ],
    options: [
      { value: "东京雨夜", label: "雨点挂在车窗上", description: "霓虹被拉长，世界安静又有点电影感。", mark: "🌧️" },
      { value: "夏日晚风", label: "风穿过树影", description: "夜里有点凉，心也慢慢松开。", mark: "🍃" },
      { value: "海边公路", label: "海和路一起往前", description: "视线被拉开，整个人也想重新流动。", mark: "🌊" },
      { value: "深夜便利店", label: "白光落在安静的小店里", description: "世界缩小了，反而比较安心。", mark: "🏪" },
      { value: "城市灯光", label: "高楼窗口一盏盏亮着", description: "城市还醒着，所以你也不算太孤单。", mark: "🌆" },
    ],
  },
  {
    titles: [
      "如果今晚只能选一组 emoji，当作歌单封面，你会选哪组？",
      "下面哪组 emoji 最像你想待着的今晚？",
      "如果把今晚缩成一组表情符号，你会选哪一个？",
      "哪一组 emoji 最适合承接你现在的情绪？",
      "你最想把自己放进下面哪组 emoji 里？",
      "如果歌单封面只用 emoji，你更想选哪组？",
    ],
    hints: [
      "不用解释，emoji 反而更适合选出你想停留的氛围。",
      "选最像“我想进去待着”的那一组。",
      "这一题决定歌单的场景滤镜。",
    ],
    footnotes: [
      "emoji 看起来轻，但很适合快速定场景。",
      "你只要选最有画面感的一组。",
      "后面的歌单会沿着这个氛围展开。",
    ],
    options: [
      { value: "东京雨夜", label: "🌧️🚕🌃", description: "有雨、有霓虹、有一点城市里的独处感。 " },
      { value: "夏日晚风", label: "🌙🍃🎧", description: "风是轻的，整个人也想跟着轻下来。 " },
      { value: "海边公路", label: "🌊🚗☁️", description: "想把自己放进更开阔的路上。 " },
      { value: "深夜便利店", label: "🏪🥛🌙", description: "被一小块稳定亮光接住。 " },
      { value: "城市灯光", label: "🌆✨🪟", description: "城市很大，但灯光会让人没那么空。 " },
    ].map((option, index) => ({ ...option, mark: ["01", "02", "03", "04", "05"][index] })),
  },
  {
    titles: [
      "如果今晚有一种光线，你更想站在里面的是哪一种？",
      "哪种灯光最适合接住你现在的心情？",
      "如果今晚只能留一种光，你会选哪种？",
      "你更想把自己放进哪一种亮度里？",
      "哪种光线最像你想待着的夜晚？",
      "如果情绪最后落成一种光，它更像哪种？",
    ],
    hints: [
      "光线会决定歌单是更冷、更暖、更开阔还是更安静。",
      "选你最想站进去的那一束光。",
      "这一题其实是在问你想被怎样的氛围包起来。",
    ],
    footnotes: [
      "选一束光，歌单就会有自己的质地。",
      "不要想合理不合理，只看想不想待在里面。",
      "你想靠近的光，就是今晚的氛围方向。",
    ],
    options: [
      { value: "东京雨夜", label: "霓虹反光", description: "冷一点、湿一点、像电影里的城市边缘。", mark: "💜" },
      { value: "夏日晚风", label: "树影里的月光", description: "轻轻晃着，让人想慢下来。", mark: "🌿" },
      { value: "海边公路", label: "海平线尽头的余光", description: "有空间，也有继续往前的感觉。", mark: "🛣️" },
      { value: "深夜便利店", label: "便利店白光", description: "稳定、简单、很适合暂时停靠。", mark: "🥛" },
      { value: "城市灯光", label: "楼宇窗灯", description: "很多陌生的亮光，拼出一种陪伴感。", mark: "🏙️" },
    ],
  },
  {
    titles: [
      "如果今晚要躲进一个地方，你最想去哪儿？",
      "下面这些落脚点里，你最想把自己放在哪里？",
      "如果现在有一个能让你停靠一下的地方，你会选哪儿？",
      "你最想在今晚把自己安放到哪个地方？",
      "如果给这份情绪找一个临时落脚点，你选哪里？",
      "回家之前，你最想先停在哪一站？",
    ],
    hints: [
      "这不是在问去哪玩，而是在问哪里最能接住你。",
      "选最想让自己安静待一会儿的地方。",
      "地点感会决定整张歌单的空间感。",
    ],
    footnotes: [
      "选最想停靠的一站就好。",
      "歌单会沿着你选的这个地方生长出来。",
      "这一题会把抽象情绪变成更可感知的夜晚场景。",
    ],
    options: [
      { value: "东京雨夜", label: "一辆停在雨里的车里", description: "窗外很闹，车里却终于安静下来。", mark: "🚕" },
      { value: "夏日晚风", label: "一段有风的小路", description: "没有人催，夜色刚刚好。", mark: "🚶" },
      { value: "海边公路", label: "一条能一直往前开的路", description: "想让视线和心都拉开一点。", mark: "🚗" },
      { value: "深夜便利店", label: "一家还亮着灯的小店", description: "世界缩小之后，情绪也比较好放。", mark: "🏪" },
      { value: "城市灯光", label: "能看见很多窗灯的高处", description: "像有人在远处陪着你一起醒着。", mark: "🪟" },
    ],
  },
  {
    titles: [
      "如果今晚是一部片子的片名，你更想活在哪一种里面？",
      "下面哪种片子，更像你想要的今晚？",
      "如果你今晚要住进一个电影类型里，会选哪种？",
      "这一刻更想把自己放进哪类夜晚电影？",
      "如果歌单是一部电影，你最想选哪种镜头语言？",
      "哪一种片感，最适合收留你现在的情绪？",
    ],
    hints: [
      "电影类型会直接影响歌单的叙事速度和空气感。",
      "选最想让今晚长成的片感。",
      "不用追求真实，只看你想进入哪种夜色。",
    ],
    footnotes: [
      "选片感，不选对错。",
      "这一题在帮 AOTD 确定整张歌单的镜头语言。",
      "你想活进哪一种片子里，歌单就会朝那里走。",
    ],
    options: [
      { value: "东京雨夜", label: "都市夜雨片", description: "冷色霓虹、缓慢镜头、有人在心里说话。", mark: "🎬" },
      { value: "夏日晚风", label: "夏夜散步片", description: "风很轻，心事也没那么重。", mark: "🌙" },
      { value: "海边公路", label: "公路逃逸片", description: "想让路和海把自己带远一点。", mark: "🛣️" },
      { value: "深夜便利店", label: "小店停靠片", description: "不是热闹，是被日常温柔接住。", mark: "🥤" },
      { value: "城市灯光", label: "高楼夜归片", description: "城市很亮，心里慢慢没那么空。", mark: "🌃" },
    ],
  },
  {
    titles: [
      "如果今晚的空气有味道，你更想闻到哪一种？",
      "下面哪种空气感，更像你想待着的今晚？",
      "如果你能替今晚选一种空气，会是哪种？",
      "你更想把自己放进哪一种空气里？",
      "哪种空气最能承接你现在的情绪？",
      "如果今晚有一种呼吸感，你更想选哪一个？",
    ],
    hints: [
      "空气感很抽象，但常常最接近一个人真正想停留的场景。",
      "选最想深呼吸进去的那个。",
      "这一题会决定歌单的“空气密度”。",
    ],
    footnotes: [
      "选空气感，就是选今晚的氛围质地。",
      "不用解释为什么想闻到它，只选最想靠近的那个。",
      "歌单会把这份空气感继续铺开。",
    ],
    options: [
      { value: "东京雨夜", label: "雨后柏油路", description: "冷、湿、带一点灯光反射的味道。", mark: "🌧️" },
      { value: "夏日晚风", label: "风吹过树叶", description: "很轻，很干净，很适合慢下来。", mark: "🍃" },
      { value: "海边公路", label: "海风和空旷", description: "有盐味，也有往前开的空间感。", mark: "🌊" },
      { value: "深夜便利店", label: "冰柜边的冷空气", description: "有点日常，也有点被接住。", mark: "🧊" },
      { value: "城市灯光", label: "夜里刚下楼的城市空气", description: "灯还亮着，所以人不至于太空。", mark: "🌆" },
    ],
  },
  {
    titles: [
      "如果今晚有一种温度，你最想待在哪一种里面？",
      "哪一种温度最像你想要的今晚？",
      "如果耳机能替你调今晚的温度，你会调到哪一档？",
      "你更想把自己放进哪种温度里？",
      "现在最适合承接你情绪的，会是哪种温度？",
      "如果今晚只能留下一种体感温度，你会选哪种？",
    ],
    hints: [
      "温度题很适合快速决定歌单是冷感、风感、开阔感还是城市感。",
      "选最想待进去的体感，不用想现实天气。",
      "你想靠近的温度，就是今晚的氛围滤镜。",
    ],
    footnotes: [
      "温度不在说冷热本身，而是在说你想被什么样的夜晚包住。",
      "选最想让自己沉进去的那一档。",
      "AOTD 会把这档温度翻成歌单场景。",
    ],
    options: [
      { value: "东京雨夜", label: "微凉带雨气", description: "冷一点、湿一点，像霓虹落在车窗上。", mark: "🌧️" },
      { value: "夏日晚风", label: "刚刚好的晚风温度", description: "轻轻吹着，很适合把整个人放松下来。", mark: "🍃" },
      { value: "海边公路", label: "有海风的清凉", description: "视线和呼吸都能被拉开。", mark: "🌊" },
      { value: "深夜便利店", label: "冰柜旁的冷白温度", description: "简单、稳定、让人暂时安心。", mark: "🧊" },
      { value: "城市灯光", label: "夜里街灯的余温", description: "不是热，但有种城市还醒着的陪伴感。", mark: "🌆" },
    ],
  },
  {
    titles: [
      "如果今晚只能选一个座位待着，你会选哪一个？",
      "下面哪一个位置，最像你想停留的今晚？",
      "如果现在有个座位能接住你，你最想坐在哪里？",
      "你更想把今晚安放到哪一个座位里？",
      "哪一个位置最适合现在的你？",
      "如果歌单开始前要先选个位子，你会坐哪儿？",
    ],
    hints: [
      "座位题很适合把抽象情绪变成一个可停留的场景。",
      "选最想坐下去不被打扰的那个位置。",
      "这个位置会决定整张歌单的空间感。",
    ],
    footnotes: [
      "选位置，就是在选今晚的落点。",
      "不用想谁陪你，只想你最想坐哪儿。",
      "歌单会从这个座位的视角开始。",
    ],
    options: [
      { value: "东京雨夜", label: "靠窗车座", description: "看雨和霓虹往后退，心也能慢下来。", mark: "🚕" },
      { value: "夏日晚风", label: "路边长椅", description: "有风、有树影，什么都不用急。", mark: "🪑" },
      { value: "海边公路", label: "副驾驶座", description: "可以一直看着路和远处往前走。", mark: "🚗" },
      { value: "深夜便利店", label: "便利店门口高脚凳", description: "灯是亮的，人是安静的。", mark: "🏪" },
      { value: "城市灯光", label: "高楼窗边的位置", description: "能看见很多灯，也没那么孤单。", mark: "🪟" },
    ],
  },
];

export const questionPromptPool = {
  consumptionSource: consumptionSourceTypes,
  emotionalNeed: emotionalNeedTypes,
  emotionalImagery: emotionalImageryTypes,
};

export function createQuestionDeck(history = {}) {
  return {
    consumptionSource: buildQuestion(
      pickAvoidRecent(questionPromptPool.consumptionSource, history.consumptionSource || []),
    ),
    emotionalNeed: buildQuestion(
      pickAvoidRecent(questionPromptPool.emotionalNeed, history.emotionalNeed || []),
    ),
    emotionalImagery: buildQuestion(
      pickAvoidRecent(questionPromptPool.emotionalImagery, history.emotionalImagery || []),
    ),
  };
}
