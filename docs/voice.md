# Voice guide

How *Chooser of the Slain* sounds: for rewriting the drafts, for new scenes and for anyone helping with the words. The mechanics of writing a scene (Ink, tags, flags) are in `docs/story-drafts.md`.

## The tone in one line

A dry comedy about paperwork at the end of the world, told straight, over a family that is really struggling. The gods' bureaucracy is the joke. The dead and the family are never the joke.

## Rules

- **Plain modern English, Norse things.** Short sentences. Concrete nouns from the world: hearth, turf roof, seax, tally stick, mead bench, rings. No "thee" and "thou", no "okay", "boss", "minutes" or "office". Time is daylight and dusk, money is rings.
- **Deadpan, not wacky.** The comedy comes from people treating the absurd as routine. Nobody winks at the player.
- **One joke per beat.** Let the serious line land without a punchline after it.
- **Show the rule, then the cost.** Every morning teaches one rule and says what it costs (daylight, a ring, a fine). Nights show what the rings are for.
- **Nobody explains Odin.** Characters report decrees; they don't justify them.
- **Specific over general.** "A hole over Asa's bed the size of a shield", not "the roof needs repairs".
- **The dead get dignity.** They can be vain, confused, cowardly or lying, and that can be funny. Death itself, grief and wounds are not played for laughs. Wounds are described, never dwelt on.
- **Choices are stances, never traps.** Each option is a way of being (kind, honest, obedient, curious, silent). None is secretly the wrong answer, and nothing happens by accident: consequences come from choices, never from mistakes (build plan §1).

## People

| Who | Sounds like |
|---|---|
| **Skögul**, your trainer | Short, flat statements. Gives rules as facts. Tired, fond, never soft. At most one dry joke a scene. Eats during work. |
| **Ulf**, your brother | Warm, practical, understates every hardship ("the roof held through most of the storm"). Counts in rings. Protects Asa from the truth. |
| **Asa**, your little sister | Heard through Ulf's letters. Innocent questions that land hard ("has she seen Grandfather?"). A child: she can fall ill or leave, never die. |
| **Ragna**, your mother | Heard through Ulf. Proud, worried, feeds people. |
| **The stranger** (Loki, unnamed until later) | Polite, delighted, precise. Compliments odd details (nails). Never threatens. Always leaves a small wrongness behind. His lips carry small stitch scars (Brokkr sewed them shut), the Day 12 tell. |
| **The quartermaster** | Never seen. Birch-bark decrees in a very small hand. Enjoys fines. |
| **Loki**, named from Day 12 | The stranger, once Skögul has named him. The same manners. Deals, never threats; he keeps names "somewhere very dry". |
| **The clerk** (Day 10) | Of the White Christ's department of the dead. Polite, precise, tired; loves a form, fears a duplicate. Kind to the souls in his care. He never preaches and nobody mocks his faith: the joke is two departments sharing one table. |
| **Muninn** (Day 13) | Odin's raven of memory, forgetting more each day. Speaks in short, certain sentences, then loses the thread. |
| **Móðguðr** (Day 14) | Keeper of the bridge to Hel's hall. Pale, formal, literal. Speaks for Hel and waits to be noticed. |
| **Hel** (Day 17, at the desk) | Half a young woman's face, half a week-old bruise, both held still. Says little, expects nothing, is never angry. Speaks of Odin as someone who likes to be first. |
| **Þökk** (Day 15, at the desk) | Loki as an old woman in a grey shawl, the one who wouldn't weep for Baldr. Warm hands, which the dead's never are; a young man's laugh when seen through. The lips give her away. |
| **Thorvald the Unlucky** | Cheerful, bewildered and never quite dead. He should have died many times; the joke is that he's the luckiest man alive. |
| **The ferryman** | Never seen. Older than the rocks, won't give his name, takes rings. |
| **The dead** | By persona: braggarts perform for an audience, the confused ask about tables, cowards look for a quieter hall. Each line is something a person would say at a gate, not a clue read aloud. |

## Lengths

From the build plan's word budget: a morning is about 350 words with one choice; a night is about 450 with one or two. A story soul says two or three lines. Decrees are one sentence.

## Words to keep consistent

Skögul (with the ö). Valhalla, Hel (the place and the goddess), Fólkvangr, Rán, Naglfar. Ragna, Ulf, Asa. Rings, not coins. The gate of the slain, the queue, the stamp, the slate. "The fled", not "deserters". A soul's weapon is whatever the soul calls it; the art draws that weapon.

## Lines for the dead

The dead speak from templates (`templates/*.yaml`, strings `tm.*`, `rv.*`, `tl.*`, `q.*`): a soul's lines are picked for it, so a line has to be true of every soul that can say it. What went wrong before (audit item 1) and the rules that came out of it:

- **Nothing the soul's body can contradict.** Name the weapon with `{weapon}`, never "axe": the soul's lines share one weapon, and the art draws it. No ages ("seventy winters"): the old dead are 64 to 85. Anything gendered goes through `{gender, select, f {…} other {…}}`. A confession names the real cause with `{truth, select, …}`.
- **A line about one fact holds whatever else is true.** Huginn reports "never fled" and "no weapon" for souls who died in bed too, so those lines can't mention fighting; only lines that claim a battle death can.
- **A fact decides its words.** An Ulfberht is a sword: the blade fact's `words` makes every line of a soul with a marked blade, or who claims one, say sword, and the art draws one.
- **No line gives the answer away.** A line only liars say is a free answer: Loki's "plain man" line was. Honest souls say Loki's lines too now, and a test fails if any line is spoken as a lie 80% of the time or more. Persona-only variants are where this creeps in (only cowards and the confused claimed baptism, and they were nearly all liars), so give every claim variants anyone can say. When liars always make a claim and honest souls seldom do, raise the honest chance for that value (`speech.yaml` `chances`).
- **One story per answer.** Every message of a question template plays, in order. Two alternative stories go in two templates.
- **Enough variants to go round.** A long day hears the common lines (who they are, how they died, the weapon, the back) a dozen times. Story days spread each kind of line across the queue (`spreadLines`), but that can't stretch three variants over twenty souls. Write new variants in the campaign pack; core lines are the Daily's.

## Content rules

The dead are adults. No self-harm, no sexual violence, no slurs. Religion is played as rival afterlife departments, never as mockery of belief. The Christian clerk's storyline gets a sensitivity read.
