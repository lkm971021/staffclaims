import { Alert } from "./ui";
export function Flash({ sp }: { sp: Record<string, string | undefined> }) {
  if (sp.ok) return <div className="mb-4"><Alert tone="green">{sp.ok}</Alert></div>;
  if (sp.error) return <div className="mb-4"><Alert tone="red">{sp.error}</Alert></div>;
  return null;
}
