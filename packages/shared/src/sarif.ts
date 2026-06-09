import type { TConfidence, TFinding } from "./finding.js";

export interface SarifLocation {
  physicalLocation: {
    artifactLocation: { uri: string };
    region: { startLine: number; endLine: number };
  };
}

export interface SarifResult {
  ruleId: string;
  level: "error" | "warning" | "note";
  message: { text: string };
  locations: SarifLocation[];
}

export interface SarifLog {
  $schema: string;
  version: "2.1.0";
  runs: Array<{
    tool: {
      driver: {
        name: string;
        version: string;
        informationUri: string;
        rules: Array<{ id: string; shortDescription: { text: string } }>;
      };
    };
    results: SarifResult[];
  }>;
}

const RULE_ID = "authzscan/idor";

const levelByConfidence: Record<TConfidence, SarifResult["level"]> = {
  high: "error",
  medium: "warning",
  low: "note",
};

export function toSarif(findings: TFinding[], opts: { toolVersion: string }): SarifLog {
  const confirmed = findings.filter((f) => f.verdict === "confirmed");
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "authzscan",
            version: opts.toolVersion,
            informationUri: "https://github.com/davidldv/authzscan",
            rules: [
              {
                id: RULE_ID,
                shortDescription: { text: "Object-level authorization missing (IDOR/BOLA)" },
              },
            ],
          },
        },
        results: confirmed.map((f) => ({
          ruleId: RULE_ID,
          level: levelByConfidence[f.confidence],
          message: { text: `${f.title}\n\n${f.description}\n\nReproduction: ${f.reproduction}` },
          locations: f.evidence.map((e) => ({
            physicalLocation: {
              artifactLocation: { uri: e.file },
              region: { startLine: e.startLine, endLine: e.endLine },
            },
          })),
        })),
      },
    ],
  };
}
