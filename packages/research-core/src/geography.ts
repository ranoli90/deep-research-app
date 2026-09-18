/** Named geographies extracted from the question. Word-boundary only; Indiana is not India. */

export const COUNTRIES = [
  "germany",
  "france",
  "united states",
  "usa",
  "uk",
  "united kingdom",
  "canada",
  "japan",
  "india",
  "australia",
  "brazil",
  "spain",
  "italy",
  "netherlands",
  "sweden",
  "norway",
  "singapore",
  "mexico",
  "ireland",
  "switzerland",
  "new zealand",
  "south korea",
  "china",
] as const;

export const US_STATES: { name: string; abbr: string }[] = [
  { name: "alabama", abbr: "al" }, { name: "alaska", abbr: "ak" }, { name: "arizona", abbr: "az" },
  { name: "arkansas", abbr: "ar" }, { name: "california", abbr: "ca" }, { name: "colorado", abbr: "co" },
  { name: "connecticut", abbr: "ct" }, { name: "delaware", abbr: "de" }, { name: "florida", abbr: "fl" },
  { name: "georgia", abbr: "ga" }, { name: "hawaii", abbr: "hi" }, { name: "idaho", abbr: "id" },
  { name: "illinois", abbr: "il" }, { name: "indiana", abbr: "in" }, { name: "iowa", abbr: "ia" },
  { name: "kansas", abbr: "ks" }, { name: "kentucky", abbr: "ky" }, { name: "louisiana", abbr: "la" },
  { name: "maine", abbr: "me" }, { name: "maryland", abbr: "md" }, { name: "massachusetts", abbr: "ma" },
  { name: "michigan", abbr: "mi" }, { name: "minnesota", abbr: "mn" }, { name: "mississippi", abbr: "ms" },
  { name: "missouri", abbr: "mo" }, { name: "montana", abbr: "mt" }, { name: "nebraska", abbr: "ne" },
  { name: "nevada", abbr: "nv" }, { name: "new hampshire", abbr: "nh" }, { name: "new jersey", abbr: "nj" },
  { name: "new mexico", abbr: "nm" }, { name: "new york", abbr: "ny" }, { name: "north carolina", abbr: "nc" },
  { name: "north dakota", abbr: "nd" }, { name: "ohio", abbr: "oh" }, { name: "oklahoma", abbr: "ok" },
  { name: "oregon", abbr: "or" }, { name: "pennsylvania", abbr: "pa" }, { name: "rhode island", abbr: "ri" },
  { name: "south carolina", abbr: "sc" }, { name: "south dakota", abbr: "sd" }, { name: "tennessee", abbr: "tn" },
  { name: "texas", abbr: "tx" }, { name: "utah", abbr: "ut" }, { name: "vermont", abbr: "vt" },
  { name: "virginia", abbr: "va" }, { name: "washington", abbr: "wa" }, { name: "west virginia", abbr: "wv" },
  { name: "wisconsin", abbr: "wi" }, { name: "wyoming", abbr: "wy" }, { name: "district of columbia", abbr: "dc" },
];

export const NAMED_CITIES = [
  "austin", "dallas", "houston", "chicago", "seattle", "boston", "denver", "atlanta",
  "miami", "phoenix", "portland", "nashville", "london", "paris", "berlin", "tokyo",
  "toronto", "vancouver", "sydney", "melbourne",
];

function negated(question: string, token: string): boolean {
  const pattern = token.replace(/\s+/g, "\\s+");
  return new RegExp(`\\bnot(?:\\s+in)?\\s+${pattern}\\b`, "i").test(question);
}

function named(question: string, token: string): boolean {
  const pattern = token.replace(/\s+/g, "\\s+");
  return new RegExp(`\\b${pattern}\\b`, "i").test(question) && !negated(question, token);
}

export type NamedGeography = { value: string; kind: "country" | "state" | "city"; stated: true };

/** First stated geography, preferring longer matches so “new york” wins over “york”. */
export function extractNamedGeography(question: string): NamedGeography | null {
  const hits: NamedGeography[] = [];
  for (const country of COUNTRIES) {
    if (named(question, country)) hits.push({ value: country, kind: "country", stated: true });
  }
  for (const state of US_STATES) {
    if (named(question, state.name)) hits.push({ value: state.name, kind: "state", stated: true });
  }
  for (const city of NAMED_CITIES) {
    if (named(question, city)) hits.push({ value: city, kind: "city", stated: true });
  }
  hits.sort((a, b) => b.value.length - a.value.length);
  return hits[0] ?? null;
}

export function geographyIsStated(question: string): boolean {
  return extractNamedGeography(question) !== null;
}
