const SYSTEM_PROMPT = `You are an educational financial assistant specialized in Chilean stocks listed on the Santiago Stock Exchange.
Do NOT provide financial advice.
Do NOT give direct buy/sell orders.
Provide a simulated diversified portfolio.

Constraints:
- Only Chilean stocks
- Maximum 12 stocks
- No single stock above 20%
- Avoid extreme sector concentration
- Provide:
  1) Executive summary (5 lines)
  2) Allocation table (Stock | % | Role)
  3) Risk factors specific to Chile
  4) Rebalancing suggestion
- Do NOT promise returns
- If you mention returns, use ranges with disclaimer`;

function jsonResponse(res, status, body) {
  res.status(status).json(body);
}

function validatePayload(payload) {
  const requiredFields = ["capital", "horizon", "risk", "objective"];

  for (const field of requiredFields) {
    if (!payload[field] || String(payload[field]).trim() === "") {
      return `Missing required field: ${field}`;
    }
  }

  return null;
}

function buildUserPrompt({ capital, horizon, risk, objective, constraints }) {
  const safeConstraints = constraints && constraints.trim() !== "" ? constraints.trim() : "Ninguna";

  return `Generate a clean-text simulated Chilean stock portfolio using the following inputs:
- Capital (CLP): ${capital}
- Investment horizon (years): ${horizon}
- Risk level: ${risk}
- Objective: ${objective}
- Optional constraints: ${safeConstraints}

Output language: Spanish.
Remember: educational simulation only, not financial advice.`;
}

async function requestPortfolio(userPrompt, apiKey) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.4,
      input: [
        { role: "system", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
        { role: "user", content: [{ type: "input_text", text: userPrompt }] },
      ],
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`OpenAI error (${response.status}): ${details}`);
  }

  const data = await response.json();
  return data.output_text ? data.output_text.trim() : "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return jsonResponse(res, 405, { error: "Method not allowed" });
  }

  if (!process.env.ORTO) {
    return jsonResponse(res, 500, { error: "Server misconfiguration: missing ORTO" });
  }

  try {
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const validationError = validatePayload(payload);

    if (validationError) {
      return jsonResponse(res, 400, { error: validationError });
    }

    const userPrompt = buildUserPrompt(payload);
    const result = await requestPortfolio(userPrompt, process.env.ORTO);

    if (!result) {
      return jsonResponse(res, 502, { error: "Empty response from model" });
    }

    return jsonResponse(res, 200, { result });
  } catch (error) {
    return jsonResponse(res, 500, { error: "Failed to generate simulation" });
  }
}
