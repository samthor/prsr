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
 * @fileoverview Node interface to a JS imports rewriter.
 */

import fs from 'fs';
import path from 'path';
import build from './wrap.js';
import stream from 'stream';

const PENDING_BUFFER_MAX = 1024 * 16;

const decoder = new TextDecoder('utf-8');

/**
 * Builds a method which rewrites imports from a passed filename.
 *
 * @param {function(string, string): string} resolve passed importee and importer, return new import
 * @param {number=} pages of wasm memory to allocate
 * @return {function(string): !ReadableStream}
 */
export default async function rewriter(resolve, pages = 128) {
  const source = path.join(path.dirname(import.meta.url.split(':')[1]), 'runner.wasm');
  const wasm = fs.readFileSync(source);

  const run = await build(wasm, pages);

  return (f) => {
    const fd = fs.openSync(f);
    const stat = fs.fstatSync(fd);
    const readable = new stream.Readable();

    let buffer = null;
    const prepare = (b) => {
      buffer = b;  // store for later

      const read = fs.readSync(fd, buffer, 0, stat.size, 0);
      if (read !== stat.size) {
        throw new Error(`did not read all bytes at once: ${read}/${stat.size}`);
      }
    };

    let sent = 0;

    run(stat.size, prepare, (p, len, line_no, type, special) => {
      if (special !== 1) {
        if (p - sent > PENDING_BUFFER_MAX) {
          // send some data, we've gone through a lot
          readable.push(buffer.subarray(sent, p));
          sent = p;
        }
        return;
      }

      const s = parseStringLiteralInner(buffer.subarray(p + 1, p + len - 1));
      const out = resolve(s, f);
      if (out == null || typeof out !== 'string') {
        return;  // do nothing, data will be sent later
      }

      // bump to high water mark
      readable.push(buffer.subarray(sent, p));

      // write new import
      readable.push(JSON.stringify(out), 'utf-8');

      // move past the "original" string
      sent = p + len;
    });

    // send rest
    readable.push(buffer.subarray(sent, buffer.length));
    readable.push(null);
    return readable;
  };
}


/**
 * @param {!Uint8Array} view
 * @return {string}
 */
function parseStringLiteralInner(view) {
  if (view.some((c) => c === 92)) {
    // take the slow train, choo choo, filter out slashes
    let skip = false;
    view = view.filter((c, index) => {
      if (skip) {
        skip = false;
        return true;  // always allow
      }
      skip = (c === 92);
      return !skip;
    });
  }

  return decoder.decode(view);
}

