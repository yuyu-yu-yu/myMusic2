# AI DJ Avatar Motion Pipeline

This project uses a pixel-art AI DJ girl avatar as the virtual radio host.

## Goal

Build a fast MVP animation system using a source image, optional image-to-video generated clips, and WebM playback in the frontend.

## Avatar source

Use this source image:

- `public/avatar/source/cancan.png`

## Motion states

Create and maintain these avatar motion states:

- `idle`: gentle breathing, blinking, small headphone glow, subtle pixel shimmer
- `listening`: she tilts her head slightly and listens to music
- `talking`: she smiles and speaks softly like an AI radio host
- `searching_music`: she looks through a floating music playlist or holographic panel
- `reading_book`: she reads a small book or notebook cutely
- `happy`: she reacts happily when a good song starts
- `on_air`: she acts like she is hosting a radio show

## Visual consistency rules

Always preserve:

- pixel art style
- anime girl face identity
- black short hair with blue/purple highlights
- large blue eyes
- headphones
- cyber radio / neon blue-purple aesthetic
- dark background
- AI DJ / ON AIR theme

Avoid:

- realistic rendering
- face identity drift
- extra fingers
- distorted hands
- unreadable new text
- changing the outfit too much
- changing the character into a different person

## Output rules

Generated videos should be saved as MP4 first:

- `public/avatar/generated/<motion>.mp4`

Then convert to WebM:

- `public/avatar/webm/<motion>.webm`

Frontend should use WebM files from:

- `/avatar/webm/<motion>.webm`

## Frontend rules

The existing frontend is static HTML, CSS, and module JavaScript. Do not introduce React unless the project is migrated to a build pipeline.

The reusable avatar UI should support:

- `idle`
- `listening`
- `talking`
- `searching`
- `reading`
- `happy`
- `on_air`

The avatar should render a looping muted video when a matching WebM exists, and fall back to the source PNG with CSS motion when it does not.

Use `image-rendering: pixelated` where appropriate.

## Secrets

Never put provider API keys in frontend code.

Read generation keys only from environment variables:

- `FAL_KEY`
- `RUNWAY_API_KEY`
- `RUNWAYML_API_SECRET`

## Validation

After code changes:

- run tests if available
- run typecheck if available
- run lint if available
- verify all referenced asset paths exist
