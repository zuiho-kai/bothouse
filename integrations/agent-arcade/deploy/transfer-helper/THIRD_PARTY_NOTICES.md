# Transfer helper dependency notices

This independent package uses the following MIT-licensed direct dependencies:

- [tus-node-server](https://github.com/tus/tus-node-server): `@tus/server`
  2.4.7 and `@tus/utils` 0.7.3 declare MIT. The server package includes the
  repository's MIT license text; the fixed utils package declares MIT in its
  metadata but does not include a separate LICENSE file. Preserve the server's
  supplied license and copyright notice with this deployment.
- [yazl](https://github.com/thejoshwolfe/yazl): 3.3.1, MIT; its installed
  package includes the license.

Preserve the dependencies' distributed license files when redistributing a
deployment. Exact transitive packages and npm integrity values are recorded in
`package-lock.json`; do not remove their license files. No NapCat implementation
is copied into this service. The original helper code follows this repository's
license. The public synthetic TLS test key is not a deployment credential.

## tus license text

The npm metadata for `@tus/utils` 0.7.3 identifies repository commit
`ce151f9eb6fc076eb5c34f5d631c6ed27a113798`. Its
[MIT license](https://github.com/tus/tus-node-server/blob/ce151f9eb6fc076eb5c34f5d631c6ed27a113798/LICENSE),
checked 2026-11-07, exactly matches the license distributed with `@tus/server`
2.4.7. The complete copyright and permission text is retained here for the
utils package, whose npm archive omits a separate LICENSE file.

```text
The MIT License (MIT)

Copyright (c) 2015 tus - Resumable File Uploads

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
