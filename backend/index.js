const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

loadEnvFile(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 3001);

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    let val = line.slice(eqIndex + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = val;
    }
  }
}

function getProviderStatus() {
  const hasGemini = Boolean(process.env.GEMINI_API_KEY);
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
  const hasStability = Boolean(process.env.STABILITY_API_KEY);
  const hasHF = Boolean(process.env.HF_API_KEY);
  const hasPinata = Boolean(process.env.PINATA_JWT);

  return {
    chat: hasGemini ? "gemini" : hasOpenAI ? "openai" : "built-in-assistant",
    image: hasGemini
      ? "gemini-image"
      : hasOpenAI
      ? "openai"
      : hasStability
      ? "stability"
      : hasHF
      ? "huggingface"
      : "procedural-svg",
    ipfs: hasPinata ? "pinata" : "local-preview",
  };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req, maxBytes = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Request payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

const SYSTEM_PROMPT = `You are EzyNFT, a friendly Web3 & NFT creation co-pilot built on NEAR Protocol.
Your job is to help beginners:
1. Understand Web3, NEAR wallets, gas/storage deposits, and IPFS simply.
2. Co-create an NFT from natural language.

When the user asks to create/draw/generate/mint an artwork or describes visual art, respond concisely AND include a JSON block at the end wrapped in <nft_draft>...</nft_draft> with:
{
  "shouldGenerateImage": true,
  "title": "Short evocative NFT title",
  "description": "1-2 sentence NFT description",
  "imagePrompt": "Detailed visual prompt for an AI image generator",
  "style": "e.g. Cyberpunk, Watercolor, 3D Render, Pixel Art"
}
If the user is only asking a question (e.g. "what is IPFS?", "how does NEAR minting work?"), answer clearly in 2-4 sentences without <nft_draft>.`;

function extractDraftTag(text) {
  const match = text.match(/<nft_draft>\s*([\s\S]*?)\s*<\/nft_draft>/i);
  if (!match) return { cleanText: text.trim(), draft: null };
  const cleanText = text.replace(match[0], "").trim();
  try {
    const parsed = JSON.parse(match[1]);
    return { cleanText, draft: parsed };
  } catch {
    return { cleanText, draft: null };
  }
}

async function callGeminiChat(messages, accountId) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: `${SYSTEM_PROMPT}\nConnected NEAR wallet: ${
                accountId || "guest"
              }`,
            },
          ],
        },
        contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: 512 },
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini error (${response.status}): ${errText}`);
  }
  const data = await response.json();
  const rawText =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    "I'm ready to help you create your NFT!";
  return extractDraftTag(rawText);
}

async function callOpenAIChat(messages, accountId) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      max_tokens: 512,
      messages: [
        {
          role: "system",
          content: `${SYSTEM_PROMPT}\nConnected NEAR wallet: ${
            accountId || "guest"
          }`,
        },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI error (${response.status}): ${errText}`);
  }
  const data = await response.json();
  const rawText =
    data?.choices?.[0]?.message?.content ||
    "I'm ready to help you create your NFT!";
  return extractDraftTag(rawText);
}

function builtInAssistantReply(messages, accountId) {
  const lastMsg =
    [...messages].reverse().find((m) => m.role === "user")?.content || "";
  const lower = lastMsg.toLowerCase();

  if (
    lower.includes("what is ipfs") ||
    lower.includes("ipfs") && !lower.includes("mint") && !lower.includes("create")
  ) {
    return {
      cleanText:
        "IPFS (InterPlanetary File System) stores your NFT's artwork and metadata on a decentralized network identified by a cryptographic Content ID (CID), rather than a mutable web link. In EzyNFT, once you generate art, you can pin it to IPFS before minting it to your NEAR wallet.",
      draft: null,
    };
  }

  if (
    lower.includes("how") &&
    (lower.includes("mint") || lower.includes("near") || lower.includes("gas"))
  ) {
    return {
      cleanText:
        "Minting on NEAR creates a permanent NEP-171 token record inside the EzyNFT smart contract owned by your wallet (" +
        (accountId || "your NEAR account") +
        "). You attach a tiny storage deposit (~0.02–0.05 NEAR, with any excess refunded automatically by the contract) and sign once in your wallet!",
      draft: null,
    };
  }

  const wantsArt =
    /create|generate|draw|paint|make|design|mint|art|nft|cyber|dragon|space|cat|lotus|neon|portrait|landscape/i.test(
      lastMsg
    );

  if (wantsArt && lastMsg.trim().length > 3) {
    const cleanedSubject = lastMsg
      .replace(/^(please\s+)?(create|generate|draw|paint|make|design|mint)\s+(me\s+)?(an?\s+)?(nft\s+(of|about)\s+)?/i, "")
      .trim();
    const subject = cleanedSubject || "Cosmic NEAR Phoenix";
    const title = subject
      .split(/\s+/)
      .slice(0, 4)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

    return {
      cleanText: `Awesome idea! I've drafted "${title}" and generated artwork for your preview card. You can tweak the title, description, pin to IPFS, and mint it on NEAR whenever you're ready.`,
      draft: {
        shouldGenerateImage: true,
        title,
        description: `Co-created in EzyNFT Studio from prompt: "${subject}"`,
        imagePrompt: `${subject}, vibrant digital collectible artwork, crisp lighting, rich detail`,
        style: "Digital Collectible",
      },
    };
  }

  return {
    cleanText:
      `Welcome ${accountId ? accountId : "creator"}! Tell me what kind of NFT you'd like to create (for example: "Create a neon cyberpunk lotus floating over Tokyo"), or ask me anything about NEAR, IPFS, or gas fees.`,
    draft: null,
  };
}

