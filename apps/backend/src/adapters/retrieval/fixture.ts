import { fetchCatalog, matchCatalog, type CatalogSource } from "./fixture-catalog.js";

export type SearchHit = {
  locator: string;
  title: string;
  publisher: string;
  snippet: string;
  originCluster: string;
  family: string;
  sourceType?: string;
  population?: string;
  language?: string;
  translated?: boolean;
};

export type FetchedDoc = {
  locator: string;
  title: string;
  publisher: string;
  originCluster: string;
  family: string;
  sourceType?: string;
  population?: string;
  language?: string;
  translated?: boolean;
  text: string;
  accessLevel: "full-text" | "snippet" | "blocked";
};

export function fixtureSearch(query: string): SearchHit[] {
  return matchCatalog(query).map((s) => ({
    locator: s.locator,
    title: s.title,
    publisher: s.publisher,
    snippet: s.snippet,
    originCluster: s.originCluster,
    family: s.family,
    sourceType: s.sourceType,
    population: s.population,
    language: s.language,
    translated: s.translated,
  }));
}

export function fixtureFetch(locator: string): FetchedDoc {
  const src: CatalogSource | undefined = fetchCatalog(locator);
  if (!src) {
    return {
      locator,
      title: "Unknown",
      publisher: "unknown",
      originCluster: locator,
      family: "unknown",
      text: "",
      accessLevel: "blocked",
    };
  }
  if (src.blocked) {
    return {
      locator: src.locator,
      title: src.title,
      publisher: src.publisher,
      originCluster: src.originCluster,
      family: src.family,
      sourceType: src.sourceType,
      population: src.population,
      language: src.language,
      translated: src.translated,
      text: src.snippet,
      accessLevel: "blocked",
    };
  }
  return {
    locator: src.locator,
    title: src.title,
    publisher: src.publisher,
    originCluster: src.originCluster,
    family: src.family,
    sourceType: src.sourceType,
    population: src.population,
    language: src.language,
    translated: src.translated,
    text: src.fullText,
    accessLevel: "full-text",
  };
}
