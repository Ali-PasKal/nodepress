import type { TermInfo } from '@nexora/shared';

/** Terms in tree order with their depth (parents before children). */
export function orderTerms(terms: readonly TermInfo[]): { term: TermInfo; depth: number }[] {
  const children = new Map<string | null, TermInfo[]>();
  for (const term of terms) {
    const parent =
      term.parentId !== null && terms.some((candidate) => candidate.id === term.parentId)
        ? term.parentId
        : null;
    children.set(parent, [...(children.get(parent) ?? []), term]);
  }
  const result: { term: TermInfo; depth: number }[] = [];
  const visit = (parent: string | null, depth: number) => {
    for (const term of children.get(parent) ?? []) {
      result.push({ term, depth });
      if (depth < 20) visit(term.id, depth + 1);
    }
  };
  visit(null, 0);
  return result;
}
