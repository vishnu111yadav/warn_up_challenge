/* ─────────────────────────────────────────────
   ChefAI · app.js
   Gemini Flash API integration + rendering
   ───────────────────────────────────────────── */

"use strict";

// ── DOM References ──────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const apiKeyInput     = $('api-key');
const toggleKeyBtn    = $('toggle-key');
const dayDescInput    = $('day-description');
const charCountEl     = $('char-count');
const dietarySelect   = $('dietary');
const servingsInput   = $('servings');
const budgetInput     = $('budget');
const cuisineSelect   = $('cuisine');
const generateBtn     = $('generate-btn');
const errorMsg        = $('error-msg');
const outputSection   = $('output');
const skeletonSection = $('skeleton');
const voiceBtn        = $('voice-btn');
const voiceLabel      = $('voice-label');
const regenBtn        = $('regen-btn');
const copyAllBtn      = $('copy-all-btn');
const copyGroceryBtn  = $('copy-grocery');
const toastEl         = $('toast');

// ── Gemini API Config ───────────────────────────────────────────────────────
const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_URL = (key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;

// ── State ───────────────────────────────────────────────────────────────────
let lastPlanData    = null;
let speechRecognition = null;
let isListening     = false;

// ── Init: restore persisted API key ─────────────────────────────────────────
(function restoreApiKey() {
  const saved = localStorage.getItem('chefai_apikey');
  if (saved) {
    apiKeyInput.value = saved;
    $('api-key-hint').textContent = '🔒 Key loaded from browser storage. Never sent to any server.';
  }
})();

// Persist API key on change
apiKeyInput.addEventListener('input', () => {
  const val = apiKeyInput.value.trim();
  if (val) localStorage.setItem('chefai_apikey', val);
  else     localStorage.removeItem('chefai_apikey');
});

// ── Event Listeners ─────────────────────────────────────────────────────────

// Character counter
dayDescInput.addEventListener("input", () => {
  const len = dayDescInput.value.length;
  charCountEl.textContent = `${len} / 600`;
  charCountEl.style.color = len > 550 ? "#f87171" : "";
});

// Toggle API key visibility
toggleKeyBtn.addEventListener("click", () => {
  const isHidden = apiKeyInput.type === "password";
  apiKeyInput.type = isHidden ? "text" : "password";
  toggleKeyBtn.textContent = isHidden ? "🙈" : "👁";
  toggleKeyBtn.setAttribute(
    "aria-label",
    isHidden ? "Hide API key" : "Show API key",
  );
});

// Generate plan
generateBtn.addEventListener("click", handleGenerate);

// Regenerate
regenBtn.addEventListener("click", handleGenerate);

// Copy grocery list
copyGroceryBtn.addEventListener("click", () => {
  if (!lastPlanData) return;
  const text = lastPlanData.groceryList
    .map((g) => `• ${g.item} — ${g.quantity} (≈ ₹${g.estimatedCost})`)
    .join("\n");
  copyToClipboard("🛒 Grocery List\n\n" + text, "Grocery list copied!");
});

// Copy full plan
copyAllBtn.addEventListener('click', () => {
  if (!lastPlanData) return;
  copyToClipboard(buildFullPlanText(lastPlanData), 'Full plan copied!');
});

// ── Voice Input ──────────────────────────────────────────────────────────────
(function initVoice() {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    voiceBtn.title = 'Voice input not supported in this browser';
    voiceBtn.style.opacity = '0.35';
    voiceBtn.style.cursor  = 'not-allowed';
    return;
  }

  speechRecognition = new SpeechRecognition();
  speechRecognition.continuous      = false;
  speechRecognition.interimResults  = true;
  speechRecognition.lang            = 'en-IN';
  speechRecognition.maxAlternatives = 1;

  speechRecognition.onstart = () => {
    isListening = true;
    voiceBtn.classList.add('listening');
    voiceLabel.textContent = 'Listening…';
    voiceBtn.setAttribute('aria-label', 'Stop listening');
  };

  speechRecognition.onresult = (e) => {
    let transcript = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      transcript += e.results[i][0].transcript;
    }
    dayDescInput.value = transcript;
    // Update char counter
    charCountEl.textContent = `${transcript.length} / 600`;
  };

  speechRecognition.onend = () => {
    isListening = false;
    voiceBtn.classList.remove('listening');
    voiceLabel.textContent = 'Speak';
    voiceBtn.setAttribute('aria-label', 'Use voice input');
    if (dayDescInput.value.trim()) {
      showToast('🎤 Voice captured! Review and hit Generate.');
    }
  };

  speechRecognition.onerror = (e) => {
    isListening = false;
    voiceBtn.classList.remove('listening');
    voiceLabel.textContent = 'Speak';
    const msgs = {
      'not-allowed': 'Microphone access denied. Allow mic in browser settings.',
      'no-speech':   'No speech detected. Try again.',
      'network':     'Network error during voice recognition.',
    };
    showToast(`⚠️ ${msgs[e.error] || 'Voice error. Try again.'}`);
  };

  voiceBtn.addEventListener('click', () => {
    if (isListening) {
      speechRecognition.stop();
    } else {
      dayDescInput.value = '';
      charCountEl.textContent = '0 / 600';
      speechRecognition.start();
    }
  });
})();

