// Country flags as real SVGs from the MIT-licensed `flag-icons` package. Emoji flags are not used because Windows draws
// them as letters. A flag is a visual cue for where a language is mainly spoken, never a claim about a voice.

const urls = import.meta.glob("/node_modules/flag-icons/flags/4x3/*.svg", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const byCode = new Map(Object.entries(urls).map(([path, url]) => [path.split("/").pop()!.replace(".svg", ""), url]));

export function Flag({ cc, size = 22 }: { cc: string; size?: number }) {
  const url = byCode.get(cc);
  if (!url) return <span className="flag-ph" style={{ width: size, height: Math.round(size * 0.75) }} aria-hidden="true" />;
  return <img className="flag" src={url} width={size} height={Math.round(size * 0.75)} alt="" aria-hidden="true" />;
}
