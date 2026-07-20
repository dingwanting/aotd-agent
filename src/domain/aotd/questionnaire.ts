import type { AotdQuestionnaireAnswers } from "./types.js";

export interface AotdQuestionOption {
  value: string;
  label: string;
  description?: string;
}

export interface AotdQuestionDefinition {
  id: keyof AotdQuestionnaireAnswers;
  title: string;
  prompt: string;
  options: AotdQuestionOption[];
}

export const aotdQuestionnaire: AotdQuestionDefinition[] = [
  {
    id: "consumptionSource",
    title: "问题一",
    prompt: "今天最消耗你的情绪来源是什么？",
    options: [
      { value: "工作拉扯", label: "工作拉扯" },
      { value: "信息过载", label: "信息过载" },
      { value: "关系内耗", label: "关系内耗" },
      { value: "身体疲惫", label: "身体疲惫" },
      { value: "空心麻木", label: "空心麻木" },
      { value: "轻微焦虑", label: "轻微焦虑" },
    ],
  },
  {
    id: "emotionalNeed",
    title: "问题二",
    prompt: "此刻你最需要被满足的情绪需求是什么？",
    options: [
      { value: "被接住", label: "被接住" },
      { value: "排水放松", label: "排水放松" },
      { value: "稳定专注", label: "稳定专注" },
      { value: "重新启动", label: "重新启动" },
      { value: "有人陪伴", label: "有人陪伴" },
      { value: "柔软回暖", label: "柔软回暖" },
    ],
  },
  {
    id: "emotionalImagery",
    title: "问题三",
    prompt: "今天你更想把自己放进哪一种情绪意境？",
    options: [
      { value: "雨夜窗边", label: "雨夜窗边" },
      { value: "夜晚散步", label: "夜晚散步" },
      { value: "房间独处", label: "房间独处" },
      { value: "城市霓虹", label: "城市霓虹" },
      { value: "清晨通勤", label: "清晨通勤" },
      { value: "晚风海边", label: "晚风海边" },
    ],
  },
];

export const defaultAotdAnswers: AotdQuestionnaireAnswers = {
  consumptionSource: "工作拉扯",
  emotionalNeed: "排水放松",
  emotionalImagery: "雨夜窗边",
};

export function renderQuestionnaireAnswers(answers: AotdQuestionnaireAnswers): string {
  return [
    `问题一·情绪消耗源：${answers.consumptionSource}`,
    `问题二·情绪需求：${answers.emotionalNeed}`,
    `问题三·情绪意境：${answers.emotionalImagery}`,
  ].join("\n");
}
