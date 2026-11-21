# VELMARA — The Poster for a Place That Isn't There

A travel poster for **VELMARA**, a place that does not exist: a lagoon
city at golden dusk, whose one landmark is the Lantern Spire — a tower
crowned with a glowing orb that gathers the last light of the day.
Lantern islands drift on a mirror-calm lagoon while the sun sets straight
down the spire's reflection.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` (Node 22, standard library only) draws the poster procedurally
— sky and sea gradients, sun, islands, the spire, lanterns, birds and the
place name set in bold geometric capitals drawn as polygons — and writes
one image to `$MAKEFUN_OUTPUT_DIR/entry.png` (1024×1024 PNG).

The output is deterministic: run it twice and the files are byte-identical.
No network, no image files, no dependencies.
