const longToolOutput = [
  "install started",
  "status: running",
  ...Array.from({ length: 260 }, (_, i) => `verbose install log line ${i}: ${"x".repeat(90)}`),
  "error: package mirror timeout",
  "path: C:\\tmp\\installer.log",
  "status: failed",
].join("\n");

const body = {
  model: "minirouter/auto",
  messages: [
    { role: "system", content: "You are a concise engineering assistant." },
    { role: "user", content: "根据工具输出判断安装是否成功，用一句中文回答。" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_smoke_1",
          type: "function",
          function: { name: "shell", arguments: "{\"cmd\":\"npm install\"}" },
        },
      ],
    },
    { role: "tool", tool_call_id: "call_smoke_1", content: longToolOutput },
  ],
  tools: [
    {
      type: "function",
      function: {
        name: "shell",
        description: "Run a shell command",
        parameters: { type: "object", properties: { cmd: { type: "string" } }, required: ["cmd"] },
      },
    },
  ],
  tool_choice: "none",
  temperature: 0,
  max_tokens: 64,
  stream: false,
};

const response = await fetch("http://localhost:8402/v1/chat/completions", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const text = await response.text();
console.log(
  JSON.stringify(
    {
      status: response.status,
      ok: response.ok,
      preview: text.slice(0, 500),
    },
    null,
    2,
  ),
);
