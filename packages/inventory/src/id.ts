export function endpointId(file: string, exportName: string): string {
  const cleaned = `${file.replace(/\\/g, "/")}#${exportName}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `ep_${cleaned}`;
}
