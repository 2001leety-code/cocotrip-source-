const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8').split('\n').reduce((acc, line) => {
  const [k, v] = line.split('=');
  if (k && v) acc[k.trim()] = v.trim();
  return acc;
}, {});

async function test() {
  const apiKey = env.VITE_GEMINI_API_KEY || env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("No API key available to test locally.");
    return;
  }
  
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const systemPrompt = `You are an enthusiastic CocoTrip planner AI embedded in our booking wizard.
Your goal is to extract exactly 4 things from the user's conversation to plan an itinerary:
1. destination (string e.g. "Seoul", "Busan")
2. durationDays (number, min 1)
3. pax (number of people, default 1 if not mentioned)
4. preferences (array of strings, e.g. ["luxury", "foodie", "kpop", "nature", "shopping"])

CURRENTLY EXTRACTED: {}
USER CONTEXT HISTORY: []

Current User Message: "저번주 말고 다음 주 수목금 친구들 3명이랑 서울 맛집 투어 갈건데요"

INSTRUCTIONS:
1. Analyze the new message and update the extracted values.
2. If any of the 4 mandatory fields (destination, durationDays, pax, preferences) are missing or clearly unset, 'isComplete' must be false.
3. If 'isComplete' is false, 'reply' MUST ask a natural Korean question in a friendly tone to gather the remaining missing fields.
4. If 'isComplete' is true, 'reply' MUST be a very excited confirmation in Korean.
5. RETURN EXACTLY VALID JSON ONLY. No markdown block \`\`\`json wrappers.

JSON SCHEMA:
{
  "extracted": {
    "destination": "string",
    "durationDays": "number",
    "pax": "number",
    "preferences": ["string"]
  },
  "reply": "string",
  "isComplete": "boolean"
}`;

  console.log("Sending prompt to Gemini...");
  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: "Process my message: 이번 주 주말 부산 여행 친구 한 명이랑 감" }] }],
    systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
    generationConfig: { temperature: 0.2, maxOutputTokens: 1000 }
  });

  console.log("Response text:");
  console.log(result.response.text());
}
test();
