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

function isMissing(value) {
  return value === undefined || value === null || String(value).trim() === "";
}

function buildPrompt({ monto, horizonte, riesgo, objetivo, restricciones }) {
  return [
    "Devuelve SOLO JSON válido, sin markdown, sin bloques de código y sin texto adicional.",
    "Todas las claves y todos los textos deben estar en español.",
    "Construye una propuesta educativa de cartera de acciones chilenas para este perfil:",
    `- Monto (CLP): ${monto}`,
    `- Horizonte (años): ${horizonte}`,
    `- Riesgo: ${riesgo}`,
    `- Objetivo: ${objetivo}`,
    `- Restricciones: ${restricciones || "Sin restricciones adicionales"}`,
    "",
    "Restricciones del modelo:",
    "- Solo acciones chilenas con liquidez razonable",
    "- Máximo 12 acciones",
    "- Ninguna acción > 20%",
    "- Evitar concentración sectorial extrema",
    "- No repetir tickers",
    "- Responder en español",
    "- No prometer rentabilidad",
    "- Si das rangos, usa lenguaje prudente",
    "- JSON válido solamente",
    "",
    "Estructura JSON requerida (claves exactas):",
    '{',
    '  "resumenEjecutivo": "string",',
    '  "asignacion": [',
    "    {",
    '      "ticker": "string",',
    '      "empresa": "string",',
    '      "sector": "string",',
    '      "porcentaje": 0,',
    '      "rol": "string",',
    '      "montoCLP": 0',
    "    }",
    "  ],",
    '  "riesgosChile": ["string", "string"],',
    '  "rebalanceo": {',
    '    "frecuencia": "string",',
    '    "regla": "string",',
    '    "comentario": "string"',
    "  },",
    '  "metricas": {',
    '    "rentabilidadEsperadaRango": "string",',
    '    "volatilidadEstimadaRango": "string"',
    "  }",
    "}",
  ].join("\n");
}

export default async function handler(req) {
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Método no permitido" }, 405);
  }

  const apiKey = process.env.ACCIONES;
  if (!apiKey) {
    return jsonResponse({ ok: false, error: "Falta la variable de entorno ACCIONES" }, 500);
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
      .filter(([, value]) => isMissing(value))
      .map(([field]) => field);

    if (missingFields.length > 0) {
      return jsonResponse(
        {
          ok: false,
          error: `Faltan campos requeridos: ${missingFields.join(", ")}`,
        },
        400
      );
    }

    const prompt = buildPrompt({ monto, horizonte, riesgo, objetivo, restricciones });

    const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        input: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    const data = await openaiResponse.json();

    if (!openaiResponse.ok) {
      return jsonResponse(
        {
          ok: false,
          error: data?.error?.message || "Error en OpenAI",
        },
        openaiResponse.status
      );
    }

    const rawText =
      data?.output
        ?.flatMap((item) => item?.content || [])
        ?.filter((content) => content?.type === "output_text")
        ?.map((content) => content?.text || "")
        ?.join("\n")
        ?.trim() || "";

    if (!rawText) {
      return jsonResponse({ ok: false, error: "El modelo no devolvió texto utilizable" }, 502);
    }

    try {
      const portfolio = JSON.parse(rawText);
      return jsonResponse({ ok: true, data: portfolio });
    } catch {
      return jsonResponse(
        {
          ok: false,
          error: "No se pudo parsear JSON del modelo",
          rawText,
        },
        502
      );
    }
  } catch (error) {
    return jsonResponse({ ok: false, error: error?.message || "Error inesperado" }, 500);
  }
}
