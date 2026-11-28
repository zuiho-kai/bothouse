# Little Worlds scenery meshes

Quaternius created the original models in [Stylized Nature MegaKit](https://quaternius.com/packs/stylizednaturemegakit.html). This directory uses the CC0 1.0 Universal terms in the [Standard-1.0 download](https://store.godotengine.org/asset/quaternius/stylized-nature-megakit/) offered by Quaternius. The publisher's notice is in [License_Standard.txt](License_Standard.txt). [provenance.json](provenance.json) pins the ZIP and the exact glTF members and colour maps used.

| Game scenery | Original source model | Indexed triangles per asset |
| --- | --- | --- |
| Wild broadleaf and planted tree | `CommonTree_5` | 189 wild / 438 close |
| Wild conifer | `Pine_5` | 104 wild |
| Wild shrub | `Bush_Common` | 12 low / 80 standard |
| Loose rock | `Pebble_Round_5` | 20 low / 40 standard |
| Planted flower group | `Flower_3_Group` | 104 distant / 195 close, plus the game's pot |

The conversion flattens each selected glTF primitive into indexed Three.js position, normal and UV buffers, applies meshoptimizer 1.1.1 to the index buffer, and packs the resulting buffers in `meshes.json`. It shifts the local base to ground level, normalises height, and downsamples colour maps to 256 pixels in lossless WebP using FFmpeg. The shrub keeps the original alpha mask with the village’s muted green palette. It uses the existing village lighting and base-colour textures, with no normal maps or engine-specific shaders. The pot is host geometry scaled to the established saved-object dimensions.

Terrain decor reuses the original instance transforms, normals and counts. Each replacement fits the outgoing kind's geometry budget, so distant trees may retain their original low-LOD model. The host keeps its original assets for biome-specific cactus, agave, ice spires and blueprint scenery embedded in structures.
