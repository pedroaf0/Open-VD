/**
 * Agrupamento de modelos (STL/PLY/OBJ) na lista do visualizador.
 *
 * Objetos que compartilham um mesmo termo no nome são reunidos num grupo. O
 * termo do grupo é o que se repete no maior número de nomes — por exemplo,
 * "incisivo central dentes", "incisivo lateral dentes" e "molar dentes" formam
 * o grupo "dentes" (3 nomes) e não "incisivo" (2 nomes).
 */

import { normalizeMeshName } from "@/lib/meshColors";

export type MeshGroup<T> = {
  /** Chave estável do grupo (o próprio termo); vazio para itens sem grupo. */
  key: string;
  /** Termo do grupo ou null para os itens que não entraram em nenhum grupo. */
  label: string | null;
  items: T[];
};

/** Termos muito curtos ou genéricos nunca definem um grupo. */
const MIN_TOKEN_LENGTH = 3;
const STOPWORDS = new Set([
  "com",
  "sem",
  "para",
  "por",
  "dos",
  "das",
  "uma",
  "the",
  "and",
  "for",
  "part",
  "copy",
  "final",
  "model",
  "mesh",
  "scan",
  "export",
  "merged",
]);

/**
 * Termos de um nome para efeito de agrupamento: normaliza (sem extensão,
 * acento ou caixa), descarta dígitos, termos curtos, stopwords e repetições.
 */
export function meshNameTokens(name: string): string[] {
  const tokens: string[] = [];
  for (const token of normalizeMeshName(name).split(/[^a-z]+/)) {
    if (token.length < MIN_TOKEN_LENGTH) continue;
    if (STOPWORDS.has(token)) continue;
    if (!tokens.includes(token)) tokens.push(token);
  }
  return tokens;
}

/**
 * Agrupa os itens por termo compartilhado, escolhendo para cada item o termo
 * mais repetido (desempate por termo mais longo e depois alfabético). Grupos
 * com um único item caem no balde sem rótulo (label = null), renderizado sem
 * cabeçalho.
 */
export function groupMeshesByName<T extends { name: string }>(items: T[]): MeshGroup<T>[] {
  if (items.length < 2) {
    return items.length ? [{ key: "", label: null, items }] : [];
  }

  const tokensById = items.map((item) => meshNameTokens(item.name));

  const frequency = new Map<string, number>();
  for (const tokens of tokensById) {
    for (const token of tokens) frequency.set(token, (frequency.get(token) ?? 0) + 1);
  }

  const candidates = [...frequency.entries()]
    .filter(([, count]) => count >= 2)
    .map(([token, count]) => ({ token, count }))
    .sort(
      (a, b) =>
        b.count - a.count || b.token.length - a.token.length || a.token.localeCompare(b.token),
    );

  const grouped = new Map<string, T[]>();
  const ungrouped: T[] = [];

  for (let i = 0; i < items.length; i++) {
    const tokens = tokensById[i]!;
    const best = candidates.find((candidate) => tokens.includes(candidate.token));
    if (!best) {
      ungrouped.push(items[i]!);
      continue;
    }
    const bucket = grouped.get(best.token);
    if (bucket) bucket.push(items[i]!);
    else grouped.set(best.token, [items[i]!]);
  }

  const groups: MeshGroup<T>[] = [];
  for (const candidate of candidates) {
    const bucket = grouped.get(candidate.token);
    if (!bucket) continue;
    if (bucket.length >= 2)
      groups.push({ key: candidate.token, label: candidate.token, items: bucket });
    else ungrouped.push(...bucket);
  }
  if (ungrouped.length) groups.push({ key: "", label: null, items: ungrouped });

  return groups;
}
