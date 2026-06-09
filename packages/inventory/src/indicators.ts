import { Node, type SourceFile } from "ts-morph";

const AUTH_HELPERS: readonly string[] = [
  "getServerSession",
  "auth",
  "currentUser",
  "getUser",
  "getSession",
  "validateRequest",
  "requireUser",
];

const DB_IDENTIFIERS = /^(prisma|db|database)$/;
const DB_MODULE = /prisma|(?:^|\/)db$|(?:^|\/)database$/i;

export function usesDb(sf: SourceFile): boolean {
  for (const imp of sf.getImportDeclarations()) {
    if (DB_MODULE.test(imp.getModuleSpecifierValue())) return true;
  }
  let found = false;
  sf.forEachDescendant((node, traversal) => {
    if (Node.isPropertyAccessExpression(node) && DB_IDENTIFIERS.test(node.getExpression().getText())) {
      found = true;
      traversal.stop();
    }
  });
  return found;
}

export function findAuthIndicators(sf: SourceFile): string[] {
  const found = new Set<string>();
  sf.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;
    const expr = node.getExpression();
    const name = Node.isIdentifier(expr)
      ? expr.getText()
      : Node.isPropertyAccessExpression(expr)
        ? expr.getName()
        : null;
    if (name && AUTH_HELPERS.includes(name)) found.add(name);
  });
  return [...found].sort();
}
