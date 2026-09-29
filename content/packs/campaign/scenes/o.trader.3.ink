# draft
// FIRST DRAFT (phase 6): rewrite or sign off. Voice: docs/voice.md. Flags: docs/story-drafts.md.
// The trader's last night (docs/tech-spec.md §72). It changes nothing: the ending follows from the run.
EXTERNAL flag(name)
EXTERNAL home(id)
{ not home("gisli"): -> gone }
You think of Gisli, who'll be watching the sky tonight and not the water, whatever he promised himself.
{
- flag("wood") || flag("ferryman") || flag("loki_deal"):
  Wherever they are going tonight, he'll have worked out the way by the stars, and he'll be checking it against the ones still out.
- else:
  He'll be at your mother's table with your father's scales, weighing out what's left in the pot, so everyone knows what they have. It isn't much. It's exact.
}
* [Count what you have left.]
  You tip your purse out on the table and count it, twice, the way your father taught you. It comes to the same both times, which is something.
* [Leave the purse shut.]
  For once in your life you don't count it. Your father would be appalled. Gisli would understand.
- The mist comes up from the battlefield and doesn't clear.
-> END

=== gone ===
You think of Gisli, who went down to Hel still counting the times your father said it wasn't his fault. You hope somebody down there has told him it was enough.
-> END
