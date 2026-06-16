import * as fontoxpath from "fontoxpath";
import { glob, readFile } from "fs/promises";
import { Element, document } from "slimdom";
import { namespaceResolver } from "../util/util.ts";

const {
  evaluateXPathToMap,
  evaluateXPathToNodes,
  evaluateXPathToString,
  parseScript,
} = fontoxpath;

type FunctionCallGraph = Map<
  string,
  {
    incoming: Set<string>;
    outgoing: Set<string>;
    isRoot: boolean;
  }
>;

function addEdge(
  graph: FunctionCallGraph,
  callingFunction: string,
  calledFunction: string,
  callingFunctionIsRoot: boolean,
) {
  if (!graph.get(callingFunction)) {
    graph.set(callingFunction, {
      incoming: new Set(),
      outgoing: new Set(),
      isRoot: callingFunctionIsRoot,
    });
  }
  const entryForCaller = graph.get(callingFunction)!;
  entryForCaller.outgoing.add(calledFunction);

  if (!graph.get(calledFunction)) {
    graph.set(calledFunction, {
      incoming: new Set(),
      outgoing: new Set(),
      isRoot: false,
    });
  }
  const entryForCallee = graph.get(calledFunction)!;
  entryForCallee.incoming.add(callingFunction);
}

export async function scanXQueryFile(
  fileName: string,
  contents: string,
  functionCallGraph: FunctionCallGraph,
) {
  let script: Element;
  try {
    script = parseScript(
      contents,
      { annotateAst: true, namespaceResolver },
      document,
    );
  } catch (err: unknown) {
    console.error(`Parsing ${fileName} failed. ${err}`);
    return;
    //		throw err;
  }

  // Build a map to resolve namespace prefixes
  const namespaceByPrefix = evaluateXPathToMap(
    `(
map{
'local': 'http://www.w3.org/2005/xquery-local-functions',
'fn': 'http://www.w3.org/2005/xpath-functions'
},
descendant::moduleDecl/map:entry(prefix, uri/string()),
descendant::moduleImport/map:entry(namespacePrefix, targetNamespace/string()),
descendant::namespaceDecl/map:entry(prefix, uri/string())
) => map:merge()`,
    script,
    null,
    null,
    { namespaceResolver },
  );

  // First: declared functions
  for (const functionDeclaration of evaluateXPathToNodes(
    "descendant-or-self::functionDecl",
    script,
    null,
    null,
    { namespaceResolver },
  )) {
    const callingFunctionName = evaluateXPathToString(
      '"Q{" || $namespaceByPrefix(functionName/@xqx:prefix/string()) || "}" || functionName',
      functionDeclaration,
      null,
      { namespaceByPrefix },
      { namespaceResolver },
    );
    for (const call of evaluateXPathToNodes(
      "descendant-or-self::functionCallExpr",
      script,
      null,
      null,
      {
        namespaceResolver,
      },
    )) {
      const calledFunctionName = evaluateXPathToString(
        '"Q{" || functionName/@xqx:URI || "}" || functionName',
        call,
        null,
        null,
        { namespaceResolver },
      );
      addEdge(
        functionCallGraph,
        callingFunctionName,
        calledFunctionName,
        false,
      );
    }
  }

  // Finally, if we are a executable module, the query body
  for (const call of evaluateXPathToNodes(
    "descendant-or-self::functionCallExpr",
    script,
    null,
    null,
    {
      namespaceResolver,
    },
  )) {
    const calledFunctionName = evaluateXPathToString(
      '"Q{" || functionName/@xqx:URI || "}" || functionName',
      call,
      null,
      null,
      { namespaceResolver },
    );
    addEdge(functionCallGraph, fileName, calledFunctionName, true);
  }
}

export function findOrphans(graph: FunctionCallGraph): Set<string> {
  const roots = new Set<string>();

  for (const key of graph.keys()) {
    const edges = graph.get(key)!;
    if (edges.isRoot) {
      // Never mind: reachable from the outside
      continue;
    }
    if (edges.incoming.size === 0) {
      roots.add(key);
    }
  }

  return roots;
}

export async function scanForDeadCode(globString: string): Promise<void> {
  const functionCallGraph = new Map();

  for await (const entry of glob(globString)) {
    if (entry.endsWith(".xqm") || entry.endsWith(".xql")) {
      scanXQueryFile(entry, await readFile(entry, "utf-8"), functionCallGraph);
    }
  }

  console.log(Array.from(findOrphans(functionCallGraph).values()).join("\n"));
}
