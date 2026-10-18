/**
 * Regras de cor especial por nome de malha (STL/PLY/OBJ).
 *
 * O administrador do plugin WordPress define a lista "nome do modelo -> cor"
 * no painel (submenu "Cores dos modelos"); ela chega ao visualizador pela
 * config criptografada (`window.V_DICOM`). Fora do WordPress (visualizador
 * puramente local) usamos os padrões históricos abaixo.
 */

import { wpConfig } from "@/lib/wp";

export type MeshColorMatch = "exact" | "contains" | "regex";

export type MeshColorRule = {
  /** Nome base do arquivo/malha ou expressão regular (quando `match` = "regex"). */
  name: string;
  /** Cor em '#RRGGBB'. */
  color: string;
  /** "exact" nome inteiro; "contains" trechos; "regex" expressão regular. */
  match: MeshColorMatch;
};

/** Padrões usados quando o administrador ainda não personalizou a lista. */
export const DEFAULT_MESH_COLOR_RULES: MeshColorRule[] = [
  { name: "maxila e cranio superior", color: "#FFF3B0", match: "exact" },
  { name: "mandibula", color: "#FFF3B0", match: "exact" },
  { name: "dentes superiores", color: "#FFFFFF", match: "exact" },
  { name: "dentes inferiores", color: "#FFFFFF", match: "exact" },
  { name: "canal mandibular", color: "#FF0000", match: "exact" },
];

/**
 * Normaliza o nome de uma malha para comparação: remove a extensão, espaços
 * nas pontas, acentos, e coloca em minúsculas.
 */
export const normalizeMeshName = (n: string): string =>
  n
    .replace(/\.(stl|ply|obj)$/i, "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/**
 * Regras ativas: a lista enviada pelo WordPress é usada como está — inclusive
 * vazia (nenhuma cor forçada). Fora do WordPress (config ausente) ou com um
 * plugin antigo que não envia `meshColors`, caímos nos padrões históricos.
 */
export function meshColorRules(): MeshColorRule[] {
  const cfg = wpConfig();
  if (cfg && Array.isArray(cfg.meshColors)) return cfg.meshColors;
  return DEFAULT_MESH_COLOR_RULES;
}

/**
 * Cor forçada para uma malha, ou `undefined` para usar a cor padrão/salva.
 * A primeira regra que combinar vence. Regras `regex` são testadas contra o
 * nome normalizado (minúsculas, sem acento e sem extensão) com a flag `i`;
 * expressões inválidas são ignoradas.
 */
export function forcedMeshColor(
  name: string,
  rules: MeshColorRule[] = meshColorRules(),
): string | undefined {
  const normalized = normalizeMeshName(name);
  if (!normalized) return undefined;
  for (const rule of rules) {
    if (rule.match === "regex") {
      const re = compileRuleRegex(rule.name);
      if (re && re.test(normalized)) return rule.color;
      continue;
    }
    const target = normalizeMeshName(rule.name);
    if (!target) continue;
    const hit = rule.match === "contains" ? normalized.includes(target) : normalized === target;
    if (hit) return rule.color;
  }
  return undefined;
}

/** Cache de regex compiladas (evita recompilar a cada malha/render). */
const regexCache = new Map<string, RegExp | null>();

function compileRuleRegex(pattern: string): RegExp | null {
  const cached = regexCache.get(pattern);
  if (cached !== undefined) return cached;
  let compiled: RegExp | null = null;
  try {
    compiled = new RegExp(pattern, "i");
  } catch {
    compiled = null;
  }
  regexCache.set(pattern, compiled);
  return compiled;
}
