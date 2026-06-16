import fontoxpath from "fontoxpath";
import { glob, readFile } from "fs/promises";
import { DOMParser, Document, Element } from "slimdom";

import { type NonTerminal, XQuery31Full } from "xq-parser";

const {
  evaluateXPathToFirstNode,
  evaluateXPathToNodes,
  evaluateXPathToString,
  evaluateXPathToStrings,
} = fontoxpath;

function getLineNumber(contents: string, index: number): number {
  return [...contents.substring(0, index).matchAll(/\n/g)].length;
}

type FunctionLocation = { filename: string; line: number; contents: string };

function mergeIntoMap(map: Map<string, string[]>, key: string, value: string) {
  if (!map.has(key)) {
    map.set(key, []);
  }
  map.get(key)!.push(value);
}

function parseXQueryToDocument(contents: string): Document {
  const parsed = XQuery31Full(contents);
  const newDocument = new Document();
  const toDocument = (node: NonTerminal): Element => {
    const ele = newDocument.createElement(node.type);
    ele.setAttribute("start", `${node.start}`);
    ele.setAttribute("end", `${node.end}`);
    for (const child of node.children) {
      if (child.isTerminal) {
        ele.appendChild(newDocument.createTextNode(child.value));
      } else {
        ele.appendChild(toDocument(child as NonTerminal));
      }
    }

    return ele;
  };

  const root = toDocument(parsed.ast);
  newDocument.appendChild(root);
  return newDocument;
}

// xq-parser keeps string literals as raw source text, quotes included, with
// the quote character doubled to escape it (the XQuery string literal rule).
function unescapeStringLiteral(rawText: string): string {
  const quote = rawText[0];
  return rawText
    .slice(1, -1)
    .split(quote + quote)
    .join(quote);
}

export async function scanXQueryFile(
  entry: string,
  contents: string,
  unknownFunctionLocations: FunctionLocation[],
  foundStringParameters: Map<string, string[]>,
) {
  if (!contents.includes("i18n:getLocalizedTextForKey")) {
    return;
  }

  let script: Document;
  try {
    script = parseXQueryToDocument(contents);
  } catch (e) {
    console.warn(e);
    unknownFunctionLocations.push({
      filename: entry,
      line: -1,
      contents: "",
    });
    return;
  }

  let i = -1;

  for (const call of evaluateXPathToNodes<Element>(
    'descendant-or-self::FunctionCall[matches(FunctionEQName, "(^|:)getLocalizedTextForKey$")]',
    script,
  )) {
    i++;
    const param = evaluateXPathToFirstNode<Element>(
      "descendant::ArgumentList/Argument[1]//PrimaryExpr[1]/*",
      call,
    );
    const rawText = param ? evaluateXPathToString(".", param) : "";
    switch (param?.localName) {
      case "Literal":
        if (rawText.startsWith('"') || rawText.startsWith("'")) {
          mergeIntoMap(
            foundStringParameters,
            unescapeStringLiteral(rawText),
            entry,
          );
          break;
        }
      // falls through for non-string literals (numeric, boolean, ...)
      default:
        try {
          const start = parseInt(call.getAttribute("start"));
          const end = parseInt(call.getAttribute("end"));
          const line = getLineNumber(contents, start);

          unknownFunctionLocations.push({
            filename: entry,
            line,
            contents: contents.substring(start, end),
          });
        } catch (e) {
          console.log(call, i, entry);
          throw e;
        }
    }
  }
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
        contents: "",
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
      scanXQueryFile(
        entry,
        await readFile(entry, "utf-8"),
        unknownFunctionLocations,
        foundStringParameters,
      );
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
    unknownFunctionLocations
      .map((x) => `${x.filename}; ${x.contents}; ${x.line}`)
      .join("\n"),
  );
}
