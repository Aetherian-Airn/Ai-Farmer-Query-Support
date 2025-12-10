// server.js
const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const fetch = require("node-fetch"); // ✅ ADD THIS
const app = express();

// TODO: put your real MongoDB connection string here:
const MONGO_URL = "mongodb://localhost:27017/";
// TODO: put your real Gemini API key here:
const GEMINI_API_KEY = "AIzaSyCAZY7ZCyh3cVYe9HLik6gpmdr30Yx0B3Y";

// --- MongoDB connection ---
mongoose
  .connect(MONGO_URL)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("MongoDB error:", err));

// --- Schema + model ---
const querySchema = new mongoose.Schema(
  {
    name: String,
    phone: String,
    location: String,
    soilType: String,
    crop: String,
    issueType: String,
    description: String,
    language: { type: String, default: "english" }, // english / hindi / other
    rating: {
      type: String,
      enum: ["poor", "bad", "ok", "good", "excellent", null],
      default: null,
    },
  },
  { timestamps: true }
);

const FarmingQuery = mongoose.model("FarmingQuery", querySchema);

// --- Middleware ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --- Routes ---

// Show the form
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "query-form.html"));
});

// Handle form submit: save + redirect to chat page
app.post("/query", async (req, res) => {
  try {
    const newQuery = new FarmingQuery(req.body);
    const saved = await newQuery.save();
    // redirect to Raghu chat page for this query
    res.redirect(`/chat/${saved._id}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error saving your query. Please try again.");
  }
});

// Chat UI page (loading screen + answer + rating)
app.get("/chat/:id", (req, res) => {
  const queryId = req.params.id;

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Raghu • AI Farming Helper</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 700px; margin: 20px auto; padding: 10px; }
    h1 { text-align: center; }
    #loading {
      padding: 20px;
      margin-top: 20px;
      border-radius: 8px;
      border: 1px dashed #888;
      text-align: center;
      font-size: 1.1rem;
    }
    #answer {
      margin-top: 20px;
      padding: 16px;
      border-radius: 8px;
      border: 1px solid #ccc;
      background: #fafafa;
      white-space: pre-wrap;
    }
    #rating-section {
      margin-top: 20px;
      display: none;
    }
    .rating-btn {
      margin: 4px;
      padding: 8px 12px;
      border-radius: 6px;
      border: 1px solid #ccc;
      cursor: pointer;
      background: #fff;
    }
    .rating-btn:hover {
      background: #f0f0f0;
    }
  </style>
</head>
<body>
  <h1>🌾 Raghu – Your Farming Assistant</h1>

  <div id="loading">
    🤖 Raghu is thinking how to help you in the most convenient and sufficient way possible…<br/>
    कृपया थोड़ी देर प्रतीक्षा करें / Please wait a few seconds…
  </div>

  <div id="answer"></div>

  <div id="rating-section">
    <p><b>Raghu:</b> Did this help you? Please rate my answer 😊</p>
    <button class="rating-btn" onclick="sendRating('poor')">Poor 😢</button>
    <button class="rating-btn" onclick="sendRating('bad')">Bad 🙁</button>
    <button class="rating-btn" onclick="sendRating('ok')">OK 😐</button>
    <button class="rating-btn" onclick="sendRating('good')">Good 🙂</button>
    <button class="rating-btn" onclick="sendRating('excellent')">Excellent 🤩</button>
  </div>

  <script>
    const queryId = '${queryId}';

    async function getAnswer() {
      const loading = document.getElementById('loading');
      const answerDiv = document.getElementById('answer');
      try {
        const res = await fetch('/api/answer/' + queryId, { method: 'POST' });
        const data = await res.json();
        loading.style.display = 'none';
        answerDiv.innerHTML = data.answer.replace(/\\n/g, '<br>');
        document.getElementById('rating-section').style.display = 'block';
      } catch (e) {
        loading.style.display = 'none';
        answerDiv.textContent = 'Sorry, there was an error getting Raghu\\'s answer.';
      }
    }

    async function sendRating(rating) {
      try {
        await fetch('/api/rating/' + queryId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating })
        });
        alert('Thank you for rating Raghu! 🌟');
      } catch (e) {
        alert('Could not save rating, please try again later.');
      }
    }

    window.onload = getAnswer;
  </script>
</body>
</html>`);
});

// --- Gemini helper function ---
async function callGemini(systemPrompt, userPrompt) {
  if (!GEMINI_API_KEY) {
    return "Gemini API key is not configured on the server. Please tell the developer to add it.";
  }

  // ✅ This is what I meant by "use v1beta like your friend"
const url =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
  GEMINI_API_KEY;

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: systemPrompt + "\n\nUSER QUERY:\n" + userPrompt,
          },
        ],
      },
    ],
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    console.log("Gemini response:", JSON.stringify(data, null, 2)); // 👀 see errors in terminal

    if (!response.ok) {
      return (
        "Raghu could not answer right now. Error from Gemini: " +
        (data.error?.message || response.statusText)
      );
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Sorry, Raghu could not generate a reply right now.";
    return text;
  } catch (err) {
    console.error("Gemini fetch error:", err);
    return "Raghu had a problem contacting the AI server. Please try again later.";
  }
}

// --- API route to get AI answer for one query ---
app.post("/api/answer/:id", async (req, res) => {
  try {
    const query = await FarmingQuery.findById(req.params.id);
    if (!query) {
      return res.status(404).json({ error: "Query not found" });
    }

    // language instruction for Raghu
    let langInstruction;
    if (query.language === "hindi") {
      langInstruction =
        "Answer ONLY in very simple Hindi, using everyday farmer language. Even if the user types in English, always reply only in Hindi for this query.";
    } else {
      langInstruction =
        "Answer ONLY in very simple English. Even if the user mixes Hindi or other languages, always reply only in English for this query.";
    }

    // backend/system prompt – only creators see this
    const systemPrompt = `
You are "Raghu", a friendly AI assistant that helps Indian farmers with crop and soil problems. 🧑‍🌾🤖

${langInstruction}

STYLE RULES (MUST FOLLOW STRICTLY):
- Be very polite, supportive and encouraging. Use a few relevant emojis (but not too many).
- First give a SHORT, clear paragraph answer.
- Then give the rest of the answer in:
  1) A bullet list of main points / steps
  2) A bullet list of pros/benefits (prefix items with "✅")
  3) A bullet list of cautions/risks (prefix items with "⚠️")
- Always keep the language simple, easy to understand by a normal farmer.
- Use only information related to the user’s query (crop, soil type, issue, location). Do NOT change the topic.
- If the user later asks about something completely different, gently bring them back to the original crop/problem.

CONTEXT:
You will get data that was saved from a form: farmer name, location, soil type, crop, issue type, problem description.
Use that information to give practical advice (what to check, what to do now, any sprays/fertilizers/irrigation tips, when to contact a local expert etc.).
`;

    // build user prompt from saved query data
    const userPrompt = `
Farmer name: ${query.name}
Phone: ${query.phone}
Location: ${query.location}
Soil type: ${query.soilType}
Crop: ${query.crop}
Issue type: ${query.issueType}
Problem description: ${query.description}

Now give your advice following ALL the style rules.
`;

    const answer = await callGemini(systemPrompt, userPrompt);
    res.json({ answer });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error getting AI answer" });
  }
});

// --- Save rating route ---
app.post("/api/rating/:id", async (req, res) => {
  try {
    const { rating } = req.body;
    await FarmingQuery.findByIdAndUpdate(req.params.id, { rating });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error saving rating" });
  }
});

// --- Start server ---
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
