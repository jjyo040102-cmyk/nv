# Nebius × NVIDIA inference

The live provider is `nebius`. Its publisher is NVIDIA and its hosting provider is Nebius. Chat API compatibility is a transport format; it does not select a GPT provider.

- Fixed endpoint: `https://api.tokenfactory.nebius.com/v1`.
- Initial model candidate: `nvidia/nemotron-3-super-120b-a12b`.
- Custom model IDs must start with `nvidia/` and use the supported identifier format.
- Connection testing queries the account model list and then performs actual inference.
- JSON output is validated against the work-plan schema. At most one JSON repair attempt is made using the same model.
- The backend assigns hosting, publisher, response ID, response hash, time and token usage evidence. Model text cannot grant tool authority.
- A missing key, unexpected response model, truncated response or unavailable model fails without provider substitution.

No user-configurable base URL, LOCAL/API selector, Qwen/Tabby installation, task-specific provider switch, OpenAI/Anthropic/Gemini adapter or automatic provider fallback remains in the active application.

The deterministic DemoProvider remains solely as an explicit development test fixture. `ACTFLOW_TEST_MODE=true` cannot enable it in production. It reports `realModelCalled: false`, is absent from provider presets and settings UI, and cannot be presented as hackathon inference evidence.

Legacy database migration replaces unsupported routing preferences with the Nebius default without making an inference request. Stored task history and opaque encrypted credential history remain preserved; retired credentials cannot be selected or read through the application credential API.

Actual model availability, credits and live inference are pending account verification.

References: [Nebius quickstart](https://docs.tokenfactory.nebius.com/quickstart), [JSON mode](https://docs.tokenfactory.nebius.com/ai-models-inference/json), [NVIDIA model cookbook](https://github.com/nebius/token-factory-cookbook/blob/main/models/nemotron/nemotron3-super-120B.md).