async function generateImageWithOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size: "1024x1024",
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI Image error (${response.status}): ${await response.text()}`);
  }
  const data = await response.json();
  let b64 = data?.data?.[0]?.b64_json;
  if (!b64 && data?.data?.[0]?.url) {
    const imgRes = await fetch(data.data[0].url);
    if (!imgRes.ok) throw new Error("Failed to download OpenAI image URL");
    b64 = Buffer.from(await imgRes.arrayBuffer()).toString("base64");
  }
  if (!b64) throw new Error("OpenAI returned no image data");
  return {
    imageDataUrl: `data:image/png;base64,${b64}`,
    mimeType: "image/png",
    provider: `openai:${model}`,
  };
}

async function generateImageWithStability(prompt) {
  const apiKey = process.env.STABILITY_API_KEY;
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("output_format", "png");
  const response = await fetch(
    "https://api.stability.ai/v2beta/stable-image/generate/core",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      body: form,
    }
  );
  if (!response.ok) {
    throw new Error(`Stability error (${response.status}): ${await response.text()}`);
  }
  const data = await response.json();
  if (!data?.image) throw new Error("Stability returned no image");
  return {
    imageDataUrl: `data:image/png;base64,${data.image}`,
    mimeType: "image/png",
    provider: "stability:core",
  };
}

async function generateImageWithHuggingFace(prompt) {
  const apiKey = process.env.HF_API_KEY;
  const providerPath =
    process.env.HF_IMAGE_ENDPOINT || "fal-ai/fal-ai/flux/schnell";
  const response = await fetch(
    `https://router.huggingface.co/${providerPath}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt }),
    }
  );
  if (!response.ok) {
    throw new Error(`Hugging Face error (${response.status}): ${await response.text()}`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const json = await response.json();
    const imgUrl = json?.images?.[0]?.url || json?.url;
    if (!imgUrl) throw new Error("Hugging Face returned no image URL");
    const imgRes = await fetch(imgUrl);
    if (!imgRes.ok) throw new Error("Failed to download Hugging Face image");
    const b64 = Buffer.from(await imgRes.arrayBuffer()).toString("base64");
    return {
      imageDataUrl: `data:image/png;base64,${b64}`,
      mimeType: "image/png",
      provider: `huggingface:${providerPath}`,
    };
  }
  const arrayBuffer = await response.arrayBuffer();
  const b64 = Buffer.from(arrayBuffer).toString("base64");
  return {
    imageDataUrl: `data:image/png;base64,${b64}`,
    mimeType: "image/png",
    provider: `huggingface:${providerPath}`,
  };
}

async function generateImageWithGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: `Create a high-quality NFT artwork: ${prompt}` }],
          },
        ],
        generationConfig: {
          responseModalities: ["IMAGE", "TEXT"],
        },
      }),
    }
  );
  if (!response.ok) {
    throw new Error(`Gemini Image error (${response.status}): ${await response.text()}`);
  }
  const data = await response.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData?.data);
  if (!imagePart) {
    throw new Error("Gemini returned no image data");
  }
  const mimeType = imagePart.inlineData.mimeType || "image/png";
  return {
    imageDataUrl: `data:${mimeType};base64,${imagePart.inlineData.data}`,
    mimeType,
    provider: `gemini:${model}`,
  };
}

