export const config = {
  runtime: "edge",
};

function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isMissing(v) {
  return v === undefined || v === null || String(v).trim() === "";
}

function buildPrompt({ monto, horizonte, riesgo, objetivo, restricciones }) {
  return `Eres un analista financiero chileno experto en renta variable local.

Responde ÚNICAMENTE con un objeto JSON válido. Sin texto adicional. Sin bloques markdown. Sin comentarios.

Datos del inversionista:
- Capital: ${monto} CLP
- Horizonte: ${horizonte} años  
- Riesgo: ${riesgo}
- Objetivo: ${objetivo}
- Restricciones: ${restricciones || "Ninguna"}

Construye una cartera con estas reglas:
- 10 a 14 acciones chilenas líquidas del IPSA o midcaps conocidos
- Máximo 25% por sector
- Porcentajes deben sumar exactamente 100
- Lenguaje técnico pero comprensible

Formato JSON exacto que debes retornar:

{
  "resumenEjecutivo": "string breve",
  "supuestosMacro": "string breve",
  "asignacion": [
    { "accion": "Nombre", "ticker": "TICKER", "sector": "Sector", "porcentaje": 8, "rol": "string" }
  ],
  "asignacionSectorial": [
    { "sector": "Sector", "porcentaje": 20 }
  ],
  "logicaCartera": [
    { "bloque": "Nombre", "descripcion": "string" }
  ],
  "estimaciones": {
    "rentabilidadEsperada": "8-12% anual",
    "volatilidad": "15-20% anual",
    "drawdown": "-20 a -30%"
  },
  "riesgosPrincipales": ["riesgo 1", "riesgo 2", "riesgo 3"],
  "monitoreo": {
    "frecuencia": "string",
    "queMirar": ["indicador 1", "indicador 2"]
  },
  "implementacion": "string"
}`;
}

export default async function handler(req) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST" },
    });
  }

  if (req.method !== "POST") {
    return jsonRes({ ok: false, error: "Método no permitido" }, 405);
  }

  const apiKey = process.env.ACCIONES;
  if (!apiKey) {
    return jsonRes({ ok: false, error: "Variable de entorno ACCIONES no configurada" }, 500);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonRes({ ok: false, error: "Body inválido" }, 400);
  }

  const monto         = body?.monto        ?? body?.capital;
  const horizonte     = body?.horizonte    ?? body?.horizon;
  const riesgo        = body?.riesgo       ?? body?.risk;
  const objetivo      = body?.objetivo     ?? body?.objective;
  const restricciones = body?.restricciones ?? body?.constraints ?? "";

  const missing = [["monto", monto], ["horizonte", horizonte], ["riesgo", riesgo], ["objetivo", objetivo]]
    .filter(([, v]) => isMissing(v)).map(([k]) => k);

  if (missing.length) {
    return jsonRes({ ok: false, error: `Faltan campos: ${missing.join(", ")}` }, 400);
  }

  const prompt = buildPrompt({ monto, horizonte, riesgo, objetivo, restricciones });

  // Call OpenAI chat completions (standard, fast, compatible with edge)
  let openaiRes;
  try {
    openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        max_tokens: 2000,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "Eres un analista financiero chileno. Respondes SOLO con JSON válido, sin texto adicional.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });
  } catch (err) {
    return jsonRes({ ok: false, error: `Error conectando con OpenAI: ${err.message}` }, 502);
  }

  let data;
  try {
    data = await openaiRes.json();
  } catch {
    return jsonRes({ ok: false, error: "OpenAI devolvió respuesta no-JSON" }, 502);
  }

  if (!openaiRes.ok) {
    const errMsg = data?.error?.message || `OpenAI status ${openaiRes.status}`;
    return jsonRes({ ok: false, error: errMsg }, openaiRes.status >= 500 ? 502 : openaiRes.status);
  }

  const rawText = (data?.choices?.[0]?.message?.content ?? "").trim();

  if (!rawText) {
    return jsonRes({ ok: false, error: "El modelo no retornó contenido" }, 502);
  }

  // Strip any accidental markdown fences
  const cleaned = rawText
    .replace(/^```(?:json)?[\r\n]*/i, "")
    .replace(/[\r\n]*```\s*$/i, "")
    .trim();

  let portfolio;
  try {
    portfolio = JSON.parse(cleaned);
  } catch {
    return jsonRes({
      ok: false,
      error: "JSON inválido en respuesta del modelo",
      preview: cleaned.slice(0, 200),
    }, 502);
  }

  return jsonRes({ ok: true, data: portfolio });
}