// ── Main Handler ─────────────────────────────────────────────────────────────
async function handleGenerate() {
  const apiKey = apiKeyInput.value.trim();
  const dayDesc = dayDescInput.value.trim();

  // ── Validation ──
  if (!apiKey) return showError('Please enter your Gemini API key.');
  if (!dayDesc)
    return showError('Please describe your day so I can personalize your meal plan.');
  if (dayDesc.length < 10)
    return showError('Give me a bit more detail about your day (at least 10 characters).');

  clearError();
  setLoading(true);

  try {
    const prompt   = buildPrompt();
    const response = await callGemini(apiKey, prompt);
    const plan     = parseGeminiResponse(response);
    lastPlanData   = plan;
    renderPlan(plan);
  } catch (err) {
    console.error('[ChefAI] Error:', err);
    showError(err.message || 'Something went wrong. Please try again.');
    outputSection.hidden   = true;
    skeletonSection.hidden = true;
  } finally {
    setLoading(false);
  }
}

// ── Prompt Engineering ────────────────────────────────────────────────────────
function buildPrompt() {
  const dietary = dietarySelect.value;
  const servings = servingsInput.value || 2;
  const budget = budgetInput.value ? `₹${budgetInput.value}` : "flexible";
  const cuisine = cuisineSelect.value;
  const dayDesc = dayDescInput.value.trim();

  return `
You are an expert personal chef and nutritionist.

A user has described their day and wants a PERSONALIZED cooking to-do list that fits their actual schedule and lifestyle — not just generic meal suggestions.

## User Context
- **Their Day:** "${dayDesc}"
- **Dietary Preference:** ${dietary === "none" ? "No restrictions" : dietary}
- **Servings:** ${servings} person(s)
- **Budget:** ${budget}
- **Cuisine Preference:** ${
    cuisine === "any" ? "Any / open to suggestions" : cuisine
  }

## Your Task
Analyze their day carefully:
- If they are busy in the morning → suggest quick/minimal-cook breakfast
- If they mention guests or a special occasion → suggest an impressive dinner
- If they have physical activity → suggest higher protein meals around it
- If their budget is tight → suggest budget-friendly ingredients

Return ONLY a single valid JSON object — no markdown, no explanation, no code fences.

Use this exact JSON structure:
{
  "meals": {
    "breakfast": {
      "name": "Dish Name",
      "description": "1-2 sentence description tailored to their morning",
      "cookTime": "10 min",
      "difficulty": "Easy"
    },
    "lunch": {
      "name": "Dish Name",
      "description": "1-2 sentence description tailored to their afternoon",
      "cookTime": "20 min",
      "difficulty": "Medium"
    },
    "dinner": {
      "name": "Dish Name",
      "description": "1-2 sentence description tailored to their evening",
      "cookTime": "35 min",
      "difficulty": "Medium"
    }
  },
  "groceryList": [
    { "item": "Ingredient Name", "quantity": "2 units", "estimatedCost": 40 }
  ],
  "substitutions": [
    { "original": "Original Ingredient", "substitute": "Better Alternative", "reason": "Why this swap works" }
  ],
  "budget": {
    "estimatedTotal": 380,
    "isWithinBudget": true,
    "verdict": "Your meal plan fits within ₹500 with ₹120 to spare!",
    "tips": "Practical tip to save more money while cooking these meals."
  }
}

Rules:
- estimatedCost for each grocery item must be a number (no currency symbol)
- estimatedTotal must be a number
- Provide 6-12 grocery items covering all 3 meals for ${servings} person(s)
- Provide exactly 3 substitutions
- difficulty must be one of: Easy, Medium, Hard
- Keep descriptions warm, encouraging, and specific to their described day
`.trim();
}

