export const config = {
  runtime: "nodejs",
  maxDuration: 60,
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isMissing(value) {
  return value === undefined || value === null || String(value).trim() === "";
}

function buildPrompt({ monto, horizonte, riesgo, objetivo, restricciones }) {
  return `Actúa como un asesor de inversiones especializado en el mercado accionario chileno.
Escribe como un analista financiero profesional.

IMPORTANTE: Devuelve ÚNICAMENTE JSON válido. Sin texto antes ni después. Sin bloques markdown. Sin comentarios.

Perfil del inversionista:
- Capital: ${monto} CLP
- Horizonte: ${horizonte} años
- Riesgo: ${riesgo}
- Objetivo: ${objetivo}
- Restricciones: ${restricciones || "Ninguna"}

Reglas:
- Acciones chilenas líquidas (IPSA y midcaps).
- Entre 12 y 16 acciones.
- Diversificar por sectores. Máximo 30% por sector.
- Lenguaje prudente y profesional.

Responde SOLO con este JSON (sin nada más):

{
  "resumenEjecutivo": "string",
  "supuestosMacro": "string",
  "asignacion": [
    { "accion": "string", "ticker": "string", "sector": "string", "porcentaje": number, "rol": "string" }
  ],
  "asignacionSectorial": [
    { "sector": "string", "porcentaje": number }
  ],
  "logicaCartera": [
    { "bloque": "string", "descripcion": "string" }
  ],
  "estimaciones": {
    "rentabilidadEsperada": "string",
    "volatilidad": "string",
    "drawdown": "string"
  },
  "riesgosPrincipales": ["string"],
  "monitoreo": {
    "frecuencia": "string",
    "queMirar": ["string"]
  },
  "implementacion": "string"
}`;
}

export default async function handler(req) {
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Método no permitido" }, 405);
  }

  const apiKey = process.env.ACCIONES;
  if (!apiKey) {
    return jsonResponse({ ok: false, error: "Falta variable de entorno ACCIONES" }, 500);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Request body inválido" }, 400);
  }

  const monto        = body?.monto       ?? body?.capital;
  const horizonte    = body?.horizonte   ?? body?.horizon;
  const riesgo       = body?.riesgo      ?? body?.risk;
  const objetivo     = body?.objetivo    ?? body?.objective;
  const restricciones= body?.restricciones ?? body?.constraints ?? "";

  const missing = [["monto", monto], ["horizonte", horizonte], ["riesgo", riesgo], ["objetivo", objetivo]]
    .filter(([, v]) => isMissing(v))
    .map(([k]) => k);

  if (missing.length > 0) {
    return jsonResponse({ ok: false, error: `Faltan campos: ${missing.join(", ")}` }, 400);
  }

  const prompt = buildPrompt({ monto, horizonte, riesgo, objetivo, restricciones });

  let openaiRes;
  try {
    openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        max_tokens: 2500,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "Eres un analista financiero chileno. Responde SIEMPRE con JSON válido y nada más.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });
  } catch (fetchErr) {
    return jsonResponse({ ok: false, error: `Error de red hacia OpenAI: ${fetchErr.message}` }, 502);
  }

  let data;
  try {
    data = await openaiRes.json();
  } catch {
    return jsonResponse({ ok: false, error: "OpenAI devolvió una respuesta no-JSON" }, 502);
  }

  if (!openaiRes.ok) {
    return jsonResponse(
      { ok: false, error: data?.error?.message || `OpenAI error ${openaiRes.status}` },
      openaiRes.status
    );
  }

  // Extract text from chat/completions format
  const rawText = data?.choices?.[0]?.message?.content?.trim() ?? "";

  if (!rawText) {
    return jsonResponse({ ok: false, error: "El modelo no devolvió contenido" }, 502);
  }

  // Strip markdown fences if present (```json ... ```)
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

  let portfolio;
  try {
    portfolio = JSON.parse(cleaned);
  } catch {
    return jsonResponse(
      { ok: false, error: "No se pudo parsear el JSON del modelo", rawText: cleaned.slice(0, 500) },
      502
    );
  }

  return jsonResponse({ ok: true, data: portfolio });
}
