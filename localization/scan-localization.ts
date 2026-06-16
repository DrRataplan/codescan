import * as fontoxpath from "fontoxpath";
import { glob, readFile } from "fs/promises";
import { DOMParser, Document, Element, document } from "slimdom";
import { namespaceResolver } from "../util/util.ts";

const {
  evaluateXPath,
  evaluateXPathToFirstNode,
  evaluateXPathToNodes,
  evaluateXPathToString,
  evaluateXPathToStrings,
  parseScript,
} = fontoxpath;

function getLineNumber(contents: string, index: number): number {
  return [...contents.substring(0, index).matchAll(/\n/g)].length;
}

type FunctionLocation = { filename: string; line: number };
type FunctionCalls = { name: string; calls: Element[] };

function mergeIntoMap(map: Map<string, string[]>, key: string, value: string) {
  if (!map.has(key)) {
    map.set(key, []);
  }
  map.get(key)!.push(value);
}

async function scanXQueryFile(
  entry: string,
  unknownFunctionLocations: FunctionLocation[],
  foundStringParameters: Map<string, string[]>,
) {
  const contents = await readFile(entry, "utf-8");

  if (!contents.includes("i18n:get-display-value-for-key")) {
    return;
  }
  const matches = [...contents.matchAll(/i18n:get-display-value-for-key/g)];

  if (!matches.length) {
    throw new Error(contents);
  }

  let script: Element;
  try {
    script = parseScript(
      contents,
      { language: evaluateXPath.XQUERY_3_1_LANGUAGE },
      document,
    );
  } catch (e) {
    console.warn(e);
    for (const match of matches) {
      unknownFunctionLocations.push({
        filename: entry,
        line: getLineNumber(contents, match.index),
      });
    }
    return;
  }

  let i = -1;

  for (const call of evaluateXPathToNodes(
    'descendant-or-self::functionCallExpr[functionName = "get-display-value-for-key"]',
    script,
    null,
    null,
    {
      namespaceResolver,
    },
  )) {
    i++;
    const param = evaluateXPathToFirstNode<Element>(
      "descendant::arguments/*",
      call,
      null,
      null,
      { namespaceResolver },
    );
    switch (param!.localName) {
      case "stringConstantExpr":
        mergeIntoMap(
          foundStringParameters,
          evaluateXPathToString(".", param),
          entry,
        );
        break;
      default:
        try {
          const line = getLineNumber(contents, matches[i].index);

          unknownFunctionLocations.push({ filename: entry, line });
        } catch (e) {
          console.log(matches, i, entry);
          throw e;
        }
    }
  }
  1;
}

async function scanHtmlFile(
  entry: string,
  unknownFunctionLocations: FunctionLocation[],
  foundStringParameters: Map<string, string[]>,
) {
  const contents = await readFile(entry, "utf-8");

  if (!contents.includes("i18n:text")) {
    return;
  }
  const matches = [...contents.matchAll(/i18n:text/g)];

  const parser = new DOMParser();
  let html: Document;
  try {
    html = parser.parseFromString(contents, "text/xml");
  } catch (err: unknown) {
    console.log(err);
    unknownFunctionLocations.push(
      ...matches.map((_match, i) => ({
        filename: entry,
        line: getLineNumber(contents, i),
      })),
    );
    return;
  }

  const occurences = evaluateXPathToStrings(
    `//@*[name() = ('data-filter-trigger-label-default',
        'data-filter-trigger-label-selected',
        'data-filter-button-submit',
        'data-filter-button-reset',
'data-filter-button-cancel')]`,
    html,
    null,
    {},
    { namespaceResolver: () => "http://exist-db.org/xquery/i18n" },
  ) as string[];

  for (const occurence of occurences) {
    mergeIntoMap(foundStringParameters, occurence, entry);
  }
}

export async function scanForLocalization(globString: string): Promise<void> {
  const unknownFunctionLocations: FunctionLocation[] = [];
  const foundStringParameters: Map<string, string[]> = new Map();

  for await (const entry of glob(globString)) {
    if (entry.includes("build")) continue;
    if (entry.endsWith("html")) {
      scanHtmlFile(entry, unknownFunctionLocations, foundStringParameters);
    } else if (entry.endsWith(".xqm") || entry.endsWith(".xql")) {
      scanXQueryFile(entry, unknownFunctionLocations, foundStringParameters);
    }
  }

  const found = [...foundStringParameters];

  console.log(
    `Found ${found.length} occurences with arguments and ${unknownFunctionLocations.length} locations that need to be passed by hand`,
  );
  console.log(
    found
      .map(([param, locations]) => param + "; " + locations.join(","))
      .join("\n"),
  );
  //	console.table(unknownFunctionLocations);

  console.log(
    unknownFunctionLocations.map((x) => x.filename + "; " + x.line).join("\n"),
  );
}
