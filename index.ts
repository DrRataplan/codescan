import { scanForLocalization } from "./localization/scan-localization.ts";
import { scanForDeadCode } from "./dead-code/scanDeadCode.ts";

async function main() {
  const mode = process.argv[2];
  const glob = `${process.argv[3]}`;
  switch (mode) {
    case "localization":
      scanForLocalization(glob);
      break;
    case "deadcode":
      scanForDeadCode(glob);
  }
}

main();
