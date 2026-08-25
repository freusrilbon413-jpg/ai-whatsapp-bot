const express = require("express");

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 3000;

const EVOLUTION_API_URL = (process.env.EVOLUTION_API_URL || "").replace(/\/$/, "");
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || "";
const EVOLUTION_INSTANCE_NAME =
  process.env.EVOLUTION_INSTANCE_NAME || "fritzson-ai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

let botEnabled = true;

let botSettings = {
  name: "Fritzson AI",
  language: "ht",
  personality:
    "Ou se Fritzson AI, yon asistan entèlijan, zanmitay, itil epi natirèl. Reponn klèman epi sitou sèvi ak lang itilizatè a itilize.",
  welcomeMessage: "Bonjou 👋 Mwen se Fritzson AI. Kijan mwen ka ede w?",
};

const processedMessages = new Set();

function evolutionHeaders() {
  return {
    "Content-Type": "application/json",
    apikey: EVOLUTION_API_KEY,
  };
}

async function evolutionRequest(path, options = {}) {
  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
    throw new Error("Evolution API environment variables are missing.");
  }

  const response = await fetch(`${EVOLUTION_API_URL}${path}`, {
    ...options,
    headers: {
      ...evolutionHeaders(),
      ...(options.headers || {}),
    },
  });

  const text = await response.text();

  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(
      `Evolution API error ${response.status}: ${JSON.stringify(data)}`
    );
  }

  return data;
}

async function sendWhatsAppText(number, text) {
  return evolutionRequest(
    `/message/sendText/${encodeURIComponent(EVOLUTION_INSTANCE_NAME)}`,
    {
      method: "POST",
      body: JSON.stringify({
        number,
        text,
      }),
    }
  );
}

async function askGemini(userMessage) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const model = "gemini-2.5-flash";

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
    `?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const systemInstruction = `
Ou se ${botSettings.name}.

${botSettings.personality}

Règ:
- Reponn natirèlman.
- Si itilizatè a ekri an kreyòl, reponn an kreyòl.
- Si li ekri an français, reponn an français.
- Si li ekri an anglais, reponn an anglais.
- Si li ekri an español, reponn en español.
- Pa mansyone ke ou se yon API.
- Pa bay repons ki pa nesesèman long.
`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: systemInstruction }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: String(userMessage).slice(0, 8000) }],
        },
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 700,
      },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Gemini error ${response.status}: ${JSON.stringify(data)}`);
  }

  const answer =
    data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();

  if (!answer) {
    throw new Error("Gemini returned an empty response.");
  }

  return answer;
}

function extractIncomingMessage(payload) {
  const data = payload?.data || payload;

  const key = data?.key || {};
  const message = data?.message || {};

  const remoteJid =
    key?.remoteJid ||
    data?.remoteJid ||
    data?.sender ||
    data?.from ||
    "";

  const messageId =
    key?.id ||
    data?.id ||
    data?.messageId ||
    "";

  const fromMe =
    key?.fromMe === true ||
    data?.fromMe === true;

  let text = "";

  if (typeof data?.body === "string") {
    text = data.body;
  }

  if (!text && typeof data?.text === "string") {
    text = data.text;
  }

  if (!text && typeof message?.conversation === "string") {
    text = message.conversation;
  }

  if (!text && message?.extendedTextMessage?.text) {
    text = message.extendedTextMessage.text;
  }

  return {
    remoteJid,
    messageId,
    text: String(text || "").trim(),
    fromMe,
  };
}

function phoneFromJid(jid) {
  return String(jid || "").split("@")[0];
}

app.get("/", (req, res) => {
  res.json({
    name: "Fritzson AI",
    status: "online",
    developer: "Fritzson",
    whatsappInstance: EVOLUTION_INSTANCE_NAME,
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "Fritzson AI",
    whatsappConfigured: Boolean(
      EVOLUTION_API_URL && EVOLUTION_API_KEY
    ),
    geminiConfigured: Boolean(GEMINI_API_KEY),
  });
});

app.get("/api/whatsapp/status", async (req, res) => {
  try {
    const data = await evolutionRequest(
      `/instance/connectionState/${encodeURIComponent(
        EVOLUTION_INSTANCE_NAME
      )}`
    );

    res.json(data);
  } catch (error) {
    res.status(502).json({
      connected: false,
      error: error.message,
    });
  }
});

