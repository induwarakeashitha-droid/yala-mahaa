// Yala Maha AI assistant: Gemini Multimodal Audio (Live Transcribe + Live Translate + Chat + TTS)
// Includes multi-key pool with automatic round-robin and rate-limit (429/quota) failover.
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const cors = require("cors");
const { GoogleGenAI } = require("@google/genai");

// --- Multi-Key Pool & Failover Management ---
// Supports comma, semicolon, space, or newline-separated keys in GEMINI_API_KEYS or GEMINI_API_KEY
const rawKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "";
const API_KEYS = rawKeys
  .split(/[,;\n\s]+/)
  .map((k) => k.trim())
  .filter((k) => k.length > 5);

if (API_KEYS.length === 0) {
  console.warn("WARNING: No GEMINI_API_KEY or GEMINI_API_KEYS configured.");
} else {
  console.log(`[KeyPool] Loaded ${API_KEYS.length} Gemini API key(s) with auto-failover & rotation.`);
}

let currentKeyIndex = 0;

function getAIClient(forcedIndex = null) {
  if (API_KEYS.length === 0) {
    return { client: new GoogleGenAI({ apiKey: "missing" }), keyIndex: 0, keyMasked: "none" };
  }
  const idx = forcedIndex !== null ? forcedIndex % API_KEYS.length : currentKeyIndex % API_KEYS.length;
  currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
  const key = API_KEYS[idx];
  return {
    client: new GoogleGenAI({ apiKey: key }),
    keyIndex: idx,
    keyMasked: key.slice(0, 6) + "..." + key.slice(-4),
  };
}

// Retries across keys if a rate-limit (429), quota exhaustion, or server busy (503) occurs
async function withKeyFailover(operation) {
  const totalKeys = Math.max(1, API_KEYS.length);
  let lastError = null;

  for (let attempt = 0; attempt < totalKeys; attempt++) {
    const { client, keyIndex: kIdx, keyMasked } = getAIClient();
    try {
      return await operation(client);
    } catch (err) {
      lastError = err;
      const isRateOrTransient = RETRYABLE.test(err.message);
      console.warn(`[KeyPool] Key ${kIdx + 1}/${totalKeys} (${keyMasked}) error: ${err.message.slice(0, 120)}`);
      if (isRateOrTransient && attempt < totalKeys - 1) {
        console.log(`[KeyPool] Rate limit/busy detected. Automatically switching to key ${((kIdx + 1) % totalKeys) + 1}...`);
        continue;
      }
      if (!isRateOrTransient) break;
    }
  }
  throw lastError;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "35mb" }));
app.use(express.urlencoded({ limit: "35mb", extended: true }));

const SYSTEM = `You are the Yala Maha assistant for Sri Lankan farmers and irrigation officers.
Help with paddy cultivation, Yala/Maha seasons, reservoir levels, flood alerts and farmer registration.
Reply in the user's language (Sinhala, Tamil or English). Keep answers short and practical.
Write plain text for a phone chat bubble: no Markdown, no asterisks or headings; use short lines or "-" for lists.`;

// Tried in order: when Gemini is overloaded (503), rate-limited (429), retires a model (404) or times out,
// the next model answers instead of the farmer seeing an error.
const CHAT_MODELS = [...new Set([
  process.env.GEMINI_CHAT_MODEL || "gemini-3.5-flash",
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
  "gemini-flash-lite-latest",
])];
const RETRYABLE = /\b(429|500|503|504|404)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|NOT_FOUND|overloaded|high demand|timed? ?out|abort/i;

const TTS_MODELS = [...new Set([
  process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts",
  "gemini-3.8-flash-lite-tts",
  "gemini-2.5-flash-preview-tts",
])];

function extractBase64Data(raw) {
  if (!raw || typeof raw !== "string") return "";
  const idx = raw.indexOf(";base64,");
  if (idx !== -1) return raw.slice(idx + 8);
  const prefixMatch = raw.match(/^data:[^,]+,/);
  if (prefixMatch) return raw.slice(prefixMatch[0].length);
  return raw.trim();
}

