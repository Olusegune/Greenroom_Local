# Accessibility

What was tested on 0.12.0, how, and what it cannot show. Scripts: `scripts/qa/a11y.mjs` and `scripts/qa/keyboard.mjs` (headless Chrome against the demo build; `npx vite --port 5173` must be running).

## Automated audit (axe-core 4.10, WCAG 2.1 A and AA)

Twelve screens, each in the dark and the light theme (switched with the app's own Light and Dark button): Presets (genres, cards, compare with filters, Add to Cast panel), Agent Studio with a plan, Cast with profiles open, Perform, Voices, Export, Timeline, Model Center, Settings.

| | Dark | Light |
|---|---|---|
| First run | 0 violations | **108** colour-contrast failures |
| After fixes | 0 | **0** |

The light-theme failures were all from four pre-existing colour choices, fixed in `app/src/styles/refresh.css`:

1. The primary button used the dark theme's bright green (#65d89a) with white text (1.8:1). It now uses the light theme's accent (4.5:1) with a darker hover.
2. The small uppercase section labels used the same bright green on white (1.5:1). They now use the theme's accent text colour.
3. The third-level grey text was 4.1:1 on white; now 5.3:1.
4. The tag chips in the line editor took their text from a light group colour (down to 1.9:1); the text is now mixed toward the dark text colour, keeping the coloured border.

## Keyboard pass (real key presses)

Presets (genres, cards, compare, cast panel) and Agent Studio: every visible control is reached by Tab (controls inside a closed "More" menu are reached by opening it, and a radio group is entered once and moved with arrow keys, as native controls do); focus is never trapped; every focused control shows an outline or ring; Enter and Space activate buttons; Enter opens the Add to Cast panel, which has a name and a Close button; arrow keys switch between the three agent modes.

## Built in

Controls have names (favourite buttons say which preset; selects have labels); state is exposed with `aria-pressed`; results and plan changes are in `aria-live` regions; preset portraits are decorative (`alt=""`) because the name is always beside them; tables use header cells with scopes; nothing relies on colour alone (every status is also a word).

## Not tested (a person is needed)

Screen readers (NVDA, JAWS, Narrator, VoiceOver); Windows High Contrast and forced colours beyond the existing rule in `base.css`; browser zoom to 200% and text-only zoom; reduced motion; voice control; a switch device; touch. Automated tools find roughly a third of real problems. Other screens not listed above (Home, Write, Picture, Studio, History, SFX Studio, Voice lab, Help, the dialogs) were covered only by the existing smoke script for console errors, not by axe.
