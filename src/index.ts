import { AotdAgent } from "./agents/aotd-agent.js";
import { defaultAotdAnswers } from "./domain/aotd/questionnaire.js";
import type { AotdQuestionnaireAnswers } from "./domain/aotd/types.js";

function parseAnswersFromCli(argv: string[]): AotdQuestionnaireAnswers {
  const raw = argv.join(" ").trim();
  if (!raw) {
    return defaultAotdAnswers;
  }

  return {
    ...defaultAotdAnswers,
    ...(JSON.parse(raw) as Partial<AotdQuestionnaireAnswers>),
  };
}

async function main() {
  const answers = parseAnswersFromCli(process.argv.slice(2));
  const agent = new AotdAgent();
  const result = await agent.run(answers);

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
