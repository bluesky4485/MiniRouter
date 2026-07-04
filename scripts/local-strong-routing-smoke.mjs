const response = await fetch("http://localhost:8402/v1/chat/completions", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    model: "minirouter/auto",
    messages: [
      {
        role: "user",
        content: "上高智模型试下：只回答 OK",
      },
    ],
    temperature: 0,
    max_tokens: 8,
    stream: false,
  }),
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