// ── Gemini API Call ───────────────────────────────────────────────────────────
async function callGemini(apiKey, prompt) {
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      topP: 0.9,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    ],
  };

  const res = await fetch(GEMINI_URL(apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const message = errData?.error?.message || `API error (${res.status})`;
    if (res.status === 400)
      throw new Error("Invalid API key or request. Check your Gemini API key.");
    if (res.status === 429)
      throw new Error("Rate limit reached. Wait a moment and try again.");
    throw new Error(message);
  }

  return res.json();
}

// ── Parse Gemini Response ─────────────────────────────────────────────────────
function parseGeminiResponse(response) {
  try {
    const rawText = response?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText)
      throw new Error("Empty response from Gemini. Please try again.");

    // Strip markdown fences if present (defensive)
    const cleaned = rawText.replace(/```(?:json)?/g, "").trim();
    const parsed = JSON.parse(cleaned);

    // Validate required keys
    if (
      !parsed.meals ||
      !parsed.groceryList ||
      !parsed.substitutions ||
      !parsed.budget
    ) {
      throw new Error("Unexpected response structure. Please try again.");
    }
    return parsed;
  } catch (e) {
    if (e.message.includes("JSON")) {
      throw new Error("Could not parse the AI response. Try regenerating.");
    }
    throw e;
  }
}

// ── Render ─────────────────────────────────────────────────────────────────────
function renderPlan(plan) {
  renderBudget(plan.budget);
  renderMeals(plan.meals);
  renderGroceryList(plan.groceryList);
  renderSubstitutions(plan.substitutions);
  renderTips(plan.budget.tips);

  outputSection.hidden = false;
  outputSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Budget banner
function renderBudget(budget) {
  const banner = $("budget-banner");
  const iconWrap = $("budget-icon-wrap");
  const verdictEl = $("budget-verdict");
  const detailEl = $("budget-detail");
  const amountEl = $("budget-estimated");
  const userBudget = parseFloat(budgetInput.value) || null;

  const within = budget.isWithinBudget;

  banner.classList.toggle("within", within);
  banner.classList.toggle("over", !within);
  iconWrap.textContent = within ? "✅" : "⚠️";

  verdictEl.textContent = within ? "✅ Within Budget!" : "⚠️ Over Budget";
  verdictEl.style.color = within ? "var(--success)" : "var(--danger)";
  detailEl.textContent = budget.verdict;

  const total =
    typeof budget.estimatedTotal === "number"
      ? budget.estimatedTotal
      : parseFloat(budget.estimatedTotal) || 0;

  amountEl.textContent = `₹${total.toFixed(0)}`;
  amountEl.style.color = within ? "var(--success)" : "var(--danger)";
}

// Meal cards
function renderMeals(meals) {
  const times = ["breakfast", "lunch", "dinner"];
  times.forEach((time) => {
    const meal = meals[time];
    if (!meal) return;
    $(`${time}-name`).textContent = meal.name || "—";
    $(`${time}-desc`).textContent = meal.description || "";
    $(`${time}-time`).textContent = `⏱ ${meal.cookTime || "N/A"}`;
    $(`${time}-diff`).textContent = meal.difficulty || "Easy";
  });
}

// Grocery list
function renderGroceryList(groceryList) {
  const ul = $("grocery-list");
  ul.innerHTML = "";

  groceryList.forEach((item, i) => {
    const cost =
      typeof item.estimatedCost === "number"
        ? item.estimatedCost
        : parseFloat(item.estimatedCost) || 0;

    const li = document.createElement("li");
    li.className = "grocery-item";
    li.setAttribute("role", "listitem");
    li.id = `grocery-item-${i}`;

    li.innerHTML = `
      <input type="checkbox" id="chk-${i}" aria-label="Mark ${
      item.item
    } as bought" />
      <label for="chk-${i}" class="grocery-name">${escHtml(item.item)}</label>
      <span class="grocery-qty">${escHtml(item.quantity || "")}</span>
      <span class="grocery-cost">₹${cost}</span>
    `;

    li.querySelector("input").addEventListener("change", (e) => {
      li.classList.toggle("checked", e.target.checked);
    });

    ul.appendChild(li);
  });
}

// Substitutions
function renderSubstitutions(substitutions) {
  const container = $("substitutions-list");
  container.innerHTML = "";

  substitutions.forEach((sub) => {
    const div = document.createElement("div");
    div.className = "sub-item";
    div.setAttribute("role", "listitem");
    div.innerHTML = `
      <div class="sub-row">
        <span class="sub-original">${escHtml(sub.original)}</span>
        <span class="sub-arrow">→</span>
        <span class="sub-replacement">${escHtml(sub.substitute)}</span>
      </div>
      <p class="sub-reason">${escHtml(sub.reason)}</p>
    `;
    container.appendChild(div);
  });
}

// Budget tips
function renderTips(tips) {
  $("budget-tips").textContent = tips || "No additional tips at this time.";
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function setLoading(on) {
  const btnText   = generateBtn.querySelector('.btn-text');
  const btnLoader = generateBtn.querySelector('.btn-loader');
  generateBtn.disabled   = on;
  btnText.hidden         = on;
  btnLoader.hidden       = !on;
  regenBtn.disabled      = on;

  // Show/hide skeleton
  skeletonSection.hidden = !on;
  if (on) {
    outputSection.hidden = true;
    skeletonSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function showError(msg) {
  errorMsg.textContent = `⚠️ ${msg}`;
  errorMsg.hidden = false;
  errorMsg.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function clearError() {
  errorMsg.hidden = true;
  errorMsg.textContent = "";
}

function scrollToOutput() {
  if (outputSection && !outputSection.hidden) {
    outputSection.scrollIntoView({ behavior: "smooth" });
  }
}

function showToast(message, duration = 2500) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), duration);
}

async function copyToClipboard(text, successMsg = "Copied!") {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`✅ ${successMsg}`);
  } catch {
    showToast("❌ Could not copy. Try manually.");
  }
}

function escHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildFullPlanText(plan) {
  const m = plan.meals;
  const lines = [
    "🍳 ChefAI — My Personal Meal Plan",
    "══════════════════════════════════",
    "",
    `🌅 BREAKFAST: ${m.breakfast?.name}`,
    m.breakfast?.description,
    `⏱ ${m.breakfast?.cookTime}  |  ${m.breakfast?.difficulty}`,
    "",
    `☀️ LUNCH: ${m.lunch?.name}`,
    m.lunch?.description,
    `⏱ ${m.lunch?.cookTime}  |  ${m.lunch?.difficulty}`,
    "",
    `🌙 DINNER: ${m.dinner?.name}`,
    m.dinner?.description,
    `⏱ ${m.dinner?.cookTime}  |  ${m.dinner?.difficulty}`,
    "",
    "══════════════════════════════════",
    "🛒 GROCERY LIST",
    ...plan.groceryList.map(
      (g) => `• ${g.item} — ${g.quantity} (≈ ₹${g.estimatedCost})`,
    ),
    "",
    "══════════════════════════════════",
    "🔄 SUBSTITUTIONS",
    ...plan.substitutions.map(
      (s) => `• ${s.original} → ${s.substitute}: ${s.reason}`,
    ),
    "",
    "══════════════════════════════════",
    `💰 BUDGET: ₹${plan.budget.estimatedTotal} estimated`,
    plan.budget.verdict,
    `💡 Tip: ${plan.budget.tips}`,
    "",
    "Generated by ChefAI · Powered by Gemini Flash",
  ];
  return lines.join("\n");
}
