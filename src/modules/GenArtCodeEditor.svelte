<script>
  import { onMount, onDestroy } from 'svelte';
  import {
    autocompletion, completeFromList, completionKeymap,
    snippetCompletion,
  } from '@codemirror/autocomplete';
  import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
  import {
    javascript, localCompletionSource, scopeCompletionSource, snippets,
  } from '@codemirror/lang-javascript';
  import {
    bracketMatching, defaultHighlightStyle, foldGutter, indentOnInput,
    syntaxHighlighting,
  } from '@codemirror/language';
  import { EditorState } from '@codemirror/state';
  import { oneDark } from '@codemirror/theme-one-dark';
  import {
    drawSelection, EditorView, highlightActiveLine,
    highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers,
  } from '@codemirror/view';

  export let value = '';
  export let onChange = () => {};

  let host;
  let view;

  const keywords = [
    'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
    'else', 'export', 'false', 'finally', 'for', 'function', 'if', 'import',
    'let', 'new', 'null', 'return', 'static', 'switch', 'this', 'throw',
    'true', 'try', 'typeof', 'var', 'while', 'yield',
  ].map(label => ({ label, type: 'keyword' }));

  const artHelpers = [
    ...[
      ['solid.cone', 'solid.cone({ detail: 8 }).draw("silhouette")', 'Create a capped cone'],
      ['solid.cylinderBetween', 'solid.cylinderBetween([0,0,0], [0,0,1], { radius: 0.1, draw: "silhouette" })', 'Connect two 3D points'],
      ['solid.coneBetween', 'solid.coneBetween([0,0,0], [0,0,1], { radius: 0.3, draw: "silhouette" })', 'Cone from base to tip'],
      ['solid.union', 'solid.union(${shapeA}, ${shapeB})', 'Combine solid volumes'],
      ['solid.intersection', 'solid.intersection(${shapeA}, ${shapeB})', 'Keep overlapping volume'],
      ['solid.difference', 'solid.difference(${body}, ${cut})', 'Subtract solid volumes'],
      ['solid.function', 'solid.function({ x: [-2,2], y: [-2,2], z: [-4,1], height: (x,y) => -1/(x*x+y*y) })', 'Bounded function surface'],
      ['mesh.from', 'mesh.from({ vertices: ${vertices}, faces: ${faces} })', 'Create a triangle mesh'],
      ['mesh.obj', 'mesh.obj(assets["${model.obj}"]).fit()', 'Import a local OBJ mesh'],
      ['mesh.stl', 'mesh.stl(assets["${model.stl}"]).fit()', 'Import ASCII or binary STL'],
      ['paths3d', 'paths3d(${[[[0,0,0],[1,0,1]]]})', 'Draw 3D polylines with scene occlusion'],
      ['latLng', 'latLng(${latitude}, ${longitude})', 'Latitude/longitude to a unit sphere point'],
      ['random', 'random(${42})', 'Create a seeded random-number function'],
      ['contours', 'contours(${field}, ${size}, ${0.5})', 'Extract 2D contour paths from a square scalar grid'],
    ].map(([label, snippet, detail]) => snippetCompletion(snippet, { label, detail, type: 'function' })),
    snippetCompletion('solid.heightfield({ x: [-2, 2], y: [-2, 2], lines: 70, samples: 160, style: "parallel", height: (x, y) => Math.cos(8 * Math.hypot(x, y)) * 0.2 })', {
      label: 'solid.heightfield',
      detail: 'Create a 3D surface from height(x, y)',
      type: 'function',
    }),
    snippetCompletion('scene().add(${})', {
      label: 'scene',
      detail: 'Create a shared 3D scene',
      type: 'function',
    }),
    snippetCompletion('solid.sphere({ detail: 8 }).translate(0, 0, 0)', {
      label: 'solid.sphere',
      detail: 'Add a transformable 3D sphere',
      type: 'function',
    }),
    snippetCompletion('solid.cube({ detail: 8 }).translate(0, 0, 0)', {
      label: 'solid.cube',
      detail: 'Add a transformable 3D cube',
      type: 'function',
    }),
    snippetCompletion('solid.torus({ detail: 8 }).translate(0, 0, 0)', {
      label: 'solid.torus',
      detail: 'Add a transformable 3D torus',
      type: 'function',
    }),
    snippetCompletion('solid.cylinder({ detail: 8 }).translate(0, 0, 0)', {
      label: 'solid.cylinder',
      detail: 'Add a transformable 3D cylinder',
      type: 'function',
    }),
    snippetCompletion('sphere({ detail: 10, azimuth: 35, elevation: 25 })', {
      label: 'sphere',
      detail: 'Visible 3D sphere paths',
      type: 'function',
    }),
    snippetCompletion('cube({ detail: 10, azimuth: 35, elevation: 25 })', {
      label: 'cube',
      detail: 'Visible 3D cube paths',
      type: 'function',
    }),
    snippetCompletion('torus({ detail: 10, azimuth: 35, elevation: 25 })', {
      label: 'torus',
      detail: 'Visible 3D torus paths',
      type: 'function',
    }),
    snippetCompletion('cylinder({ detail: 10, azimuth: 35, elevation: 25 })', {
      label: 'cylinder',
      detail: 'Visible 3D cylinder paths',
      type: 'function',
    }),
    snippetCompletion('combine(${})', {
      label: 'combine',
      detail: 'Join path arrays',
      type: 'function',
    }),
    snippetCompletion('transform(${paths}, { scale: 1, rotate: 0, translateX: 0, translateY: 0 })', {
      label: 'transform',
      detail: 'Transform paths in 2D',
      type: 'function',
    }),
    snippetCompletion('circle({ radius: 0.5, steps: 120 })', {
      label: 'circle',
      detail: 'Create a circle path',
      type: 'function',
    }),
    snippetCompletion('polyline(${[[0, 0], [0.5, 0.5]]})', {
      label: 'polyline',
      detail: 'Create a path from points',
      type: 'function',
    }),
  ];

  onMount(() => {
    view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          foldGutter(),
          drawSelection(),
          indentOnInput(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          bracketMatching(),
          highlightActiveLine(),
          keymap.of([...completionKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
          javascript(),
          autocompletion({
            activateOnTyping: true,
            maxRenderedOptions: 10,
            override: [
              completeFromList([...artHelpers, ...snippets, ...keywords]),
              localCompletionSource,
              scopeCompletionSource({
                solid: {
                  sphere: true,
                  cube: true,
                  torus: true,
                  cylinder: true,
                  heightfield: true,
                  cone: true,
                  cylinderBetween: true,
                  coneBetween: true,
                  union: true,
                  intersection: true,
                  difference: true,
                  function: true,
                },
                mesh: { from: true, obj: true, stl: true },
                assets: {},
              }),
            ],
          }),
          oneDark,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            'aria-label': 'Art code',
            spellcheck: 'false',
            autocapitalize: 'off',
            autocomplete: 'off',
          }),
          EditorView.updateListener.of(update => {
            if (update.docChanged) onChange(update.state.doc.toString());
          }),
          EditorView.theme({
            '&': { height: '100%', fontSize: '12px' },
            '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
            '.cm-gutters': { borderRight: '1px solid #283238' },
            '.cm-activeLineGutter': { backgroundColor: '#1b2930' },
            '.cm-activeLine': { backgroundColor: '#101b20' },
            '.cm-cursor': { borderLeftColor: '#00d4ff' },
            '.cm-selectionBackground, ::selection': { backgroundColor: '#17475a !important' },
            '&.cm-focused': { outline: '1px solid #00d4ff88' },
          }),
        ],
      }),
      parent: host,
    });
  });

  onDestroy(() => view?.destroy());

  $: if (view && value !== view.state.doc.toString()) {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  }
</script>

<div class="code-editor" bind:this={host}></div>

<style>
  .code-editor {
    flex: 1;
    min-height: 0;
    width: 100%;
    overflow: hidden;
    border: 1px solid #30383d;
    border-radius: 4px;
    background: #090d10;
  }

  .code-editor :global(.cm-editor) {
    height: 100%;
  }
</style>
