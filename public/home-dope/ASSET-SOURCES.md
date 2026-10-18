# Home local mock assets — 2026-10-07

- `twilight-clouds.webp`: Jason Leung, “Twists of Berries”, published 2018-02-20. Source: https://unsplash.com/photos/purple-clouds-u4Vz2MqX1fo . Downloaded from the photo's observed Unsplash image URL, resized by the image service to width 1920. Free commercial use under https://unsplash.com/license . Not the reference site's proprietary background. No people or property depicted.
- `Lora-Italic.ttf`: unmodified Google Fonts Lora variable italic, https://github.com/google/fonts/tree/main/ofl/lora . SIL Open Font License 1.1; full copyright and license in `Lora-OFL.txt`. Substitute for unlicensed GrandSlang, with visibly different letterforms. The reference site's Whyte/GrandSlang font files are not copied.
- Hero sky motion = option B, **animated still, not video**. No video file was downloaded or shipped (option A licensed-clip search not attempted within the session budget). Motion is CSS keyframes over `twilight-clouds.webp` (scale drift) plus the two SVGs below and an inline dashed route path.
- `cloud-a.svg`, `cloud-b.svg`: own work, drawn by hand-written SVG (ellipses + `feGaussianBlur`) for this mock on 2026-10-07. No external source; same project license as the repository.
- `v3-cloud-flight.mp4` (3,611,064 bytes, 10 s, unmodified) and `v3-cloud-poster.jpg`, used by `design-v3.html`: Pixabay video 180549 by bellergy, https://pixabay.com/videos/clouds-sunrise-sunset-dusk-sky-180549/ . Downloaded 2026-10-07 from the observed CDN files `https://cdn.pixabay.com/video/2023/09/14/180549-864532749_large.mp4` and `…_tiny.jpg`. Pixabay Content License (free commercial use, with restrictions): https://pixabay.com/service/license-summary/ . Clouds only, no people or logos.
- `v3-InstrumentSerif-Regular.ttf`, `v3-InstrumentSerif-Italic.ttf`: unmodified Google Fonts Instrument Serif, https://github.com/google/fonts/tree/main/ofl/instrumentserif , downloaded 2026-10-07. SIL Open Font License 1.1; full text in `v3-InstrumentSerif-OFL.txt`.
- Existing city photos, routes, sample plans, prices and food facts retain their original project sources. This asset file grants no additional permission for other images.

## Home A motion sources — 2026-10-07

- `src/sections/home/SplitHeading.tsx` adapts the *behaviour* of ReactBits SplitText (word split, staggered opacity/y reveal, once on view), https://github.com/DavidHDev/react-bits , upstream commit `ca44b3f9ee180676a06d7de8ec6bea84cddff85b`. It is a behaviour adaptation, not a code copy: the upstream component uses GSAP SplitText; this file re-implements the reveal on Motion (the already-installed `framer-motion` `animate`/`stagger`), words only. The upstream license is reproduced verbatim below, as required:

```text
MIT + Commons Clause License Condition v1.0

Copyright (c) 2026 David Haz

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, and distribute the Software **as part of an application, website, or product**, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

## Commons Clause Restriction

You may use this Software, including for any commercial purpose, **so long as you do not sell, sublicense, or redistribute the components themselves-whether alone, in a bundle, or as a ported version.**

## No Warranty

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

  Upstream source and license file were staged for review outside the repo (`home-a/tool-sources/ReactBits-SplitText.tsx`, `ReactBits-LICENSE.md`).
- `src/sections/home/glyphResolve.ts` (service-row title resolve): own glue code calling GSAP's ScrambleTextPlugin from the `gsap` npm package (3.15.0, GSAP standard "no charge" license, https://gsap.com/standard-license). GSAP is dynamically imported on the first row play only; no GSAP code is copied into the repo.
- Motion docs MCP and the 21st.dev connection were available during the session and consulted as references only; neither is used at runtime, and no 21st.dev code is in the product (per-component license unconfirmed).
