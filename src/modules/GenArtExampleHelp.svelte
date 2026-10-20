<script>
  import { onMount, onDestroy } from 'svelte';
  import { codeArtExamples } from '../lib/genart/codeArtExamples.js';
  import {
    codeArtExampleHelp, exampleHelpFundamentals, getExampleCameraHelp, getWalkthroughLine,
  } from '../lib/genart/codeArtExampleHelp.js';

  export let exampleId;
  export let onClose = () => {};

  let guideId = exampleId;
  let dialog;
  let content;
  let closeButton;
  let highlightedLine = 0;

  $: example = codeArtExamples.find(item => item.id === guideId);
  $: guide = codeArtExampleHelp[guideId];
  $: camera = getExampleCameraHelp(example);

  onMount(() => {
    dialog.showModal();
    closeButton.focus();
  });
  onDestroy(() => dialog?.close());

  function changeGuide() {
    highlightedLine = 0;
    content.scrollTop = 0;
  }

  function showSource(section) {
    highlightedLine = getWalkthroughLine(example, section);
    dialog.querySelector(`#example-source-${highlightedLine}`)?.scrollIntoView({ block: 'center' });
  }

  function containKeyboardFocus(event) {
    if (event.key !== 'Tab') return;
    const controls = dialog.querySelectorAll('button, select, a[href]');
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
</script>

<dialog
  bind:this={dialog}
  class="example-help-drawer"
  aria-labelledby="example-help-title"
  aria-describedby="example-help-description"
  on:close={onClose}
  on:keydown={containKeyboardFocus}
>
  <header>
    <div>
      <span class="eyebrow">Code Art / Example guide</span>
      <h2 id="example-help-title">{example.label}</h2>
    </div>
    <button bind:this={closeButton} class="close-button" on:click={() => dialog.close()} aria-label="Close example help">
      Close <span aria-hidden="true">&times;</span>
    </button>
    <div class="guide-picker">
      <label for="example-help-select">Guide example</label>
      <select id="example-help-select" bind:value={guideId} on:change={changeGuide}>
        {#each codeArtExamples as item (item.id)}
          <option value={item.id}>{item.label}</option>
        {/each}
      </select>
    </div>
    <p id="example-help-description">
      Explains the bundled example, not your edited code. Reading or switching guides does not load, run, or change the editor.
    </p>
    <nav aria-label="Example guide sections">
      <a href="#example-help-overview">Overview</a>
      <a href="#example-help-walkthrough">Walkthrough</a>
      <a href="#example-help-numbers">Numbers</a>
      <a href="#example-help-camera">{camera.length ? 'Camera' : 'Framing'}</a>
      <a href="#example-help-experiments">Try it</a>
      <a href="#example-help-cautions">Pitfalls</a>
      <a href="#example-help-source">Source</a>
      <a href="#example-help-basics">Basics</a>
    </nav>
  </header>

  <div class="guide-content" bind:this={content}>
    <section id="example-help-overview">
      <h3>What this example makes</h3>
      <p>{guide.summary}</p>
    </section>

    <section id="example-help-walkthrough">
      <h3>Code walkthrough</h3>
      <p>Read the construction in order. Each excerpt links to its line in the original source below.</p>
      <ol class="walkthrough">
        {#each guide.steps as section (section.title)}
          <li>
            <h4>{section.title}</h4>
            <button class="source-link" on:click={() => showSource(section)}>
              Show source line {getWalkthroughLine(example, section)}
            </button>
            <pre><code>{section.code}</code></pre>
            <p>{section.explanation}</p>
          </li>
        {/each}
      </ol>
    </section>

    <section id="example-help-numbers">
      <h3>Every number and setting</h3>
      <p>Coordinates, dimensions, loop bounds, angles, and formula constants have different jobs. {camera.length ? 'Camera values are explained separately below.' : 'This example draws directly in 2D; it has no camera settings.'}</p>
      <div class="table-scroll">
        <table>
          <caption>Parameters in {example.label}</caption>
          <thead><tr><th scope="col">Code / value</th><th scope="col">What it does</th><th scope="col">What to change</th></tr></thead>
          <tbody>
            {#each guide.parameters as row (row.code)}
              <tr><th scope="row"><code>{row.code}</code></th><td>{row.meaning}</td><td>{row.experiment}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    <section id="example-help-camera">
      <h3>{camera.length ? 'Camera and framing' : '2D framing'}</h3>
      {#if camera.length}
        <p>All positions are world coordinates, not millimetres. Auto-fit is enabled in this example.</p>
      {:else}
        <p>This example returns normalized 2D paths directly, without a camera, hidden-line removal, or scene auto-fit. X and Y run from -1 to +1; positive Y is upward. Grid contours span this square. The attractor example fits its own projected bounds with uniform scale. G-code paper settings determine the physical dimensions later.</p>
      {/if}
      <dl class="camera-values">
        {#each camera as row (row.code)}
          <dt><code>{row.code}</code></dt>
          <dd><p>{row.meaning}</p><p class="try-note">{row.experiment}</p></dd>
        {/each}
      </dl>
    </section>

    <section id="example-help-experiments">
      <h3>Experiments to try</h3>
      <p>Change one thing at a time in the editor, then Generate. These suggestions do not modify code automatically.</p>
      <ol>{#each guide.experiments as experiment (experiment)}<li>{experiment}</li>{/each}</ol>
    </section>

    <section id="example-help-cautions">
      <h3>Pitfalls and plotting notes</h3>
      <ul>{#each guide.cautions as caution (caution)}<li>{caution}</li>{/each}</ul>
    </section>

    <section id="example-help-source">
      <h3>Original source</h3>
      <p>This read-only reference always matches the bundled example. It does not reflect unsaved experiments in your editor.</p>
      <pre class="numbered-source" aria-label={`${example.label} original source`}><code>{#each example.code.split('\n') as line, index (index)}<span id={`example-source-${index + 1}`} class:highlighted={highlightedLine === index + 1}><span class="line-number" aria-hidden="true">{index + 1}</span>{line || ' '}</span>{/each}</code></pre>
    </section>

    <section id="example-help-basics">
      <h3>Shared concepts and limits</h3>
      <dl>
        {#each exampleHelpFundamentals as [title, explanation] (title)}
          <dt>{title}</dt><dd>{explanation}</dd>
        {/each}
      </dl>
    </section>
    <footer>
      3D scene studies inspired by
      <a href="https://github.com/fogleman/ln" target="_blank" rel="noopener noreferrer">Fogleman's ln</a>.
      This app uses an independent renderer, not a port of its source.
    </footer>
  </div>
</dialog>

<style>
  .example-help-drawer {
    position: fixed;
    inset: 0;
    margin: 0 0 0 auto;
    padding: 0;
    width: min(880px, calc(100vw - 24px));
    max-width: none;
    height: 100dvh;
    max-height: 100dvh;
    box-sizing: border-box;
    border: 1px solid #34434b;
    border-right: 0;
    border-radius: 12px 0 0 12px;
    background: #101619;
    color: #d4dce0;
    box-shadow: -16px 0 60px #0008;
    overflow: hidden;
    font-size: 14px;
    line-height: 1.6;
  }
  .example-help-drawer[open] { display: flex; flex-direction: column; }
  .example-help-drawer::backdrop { background: #0009; }
  header {
    flex: 0 0 auto;
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 10px 16px;
    padding: 20px 24px 12px;
    border-bottom: 1px solid #34434b;
    background: #141e23;
  }
  h2 { margin: 0; font-size: 24px; color: #f0f6f8; }
  .eyebrow { color: #8ba4b0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; }
  button, select { color: #dce8ee; background: #1d2a31; border: 1px solid #4b636f; border-radius: 4px; font: inherit; }
  button { cursor: pointer; padding: 5px 10px; }
  button:hover { background: #293f4a; }
  button:focus-visible, a:focus-visible, select:focus-visible { outline: 2px solid #00d4ff; outline-offset: 3px; }
  .close-button { align-self: start; }
  .guide-picker, header p, nav { grid-column: 1 / -1; }
  .guide-picker { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  select { padding: 5px 8px; min-width: 0; max-width: 100%; }
  header p { margin: 0; font-size: 12px; color: #b0c0c8; }
  nav { display: flex; gap: 6px 16px; flex-wrap: wrap; font-size: 13px; }
  a, .source-link { color: #62daef; }
  .guide-content { flex: 1; min-height: 0; overflow-y: auto; padding: 0 24px 24px; }
  section { padding-top: 24px; scroll-margin-top: 12px; }
  h3 { color: #eef6fa; font-size: 20px; margin: 0 0 10px; }
  h4 { color: #e1edf3; font-size: 16px; margin: 0 0 4px; }
  p { margin: 8px 0 12px; }
  li { margin-bottom: 12px; }
  ol, ul { padding-left: 24px; }
  .walkthrough li { margin-bottom: 24px; padding-left: 4px; }
  .source-link { font-size: 12px; padding: 2px 8px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  pre { background: #090f12; padding: 12px; border: 1px solid #2a3c45; border-radius: 5px; overflow-x: auto; line-height: 1.7; }
  .table-scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  caption { text-align: left; color: #abc0cb; margin-bottom: 8px; }
  th, td { padding: 12px; text-align: left; vertical-align: top; border: 1px solid #33454e; overflow-wrap: anywhere; }
  thead th { background: #1b2b33; color: #dcebf2; }
  tbody th { width: 25%; font-weight: normal; background: #121e24; }
  dt { font-weight: 600; color: #c5e9f3; margin-top: 16px; overflow-wrap: anywhere; }
  dd { margin: 4px 0 14px; }
  .try-note { color: #a6bdc8; }
  .numbered-source { padding: 12px 0; }
  .numbered-source code > span { display: block; padding-right: 16px; }
  .line-number { display: inline-block; width: 3em; padding-right: 1em; text-align: right; color: #80949f; user-select: none; }
  .highlighted { background: #194354; outline: 1px solid #36819a; }
  footer { margin-top: 28px; padding-top: 16px; border-top: 1px solid #33454e; color: #a6bdc8; font-size: 12px; }
  @media (max-width: 600px) {
    .example-help-drawer { width: 100vw; border-radius: 0; }
    header { padding: 12px; gap: 6px 12px; }
    h2 { font-size: 20px; }
    .guide-content { padding: 0 12px 20px; }
    table { min-width: 580px; }
    nav { gap: 4px 12px; }
  }
</style>
