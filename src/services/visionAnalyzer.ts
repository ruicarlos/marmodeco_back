import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DetectedSurface {
  name: string;       // ex: "Revestimento de piso - Cozinha"
  width: number;      // m
  depth: number;      // m
  area: number;       // m²
  notes?: string;
}

export interface VisionAnalysisResult {
  scale: string;                  // ex: "1:50" ou "Sem escala indicada (dimensões anotadas 12m x ...)"
  detectedEnvironment: string;    // ex: "Cozinha (área hachurada à direita)"
  totalArea: number;              // m²
  surfaces: DetectedSurface[];
  confidence: number;             // 0-100
  reasoning?: string;             // explicação curta do que a IA viu
}

// ─── Config ──────────────────────────────────────────────────────────────────

const MODEL = process.env.CLAUDE_VISION_MODEL || 'claude-sonnet-4-5';

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada no .env');
  return new Anthropic({ apiKey });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fileToBase64(filePath: string): string {
  return fs.readFileSync(filePath).toString('base64');
}

function mimeFromExt(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.pdf': return 'application/pdf';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    default: return 'application/octet-stream';
  }
}

function buildPrompt(workType?: string | null): string {
  const ctx = workType
    ? `Contexto: o projeto é de **${workType}**. Use isso para interpretar ambientes.`
    : 'Contexto: tipo de obra não informado.';

  return `Você é um engenheiro especialista em leitura de plantas técnicas para orçamentação de revestimentos em mármore e granito.

${ctx}

Analise a planta anexada e extraia, com o máximo de precisão:

1. **Escala detectada**: descreva como aparece no desenho (ex.: "1:50", "Sem escala indicada (dimensões anotadas)", "Cota de 12m no eixo horizontal").
2. **Ambiente principal**: nome do(s) ambiente(s) onde haverá revestimento de pedra (cozinha, banheiro, sala, etc.).
3. **Superfícies a revestir**: para cada superfície hachurada/destacada/cotada que poderia receber revestimento, retorne:
   - \`name\`: nome descritivo (ex.: "Revestimento de piso - Área de Mármore (Cozinha)")
   - \`width\`: largura em metros (número decimal)
   - \`depth\`: profundidade/comprimento em metros (número decimal)
   - \`area\`: área em metros quadrados (width × depth, arredondado a 2 decimais)
   - \`notes\`: observação opcional (ex.: "área hachurada à direita")
4. **Área total**: soma das áreas das superfícies (m²).
5. **Confiança**: número de 0 a 100 indicando o quanto você confia na leitura (baseado na clareza da planta, presença de cotas, escala, etc.).
6. **Reasoning**: 1-2 frases explicando o que você viu (será mostrado ao revisor humano).

**Responda APENAS com um JSON válido neste formato exato, sem markdown, sem cercas de código, sem texto antes ou depois:**

{
  "scale": "...",
  "detectedEnvironment": "...",
  "totalArea": 0,
  "surfaces": [
    { "name": "...", "width": 0, "depth": 0, "area": 0, "notes": "..." }
  ],
  "confidence": 0,
  "reasoning": "..."
}

Regras:
- Sempre use metros (m) e metros quadrados (m²).
- Se uma cota estiver em cm ou mm, converta.
- Se não houver superfície identificável, retorne \`surfaces: []\` e \`confidence: 0\`.
- Não invente medidas: se a planta não tiver cotas legíveis, baixe a confiança e marque \`notes\` explicando.
- Não escreva nada fora do JSON.`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function analyzeFloorPlan(
  filePath: string,
  workType?: string | null,
): Promise<VisionAnalysisResult> {
  const client = getClient();
  const mime = mimeFromExt(filePath);
  const base64 = fileToBase64(filePath);

  // Determine document type for Anthropic API
  // PDFs use "document" content blocks; images use "image" content blocks
  const isPdf = mime === 'application/pdf';

  const contentBlock: Anthropic.Messages.ContentBlockParam = isPdf
    ? {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: base64,
        },
      }
    : {
        type: 'image',
        source: {
          type: 'base64',
          media_type: mime as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
          data: base64,
        },
      };

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          contentBlock,
          { type: 'text', text: buildPrompt(workType) },
        ],
      },
    ],
  });

  // Extract text from response
  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Resposta da IA não contém texto');
  }

  const raw = textBlock.text.trim();
  // Strip markdown code fences if model includes them despite instructions
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  let parsed: VisionAnalysisResult;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Falha ao parsear resposta JSON da IA: ${(err as Error).message}\n\nResposta crua:\n${raw.slice(0, 500)}`);
  }

  // Sanity-check & normalize
  return {
    scale: String(parsed.scale ?? ''),
    detectedEnvironment: String(parsed.detectedEnvironment ?? ''),
    totalArea: Number(parsed.totalArea) || 0,
    surfaces: Array.isArray(parsed.surfaces)
      ? parsed.surfaces.map(s => ({
          name: String(s.name ?? 'Superfície'),
          width: Number(s.width) || 0,
          depth: Number(s.depth) || 0,
          area: Number(s.area) || (Number(s.width) || 0) * (Number(s.depth) || 0),
          notes: s.notes ? String(s.notes) : undefined,
        }))
      : [],
    confidence: Math.min(100, Math.max(0, Number(parsed.confidence) || 0)),
    reasoning: parsed.reasoning ? String(parsed.reasoning) : undefined,
  };
}
