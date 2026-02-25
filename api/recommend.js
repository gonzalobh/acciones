export const config = {
  runtime: "edge",
  maxDuration: 60,
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
  return `
Actúa como un asesor de inversiones especializado en el mercado accionario chileno.

Debes elaborar un informe profesional, claro y educativo.
No respondas como chatbot. Escribe como un analista financiero.

IMPORTANTE:
Devuelve SOLO JSON válido. No uses markdown.

Perfil del inversionista:
- Capital disponible: ${monto} CLP
- Horizonte: ${horizonte} años
- Nivel de riesgo: ${riesgo}
- Objetivo: ${objetivo}
- Restricciones: ${restricciones || "Ninguna"}

Reglas de construcción:
- Usar acciones chilenas líquidas (IPSA y midcaps razonables).
- Entre 12 y 16 acciones.
- Diversificar por sectores.
- No concentrar más de 30% en un sector.
- Explicar la lógica económica detrás de la cartera.
- No prometer resultados ni usar lenguaje comercial.
- Lenguaje prudente y profesional.

Formato JSON obligatorio:

{
  "resumenEjecutivo": "explicación clara de la estrategia",
  "supuestosMacro": "contexto económico chileno relevante",
  "asignacion": [
    {
      "accion": "Nombre empresa",
      "ticker": "TICKER",
      "sector": "Sector",
      "porcentaje": number,
      "rol": "función dentro de la cartera"
    }
  ],
  "asignacionSectorial": [
    {
      "sector": "Sector",
      "porcentaje": number
    }
  ],
  "logicaCartera": [
    {
      "bloque": "Nombre del bloque",
      "descripcion": "explicación estratégica"
    }
  ],
  "estimaciones": {
    "rentabilidadEsperada": "rango razonable",
    "volatilidad": "rango esperado",
    "drawdown": "posibles caídas"
  },
  "riesgosPrincipales": [
    "riesgo explicado",
    "riesgo explicado"
  ],
  "monitoreo": {
    "frecuencia": "cómo seguir la cartera",
    "queMirar": ["indicador", "indicador"]
  },
  "implementacion": "cómo entrar gradualmente en el mercado"
}
`;
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
        temperature: 0.2,
        max_output_tokens: 2000,
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