// POST /chat { message, history?: [{role:"user"|"model", text}] }
app.post("/chat", async (req, res) => {
  const { message, history = [] } = req.body || {};
  if (!message) return res.status(400).json({ error: "message required" });

  const turns = history
    .filter((h) => (h.role === "user" || h.role === "model") && typeof h.text === "string" && h.text.trim())
    .slice(-12);
  while (turns.length && turns[0].role !== "user") turns.shift();
  const contents = [
    ...turns.map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
    { role: "user", parts: [{ text: message }] },
  ];

  try {
    const result = await withKeyFailover(async (ai) => {
      let lastErr;
      for (const model of CHAT_MODELS) {
        try {
          const r = await ai.models.generateContent({
            model,
            contents,
            config: { systemInstruction: SYSTEM, httpOptions: { timeout: 25000 } },
          });
          if (r.text) return { reply: r.text, model };
          lastErr = new Error("empty reply");
        } catch (e) {
          lastErr = e;
          if (!RETRYABLE.test(e.message)) throw e;
        }
      }
      throw lastErr;
    });

    res.json(result);
  } catch (e) {
    console.error("All chat attempts failed:", e.message);
    res.status(503).json({ error: "busy", detail: e.message });
  }
});

// POST /transcribe { audio (base64), mimeType? } -> { transcript, language, english }
app.post("/transcribe", async (req, res) => {
  const { audio, mimeType = "audio/webm" } = req.body || {};
  if (!audio) return res.status(400).json({ error: "audio (base64) required" });

  const cleanMime = (mimeType || "audio/webm").split(";")[0].trim();
  const audioPart = {
    inlineData: {
      mimeType: cleanMime,
      data: extractBase64Data(audio),
    },
  };

  try {
    const data = await withKeyFailover(async (ai) => {
      let lastErr;
      for (const model of CHAT_MODELS) {
        try {
          const r = await ai.models.generateContent({
            model,
            contents: [
              {
                role: "user",
                parts: [
                  audioPart,
                  {
                    text: `You are an accurate multilingual speech transcriber for Sri Lanka (Sinhala, Tamil, English).
Transcribe what is spoken accurately in its original script.
Output JSON:
{
  "transcript": "exact transcription in Sinhala/Tamil/English script",
  "language": "si" | "ta" | "en",
  "english": "English translation if Sinhala or Tamil, otherwise same"
}`,
                  },
                ],
              },
            ],
            config: {
              responseMimeType: "application/json",
              httpOptions: { timeout: 35000 },
            },
          });
          return JSON.parse(r.text);
        } catch (e) {
          lastErr = e;
          if (!RETRYABLE.test(e.message)) throw e;
        }
      }
      throw lastErr;
    });

    res.json(data);
  } catch (e) {
    console.error("Transcribe failed:", e.message);
    res.status(503).json({ error: "transcribe failed", detail: e.message });
  }
});

// POST /translate { text, targetLang } -> { translated, targetLang }
app.post("/translate", async (req, res) => {
  const { text, targetLang = "en" } = req.body || {};
  if (!text) return res.status(400).json({ error: "text required" });

  const targetNames = { si: "Sinhala", ta: "Tamil", en: "English" };
  const targetName = targetNames[targetLang] || targetLang;

  try {
    const result = await withKeyFailover(async (ai) => {
      let lastErr;
      for (const model of CHAT_MODELS) {
        try {
          const r = await ai.models.generateContent({
            model,
            contents: `Translate the following text into ${targetName}.
Keep Sri Lankan agricultural, water, and weather terms natural and accurate.
Return ONLY the direct translation, nothing else.

Text to translate:
${text}`,
            config: { httpOptions: { timeout: 20000 } },
          });
          if (r.text) return { translated: r.text.trim(), targetLang };
          lastErr = new Error("empty translation");
        } catch (e) {
          lastErr = e;
          if (!RETRYABLE.test(e.message)) throw e;
        }
      }
      throw lastErr;
    });

    res.json(result);
  } catch (e) {
    console.error("Translate failed:", e.message);
    res.status(503).json({ error: "translate failed", detail: e.message });
  }
});

