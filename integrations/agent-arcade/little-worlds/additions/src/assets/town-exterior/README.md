# Village street and house meshes

The village plaster walls, shutters, tile roofs, cottage and lantern are models from the local planet-claude-modules project. The [vendor manifest](../claude-geometry/PROVENANCE.json) records the source and per-file digests. This project already hosts those factories.

The projecting roof window, timber brace, bench and sign awning use triangles from Kenney's **Fantasy Town Kit 2.0**. The OBJ export supplies the shape and face palette. The importer fits each piece to the existing village in metres, removes the duplicate base roof or wall, and maps its palette slots to game materials. Source and archive SHA-256 values appear in [provenance.json](provenance.json). The original [author notice](Kenney-License.txt) accompanies the meshes. [Kenney release](https://kenney.nl/assets/fantasy-town-kit) · [Author download on OpenGameArt](https://opengameart.org/content/fantasy-town-kit) · [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

To reproduce the packed mesh from the downloaded archive, run `python tools/import-village-town-art.py PATH_TO_ARCHIVE` from the repository. Vertices use local 0.1 mm units. The client loads them from its own bundle.
