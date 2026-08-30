import type { CardRow } from './project.js';
import { frontFace, type OracleCard } from './scryfall.js';

// Art window inner size in card pixels; must match .art-window in
// template/card.css (691 content width minus 2×2px border, 495 minus border).
export const ART_W = 687;
export const ART_H = 491;

/** Frame theme from the card itself; a `theme` value in the CSV overrides this. */
export function deriveTheme(card: OracleCard): string {
  const face = frontFace(card);
  if (/\bLand\b/.test(face.type_line ?? card.type_line)) return 'land';
  const colors = face.colors ?? card.color_identity ?? [];
  if (colors.length === 0) return 'colorless';
  if (colors.length === 1) return colors[0].toLowerCase();
  const pair = [...colors].sort().join('');
  if (pair === 'BU') return 'ub';
  return 'multi';
}

/** The object shape template/card-dom.js renders. `art_src` is set by the caller. */
export function buildCardData(row: CardRow, card: OracleCard, artSrc?: string) {
  const face = frontFace(card);
  return {
    theme: row.theme || deriveTheme(card),
    display_name: row.display_name,
    original_card: face.name, // front-face name; the full "A // B" stays in the CSV
    flavor: row.flavor || null,
    art_src: artSrc ?? null,
    oracle: {
      name: face.name,
      mana_cost: face.mana_cost,
      type_line: face.type_line ?? card.type_line,
      oracle_text: face.oracle_text,
      flavor_text: face.flavor_text,
      power: face.power ?? null,
      toughness: face.toughness ?? null,
    },
  };
}
