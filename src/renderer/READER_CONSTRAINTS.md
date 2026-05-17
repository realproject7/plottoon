# PlotLink Cartoon Reader Compatibility Constraints

PlotToon-generated publish markdown must satisfy the following constraints
for correct rendering in PlotLink's cartoon reader (plotlink#1214).

## Image Sequence

- Each image is a standard markdown image tag: `![alt](url)`
- One image per line, separated by blank lines
- Reader renders images top-to-bottom in document order
- Order in the markdown **is** the reading order — PlotToon must emit cuts
  in their intended sequence

## Alt Text

- Alt text must be non-empty (reader uses it for accessibility)
- Falls back to cut ID if no descriptive content is available
- May include direction, dialogue summary, narration, and SFX cues

## URL Format

- Absolute HTTPS URLs required (reader fetches directly)
- WebP and JPEG MIME types supported
- Dry-run output uses `[PLACEHOLDER:<cutId>]` — not valid for publish

## Title

- H1 heading (`# Title`) at the top of the document
- Reader displays this as the plot title
- Blank line required between title and first image

## Transcript (Optional)

- Placed after a horizontal rule (`---`)
- Reader treats content after `---` as metadata/transcript, not image content
- If `includeTranscript` is false, no `---` or transcript section is emitted
- Transcript does not affect image rendering

## HTML

- No raw HTML in output — reader strips it
- PlotToon's markdown generator produces only markdown syntax

## Spacing

- Blank line between each image tag (block-level parsing)
- Blank line after title heading
- These are required for PlotLink's markdown parser to treat images
  as separate block elements

## Prose/Fiction Compatibility

- These constraints apply only to `contentType: "cartoon"` publishes
- Prose/fiction publish output (if ever added) would follow different
  PlotLink reader expectations and should not adopt these constraints