// POST /voice-chat { audio (base64), mimeType?, history?: [], voice? }
app.post("/voice-chat", async (req, res) => {
  const { audio, mimeType = "audio/webm", history = [], voice = "Kore" } = req.body || {};
  if (!audio) return res.status(400).json({ error: "audio required" });

  const cleanMime = (mimeType || "audio/webm").split(";")[0].trim();
  const audioPart = {
    inlineData: {
      mimeType: cleanMime,
      data: extractBase64Data(audio),
    },
  };

  try {
    const result = await withKeyFailover(async (ai) => {
      let lastErr;
      for (const model of CHAT_MODELS) {
        try {
          const r = await ai.models.generateContent({
            model,
            contents: [
              {
                role: "user",
                parts: [
                  audioPart,
                  {
                    text: `${SYSTEM}
The user is speaking to you in the attached voice recording.
1. Transcribe what the user said (heard).
2. Answer practically in the user's spoken language (Sinhala, Tamil, or English).
Keep answer short (1-2 sentences), suitable to be spoken aloud.
Output JSON:
{
  "heard": "exact words spoken by user in original script",
  "reply": "your direct answer in the same language",
  "language": "si" | "ta" | "en"
}`,
                  },
                ],
              },
            ],
            config: {
              responseMimeType: "application/json",
              httpOptions: { timeout: 40000 },
            },
          });

          const parsed = JSON.parse(r.text);
          if (!parsed.reply) throw new Error("empty reply");

          // Generate TTS
          let audioWavBase64 = null;
          for (const ttsModel of TTS_MODELS) {
            try {
              const ttsRes = await ai.models.generateContent({
                model: ttsModel,
                contents: [{ parts: [{ text: parsed.reply }] }],
                config: {
                  responseModalities: ["AUDIO"],
                  speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
                  httpOptions: { timeout: 30000 },
                },
              });
              const inline = ttsRes.candidates?.[0]?.content?.parts?.[0]?.inlineData;
              if (inline?.data) {
                const rawBytes = Buffer.from(inline.data, "base64");
                const wavBytes = /wav/i.test(inline.mimeType || "") ? rawBytes : pcmToWav(rawBytes, 24000);
                audioWavBase64 = wavBytes.toString("base64");
                break;
              }
            } catch (ttsErr) {
              console.warn(`TTS with ${ttsModel} failed:`, ttsErr.message);
            }
          }

          return {
            heard: parsed.heard,
            reply: parsed.reply,
            language: parsed.language,
            audioWavBase64,
          };
        } catch (e) {
          lastErr = e;
          if (!RETRYABLE.test(e.message)) throw e;
        }
      }
      throw lastErr;
    });

    res.json(result);
  } catch (e) {
    console.error("Voice chat failed:", e.message);
    res.status(503).json({ error: "voice-chat failed", detail: e.message });
  }
});

// POST /tts { text, voice? } -> audio/wav
app.post("/tts", async (req, res) => {
  const { text, voice = "Kore" } = req.body || {};
  if (!text) return res.status(400).json({ error: "text required" });

  try {
    const audioBuffer = await withKeyFailover(async (ai) => {
      let lastErr;
      for (const model of TTS_MODELS) {
        try {
          const r = await ai.models.generateContent({
            model,
            contents: [{ parts: [{ text }] }],
            config: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
              httpOptions: { timeout: 45000 },
            },
          });
          const audio = r.candidates?.[0]?.content?.parts?.[0]?.inlineData;
          if (!audio?.data) { lastErr = new Error("no audio returned"); continue; }
          const bytes = Buffer.from(audio.data, "base64");
          if (/wav/i.test(audio.mimeType || "")) return bytes;
          const rate = Number(/rate=(\d+)/.exec(audio.mimeType || "")?.[1]) || 24000;
          return pcmToWav(bytes, rate);
        } catch (e) {
          lastErr = e;
          if (!RETRYABLE.test(e.message)) throw e;
        }
      }
      throw lastErr;
    });

    res.type("audio/wav").send(audioBuffer);
  } catch (e) {
    res.status(503).json({ error: "busy", detail: e.message });
  }
});

// Gemini TTS returns raw 16-bit PCM mono at 24 kHz; wrap it in a WAV header
function pcmToWav(pcm, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const PORT = process.env.AI_PORT || 5050;
app.listen(PORT, () => console.log(`AI assistant on http://localhost:${PORT}`));
