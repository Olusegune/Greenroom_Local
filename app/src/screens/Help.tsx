import { useApp } from "../ctx";

export default function Help() {
  const { go } = useApp();
  return <section className="help-screen"><span className="eyebrow">GREENROOM LOCAL</span><h1>Help & guide</h1><p className="lede">Your guide to getting from a script to finished audio.</p>
    <div className="help-grid">
      <article className="card"><h2>1. Create a project</h2><p>Create a project, then write dialogue as <code>NAME: words</code>. Use scene headings to organize your script.</p><button onClick={() => go("home")}>Open projects</button></article>
      <article className="card"><h2>2. Find a voice</h2><p>Open Voices, search the local collection, and choose Add. Piper and the chosen voice download once. Use the star for favorites and play or pause a sample after it is added.</p><button onClick={() => go("voices")}>Open voices</button></article>
      <article className="card"><h2>3. Cast and perform</h2><p>Assign a voice to each speaker on Cast. On Perform, set the pace and direction, generate takes, and choose your favorite. Piper is a plain speech engine and does not perform emotions or sound tags.</p><button onClick={() => go("cast")}>Open cast</button></article>
      <article className="card"><h2>4. Mix and export</h2><p>Arrange dialogue and imported music or effects on the Timeline, then export a mix, stems or production documents.</p><button onClick={() => go("timeline")}>Open timeline</button></article>
      <article className="card"><h2>Local AI setup</h2><p>Use Model Center to see exactly what is ready in Greenroom, what can be downloaded with setup, and what currently opens an official source page. Each card explains the next step before you download.</p><button onClick={() => go("models")}>Open Model Center</button></article>
      <article className="card"><h2>Privacy and rights</h2><p>Piper speaks locally after installation. Cloud engines require your own account and may send text to their providers. Only clone a voice with permission, and check each voice model’s licence.</p></article>
    </div>
  </section>;
}
