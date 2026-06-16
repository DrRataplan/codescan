import { describe, it } from "node:test";
import assert from "node:assert";
import { scanXQueryFile } from "./scan-localization.ts";

describe("scan localization", () => {
  it("finds a string key passed to text", async () => {
    const script = `
xquery version "3.1";
import module namespace i18n="http://exist-db.org/xquery/i18n";

i18n:text("my.translation.key")
`;

    const unknownFunctionLocations: { filename: string; line: number }[] = [];
    const foundStringParameters = new Map<string, string[]>();

    await scanXQueryFile(
      "main.xqm",
      script,
      unknownFunctionLocations,
      foundStringParameters,
    );

    assert.deepEqual(unknownFunctionLocations, []);
    assert.deepEqual(
      [...foundStringParameters],
      [["my.translation.key", ["main.xqm"]]],
    );
  });

  it("reports a call as unknown when the key isn't a string literal", async () => {
    const script = `
xquery version "3.1";
import module namespace i18n="http://exist-db.org/xquery/i18n";

let $key := "my.translation.key"
return i18n:text($key)
`;

    const unknownFunctionLocations: { filename: string; line: number }[] = [];
    const foundStringParameters = new Map<string, string[]>();

    await scanXQueryFile(
      "main.xqm",
      script,
      unknownFunctionLocations,
      foundStringParameters,
    );

    assert.deepEqual(foundStringParameters, new Map());
    assert.equal(unknownFunctionLocations.length, 1);
    assert.equal(unknownFunctionLocations[0].filename, "main.xqm");
  });
});