function generateProceduralSvgArt(prompt, style = "Digital Art") {
  const hash = crypto.createHash("sha256").update(prompt + style).digest();
  const hue1 = (hash[0] * 360) / 255;
  const hue2 = (hue1 + 55 + (hash[1] % 90)) % 360;
  const hue3 = (hue2 + 110) % 360;

  let shapes = "";
  for (let i = 0; i < 14; i++) {
    const b1 = hash[(i * 2) % hash.length];
    const b2 = hash[(i * 2 + 1) % hash.length];
    const cx = 70 + ((b1 / 255) * 372);
    const cy = 70 + ((b2 / 255) * 340);
    const r = 24 + ((b1 ^ b2) % 88);
    const opacity = (0.18 + ((b2 % 50) / 100)).toFixed(2);
    const fillHue = i % 2 === 0 ? hue2 : hue3;
    if (i % 3 === 0) {
      shapes += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}" fill="hsla(${fillHue.toFixed(0)}, 90%, 62%, ${opacity})" />`;
    } else if (i % 3 === 1) {
      shapes += `<polygon points="${cx.toFixed(1)},${(cy - r).toFixed(1)} ${(cx + r).toFixed(1)},${(cy + r * 0.8).toFixed(1)} ${(cx - r).toFixed(1)},${(cy + r * 0.8).toFixed(1)}" fill="hsla(${fillHue.toFixed(0)}, 85%, 58%, ${opacity})" />`;
    } else {
      shapes += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}" fill="none" stroke="hsla(${fillHue.toFixed(0)}, 95%, 75%, ${opacity})" stroke-width="2.5" />`;
    }
  }

  const safeLabel = prompt
    .replace(/[<>&"']/g, "")
    .slice(0, 44);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="hsl(${hue1.toFixed(0)}, 55%, 14%)"/>
      <stop offset="50%" stop-color="hsl(${hue2.toFixed(0)}, 50%, 18%)"/>
      <stop offset="100%" stop-color="hsl(${hue3.toFixed(0)}, 55%, 10%)"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="45%" r="50%">
      <stop offset="0%" stop-color="hsla(${hue2.toFixed(0)}, 95%, 68%, 0.45)"/>
      <stop offset="100%" stop-color="transparent"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <rect width="512" height="512" fill="url(#glow)"/>
  ${shapes}
  <rect x="24" y="422" width="464" height="66" rx="14" fill="rgba(12,14,20,0.72)" stroke="rgba(255,255,255,0.18)"/>
  <text x="40" y="449" font-family="Segoe UI, Arial, sans-serif" font-size="13" font-weight="700" fill="#FF585D">EZYNFT PROCEDURAL EDITION</text>
  <text x="40" y="472" font-family="Segoe UI, Arial, sans-serif" font-size="14" fill="#F4F4F6">${safeLabel}</text>
</svg>`;

  const b64 = Buffer.from(svg, "utf8").toString("base64");
  return {
    imageDataUrl: `data:image/svg+xml;base64,${b64}`,
    mimeType: "image/svg+xml",
    provider: "procedural-svg",
  };
}

async function pinToPinata({ imageDataUrl, title, description, provenance }) {
  const jwt = process.env.PINATA_JWT;
  const gateway = (
    process.env.PINATA_GATEWAY || "https://gateway.pinata.cloud/ipfs"
  ).replace(/\/$/, "");

  const match = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Expected base64 data URL for IPFS upload");
  }
  const mimeType = match[1];
  const fileBuffer = Buffer.from(match[2], "base64");
  const ext = mimeType.includes("svg")
    ? "svg"
    : mimeType.includes("jpeg")
    ? "jpg"
    : "png";

  const form = new FormData();
  const blob = new Blob([fileBuffer], { type: mimeType });
  form.append("file", blob, `ezynft-${Date.now()}.${ext}`);
  form.append("pinataMetadata", JSON.stringify({ name: `${title || "EzyNFT"} Artwork` }));

  const fileRes = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });
  if (!fileRes.ok) {
    throw new Error(`Pinata file upload failed (${fileRes.status}): ${await fileRes.text()}`);
  }
  const fileData = await fileRes.json();
  const imageCid = fileData.IpfsHash;
  const imageIpfsUri = `ipfs://${imageCid}`;
  const imageGatewayUrl = `${gateway}/${imageCid}`;

  const metadataPayload = {
    name: title,
    description,
    image: imageIpfsUri,
    external_url: imageGatewayUrl,
    attributes: [
      { trait_type: "Platform", value: "EzyNFT on NEAR" },
      { trait_type: "AI Model", value: provenance?.model || "unknown" },
      { trait_type: "Style", value: provenance?.style || "Digital Art" },
    ],
    provenance,
  };

  const jsonRes = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      pinataMetadata: { name: `${title || "EzyNFT"} Metadata` },
      pinataContent: metadataPayload,
    }),
  });
  if (!jsonRes.ok) {
    throw new Error(`Pinata JSON upload failed (${jsonRes.status}): ${await jsonRes.text()}`);
  }
  const jsonData = await jsonRes.json();
  const metadataCid = jsonData.IpfsHash;

  return {
    pinMode: "pinata",
    imageCid,
    imageIpfsUri,
    imageGatewayUrl,
    metadataCid,
    metadataIpfsUri: `ipfs://${metadataCid}`,
    metadataGatewayUrl: `${gateway}/${metadataCid}`,
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/api/status")) {
      return sendJson(res, 200, {
        ok: true,
        providers: getProviderStatus(),
      });
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      const body = await readJsonBody(req);
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const accountId = body.accountId || "";

      const chatProviders = [
        process.env.GEMINI_API_KEY
          ? { name: "gemini", fn: () => callGeminiChat(messages, accountId) }
          : null,
        process.env.OPENAI_API_KEY
          ? { name: "openai", fn: () => callOpenAIChat(messages, accountId) }
          : null,
      ].filter(Boolean);

      let result = null;
      let usedProvider = "built-in-assistant";
      for (const provider of chatProviders) {
        try {
          result = await provider.fn();
          usedProvider = provider.name;
          break;
        } catch (err) {
          console.warn(`Chat provider "${provider.name}" failed, falling back:`, err.message);
        }
      }

      if (!result) {
        result = builtInAssistantReply(messages, accountId);
      }

      return sendJson(res, 200, {
        reply: result.cleanText,
        draft: result.draft,
        provider: usedProvider,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/generate-image") {
      const body = await readJsonBody(req);
      const prompt = (body.prompt || "").trim();
      const style = (body.style || "Digital Collectible").trim();
      if (!prompt) {
        return sendJson(res, 400, { error: "Prompt is required" });
      }
      const fullPrompt = `${prompt}, ${style}`;

      const imageProviders = [
        process.env.GEMINI_API_KEY
          ? { name: "gemini-image", fn: () => generateImageWithGemini(fullPrompt) }
          : null,
        process.env.OPENAI_API_KEY
          ? { name: "openai", fn: () => generateImageWithOpenAI(fullPrompt) }
          : null,
        process.env.STABILITY_API_KEY
          ? { name: "stability", fn: () => generateImageWithStability(fullPrompt) }
          : null,
        process.env.HF_API_KEY
          ? { name: "huggingface", fn: () => generateImageWithHuggingFace(fullPrompt) }
          : null,
      ].filter(Boolean);

      let imageResult = null;
      for (const provider of imageProviders) {
        try {
          imageResult = await provider.fn();
          break;
        } catch (err) {
          console.warn(`Image provider "${provider.name}" failed, falling back:`, err.message);
        }
      }

      if (!imageResult) {
        imageResult = generateProceduralSvgArt(prompt, style);
      }

      return sendJson(res, 200, imageResult);
    }

    if (req.method === "POST" && url.pathname === "/api/pin-ipfs") {
      const body = await readJsonBody(req);
      const { imageDataUrl, title, description, provenance } = body;
      if (!imageDataUrl) {
        return sendJson(res, 400, { error: "imageDataUrl is required" });
      }

      if (process.env.PINATA_JWT) {
        const pinned = await pinToPinata({
          imageDataUrl,
          title,
          description,
          provenance,
        });
        return sendJson(res, 200, pinned);
      }

      return sendJson(res, 200, {
        pinMode: "local-preview",
        imageCid: null,
        imageIpfsUri: imageDataUrl,
        imageGatewayUrl: imageDataUrl,
        metadataCid: null,
        metadataIpfsUri: null,
        metadataGatewayUrl: null,
        message:
          "PINATA_JWT is not set in backend/.env — using direct preview URI. Add PINATA_JWT for permanent IPFS pinning.",
      });
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    console.error("API error:", err);
    sendJson(res, 500, { error: err.message || "Internal server error" });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`EzyNFT Backend listening on http://localhost:${PORT}`);
    console.log("Active providers:", getProviderStatus());
  });
}

module.exports = { server, getProviderStatus, generateProceduralSvgArt };
