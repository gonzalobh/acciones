export const config = {
  runtime: "edge",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export default async function handler(req) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const apiKey = process.env.ACCIONES;
  if (!apiKey) {
    return jsonResponse({ error: "Missing ACCIONES environment variable" }, 500);
  }

  try {
    const body = await req.json();
    const monto = body?.monto ?? body?.capital;
    const horizonte = body?.horizonte ?? body?.horizon;
    const riesgo = body?.riesgo ?? body?.risk;
    const objetivo = body?.objetivo ?? body?.objective;
    const restricciones = body?.restricciones ?? body?.constraints ?? "";

    const missingFields = [
      ["monto", monto],
      ["horizonte", horizonte],
      ["riesgo", riesgo],
      ["objetivo", objetivo],
    ]
      .filter(([, value]) => value === undefined)
      .map(([field]) => field);

    if (missingFields.length > 0) {
      return jsonResponse(
        {
          error: `Missing required fields: ${missingFields.join(", ")}`,
          missing: missingFields,
        },
        400
      );
    }

    const systemPrompt =
      "You are an educational financial assistant specialized in Chilean stocks. Do NOT give financial advice. Maximum 12 stocks. No stock above 20%. Avoid sector concentration. Return: 1) Executive summary, 2) Allocation table, 3) Chile-specific risks, 4) Rebalancing suggestion.";

    const userPrompt = `Capital: ${monto} CLP\nHorizon: ${horizonte} years\nRisk: ${riesgo}\nObjective: ${objetivo}\nConstraints: ${restricciones}`;

    const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.4,
      }),
    });

    const data = await openaiResponse.json();

    if (!openaiResponse.ok) {
      return jsonResponse({ error: data?.error?.message || "OpenAI error" }, openaiResponse.status);
    }

    const text =
      data?.output
        ?.flatMap((item) => item?.content || [])
        ?.filter((content) => content?.type === "output_text")
        ?.map((content) => content?.text || "")
        ?.join("\n")
        ?.trim() || "";

    if (!text) {
      return jsonResponse({ error: "No output_text returned by OpenAI" }, 502);
    }

    return jsonResponse({ text });
  } catch (error) {
    return jsonResponse({ error: error?.message || "Unexpected error" }, 500);
  }
}
