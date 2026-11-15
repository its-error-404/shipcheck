import type { Command } from "commander";
import { OpenAICompatibleClient, loadLlmConfig, loadLlmConnection } from "@tyn/core";
import { banner, c, fail, info, ok, out, step } from "../ui";

export const registerLlmCommands = (program: Command) => {
  program
    .command("verify-llm")
    .description("List models your LLM key can use and test tool calling (LLM_MODEL, or several with --models)")
    .option("-m, --models <ids>", "comma-separated model ids to probe, e.g. gemini-3.6-flash,gemini-3.5-flash")
    .action(async (o: { models?: string }) => {
      const conn = loadLlmConnection();
      const candidates = (o.models ?? process.env.LLM_MODEL ?? "")
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean);
      const timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 60_000);
      banner("LLM check", [
        ["Endpoint", conn.LLM_BASE_URL],
        ["Models", candidates.join(", ") || c.yellow("LLM_MODEL not set")],
      ]);
      step(1, 2, "Available models");
      const lister = new OpenAICompatibleClient({
        baseURL: conn.LLM_BASE_URL,
        apiKey: conn.LLM_API_KEY,
        model: "none",
      });
      const available = await lister.listModels().catch((e: Error) => {
        fail(`Could not list models: ${e.message}`);
        return [] as string[];
      });
      if (available.length) {
        ok(`Key works · ${available.length} models available`);
        const text = available.filter(
          (m) => /flash|qwen|llama|gpt|gemma|mistral|phi/i.test(m) && !/tts|live|audio|image|embed|omni/i.test(m),
        );
        if (text.length) info(`Text models: ${text.slice(0, 20).join(", ")}${text.length > 20 ? ", …" : ""}`);
      }
      out();
      step(2, 2, "Tool-calling probe", `timeout ${Math.round(timeoutMs / 1000)}s each`);
      if (!candidates.length) {
        info("Set LLM_MODEL in .env (or pass --models a,b,c) to test tool calling.");
        out();
        return;
      }
      const effort = process.env.LLM_REASONING_EFFORT || undefined;
      const working: { model: string; ms: number }[] = [];
      for (const model of candidates) {
        const llm = new OpenAICompatibleClient({
          baseURL: conn.LLM_BASE_URL,
          apiKey: conn.LLM_API_KEY,
          model,
          reasoningEffort: effort,
          timeoutMs,
          maxRetries: 0,
        });
        try {
          const res = await llm.chat({
            system: "You are a connectivity test. Always respond by calling the provided tool.",
            messages: [{ role: "user", content: "Call the ping tool with message 'ok'." }],
            tools: [
              {
                name: "ping",
                description: "Connectivity check",
                parameters: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
              },
            ],
          });
          if (res.toolCalls[0]?.name === "ping") {
            working.push({ model, ms: res.latencyMs });
            ok(
              `${c.bold(model)}  tool call OK in ${(res.latencyMs / 1000).toFixed(1)}s ${c.gray(`(served as ${res.model})`)}`,
            );
          } else fail(`${model}  answered without calling the tool`);
        } catch (e) {
          fail(`${model}  ${(e as Error).message.replace(/\s+/g, " ").slice(0, 150)}`);
        }
      }
      out();
      if (working.length) {
        const best = [...working].sort((a, b) => a.ms - b.ms)[0]!;
        ok(`Ready. Fastest: ${c.bold(best.model)}. Set LLM_MODEL=${best.model} in .env (prefer non-preview models).`);
        info(`Next: ${c.bold("npm run assess")}`);
      } else {
        fail("No model passed the tool-calling probe.");
        process.exitCode = 1;
      }
      // Validate the full config only when a single configured model is used (assess needs it).
      if (!o.models && candidates.length === 1) loadLlmConfig();
      out();
    });
};