app.get("/api/whatsapp/instance", async (req, res) => {
  try {
    const data = await evolutionRequest(
      `/instance/fetchInstances?instanceName=${encodeURIComponent(
        EVOLUTION_INSTANCE_NAME
      )}`
    );

    res.json(data);
  } catch (error) {
    res.status(502).json({
      error: error.message,
    });
  }
});

app.get("/api/whatsapp/qr", async (req, res) => {
  try {
    const data = await evolutionRequest(
      `/instance/connect/${encodeURIComponent(EVOLUTION_INSTANCE_NAME)}`
    );

    res.json(data);
  } catch (error) {
    res.status(502).json({
      error: error.message,
    });
  }
});

app.post("/api/whatsapp/reconnect", async (req, res) => {
  try {
    const data = await evolutionRequest(
      `/instance/restart/${encodeURIComponent(EVOLUTION_INSTANCE_NAME)}`,
      {
        method: "PUT",
      }
    );

    res.json(data);
  } catch (error) {
    res.status(502).json({
      error: error.message,
    });
  }
});

app.post("/api/whatsapp/disconnect", async (req, res) => {
  try {
    const data = await evolutionRequest(
      `/instance/logout/${encodeURIComponent(EVOLUTION_INSTANCE_NAME)}`,
      {
        method: "DELETE",
      }
    );

    res.json(data);
  } catch (error) {
    res.status(502).json({
      error: error.message,
    });
  }
});

app.get("/api/bot/settings", (req, res) => {
  res.json({
    enabled: botEnabled,
    settings: botSettings,
  });
});

app.put("/api/bot/settings", (req, res) => {
  const allowed = [
    "name",
    "language",
    "personality",
    "welcomeMessage",
  ];

  for (const key of allowed) {
    if (typeof req.body?.[key] === "string") {
      botSettings[key] = req.body[key].slice(0, 4000);
    }
  }

  if (typeof req.body?.enabled === "boolean") {
    botEnabled = req.body.enabled;
  }

  res.json({
    success: true,
    enabled: botEnabled,
    settings: botSettings,
  });
});

app.post("/api/bot/toggle", (req, res) => {
  if (typeof req.body?.enabled !== "boolean") {
    return res.status(400).json({
      error: "enabled must be true or false",
    });
  }

  botEnabled = req.body.enabled;

  res.json({
    success: true,
    enabled: botEnabled,
  });
});

app.post("/api/ai/chat", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();

    if (!message) {
      return res.status(400).json({
        error: "Message is required.",
      });
    }

    const answer = await askGemini(message);

    res.json({
      success: true,
      response: answer,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get("/api/conversations", (req, res) => {
  res.json({
    conversations: [],
    message:
      "Conversation storage will be connected to the database in the next backend layer.",
  });
});

app.get("/api/messages", (req, res) => {
  res.json({
    messages: [],
  });
});

app.get("/api/stats", (req, res) => {
  res.json({
    messagesReceived: 0,
    messagesSent: 0,
    conversations: 0,
    aiResponses: 0,
    imagesGenerated: 0,
  });
});

app.post("/api/webhook/evolution", async (req, res) => {
  res.status(200).json({
    received: true,
  });

  try {
    const incoming = extractIncomingMessage(req.body);

    if (
      !incoming.remoteJid ||
      !incoming.messageId ||
      incoming.fromMe ||
      !incoming.text
    ) {
      return;
    }

    if (processedMessages.has(incoming.messageId)) {
      return;
    }

    processedMessages.add(incoming.messageId);

    if (processedMessages.size > 5000) {
      const first = processedMessages.values().next().value;
      processedMessages.delete(first);
    }

    if (!botEnabled) {
      return;
    }

    const number = phoneFromJid(incoming.remoteJid);

    const answer = await askGemini(incoming.text);

    await sendWhatsAppText(number, answer);

    console.log(
      `Fritzson AI replied to ${number}: ${answer.slice(0, 100)}`
    );
  } catch (error) {
    console.error("Webhook processing error:", error.message);
  }
});

app.listen(PORT, () => {
  console.log(`Fritzson AI running on port ${PORT}`);
});
