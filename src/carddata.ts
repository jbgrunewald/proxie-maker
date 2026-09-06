import type { CardRow } from './project.js';
import { frontFace, type OracleCard } from './scryfall.js';

/**
 * A card layout. `art` is the art window's CONTENT box in card pixels — what
 * the renderer resizes art to, and what the app's crop rectangle is shaped by.
 *
 * These numbers describe what template/card.css actually produces, so they must
 * not be guessed: render.ts measures the rendered DOM and fails the run if the
 * two disagree. That check exists because they silently disagreed before — the
 * old constant said 687 wide while the frame's 10px padding made it 667, so
 * every card lost ~10px off each side to object-fit: cover.
 *
 * A new layout is a row here plus a `.layout-<name>` block in card.css. The
 * layout name reaches the template as a class and as --art-w/--art-h.
 */
export interface LayoutSpec {
  art: { w: number; h: number };
}

export const LAYOUTS = {
  classic: { art: { w: 667, h: 491 } },
} satisfies Record<string, LayoutSpec>;

export type LayoutName = keyof typeof LAYOUTS;
export const DEFAULT_LAYOUT: LayoutName = 'classic';

/** Layout for a row, defaulting when the CSV column is blank or absent. */
export function layoutFor(row: Pick<CardRow, 'layout'>): LayoutSpec & { name: LayoutName } {
  const name = (row.layout || DEFAULT_LAYOUT) as LayoutName;
  const spec = LAYOUTS[name];
  if (!spec) {
    // Same stance as an unresolvable card name: a typo must not quietly render.
    throw new Error(
      `Unknown layout "${row.layout}". Known layouts: ${Object.keys(LAYOUTS).join(', ')}.`,
    );
  }
  return { ...spec, name };
}

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

/**
 * The object template/card-dom.js renders. It is the contract between the TS
 * stages and the plain-JS template, which both the app gallery and the print
 * renderer draw with — keep them in step.
 */
export interface CardData {
  layout: LayoutName;
  /** Art window content box, so the template can size itself from one source. */
  art: { w: number; h: number };
  theme: string;
  display_name: string;
  original_card: string;
  flavor: string | null;
  art_src: string | null;
  oracle: {
    name: string;
    mana_cost?: string;
    type_line: string;
    oracle_text?: string;
    flavor_text?: string;
    power: string | null;
    toughness: string | null;
  };
}

/** `art_src` is set by the caller — the app points at a URL, the renderer inlines a data URI. */
export function buildCardData(row: CardRow, card: OracleCard, artSrc?: string): CardData {
  const face = frontFace(card);
  const layout = layoutFor(row);
  return {
    layout: layout.name,
    art: layout.art,
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
