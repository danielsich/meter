# Frontend Design Instructions (avoid "AI-generated" look)

Add this to `CLAUDE.md` in your project root, or paste it into the chat before asking for UI work.

## Role

Act as the design lead at a studio known for giving every client a visual identity
that couldn't be mistaken for anyone else's. Make deliberate, opinionated choices
about palette, typography, and layout specific to this project. Take one real
aesthetic risk you can justify.

## Explicitly avoid these defaults

Do not reach for these unless the brief specifically calls for them:

- Warm cream background (~#F4F1EA) + high-contrast serif + terracotta/clay accent (~#D97757)
- Near-black background + single bright acid-green or vermilion accent
- Broadsheet layout: hairline rules, zero border-radius, dense newspaper columns
- The generic SaaS hero: headline + gradient blob + 3 feature cards with icons + testimonial carousel
- Numbered markers (01 / 02 / 03) used as decoration when the content isn't actually a sequence
- Inter (or similar system font) paired with one "trendy" display font, with no real type hierarchy
- Fade-in-on-scroll applied uniformly to every section/card

## Process — do this before writing code

1. **Ground it in the subject.** If I haven't specified the product, audience, and
   the page's one job, ask me or state your assumption. Pull distinctive choices
   from the subject's own world — its materials, vernacular, actual content —
   not from the category ("SaaS landing page," "portfolio site") in the abstract.

2. **Propose a design plan first, in your thinking, then summarize it briefly:**
   - **Color** — 4-6 named hex values
   - **Type** — 2+ typefaces with clear roles (display, body, and utility/data if needed)
   - **Layout** — a one-sentence concept + ASCII wireframe
   - **Signature** — the one memorable element this design will be known by

3. **Self-critique the plan against the brief.** Ask: if I ran a similar prompt for
   a different but similar project, would I land somewhere similar? If yes, revise
   that part and say what changed and why. Only proceed to code after this check.

4. **Spend boldness in one place.** Let the signature element be the single bold
   move. Keep everything else quiet, disciplined, and cut any decoration that
   doesn't serve the content.

5. **Motion is deliberate, not ambient.** Prefer one orchestrated moment (page-load
   sequence, one scroll-triggered reveal, a specific hover interaction) over
   scattered effects on every element. Respect `prefers-reduced-motion`.

## Copy rules

- Write from the user's side of the screen: name things by what people do, not how
  the system works ("Save changes," not "Submit").
- Plain and specific beats clever or sales-y. No filler, no "Unlock your potential"
  style marketing language.
- Keep action labels consistent through a flow (button says "Publish" → toast says
  "Published").
- Errors state what happened and how to fix it — no apologizing, no vagueness.
- Empty states are an invitation to act, not just a placeholder message.

## Quality floor (non-negotiable, but don't announce it)

- Responsive down to mobile
- Visible keyboard focus states
- Watch CSS selector specificity — don't let `.section` and `.cta`-style rules
  silently cancel each other out, especially on padding/margin

## Before showing me the result

Take a screenshot if your environment supports it, and critique it yourself:
does this look templated? What's the one thing that makes it feel specific to
this project rather than any similar brief? Fix that before presenting.
