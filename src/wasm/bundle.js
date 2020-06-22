#!/usr/bin/env node
/*
 * Copyright 2020 Sam Thorogood.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. You may obtain a copy of
 * the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations under
 * the License.
 */

/**
 * @fileoverview Node interface to a JS bundler.
 */

import fs from 'fs';
import build from './wrap.js';
import path from 'path';
import stream from 'stream';

import {processFile} from '../bundler/file.js';
import {Registry} from '../bundler/registry.js';
import * as rebuild from '../bundler/rebuild.js';


function resolve(other, importer) {
  if (/^\.{0,2}\//.test(other)) {
    return path.join(path.dirname(importer), other);
  }
  return other;
}


function internalBundle(runner, files) {
  const readable = new stream.Readable({emitClose: true});
  const write = readable.push.bind(readable);

  const registry = new Registry();
  const fileData = new Map();
  const unbundledImports = new Map();

  // Part #1: Parse every file and proceed recursively into dependencies. This matches ESM execution
  // order.
  const processed = new Set();
  const process = (f, toplevel = false) => {
    if (processed.has(f)) {
      return false;
    }
    processed.add(f);

    if (!fs.existsSync(f)) {
      unbundledImports.set(f, {});
      return true;
    }

    const buffer = fs.readFileSync(f);
    const {deps, externals, imports, exports, render} = processFile(runner, buffer);

    // Immediately resolve future dependencies.
    deps.forEach((dep) => process(resolve(dep, f)));

    // Store externals globally, and ensure they're not renamed here.
    const renames = {};
    externals.forEach((external) => {
      registry.global(external, f);
      renames[external] = external;
    });

    // processFile doesn't know how to resolve external imports; resolve here.
    for (const name in imports) {
      const d = imports[name];
      d.from = resolve(d.from, f);
    }

    fileData.set(f, {imports, exports, render, renames, toplevel});
  };
  for (const f of files) {
    process(path.resolve(f), true);
  }

  // Part #2: Remap all imports. This needs to be done before exports, as we might require the
  // additional glob export from another bundled file.
  for (const [f, data] of fileData) {
    const {imports, renames} = data;

    for (const x in imports) {
      let {from, name} = imports[x];

      // If the referenced export comes from within our bundle, then prefer its original name.
      const isBundled = fileData.has(from);
      if (isBundled) {
        const {exports: otherExports} = fileData.get(from);
        const real = otherExports[name];
        if (real === undefined) {
          if (name !== '*') {
            throw new Error(`${from} does not export: ${name}`);
          }
          // We can't use its original name, as it is "*". Use whatever it got imported as first.
          otherExports['*'] = '*';
        } else {
          name = real;
        }
      }

      const update = registry.register(name, from);
      renames[x] = update;

      // If the dep is unbundled, we need to record what it's called so we can import it later.
      if (!isBundled) {
        const mapping = unbundledImports.get(from);
        mapping[name] = update;
      }
    }
  }

  // Part #3: Announce all external modules we depend on.
  for (const [f, mapping] of unbundledImports) {
    // We can't include a glob-style with regular imports.
    // TODO(samthor): default also has odd rules (can go with either glob or misc).
    if ('*' in mapping) {
      write(`${rebuild.importModuleDeclaration({'*': mapping['*']}, f)};\n`);
      delete mapping['*'];

      // If we import anything else, we need to reimport below.
      let done = true;
      for (const key in mapping) {
        done = false;
        continue;
      }
      if (done) {
        continue;
      }
    }
    write(`${rebuild.importModuleDeclaration(mapping, f)}\n`);
  }

  // Part #4: Remap exports, and rewrite/render module content.
  for (const [f, {render, exports, renames, toplevel}] of fileData) {
    for (const x in exports) {
      const real = exports[x];
      if (!(real in renames)) {
        renames[real] = registry.register(real, f);
      }
    }

    // Someone wants the global exports of this file.
    if ('*' in exports) {
      const name = renames['*'];

      // This might include further exports.
      const extras = [];
      for (const key in exports) {
        if (key[0] === '*' && key.length !== 1) {
          extras.push(renames[key]);
        }
      }

      readable.push(`const ${name} = ${rebuild.globExports(exports, renames, extras)};\n`);
    }

    if (toplevel) {
      // Create a renamed export map before displaying it.
      const r = {};
      const starQueue = new Set();

      let any = false;
      for (const key in exports) {
        console.info('work on', key, exports[key], renames[exports[key]]);

        if (key[0] === '*') {
          const from = resolve(exports[key].substr(1), f);
          starQueue.add(from);
          continue;
        }

        r[key] = renames[exports[key]];
        any = true;
      }

      // Traverse all found "export * from ..." imports, including recursively.
      for (const f of starQueue) {
        if (!fileData.has(f)) {
          // This is an external file, so just export it blindly.
          // TODO(samthor): Not sure what order this ends up occuring in.
          write(`export * from ${JSON.stringify(f)};\n`);
          continue;
        }
        const {exports: otherExports} = fileData.get(f);

        for (const key in otherExports) {
          if (key[0] === '*') {
            if (key.length === 1) {
              // TODO: This is just a sign that something is requesting * from this file.
              // However it also shows up even in reexport mode.
              continue;
            }
            const from = resolve(otherExports[key].substr(1), f);
            starQueue.add(from);
            continue;
          }
          r[key] = registry.register(otherExports[key], f);
          any = true;
        }
      }

      any && write(`${rebuild.exportMappingDeclaration(r)};\n`);
    }

    render(write, (name) => {
      const update = renames[name];
      if (update !== undefined) {
        return update;
      }

      // Otherwise, this is local to this file: just make it unique to our bundle.
      return registry.name(name);
    });
  }

  readable.push(null);
  return readable;
}




/**
 * Builds a method which bundles.
 *
 * @return {function(string): !ReadableStream}
 */
export default async function bundler() {
  const source = path.join(path.dirname(import.meta.url.split(':')[1]), 'runner.wasm');
  const wasm = fs.readFileSync(source);

  const runner = await build(wasm);
  return (files) => {
    try {
      return internalBundle(runner, files);
    } catch (e) {
      // FIXME: we get _read() errors?!
      console.error(e);
      throw e;
    }
  }
}


(async function run() {
  const r = await bundler();
  const s = r(process.argv.slice(2));
  s.pipe(process.stdout, {end: false});
  s.resume();
  await new Promise((r) => s.on('close', r));
}());
