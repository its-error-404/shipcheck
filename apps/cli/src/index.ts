#!/usr/bin/env node
/**
 * CLI entry point. Commands live in ./commands; terminal styling in ./ui.
 *   npm run verify-jira | import | verify-import | verify-llm | assess | evaluate
 */
import "dotenv/config";
import { Command } from "commander";
import { registerAssessCommands } from "./commands/assess";
import { registerJiraCommands } from "./commands/jira";
import { registerLlmCommands } from "./commands/llm";
import { errorBlock, hintFor } from "./ui";

const program = new Command()
  .name("shipcheck")
  .description("Jira release-evidence agent: importer, assessment and evaluation")
  .option("--no-color", "disable coloured output");

registerJiraCommands(program);
registerLlmCommands(program);
registerAssessCommands(program);

program.parseAsync().catch((err: Error) => {
  errorBlock(err.message, hintFor(err.message));
  process.exitCode = 1;
});
