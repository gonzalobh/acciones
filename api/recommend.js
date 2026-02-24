export const config = {
  runtime: "edge",
};

export default async function handler(req) {
  try {
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers: { "Content-Type": "application/json" } }
      );
    }

    const apiKey = process.env.ACCIONES;

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Missing ACCIONES environment variable" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();

    const { monto, horizonte, riesgo, objetivo, restricciones } = body;

    const systemPrompt = `
You are an educational financial assistant specialized in Chilean stocks.
Do NOT give financial advice.
Maximum 12 stocks.
No stock above 20%.
Avoid sector concentration.
Return:
1. Executive summary
2. Allocation table
3. Chile-specific risks
4. Rebalancing suggestion
`;

    const userPrompt = `
Capital: ${monto} CLP
Horizon: ${horizonte} years
Risk: ${riesgo}
Objective: ${objetivo}
Constraints: ${restricciones}
`;

    const openaiResponse = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          input: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          temperature: 0.4
        }),
      }
    );

    const data = await openaiResponse.json();

    if (!openaiResponse.ok) {
      return new Response(
        JSON.stringify({ error: data.error?.message || "OpenAI error" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const text =
      data.output_text ||
      data.output?.[0]?.content?.[0]?.text ||
      "No response";

    return new Response(
      JSON.stringify({ text }),
      { headers: { "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
