import { Node, type SourceFile, type Statement } from "ts-morph";

function isUseServerString(stmt: Statement | undefined): boolean {
  if (!stmt || !Node.isExpressionStatement(stmt)) return false;
  const expr = stmt.getExpression();
  return Node.isStringLiteral(expr) && expr.getLiteralValue() === "use server";
}

function hasFileDirective(sf: SourceFile): boolean {
  return isUseServerString(sf.getStatements()[0]);
}

function bodyHasDirective(node: Node): boolean {
  if (
    !Node.isFunctionDeclaration(node) &&
    !Node.isArrowFunction(node) &&
    !Node.isFunctionExpression(node)
  ) {
    return false;
  }
  const body = node.getBody();
  if (!body || !Node.isBlock(body)) return false;
  return isUseServerString(body.getStatements()[0]);
}

export function extractServerActions(sf: SourceFile): string[] {
  const fileLevel = hasFileDirective(sf);
  const names: Array<{ name: string; pos: number }> = [];

  for (const [name, decls] of sf.getExportedDeclarations()) {
    for (const d of decls) {
      let fn: Node | undefined;
      if (Node.isFunctionDeclaration(d) || Node.isArrowFunction(d) || Node.isFunctionExpression(d)) {
        fn = d;
      } else if (Node.isVariableDeclaration(d)) {
        const init = d.getInitializer();
        if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) fn = init;
      }
      if (!fn) continue;
      if (fileLevel || bodyHasDirective(fn)) {
        names.push({ name, pos: d.getStart() });
        break;
      }
    }
  }

  return names.sort((a, b) => a.pos - b.pos).map((n) => n.name);
}
